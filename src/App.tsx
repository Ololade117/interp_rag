import React, { useCallback, useEffect, useState } from 'react';
import { BookOpen, Layers, ListFilter, Search } from 'lucide-react';
import { CorpusWorkspace } from './components/CorpusWorkspace';
import { QueryWorkspace } from './components/QueryWorkspace';
import { QueueWorkspace } from './components/QueueWorkspace';
import type { CorpusStats, CuratedPaperEntry, PaperRecord } from './types';

type ActiveTab = 'query' | 'corpus' | 'queue';

export function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('query');
  const [papers, setPapers] = useState<PaperRecord[]>([]);
  const [curatedQueue, setCuratedQueue] = useState<CuratedPaperEntry[]>([]);
  const [stats, setStats] = useState<CorpusStats>({
    totalPapers: 0,
    totalChunks: 0,
    embeddedChunks: 0,
    geminiConfigured: false,
  });
  const [isSyncing, setIsSyncing] = useState(false);

  const loadCorpus = useCallback(async () => {
    try {
      const res = await fetch('/api/corpus');
      if (!res.ok) return;
      const data = await res.json();
      setPapers(data.papers ?? []);
      setCuratedQueue(data.curatedQueue ?? []);
      if (data.stats) setStats(data.stats);
    } catch {
      // Handled silently on initial poll
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/corpus')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data || cancelled) return;
        setPapers(data.papers ?? []);
        setCuratedQueue(data.curatedQueue ?? []);
        if (data.stats) setStats(data.stats);
      })
      .catch(() => {
        // Ignore initial fetch errors
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSyncStarterBatch = async () => {
    setIsSyncing(true);
    try {
      await fetch('/api/papers/sync-curated', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 5, includeHtml: false }),
      });
      await loadCorpus();
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Strict 3-zone Top Bar Contract */}
      <header className="sticky top-0 z-20 bg-white border-b border-slate-200 px-6 py-3.5">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-8">
          <a
            href="#query"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('query');
            }}
            className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            InterpRAG
          </a>

          <nav className="flex items-center gap-6 text-sm font-medium text-slate-600 overflow-x-auto">
            <button
              type="button"
              onClick={() => setActiveTab('query')}
              className={`pb-0.5 border-b-2 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'query'
                  ? 'border-blue-700 text-slate-900'
                  : 'border-transparent hover:text-slate-900'
              }`}
            >
              Query & Synthesis
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('corpus')}
              className={`pb-0.5 border-b-2 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'corpus'
                  ? 'border-blue-700 text-slate-900'
                  : 'border-transparent hover:text-slate-900'
              }`}
            >
              Paper Corpus
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('queue')}
              className={`pb-0.5 border-b-2 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'queue'
                  ? 'border-blue-700 text-slate-900'
                  : 'border-transparent hover:text-slate-900'
              }`}
            >
              arXiv Queue
            </button>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={handleSyncStarterBatch}
              disabled={isSyncing}
              className="px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              {isSyncing ? 'Syncing arXiv...' : 'Sync arXiv Batch'}
            </button>
          </div>
        </div>
      </header>

      {/* Main Workspace Container with Sidebar */}
      <div className="flex-1 max-w-7xl w-full mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        <aside className="lg:col-span-3 space-y-6">
          <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-1">
            <button
              type="button"
              onClick={() => setActiveTab('query')}
              className={`w-full flex items-center justify-between px-3 py-2 text-sm rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                activeTab === 'query'
                  ? 'bg-slate-100 font-medium text-slate-900'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <span className="inline-flex items-center gap-2.5">
                <Search className="w-4 h-4 text-slate-500" />
                Hybrid RAG Query
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('corpus')}
              className={`w-full flex items-center justify-between px-3 py-2 text-sm rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                activeTab === 'corpus'
                  ? 'bg-slate-100 font-medium text-slate-900'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <span className="inline-flex items-center gap-2.5">
                <BookOpen className="w-4 h-4 text-slate-500" />
                Paper Corpus
              </span>
              <span className="font-mono tabular-nums text-xs text-slate-500">
                {stats.totalPapers}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('queue')}
              className={`w-full flex items-center justify-between px-3 py-2 text-sm rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                activeTab === 'queue'
                  ? 'bg-slate-100 font-medium text-slate-900'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <span className="inline-flex items-center gap-2.5">
                <ListFilter className="w-4 h-4 text-slate-500" />
                arXiv Queue
              </span>
              <span className="font-mono tabular-nums text-xs text-slate-500">
                {curatedQueue.length}
              </span>
            </button>
          </div>

          {/* Corpus Summary */}
          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3 text-xs">
            <div className="flex items-center gap-2 font-semibold text-slate-900">
              <Layers className="w-3.5 h-3.5 text-slate-500" />
              Index Summary
            </div>
            <dl className="space-y-2 text-slate-600">
              <div className="flex items-center justify-between">
                <dt>Ingested Papers</dt>
                <dd className="font-mono tabular-nums font-medium text-slate-900">
                  {stats.totalPapers}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt>Extracted Chunks</dt>
                <dd className="font-mono tabular-nums font-medium text-slate-900">
                  {stats.totalChunks}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt>Dense Embeddings</dt>
                <dd className="font-mono tabular-nums font-medium text-slate-900">
                  {stats.embeddedChunks}/{stats.totalChunks}
                </dd>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                <dt>Gemini API</dt>
                <dd className={stats.geminiConfigured ? 'text-emerald-700 font-medium' : 'text-slate-500'}>
                  {stats.geminiConfigured ? 'Configured' : 'Key not set'}
                </dd>
              </div>
            </dl>
          </div>
        </aside>

        <main className="lg:col-span-9 min-w-0">
          {activeTab === 'query' && (
            <QueryWorkspace
              stats={stats}
              onCorpusUpdated={loadCorpus}
              onNavigateQueue={() => setActiveTab('queue')}
              onSyncStarterBatch={handleSyncStarterBatch}
              isSyncing={isSyncing}
            />
          )}
          {activeTab === 'corpus' && (
            <CorpusWorkspace
              papers={papers}
              stats={stats}
              onCorpusUpdated={loadCorpus}
            />
          )}
          {activeTab === 'queue' && (
            <QueueWorkspace
              queue={curatedQueue}
              onCorpusUpdated={loadCorpus}
              onInspectPaper={() => setActiveTab('corpus')}
            />
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
