import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import {
  DEFAULT_SYSTEM_PROMPT,
  embedTexts,
  extractTextFromPdf,
  generateAnswer,
  isGeminiConfigured,
  splitIntoChunks,
} from './src/server/rag.ts';
import {
  documentChunkIds,
  getPineconeConfig,
  getStore,
  isPineconeConfigured,
  pineconeStore,
  sessionDocuments,
} from './src/server/store.ts';
import type {
  DocumentRecord,
  RagRunResult,
  SearchSettings,
  StorageBackend,
  StoredChunk,
} from './src/server/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

function parseBackend(value: unknown): StorageBackend {
  return value === 'pinecone' ? 'pinecone' : 'memory';
}

function parseSearchSettings(raw: Record<string, unknown>): SearchSettings {
  const { dimension } = getPineconeConfig();
  return {
    backend: parseBackend(raw.backend),
    namespace:
      typeof raw.namespace === 'string' && raw.namespace.trim()
        ? raw.namespace.trim()
        : 'interp-rag',
    topK:
      typeof raw.topK === 'number'
        ? Math.max(1, Math.min(20, Math.round(raw.topK)))
        : 4,
    hybridAlpha:
      typeof raw.hybridAlpha === 'number'
        ? Math.max(0, Math.min(1, raw.hybridAlpha))
        : 0.75,
    minScore:
      typeof raw.minScore === 'number'
        ? Math.max(0, Math.min(1, raw.minScore))
        : 0,
    dimensions:
      typeof raw.dimensions === 'number' && raw.dimensions > 0
        ? raw.dimensions
        : dimension,
    systemPrompt:
      typeof raw.systemPrompt === 'string' && raw.systemPrompt.trim()
        ? raw.systemPrompt.trim()
        : DEFAULT_SYSTEM_PROMPT,
  };
}

