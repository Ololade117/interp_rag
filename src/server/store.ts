import { Pinecone } from '@pinecone-database/pinecone';
import { computeKeywordScore, cosineSimilarity } from './rag.ts';
import type {
  DocumentRecord,
  RetrievedChunk,
  StorageBackend,
  StoredChunk,
} from './types.ts';

// Clean adapter interface so we can swap between Pinecone and In-Memory storage
export interface VectorStoreAdapter {
  saveChunks(chunks: StoredChunk[]): Promise<void>;
  search(params: {
    query: string;
    queryEmbedding: number[];
    namespace: string;
    topK: number;
    hybridAlpha: number;
    minScore: number;
  }): Promise<RetrievedChunk[]>;
  deleteDocument(documentId: string, namespace: string, chunkIds: string[]): Promise<void>;
}

export function isPineconeConfigured(): boolean {
  return Boolean(
    process.env.PINECONE_API_KEY?.trim() && process.env.PINECONE_INDEX?.trim()
  );
}

export function getPineconeConfig() {
  const apiKey = process.env.PINECONE_API_KEY?.trim() || '';
  const indexName = process.env.PINECONE_INDEX?.trim() || '';
  const rawDim = Number(process.env.PINECONE_DIMENSION || 768);
  const dimension = Number.isFinite(rawDim) && rawDim > 0 ? rawDim : 768;
  return { apiKey, indexName, dimension };
}

// 1. Simple In-Memory Vector Store (for quick scratch tests)
class MemoryVectorStore implements VectorStoreAdapter {
  public chunks: StoredChunk[] = [];

  async saveChunks(newChunks: StoredChunk[]): Promise<void> {
    this.chunks.push(...newChunks);
  }

  async search(params: {
    query: string;
    queryEmbedding: number[];
    namespace: string;
    topK: number;
    hybridAlpha: number;
    minScore: number;
  }): Promise<RetrievedChunk[]> {
    const { query, queryEmbedding, namespace, topK, hybridAlpha, minScore } = params;

    const candidates = this.chunks.filter((c) => c.namespace === namespace);

    const scored: RetrievedChunk[] = candidates.map((c) => {
      const vectorScore = Math.max(0, cosineSimilarity(queryEmbedding, c.embedding));
      const keywordScore = computeKeywordScore(query, c.text);
      const combinedScore = hybridAlpha * vectorScore + (1 - hybridAlpha) * keywordScore;

      return {
        id: c.id,
        documentId: c.documentId,
        documentTitle: c.documentTitle,
        chunkIndex: c.chunkIndex,
        text: c.text,
        vectorScore: Number(vectorScore.toFixed(4)),
        keywordScore: Number(keywordScore.toFixed(4)),
        combinedScore: Number(combinedScore.toFixed(4)),
      };
    });

    return scored
      .filter((r) => r.combinedScore >= minScore)
      .sort((a, b) => b.combinedScore - a.combinedScore)
      .slice(0, topK);
  }

  async deleteDocument(documentId: string): Promise<void> {
    this.chunks = this.chunks.filter((c) => c.documentId !== documentId);
  }
}

// 2. Pinecone Vector Store (persistent cloud vector database)
interface PineconeChunkMetadata {
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  text: string;
  [key: string]: string | number | boolean | string[];
}

class PineconeVectorStore implements VectorStoreAdapter {
  private getIndex(namespace: string) {
    const { apiKey, indexName } = getPineconeConfig();
    if (!apiKey || !indexName) {
      throw new Error(
        'Pinecone is not configured. Add PINECONE_API_KEY and PINECONE_INDEX in Settings > Secrets.'
      );
    }
    const pc = new Pinecone({ apiKey });
    return pc.index<PineconeChunkMetadata>({
      name: indexName,
      namespace: namespace || 'interp-rag',
    });
  }

