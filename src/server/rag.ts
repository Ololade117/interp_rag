import { GoogleGenAI } from '@google/genai';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { RetrievedChunk } from './types.ts';

export const DEFAULT_SYSTEM_PROMPT =
  'You are a helpful research assistant. Answer the question using ONLY the provided context excerpts. Cite your sources inline like [Source 1] or [Title, Chunk #]. If the context does not contain enough information, say so clearly.';

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

export function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not set. Add it in Settings > Secrets to generate embeddings and answers.'
    );
  }

  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// Extract plain text from an uploaded PDF file
export async function extractTextFromPdf(buffer: Uint8Array): Promise<string> {
  const loadingTask = pdfjsLib.getDocument({
    data: buffer,
    useSystemFonts: true,
    disableFontFace: true,
    verbosity: 0,
  });
  const doc = await loadingTask.promise;
  const pages: string[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ('str' in item && typeof item.str === 'string' ? item.str : ''))
      .join(' ');
    pages.push(pageText);
  }

  return pages.join('\n\n').replace(/\s+/g, ' ').trim();
}

// Split a long document into overlapping chunks of roughly `chunkSize` characters
export function splitIntoChunks(
  rawText: string,
  chunkSize = 600,
  overlap = 100
): string[] {
  const text = rawText.replace(/\s+/g, ' ').trim();
  if (!text) return [];

  const safeSize = Math.max(100, Math.min(4000, chunkSize));
  const safeOverlap = Math.max(0, Math.min(safeSize - 50, overlap));

  if (text.length <= safeSize) {
    return [text];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + safeSize, text.length);

    // Try to break at a sentence boundary or space so words aren't cut in half
    if (end < text.length) {
      const period = text.lastIndexOf('. ', end);
      if (period > start + safeSize * 0.5) {
        end = period + 1;
      } else {
        const space = text.lastIndexOf(' ', end);
        if (space > start + safeSize * 0.5) {
          end = space;
        }
      }
    }

    const piece = text.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= text.length) break;

    start = Math.max(start + 1, end - safeOverlap);
  }

  return chunks;
}

// Generate vector embeddings using Gemini
export async function embedTexts(
  texts: string[],
  dimensions = 768
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const ai = getGeminiClient();
  const vectors: number[][] = [];
  const batchSize = 32;

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const result = await ai.models.embedContent({
      model: 'gemini-embedding-2',
      contents: batch,
      config: {
        outputDimensionality: dimensions,
      },
    });

    if (!result.embeddings || result.embeddings.length !== batch.length) {
      throw new Error('Gemini returned an unexpected embedding response.');
    }

    for (const emb of result.embeddings) {
      vectors.push(emb.values ?? []);
    }
  }

  return vectors;
}

// Simple cosine similarity between two equal-length vectors
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
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

// Simple keyword overlap score (0 to 1) to blend with vector similarity for hybrid search
export function computeKeywordScore(query: string, chunkText: string): number {
  const stop = new Set([
    'the', 'a', 'an', 'and', 'or', 'is', 'are', 'was', 'were', 'in', 'on', 'at',
    'to', 'for', 'of', 'with', 'by', 'as', 'it', 'this', 'that', 'how', 'what',
    'why', 'when', 'where', 'which', 'who', 'do', 'does', 'can', 'from',
  ]);

  const toTokens = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1 && !stop.has(w));

  const queryTerms = Array.from(new Set(toTokens(query)));
  if (queryTerms.length === 0) return 0;

  const docLower = chunkText.toLowerCase();
  let matched = 0;
  for (const term of queryTerms) {
    if (docLower.includes(term)) {
      matched += 1;
    }
  }

  return matched / queryTerms.length;
}

// Ask Gemini to answer the question grounded in the retrieved chunks
export async function generateAnswer(
  query: string,
  chunks: RetrievedChunk[],
  systemPrompt: string
): Promise<string> {
  if (chunks.length === 0) {
    return 'No matching chunks met your retrieval settings (try lowering Minimum Score or increasing Top-K).';
  }

  const ai = getGeminiClient();
  const contextText = chunks
    .map(
      (c, i) =>
        `[Source ${i + 1}] ${c.documentTitle} (Chunk ${c.chunkIndex + 1}, Score: ${c.combinedScore.toFixed(3)})\n${c.text}`
    )
    .join('\n\n---\n\n');

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: `Question:\n${query}\n\nRetrieved Context:\n${contextText}`,
    config: {
      systemInstruction: systemPrompt || DEFAULT_SYSTEM_PROMPT,
    },
  });

  return response.text ?? '';
}