async function runSingleRag(
  query: string,
  settings: SearchSettings
): Promise<RagRunResult> {
  const start = Date.now();
  const store = getStore(settings.backend);

  const [queryEmbedding] = await embedTexts([query], settings.dimensions);

  const chunks = await store.search({
    query,
    queryEmbedding,
    namespace: settings.namespace,
    topK: settings.topK,
    hybridAlpha: settings.hybridAlpha,
    minScore: settings.minScore,
  });

  let answer: string | null = null;
  let answerError: string | undefined;

  try {
    answer = await generateAnswer(query, chunks, settings.systemPrompt);
  } catch (err) {
    answerError =
      err instanceof Error ? err.message : 'Failed to generate answer.';
  }

  return {
    settings,
    answer,
    answerError,
    chunks,
    durationMs: Date.now() - start,
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  // 1. Health & configuration status (never exposes secrets)
  app.get('/api/status', async (_req, res) => {
    const pineconeCfg = getPineconeConfig();
    const pineconeStats = await pineconeStore.describeStats();

    res.json({
      geminiConfigured: isGeminiConfigured(),
      pineconeConfigured: isPineconeConfigured(),
      pineconeIndex: pineconeCfg.indexName || null,
      pineconeDimension: pineconeCfg.dimension,
      pineconeTotalRecords: pineconeStats?.totalRecords ?? null,
      pineconeNamespaces: pineconeStats?.namespaces ?? {},
    });
  });

  // 2. List documents added in this session
  app.get('/api/documents', (_req, res) => {
    res.json({ documents: sessionDocuments });
  });

  // 3. Add a document (supports pasted text or uploaded .txt, .md, .pdf)
  app.post('/api/documents', upload.single('file'), async (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      const backend = parseBackend(body.backend);
      const namespace =
        typeof body.namespace === 'string' && body.namespace.trim()
          ? body.namespace.trim()
          : 'interp-rag';
      const chunkSize = Number(body.chunkSize) || 600;
      const overlap = Number(body.overlap) || 100;
      const dimensions = Number(body.dimensions) || getPineconeConfig().dimension;

      let title = typeof body.title === 'string' ? body.title.trim() : '';
      let rawText = typeof body.text === 'string' ? body.text.trim() : '';
      let sourceType: DocumentRecord['sourceType'] = 'text';

      if (req.file) {
        const nameLower = req.file.originalname.toLowerCase();
        if (!title) {
          title = req.file.originalname.replace(/\.[^.]+$/, '');
        }
        if (nameLower.endsWith('.pdf') || req.file.mimetype.includes('pdf')) {
          sourceType = 'pdf';
          rawText = await extractTextFromPdf(new Uint8Array(req.file.buffer));
        } else if (nameLower.endsWith('.md')) {
          sourceType = 'md';
          rawText = req.file.buffer.toString('utf-8');
        } else {
          sourceType = 'txt';
          rawText = req.file.buffer.toString('utf-8');
        }
      }

      if (!title || !rawText) {
        res.status(400).json({
          error: 'Please provide both a document title and text (or upload a file).',
        });
        return;
      }

      const pieces = splitIntoChunks(rawText, chunkSize, overlap);
      if (pieces.length === 0) {
        res.status(400).json({ error: 'No readable text could be extracted.' });
        return;
      }

      const embeddings = await embedTexts(pieces, dimensions);
      const documentId = crypto.randomUUID();

      const storedChunks: StoredChunk[] = pieces.map((text, idx) => ({
        id: `${documentId}_chunk_${idx}`,
        documentId,
        documentTitle: title,
        namespace,
        chunkIndex: idx,
        text,
        embedding: embeddings[idx],
      }));

      const store = getStore(backend);
      await store.saveChunks(storedChunks);

      const doc: DocumentRecord = {
        id: documentId,
        title,
        sourceType,
        backend,
        namespace,
        chunkSize,
        overlap,
        dimensions,
        chunkCount: storedChunks.length,
        createdAt: new Date().toISOString(),
      };

      sessionDocuments.unshift(doc);
      documentChunkIds.set(
        documentId,
        storedChunks.map((c) => c.id)
      );

      res.json({ document: doc });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to ingest document.';
      res.status(500).json({ error: msg });
    }
  });

  // 4. Delete a document and its chunks from the store
  app.delete('/api/documents/:id', async (req, res) => {
    const docId = req.params.id;
    const idx = sessionDocuments.findIndex((d) => d.id === docId);
    if (idx === -1) {
      res.status(404).json({ error: 'Document not found in current session.' });
      return;
    }

    const doc = sessionDocuments[idx];
    const chunkIds = documentChunkIds.get(docId) ?? [];

    try {
      const store = getStore(doc.backend);
      await store.deleteDocument(docId, doc.namespace, chunkIds);
      sessionDocuments.splice(idx, 1);
      documentChunkIds.delete(docId);
      res.json({ deleted: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete document.';
      res.status(500).json({ error: msg });
    }
  });

  // 5. Run a single RAG query
  app.post('/api/query', async (req, res) => {
    const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
    if (!query) {
      res.status(400).json({ error: 'Please enter a question.' });
      return;
    }

    try {
      const settings = parseSearchSettings((req.body?.settings ?? {}) as Record<string, unknown>);
      const result = await runSingleRag(query, settings);
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Query failed.';
      res.status(500).json({ error: msg });
    }
  });

  // 6. Run two RAG configurations side-by-side on the same question (Option 3)
  app.post('/api/compare', async (req, res) => {
    const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
    if (!query) {
      res.status(400).json({ error: 'Please enter a question to compare.' });
      return;
    }

    try {
      const configA = parseSearchSettings((req.body?.configA ?? {}) as Record<string, unknown>);
      const configB = parseSearchSettings((req.body?.configB ?? {}) as Record<string, unknown>);

      const [resultA, resultB] = await Promise.all([
        runSingleRag(query, configA),
        runSingleRag(query, configB),
      ]);

      res.json({ query, resultA, resultB });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Comparison failed.';
      res.status(500).json({ error: msg });
    }
  });

  const httpServer = http.createServer(app);

  // Mount Vite middleware in development, or serve static dist in production
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
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
    app.use((_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = 3000;
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`InterpRAG server running on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
