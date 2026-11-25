import { getGeminiClient, isGeminiConfigured } from './geminiClient.js';
import type {
  PaperChunk,
  PhraseMatch,
  RetrievedChunkResult,
  SparseTokenMatch,
} from './types.js';

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'for', 'from',
  'has', 'have', 'how', 'in', 'into', 'is', 'it', 'its', 'may', 'more', 'not',
  'of', 'on', 'or', 'our', 'such', 'that', 'the', 'their', 'them', 'then',
  'there', 'these', 'they', 'this', 'to', 'use', 'using', 'was', 'we', 'were',
  'what', 'when', 'where', 'which', 'who', 'why', 'will', 'with',
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\-_.\s]/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^[._-]+|[._-]+$/g, ''))
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function buildTermFrequencies(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

export function computeCorpusSparseWeights(chunks: PaperChunk[]): void {
  const numDocs = Math.max(chunks.length, 1);
  const docFreq = new Map<string, number>();
  let totalLength = 0;

  for (const chunk of chunks) {
    totalLength += chunk.tokens.length;
    const unique = new Set(chunk.tokens);
    for (const token of unique) {
      docFreq.set(token, (docFreq.get(token) ?? 0) + 1);
    }
  }

  const avgDocLen = Math.max(totalLength / numDocs, 1);
  const k1 = 1.5;
  const b = 0.75;

  for (const chunk of chunks) {
    const tfMap = buildTermFrequencies(chunk.tokens);
    const weights: Record<string, number> = {};
    const docLen = Math.max(chunk.tokens.length, 1);

    for (const [token, tf] of tfMap.entries()) {
      const df = docFreq.get(token) ?? 0;
      const idf = Math.log(1 + (numDocs - df + 0.5) / (df + 0.5));
      const bm25 = idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLen / avgDocLen))));
      weights[token] = Number(bm25.toFixed(4));
    }

    chunk.sparseWeights = weights;
  }
}

function buildQuerySparseWeights(
  queryTokens: string[],
  chunks: PaperChunk[]
): Record<string, number> {
  const numDocs = Math.max(chunks.length, 1);
  const tfMap = buildTermFrequencies(queryTokens);
  const weights: Record<string, number> = {};

  for (const [token, tf] of tfMap.entries()) {
    let df = 0;
    for (const chunk of chunks) {
      if (chunk.sparseWeights[token] !== undefined) df++;
    }
    const idf = Math.log(1 + (numDocs - df + 0.5) / (df + 0.5));
    weights[token] = Number(((1 + Math.log(tf)) * Math.max(idf, 0.25)).toFixed(4));
  }

  return weights;
}

function charNgrams(token: string, n = 3): Set<string> {
  const padded = `^${token}$`;
  const grams = new Set<string>();
  if (padded.length <= n) {
    grams.add(padded);
    return grams;
  }
  for (let i = 0; i <= padded.length - n; i++) {
    grams.add(padded.slice(i, i + n));
  }
  return grams;
}

