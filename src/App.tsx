import React, { useCallback, useEffect, useState } from 'react';
import { AskTab } from './components/AskTab';
import { CompareTab } from './components/CompareTab';
import { DocumentsTab } from './components/DocumentsTab';
import type { DocumentRecord, RagConfigStatus } from './types';

type ActiveTab = 'documents' | 'ask' | 'compare';

export function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('documents');
  const [status, setStatus] = useState<RagConfigStatus>({
    geminiConfigured: false,
    pineconeConfigured: false,
    pineconeIndex: null,
    pineconeDimension: 768,
    pineconeTotalRecords: null,
    pineconeNamespaces: {},
  });
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);

  const refreshAll = useCallback(async () => {
    try {
      const [statusRes, docsRes] = await Promise.all([
        fetch('/api/status'),
        fetch('/api/documents'),
      ]);
      if (statusRes.ok) {
        setStatus((await statusRes.json()) as RagConfigStatus);
      }
      if (docsRes.ok) {
        const data = await docsRes.json();
        setDocuments(data.documents ?? []);
      }
    } catch {
      // Ignore transient refresh error
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetch('/api/status'), fetch('/api/documents')])
      .then(async ([statusRes, docsRes]) => {
        if (cancelled) return;
        if (statusRes.ok) {
          setStatus((await statusRes.json()) as RagConfigStatus);
        }
        if (docsRes.ok) {
          const data = await docsRes.json();
          setDocuments(data.documents ?? []);
        }
      })
      .catch(() => {
        // Ignore initial load error
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const defaultBackend = status.pineconeConfigured ? 'pinecone' : 'memory';

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* 3-Zone Top Bar */}
      <header className="sticky top-0 z-20 bg-white border-b border-slate-200 px-6 py-3.5">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-8">
          <a
            href="#documents"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('documents');
            }}
            className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            InterpRAG
          </a>

          <nav className="flex items-center gap-6 text-sm font-medium text-slate-600 overflow-x-auto">
            <button
              type="button"
              onClick={() => setActiveTab('documents')}
              className={`pb-0.5 border-b-2 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'documents'
                  ? 'border-blue-700 text-slate-900'
                  : 'border-transparent hover:text-slate-900'
              }`}
            >
              Documents
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('ask')}
              className={`pb-0.5 border-b-2 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'ask'
                  ? 'border-blue-700 text-slate-900'
                  : 'border-transparent hover:text-slate-900'
              }`}
            >
              Ask & Tune
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('compare')}
              className={`pb-0.5 border-b-2 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'compare'
                  ? 'border-blue-700 text-slate-900'
                  : 'border-transparent hover:text-slate-900'
              }`}
            >
              Compare Side-by-Side
            </button>
          </nav>

          <div className="shrink-0">
            <button
              type="button"
              onClick={refreshAll}
              className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              Refresh Status
            </button>
          </div>
        </div>
      </header>

      {/* Clean unboxed connection summary strip */}
      <div className="border-b border-slate-200 bg-white/60 px-6 py-2">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
          <span>
            Gemini API:{' '}
            <strong className={status.geminiConfigured ? 'text-emerald-700' : 'text-amber-700'}>
              {status.geminiConfigured ? 'Ready' : 'Not set in Secrets'}
            </strong>
          </span>
          <span aria-hidden="true">·</span>
          <span>
            Pinecone:{' '}
            <strong className={status.pineconeConfigured ? 'text-emerald-700' : 'text-slate-700'}>
              {status.pineconeConfigured
                ? `Connected (${status.pineconeIndex})`
                : 'Not set in Secrets (In-Memory available)'}
            </strong>
          </span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums">
            Session Docs: {documents.length}
          </span>
        </div>
      </div>

      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8">
        {activeTab === 'documents' && (
          <DocumentsTab
            key={`docs-${defaultBackend}-${status.pineconeDimension}`}
            status={status}
            documents={documents}
            defaultBackend={defaultBackend}
            onDocumentsChanged={refreshAll}
          />
        )}
        {activeTab === 'ask' && (
          <AskTab
            key={`ask-${defaultBackend}-${status.pineconeDimension}`}
            status={status}
            defaultBackend={defaultBackend}
          />
        )}
        {activeTab === 'compare' && (
          <CompareTab
            key={`cmp-${defaultBackend}-${status.pineconeDimension}`}
            status={status}
            defaultBackend={defaultBackend}
          />
        )}
      </main>
    </div>
  );
}

export default App;
