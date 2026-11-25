import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import { corpusStore } from './src/server/corpusStore.js';
import { getGeminiClient } from './src/server/geminiClient.js';
import { hybridSearch } from './src/server/retrieval.js';
import type { RagQueryRequest } from './src/server/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  // 1. Corpus overview
  app.get('/api/corpus', (_req, res) => {
    res.json({
      papers: corpusStore.papers,
      curatedQueue: corpusStore.curatedQueue,
      stats: corpusStore.getStats(),
    });
  });

  // 2. Single paper detail (extracted Title, Abstract, Results, Chunks)
  app.get('/api/papers/:id', (req, res) => {
    const detail = corpusStore.getPaper(req.params.id);
    if (!detail) {
      res.status(404).json({ error: 'Paper not found' });
      return;
    }
    res.json(detail);
  });

  // 3. Delete paper
  app.delete('/api/papers/:id', (req, res) => {
    const deleted = corpusStore.deletePaper(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Paper not found' });
      return;
    }
    res.json({ deleted: true, stats: corpusStore.getStats() });
  });

  // 4. Ingest single arXiv ID / URL or HTML URL
  app.post('/api/papers/ingest-url', async (req, res) => {
    const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    const allowHtml = req.body?.allowHtml !== false;
    if (!url) {
      res.status(400).json({ error: 'Provide an arXiv ID or paper URL.' });
      return;
    }

    const result = await corpusStore.ingestFromUrl(url, { allowHtml });
    if (!result.ok && !result.skipped) {
      res.status(422).json({
        error: result.message,
        curatedQueue: corpusStore.curatedQueue,
        stats: corpusStore.getStats(),
      });
      return;
    }

    res.json({
      ...result,
      papers: corpusStore.papers,
      curatedQueue: corpusStore.curatedQueue,
      stats: corpusStore.getStats(),
    });
  });

  // 5. Sync batch of curated papers from download_papers.py list
  app.post('/api/papers/sync-curated', async (req, res) => {
    const limit = typeof req.body?.limit === 'number' ? Math.max(1, Math.min(20, req.body.limit)) : 5;
    const includeHtml = req.body?.includeHtml === true;
    const targetUrls: string[] | undefined = Array.isArray(req.body?.urls)
      ? req.body.urls
      : undefined;

    const candidates = corpusStore.curatedQueue.filter((entry) => {
      if (targetUrls) return targetUrls.includes(entry.url);
      if (entry.status === 'ingested') return false;
      if (!includeHtml && entry.kind === 'html') return false;
      return true;
    });

    const batch = candidates.slice(0, limit);
    const outcomes: Array<{ url: string; ok: boolean; skipped?: boolean; message: string }> = [];

    for (const entry of batch) {
      const outcome = await corpusStore.ingestFromUrl(entry.url, { allowHtml: includeHtml });
      outcomes.push({
        url: entry.url,
        ok: outcome.ok,
        skipped: outcome.skipped,
        message: outcome.message,
      });
    }

    res.json({
      processed: outcomes.length,
      outcomes,
      papers: corpusStore.papers,
      curatedQueue: corpusStore.curatedQueue,
      stats: corpusStore.getStats(),
    });
  });

  // 6. Upload local PDF file
  app.post('/api/papers/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'No PDF file uploaded.' });
      return;
    }

    if (
      !req.file.originalname.toLowerCase().endsWith('.pdf') &&
      !req.file.mimetype.includes('pdf')
    ) {
      res.status(400).json({ error: 'Uploaded file must be a PDF document.' });
      return;
    }

    try {
      const paper = await corpusStore.ingestPdfBuffer(
        new Uint8Array(req.file.buffer),
        req.file.originalname
      );
      res.json({
        paper,
        papers: corpusStore.papers,
        stats: corpusStore.getStats(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to parse PDF document.';
      res.status(422).json({ error: msg });
    }
  });

  // 7. Add custom paper text (Title, Abstract, Results)
  app.post('/api/papers/manual', (req, res) => {
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const abstract = typeof req.body?.abstract === 'string' ? req.body.abstract.trim() : '';
    const results = typeof req.body?.results === 'string' ? req.body.results.trim() : '';
    const sourceUrl = typeof req.body?.sourceUrl === 'string' ? req.body.sourceUrl.trim() : '';

    if (!title || (!abstract && !results)) {
      res.status(400).json({ error: 'Provide a paper title and at least an abstract or results text.' });
      return;
    }

    const paper = corpusStore.ingestManualPaper({ title, abstract, results, sourceUrl });
    res.json({
      paper,
      papers: corpusStore.papers,
      stats: corpusStore.getStats(),
    });
  });

  // 8. Compute Gemini dense embeddings for all unembedded chunks
  app.post('/api/papers/embed', async (_req, res) => {
    try {
      const result = await corpusStore.embedAllMissing();
      if (result.error) {
        res.status(400).json({
          error: result.error,
          stats: corpusStore.getStats(),
        });
        return;
      }

      res.json({
        embeddedCount: result.embeddedCount,
        papers: corpusStore.papers,
        stats: corpusStore.getStats(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to generate embeddings.';
      res.status(500).json({ error: msg, stats: corpusStore.getStats() });
    }
  });

  // 9. Hybrid RAG Query (Dense + Sparse + Multi-Vector MaxSim + Gemini Synthesis)
  app.post('/api/rag/query', async (req, res) => {
    const body = (req.body ?? {}) as Partial<RagQueryRequest>;
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (!query) {
      res.status(400).json({ error: 'Query cannot be empty.' });
      return;
    }

    if (corpusStore.chunks.length === 0) {
      res.status(400).json({
        error: 'The corpus is empty. Ingest at least one paper from the arXiv queue or upload a PDF first.',
      });
      return;
    }

    const topK = typeof body.topK === 'number' ? Math.max(1, Math.min(12, body.topK)) : 5;
    const weights = {
      dense: typeof body.weights?.dense === 'number' ? Math.max(0, body.weights.dense) : 0.45,
      sparse: typeof body.weights?.sparse === 'number' ? Math.max(0, body.weights.sparse) : 0.3,
      colbert: typeof body.weights?.colbert === 'number' ? Math.max(0, body.weights.colbert) : 0.25,
    };
    const sectionFilter =
      body.sectionFilter === 'abstract' || body.sectionFilter === 'results'
        ? body.sectionFilter
        : 'all';
    const useDenseEmbeddings = body.useDenseEmbeddings !== false;
    const synthesizeAnswer = body.synthesizeAnswer !== false;

    const retrieval = await hybridSearch({
      query,
      chunks: corpusStore.chunks,
      topK,
      weights,
      sectionFilter,
      useDenseEmbeddings,
    });

    // Update paper embedding flags if dense embeddings were populated during search
    for (const paper of corpusStore.papers) {
      const paperChunks = corpusStore.chunks.filter((c) => c.paperId === paper.id);
      paper.embeddingReady =
        paperChunks.length > 0 &&
        paperChunks.every((c) => Array.isArray(c.denseEmbedding) && c.denseEmbedding.length > 0);
    }

    let answer: string | null = null;
    let synthesisError: string | undefined;

    if (synthesizeAnswer && retrieval.results.length > 0) {
      try {
        const ai = getGeminiClient();
        const contextBlocks = retrieval.results
          .map(
            (r, idx) =>
              `[Source ${idx + 1}] Title: ${r.chunk.paperTitle} | Section: ${r.chunk.section.toUpperCase()} | Hybrid Score: ${r.scores.hybrid.toFixed(3)}\n${r.chunk.text}`
          )
          .join('\n\n---\n\n');

        const response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: `Research Question:\n${query}\n\nRetrieved Mechanistic Interpretability Excerpts:\n${contextBlocks}`,
          config: {
            systemInstruction:
              'You are a mechanistic interpretability research assistant. Answer the research question strictly using the provided retrieved paper excerpts. Cite specific papers inline using [Source N] or [Paper Title · Section] notation. If the excerpts do not contain enough evidence to answer part of the question, state that clearly rather than extrapolating.',
          },
        });

        answer = response.text ?? '';
      } catch (err) {
        synthesisError =
          err instanceof Error ? err.message : 'Failed to generate grounded RAG response.';
      }
    }

    res.json({
      query,
      results: retrieval.results,
      querySparseWeights: retrieval.querySparseWeights,
      denseActive: retrieval.denseActive,
      denseError: retrieval.denseError,
      answer,
      synthesisError,
      stats: corpusStore.getStats(),
    });
  });

  const httpServer = http.createServer(app);

  // Mount Vite middleware in development, or serve static dist in production
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = 3000;
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`InterpRAG server running on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start InterpRAG server:', err);
  process.exit(1);
});
