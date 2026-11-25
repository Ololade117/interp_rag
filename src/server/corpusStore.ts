import crypto from 'node:crypto';
import { createInitialCuratedQueue, extractArxivId } from './curatedPapers.js';
import { isGeminiConfigured } from './geminiClient.js';
import {
  buildSectionChunks,
  cleanText,
  extractPaperFromHtml,
  extractPaperFromPdfBuffer,
  type ExtractedPaper,
} from './pdfExtractor.js';
import { computeCorpusSparseWeights, ensureChunkEmbeddings, tokenize } from './retrieval.js';
import type { CuratedPaperEntry, PaperChunk, PaperRecord } from './types.js';

class CorpusStore {
  public papers: PaperRecord[] = [];
  public chunks: PaperChunk[] = [];
  public curatedQueue: CuratedPaperEntry[] = createInitialCuratedQueue();

  public getStats() {
    const embeddedChunks = this.chunks.filter(
      (c) => Array.isArray(c.denseEmbedding) && c.denseEmbedding.length > 0
    ).length;

    return {
      totalPapers: this.papers.length,
      totalChunks: this.chunks.length,
      embeddedChunks,
      geminiConfigured: isGeminiConfigured(),
    };
  }

  public getPaper(id: string): { paper: PaperRecord; chunks: PaperChunk[] } | null {
    const paper = this.papers.find((p) => p.id === id);
    if (!paper) return null;
    const chunks = this.chunks
      .filter((c) => c.paperId === id)
      .map((c) => ({
        ...c,
        denseEmbedding: undefined, // Omit raw 3072-float arrays from UI payload
      }));
    return { paper, chunks };
  }

  public deletePaper(id: string): boolean {
    const idx = this.papers.findIndex((p) => p.id === id);
    if (idx === -1) return false;
    this.papers.splice(idx, 1);
    this.chunks = this.chunks.filter((c) => c.paperId !== id);
    computeCorpusSparseWeights(this.chunks);

    for (const entry of this.curatedQueue) {
      if (entry.paperId === id) {
        entry.status = 'pending';
        entry.paperId = undefined;
        entry.title = undefined;
        entry.message = undefined;
      }
    }
    return true;
  }

  public registerExtractedPaper(params: {
    extracted: ExtractedPaper;
    filename: string;
    arxivId?: string;
    sourceUrl?: string;
  }): PaperRecord {
    const { extracted, filename, arxivId, sourceUrl } = params;

    // Prevent duplicates by arxivId or exact title
    if (arxivId) {
      const existing = this.papers.find((p) => p.arxivId === arxivId);
      if (existing) return existing;
    }

    const id = crypto.randomUUID();
    const rawChunks = buildSectionChunks(id, extracted);

    const newChunks: PaperChunk[] = rawChunks.map((rc) => ({
      id: `${id}_${rc.section}_${rc.chunkIndex}`,
      paperId: id,
      paperTitle: extracted.title,
      section: rc.section,
      chunkIndex: rc.chunkIndex,
      text: rc.text,
      sparseWeights: {},
      tokens: tokenize(rc.text),
    }));

    const record: PaperRecord = {
      id,
      arxivId,
      sourceUrl,
      filename,
      title: extracted.title,
      abstract: extracted.abstract,
      results: extracted.results,
      fullTextLength: extracted.fullText.length,
      pageCount: extracted.pageCount,
      chunkCount: newChunks.length,
      ingestedAt: new Date().toISOString(),
      embeddingReady: false,
    };

    this.papers.unshift(record);
    this.chunks.push(...newChunks);
    computeCorpusSparseWeights(this.chunks);

    return record;
  }

  public async ingestPdfBuffer(
    buffer: Uint8Array,
    filename: string,
    meta?: { arxivId?: string; sourceUrl?: string }
  ): Promise<PaperRecord> {
    const fallbackTitle = filename.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ');
    const extracted = await extractPaperFromPdfBuffer(buffer, fallbackTitle);
    return this.registerExtractedPaper({
      extracted,
      filename,
      arxivId: meta?.arxivId,
      sourceUrl: meta?.sourceUrl,
    });
  }

  public ingestManualPaper(input: {
    title: string;
    abstract: string;
    results: string;
    sourceUrl?: string;
  }): PaperRecord {
    const title = cleanText(input.title);
    const abstract = cleanText(input.abstract);
    const results = cleanText(input.results);

    const extracted: ExtractedPaper = {
      title,
      abstract,
      results,
      fullText: cleanText(`${title} ${abstract} ${results}`),
      pageCount: 1,
    };

    return this.registerExtractedPaper({
      extracted,
      filename: `${title.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40)}.txt`,
      sourceUrl: input.sourceUrl?.trim() || undefined,
    });
  }

