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

export interface SearchSettings {
  backend: StorageBackend;
  namespace: string;
  topK: number;
  hybridAlpha: number;
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

export const DEFAULT_SYSTEM_PROMPT =
  'You are a helpful research assistant. Answer the question using ONLY the provided context excerpts. Cite your sources inline like [Source 1] or [Title, Chunk #]. If the context does not contain enough information, say so clearly.';
