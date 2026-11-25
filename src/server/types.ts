export type StorageBackend = 'pinecone' | 'memory';

export interface RagConfigStatus {
  geminiConfigured: boolean;
  pineconeConfigured: boolean;
  pineconeIndex: string | null;
  pineconeDimension: number;
  pineconeTotalRecords: number | null;
  pineconeNamespaces: Record<string, number>;
}

export interface DocumentRecord {
  id: string;
  title: string;
  sourceType: 'text' | 'txt' | 'md' | 'pdf';
  backend: StorageBackend;
  namespace: string;
  chunkSize: number;
  overlap: number;
  dimensions: number;
  chunkCount: number;
  createdAt: string;
}

export interface StoredChunk {
  id: string;
  documentId: string;
  documentTitle: string;
  namespace: string;
  chunkIndex: number;
  text: string;
  embedding: number[];
}

export interface SearchSettings {
  backend: StorageBackend;
  namespace: string;
  topK: number;
  hybridAlpha: number; // 1.0 = pure vector, 0.0 = pure keyword, 0.7 = 70% vector + 30% keyword
  minScore: number;
  dimensions: number;
  systemPrompt: string;
}

export interface RetrievedChunk {
  id: string;
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  text: string;
  vectorScore: number;
  keywordScore: number;
  combinedScore: number;
}

export interface RagRunResult {
  settings: SearchSettings;
  answer: string | null;
  answerError?: string;
  chunks: RetrievedChunk[];
  durationMs: number;
}
