export type SectionKind = 'abstract' | 'results' | 'body';

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

export interface PaperChunkView {
  id: string;
  paperId: string;
  paperTitle: string;
  section: SectionKind;
  chunkIndex: number;
  text: string;
  sparseWeights: Record<string, number>;
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

export interface CorpusStats {
  totalPapers: number;
  totalChunks: number;
  embeddedChunks: number;
  geminiConfigured: boolean;
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

export interface RagQueryResponse {
  query: string;
  results: RetrievedChunkResult[];
  querySparseWeights: Record<string, number>;
  denseActive: boolean;
  denseError?: string;
  answer: string | null;
  synthesisError?: string;
  stats: CorpusStats;
}