  async saveChunks(chunks: StoredChunk[]): Promise<void> {
    if (chunks.length === 0) return;
    const namespace = chunks[0].namespace || 'interp-rag';
    const index = this.getIndex(namespace);

    // Upsert in batches of 50 records
    const batchSize = 50;
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      await index.upsert({
        records: batch.map((c) => ({
          id: c.id,
          values: c.embedding,
          metadata: {
            documentId: c.documentId,
            documentTitle: c.documentTitle,
            chunkIndex: c.chunkIndex,
            // Keep metadata well under Pinecone's 40KB limit
            text: c.text.slice(0, 8000),
          },
        })),
      });
    }
  }

  async search(params: {
    query: string;
    queryEmbedding: number[];
    namespace: string;
    topK: number;
    hybridAlpha: number;
    minScore: number;
  }): Promise<RetrievedChunk[]> {
    const { query, queryEmbedding, namespace, topK, hybridAlpha, minScore } = params;
    const index = this.getIndex(namespace || 'interp-rag');

    // Fetch slightly more candidates when blending with keywords so reranking has room to work
    const fetchK = hybridAlpha < 1 ? Math.min(50, topK * 3) : topK;

    const result = await index.query({
      vector: queryEmbedding,
      topK: fetchK,
      includeMetadata: true,
    });

    const scored: RetrievedChunk[] = (result.matches ?? []).map((match) => {
      const meta = match.metadata;
      const text = typeof meta?.text === 'string' ? meta.text : '';
      const documentId = typeof meta?.documentId === 'string' ? meta.documentId : '';
      const documentTitle =
        typeof meta?.documentTitle === 'string' ? meta.documentTitle : 'Pinecone Record';
      const chunkIndex = typeof meta?.chunkIndex === 'number' ? meta.chunkIndex : 0;

      const vectorScore = Math.max(0, match.score ?? 0);
      const keywordScore = computeKeywordScore(query, text);
      const combinedScore = hybridAlpha * vectorScore + (1 - hybridAlpha) * keywordScore;

      return {
        id: match.id,
        documentId,
        documentTitle,
        chunkIndex,
        text,
        vectorScore: Number(vectorScore.toFixed(4)),
        keywordScore: Number(keywordScore.toFixed(4)),
        combinedScore: Number(combinedScore.toFixed(4)),
      };
    });

    return scored
      .filter((r) => r.combinedScore >= minScore)
      .sort((a, b) => b.combinedScore - a.combinedScore)
      .slice(0, topK);
  }

  async deleteDocument(
    _documentId: string,
    namespace: string,
    chunkIds: string[]
  ): Promise<void> {
    if (chunkIds.length === 0) return;
    const index = this.getIndex(namespace || 'interp-rag');
    await index.deleteMany({ ids: chunkIds });
  }

  async describeStats(): Promise<{
    totalRecords: number;
    namespaces: Record<string, number>;
  } | null> {
    if (!isPineconeConfigured()) return null;
    try {
      const { apiKey, indexName } = getPineconeConfig();
      const pc = new Pinecone({ apiKey });
      const stats = await pc.index({ name: indexName }).describeIndexStats();
      const namespaces: Record<string, number> = {};
      if (stats.namespaces) {
        for (const [ns, info] of Object.entries(stats.namespaces)) {
          namespaces[ns || 'default'] = info.recordCount ?? 0;
        }
      }
      return {
        totalRecords: stats.totalRecordCount ?? 0,
        namespaces,
      };
    } catch {
      return null;
    }
  }
}

export const memoryStore = new MemoryVectorStore();
export const pineconeStore = new PineconeVectorStore();

// Tracks documents uploaded during the current session (plus chunk IDs for clean deletion)
export const sessionDocuments: DocumentRecord[] = [];
export const documentChunkIds = new Map<string, string[]>();

export function getStore(backend: StorageBackend): VectorStoreAdapter {
  return backend === 'pinecone' ? pineconeStore : memoryStore;
}