function tokenSoftSimilarity(a: string, b: string): number {
  if (a === b) return 1.0;
  if (a.includes(b) || b.includes(a)) {
    return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  }
  const gramsA = charNgrams(a);
  const gramsB = charNgrams(b);
  let intersection = 0;
  for (const g of gramsA) {
    if (gramsB.has(g)) intersection++;
  }
  const union = gramsA.size + gramsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// Fine-grained multi-vector MaxSim (ColBERT-style token/phrase alignment)
function computeColbertMaxSim(
  queryTokens: string[],
  docTokens: string[],
  docText: string
): { score: number; phraseMatches: PhraseMatch[] } {
  if (queryTokens.length === 0 || docTokens.length === 0) {
    return { score: 0, phraseMatches: [] };
  }

  const rawWords = docText.split(/\s+/);
  let sumMaxSim = 0;
  const phraseMatches: PhraseMatch[] = [];
  const uniqueQuery = Array.from(new Set(queryTokens));

  for (const qTok of uniqueQuery) {
    let bestSim = 0;
    let bestIdx = 0;

    for (let i = 0; i < docTokens.length; i++) {
      const sim = tokenSoftSimilarity(qTok, docTokens[i]);
      if (sim > bestSim) {
        bestSim = sim;
        bestIdx = i;
      }
      if (bestSim === 1.0) break;
    }

    sumMaxSim += bestSim;
    if (bestSim >= 0.45) {
      // Find nearby context window in raw text for human-readable phrase display
      const targetToken = docTokens[bestIdx];
      const rawIdx = rawWords.findIndex((w) => w.toLowerCase().includes(targetToken));
      const sliceStart = Math.max(0, (rawIdx >= 0 ? rawIdx : 0) - 1);
      const sliceEnd = Math.min(rawWords.length, (rawIdx >= 0 ? rawIdx : 0) + 2);
      const matchedPhrase =
        rawIdx >= 0
          ? rawWords.slice(sliceStart, sliceEnd).join(' ').replace(/^[.,;:()]+|[.,;:()]+$/g, '')
          : targetToken;

      phraseMatches.push({
        queryTerm: qTok,
        matchedPhrase,
        similarity: Number(bestSim.toFixed(3)),
      });
    }
  }

  // Bigram phrase bonus for multi-token queries
  let bigramBonus = 0;
  if (queryTokens.length >= 2) {
    const docJoined = docTokens.join(' ');
    let bigramHits = 0;
    for (let i = 0; i < queryTokens.length - 1; i++) {
      const bigram = `${queryTokens[i]} ${queryTokens[i + 1]}`;
      if (docJoined.includes(bigram)) {
        bigramHits++;
      }
    }
    bigramBonus = (bigramHits / (queryTokens.length - 1)) * 0.2;
  }

  const baseMaxSim = sumMaxSim / uniqueQuery.length;
  const finalScore = Math.min(1, baseMaxSim + bigramBonus);
  phraseMatches.sort((a, b) => b.similarity - a.similarity);

  return {
    score: Number(finalScore.toFixed(4)),
    phraseMatches: phraseMatches.slice(0, 6),
  };
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export async function embedTextsWithGemini(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const ai = getGeminiClient();

  const vectors: number[][] = [];
  const batchSize = 32;

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const result = await ai.models.embedContent({
      model: 'gemini-embedding-2',
      contents: batch,
    });

    if (!result.embeddings || result.embeddings.length !== batch.length) {
      throw new Error('Gemini embedding API returned an unexpected embedding payload.');
    }

    for (const emb of result.embeddings) {
      vectors.push(emb.values ?? []);
    }
  }

  return vectors;
}

export async function ensureChunkEmbeddings(chunks: PaperChunk[]): Promise<{
  embeddedCount: number;
  error?: string;
}> {
  const missing = chunks.filter((c) => !c.denseEmbedding || c.denseEmbedding.length === 0);
  if (missing.length === 0) {
    return { embeddedCount: 0 };
  }

  if (!isGeminiConfigured()) {
    return {
      embeddedCount: 0,
      error: 'GEMINI_API_KEY is not configured; dense semantic vectors are unavailable.',
    };
  }

  const vectors = await embedTextsWithGemini(
    missing.map((c) => `${c.paperTitle}\n[${c.section.toUpperCase()}]\n${c.text}`)
  );

  missing.forEach((chunk, idx) => {
    chunk.denseEmbedding = vectors[idx];
  });

  return { embeddedCount: missing.length };
}

export async function hybridSearch(params: {
  query: string;
  chunks: PaperChunk[];
  topK: number;
  weights: { dense: number; sparse: number; colbert: number };
  sectionFilter: 'all' | 'abstract' | 'results';
  useDenseEmbeddings: boolean;
}): Promise<{
  results: RetrievedChunkResult[];
  querySparseWeights: Record<string, number>;
  denseActive: boolean;
  denseError?: string;
}> {
  const { query, chunks, topK, weights, sectionFilter, useDenseEmbeddings } = params;

  const filtered =
    sectionFilter === 'all' ? chunks : chunks.filter((c) => c.section === sectionFilter);

  const queryTokens = tokenize(query);
  const querySparseWeights = buildQuerySparseWeights(queryTokens, filtered);

  let denseActive = false;
  let denseError: string | undefined;
  let queryDenseEmbedding: number[] | null = null;

  if (useDenseEmbeddings && filtered.length > 0 && weights.dense > 0) {
    try {
      await ensureChunkEmbeddings(filtered);
      const [qVec] = await embedTextsWithGemini([query]);
      if (qVec && qVec.length > 0) {
        queryDenseEmbedding = qVec;
        denseActive = true;
      }
    } catch (err) {
      denseError = err instanceof Error ? err.message : 'Dense embedding request failed.';
    }
  }

  // First pass: raw scores
  const rawScored = filtered.map((chunk) => {
    // Sparse dot product
    let rawSparse = 0;
    const sparseMatches: SparseTokenMatch[] = [];
    for (const [token, qW] of Object.entries(querySparseWeights)) {
      const dW = chunk.sparseWeights[token];
      if (dW !== undefined) {
        const contribution = qW * dW;
        rawSparse += contribution;
        sparseMatches.push({
          token,
          queryWeight: qW,
          docWeight: dW,
          contribution: Number(contribution.toFixed(4)),
        });
      }
    }
    sparseMatches.sort((a, b) => b.contribution - a.contribution);

    // ColBERT MaxSim
    const { score: colbertScore, phraseMatches } = computeColbertMaxSim(
      queryTokens,
      chunk.tokens,
      chunk.text
    );

    // Dense Cosine Similarity
    let denseScore: number | null = null;
    if (denseActive && queryDenseEmbedding && chunk.denseEmbedding) {
      denseScore = Number(
        Math.max(0, cosineSimilarity(queryDenseEmbedding, chunk.denseEmbedding)).toFixed(4)
      );
    }

    return {
      chunk,
      rawSparse,
      colbertScore,
      denseScore,
      sparseMatches: sparseMatches.slice(0, 8),
      phraseMatches,
    };
  });

  // Normalize sparse scores to [0, 1] across candidate pool for fair hybrid fusion
  const maxSparse = Math.max(...rawScored.map((r) => r.rawSparse), 1e-6);

  const activeWDense = denseActive ? weights.dense : 0;
  const activeWSparse = weights.sparse;
  const activeWColbert = weights.colbert;
  const weightSum = Math.max(activeWDense + activeWSparse + activeWColbert, 1e-6);

  const combined: RetrievedChunkResult[] = rawScored.map((item) => {
    const sparseNorm = Number((item.rawSparse / maxSparse).toFixed(4));
    const denseVal = item.denseScore ?? 0;

    const hybrid =
      (activeWDense * denseVal +
        activeWSparse * sparseNorm +
        activeWColbert * item.colbertScore) /
      weightSum;

    const topSparseTokens = Object.entries(item.chunk.sparseWeights)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([token, weight]) => ({ token, weight }));

    return {
      chunk: {
        id: item.chunk.id,
        paperId: item.chunk.paperId,
        paperTitle: item.chunk.paperTitle,
        section: item.chunk.section,
        chunkIndex: item.chunk.chunkIndex,
        text: item.chunk.text,
        topSparseTokens,
      },
      scores: {
        dense: item.denseScore,
        sparse: sparseNorm,
        colbert: item.colbertScore,
        hybrid: Number(hybrid.toFixed(4)),
      },
      sparseMatches: item.sparseMatches,
      phraseMatches: item.phraseMatches,
    };
  });

  combined.sort((a, b) => b.scores.hybrid - a.scores.hybrid);

  return {
    results: combined.slice(0, topK),
    querySparseWeights,
    denseActive,
    denseError,
  };
}
