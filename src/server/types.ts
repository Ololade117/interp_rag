export type SectionKind = 'abstract' | 'results' | 'body';

export interface PaperChunk {
  id: string;
  paperId: string;
  paperTitle: string;
  section: SectionKind;
  chunkIndex: number;
  text: string;
  sparseWeights: Record<string, number>;
  tokens: string[];
  denseEmbedding?: number[];
}

export interface PaperRecord {
  id: string;
  arxivId?: string;
  sourceUrl?: string;
  filename: string;
  title: string;
  abstract: string;
  results: string;
  fullTextLength: number;
  pageCount: number;
  chunkCount: number;
  ingestedAt: string;
  embeddingReady: boolean;
}

export interface CuratedPaperEntry {
  url: string;
  arxivId?: string;
  kind: 'arxiv_pdf' | 'html';
  status: 'pending' | 'ingested' | 'skipped' | 'error';
  paperId?: string;
  title?: string;
  message?: string;
}

export interface SparseTokenMatch {
  token: string;
  queryWeight: number;
  docWeight: number;
  contribution: number;
}

export interface PhraseMatch {
  queryTerm: string;
  matchedPhrase: string;
  similarity: number;
}

export interface RetrievedChunkResult {
  chunk: {
    id: string;
    paperId: string;
    paperTitle: string;
    section: SectionKind;
    chunkIndex: number;
    text: string;
    topSparseTokens: Array<{ token: string; weight: number }>;
  };
  scores: {
    dense: number | null;
    sparse: number;
    colbert: number;
    hybrid: number;
  };
  sparseMatches: SparseTokenMatch[];
  phraseMatches: PhraseMatch[];
}

export interface RagQueryRequest {
  query: string;
  topK?: number;
  weights?: {
    dense: number;
    sparse: number;
    colbert: number;
  };
  sectionFilter?: 'all' | 'abstract' | 'results';
  useDenseEmbeddings?: boolean;
  synthesizeAnswer?: boolean;
}