  public async ingestFromUrl(
    rawInput: string,
    options?: { allowHtml?: boolean }
  ): Promise<{ ok: boolean; paper?: PaperRecord; skipped?: boolean; message: string }> {
    const trimmed = rawInput.trim().replace(/\/+$/, '');
    const queueEntry = this.curatedQueue.find((q) => q.url === trimmed);

    const arxivId = extractArxivId(trimmed);
    if (arxivId) {
      const existing = this.papers.find((p) => p.arxivId === arxivId);
      if (existing) {
        if (queueEntry) {
          queueEntry.status = 'ingested';
          queueEntry.paperId = existing.id;
          queueEntry.title = existing.title;
          queueEntry.message = 'Already ingested';
        }
        return { ok: true, paper: existing, message: `Already ingested (${existing.title})` };
      }

      const pdfUrl = `https://arxiv.org/pdf/${arxivId}.pdf`;
      try {
        const res = await fetch(pdfUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; InterpRAG/1.0)' },
          signal: AbortSignal.timeout(25000),
        });

        if (!res.ok) {
          const msg = `HTTP ${res.status} fetching ${pdfUrl}`;
          if (queueEntry) {
            queueEntry.status = 'error';
            queueEntry.message = msg;
          }
          return { ok: false, message: msg };
        }

        const contentType = res.headers.get('content-type') || '';
        const arrayBuf = await res.arrayBuffer();
        const bytes = new Uint8Array(arrayBuf);

        // Verify PDF magic header %PDF-
        const header = new TextDecoder().decode(bytes.slice(0, 5));
        if (!contentType.toLowerCase().includes('pdf') && header !== '%PDF-') {
          const msg = `Response from ${pdfUrl} was not a PDF (${contentType || 'unknown type'})`;
          if (queueEntry) {
            queueEntry.status = 'error';
            queueEntry.message = msg;
          }
          return { ok: false, message: msg };
        }

        const paper = await this.ingestPdfBuffer(bytes, `arxiv_${arxivId}.pdf`, {
          arxivId,
          sourceUrl: `https://arxiv.org/abs/${arxivId}`,
        });

        if (queueEntry) {
          queueEntry.status = 'ingested';
          queueEntry.paperId = paper.id;
          queueEntry.title = paper.title;
          queueEntry.message = `${paper.chunkCount} chunks extracted`;
        }

        return { ok: true, paper, message: `Ingested ${paper.title}` };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Network error fetching arXiv PDF';
        if (queueEntry) {
          queueEntry.status = 'error';
          queueEntry.message = msg;
        }
        return { ok: false, message: msg };
      }
    }

    // Non-arXiv URL (e.g., transformer-circuits.pub HTML page)
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(trimmed);
    } catch {
      return { ok: false, message: `Invalid URL or arXiv ID: ${rawInput}` };
    }

    if (parsedUrl.hostname.includes('transformer-circuits.pub') && options?.allowHtml === false) {
      if (queueEntry) {
        queueEntry.status = 'skipped';
        queueEntry.message = 'Non-PDF HTML page skipped (enable HTML extraction to ingest)';
      }
      return {
        ok: false,
        skipped: true,
        message: 'Skipped non-PDF HTML page (transformer-circuits.pub)',
      };
    }

    try {
      const res = await fetch(trimmed, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; InterpRAG/1.0)' },
        signal: AbortSignal.timeout(20000),
      });

      if (!res.ok) {
        const msg = `HTTP ${res.status} fetching ${trimmed}`;
        if (queueEntry) {
          queueEntry.status = 'error';
          queueEntry.message = msg;
        }
        return { ok: false, message: msg };
      }

      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      if (contentType.includes('pdf') || trimmed.toLowerCase().endsWith('.pdf')) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        const filename = parsedUrl.pathname.split('/').pop() || 'paper.pdf';
        const paper = await this.ingestPdfBuffer(bytes, filename, { sourceUrl: trimmed });
        if (queueEntry) {
          queueEntry.status = 'ingested';
          queueEntry.paperId = paper.id;
          queueEntry.title = paper.title;
          queueEntry.message = `${paper.chunkCount} chunks extracted`;
        }
        return { ok: true, paper, message: `Ingested ${paper.title}` };
      }

      const html = await res.text();
      const extracted = extractPaperFromHtml(html, parsedUrl.hostname);
      const paper = this.registerExtractedPaper({
        extracted,
        filename: `${parsedUrl.hostname.replace(/[^a-z0-9]/gi, '_')}.html`,
        sourceUrl: trimmed,
      });

      if (queueEntry) {
        queueEntry.status = 'ingested';
        queueEntry.paperId = paper.id;
        queueEntry.title = paper.title;
        queueEntry.message = `${paper.chunkCount} chunks extracted from HTML`;
      }

      return { ok: true, paper, message: `Ingested HTML paper ${paper.title}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error fetching URL';
      if (queueEntry) {
        queueEntry.status = 'error';
        queueEntry.message = msg;
      }
      return { ok: false, message: msg };
    }
  }

  public async embedAllMissing(): Promise<{ embeddedCount: number; error?: string }> {
    const result = await ensureChunkEmbeddings(this.chunks);
    for (const paper of this.papers) {
      const paperChunks = this.chunks.filter((c) => c.paperId === paper.id);
      paper.embeddingReady =
        paperChunks.length > 0 &&
        paperChunks.every((c) => Array.isArray(c.denseEmbedding) && c.denseEmbedding.length > 0);
    }
    return result;
  }
}

export const corpusStore = new CorpusStore();
