import React, { useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Database,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import type { CorpusStats, RagQueryResponse, RetrievedChunkResult } from '../types';

interface QueryWorkspaceProps {
  stats: CorpusStats;
  onCorpusUpdated: () => Promise<void>;
  onNavigateQueue: () => void;
  onSyncStarterBatch: () => Promise<void>;
  isSyncing: boolean;
}

const SAMPLE_QUERIES = [
  'How do induction heads implement in-context learning in transformers?',
  'What causes polysemanticity and superposition in neural network activations?',
  'How does path patching isolate the Indirect Object Identification circuit in GPT-2?',
  'What empirical results evaluate sparse autoencoders for feature extraction?',
];

export const QueryWorkspace: React.FC<QueryWorkspaceProps> = ({
  stats,
  onCorpusUpdated,
  onNavigateQueue,
  onSyncStarterBatch,
  isSyncing,
}) => {
  const [query, setQuery] = useState(
    'How do induction heads and attention circuits contribute to transformer behavior?'
  );
  const [topK, setTopK] = useState(5);
  const [sectionFilter, setSectionFilter] = useState<'all' | 'abstract' | 'results'>('all');
  const [wDense, setWDense] = useState(0.45);
  const [wSparse, setWSparse] = useState(0.3);
  const [wColbert, setWColbert] = useState(0.25);
  const [useDense, setUseDense] = useState(true);
  const [synthesize, setSynthesize] = useState(true);
  const [showControls, setShowControls] = useState(true);

  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<RagQueryResponse | null>(null);
  const [expandedChunkId, setExpandedChunkId] = useState<string | null>(null);

  const handleRunQuery = async (e?: React.FormEvent, overrideQuery?: string) => {
    if (e) e.preventDefault();
    const activeQuery = (overrideQuery ?? query).trim();
    if (!activeQuery) return;
    if (overrideQuery) setQuery(overrideQuery);

    setIsSearching(true);
    setError(null);

    try {
      const res = await fetch('/api/rag/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: activeQuery,
          topK,
          sectionFilter,
          weights: {
            dense: wDense,
            sparse: wSparse,
            colbert: wColbert,
          },
          useDenseEmbeddings: useDense,
          synthesizeAnswer: synthesize,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Query execution failed.');
        return;
      }

      setResponse(data as RagQueryResponse);
      await onCorpusUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error running RAG query.');
    } finally {
      setIsSearching(false);
    }
  };

  const renderScoreBar = (label: string, value: number | null, accentClass: string) => {
    const pct = value === null ? 0 : Math.min(100, Math.max(0, Math.round(value * 100)));
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="w-16 text-slate-500 shrink-0">{label}</span>
        <div className="flex-1 h-1.5 bg-slate-100 rounded-sm overflow-hidden">
          <div
            className={`h-full ${value === null ? 'bg-slate-200' : accentClass}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="w-12 text-right font-mono tabular-nums text-slate-700">
          {value === null ? 'n/a' : value.toFixed(3)}
        </span>
      </div>
    );
  };

  const renderChunkRow = (item: RetrievedChunkResult, index: number) => {
    const isExpanded = expandedChunkId === item.chunk.id;
    return (
      <div
        key={item.chunk.id}
        className="border-b border-slate-200 last:border-b-0 py-4 transition-colors"
      >
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mb-1.5">
              <span className="font-mono tabular-nums font-semibold text-slate-900">
                Source {index + 1}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-medium text-slate-700 capitalize">{item.chunk.section}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">Chunk {item.chunk.chunkIndex + 1}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-blue-700 font-medium">
                Hybrid {item.scores.hybrid.toFixed(3)}
              </span>
            </div>

            <h4 className="text-sm font-semibold text-slate-900 mb-2 leading-snug">
              {item.chunk.paperTitle}
            </h4>

            <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
              {item.chunk.text}
            </p>
          </div>

          <div className="w-full lg:w-64 shrink-0 space-y-1.5 pt-1">
            {renderScoreBar('Dense', item.scores.dense, 'bg-blue-700')}
            {renderScoreBar('Sparse', item.scores.sparse, 'bg-emerald-600')}
            {renderScoreBar('ColBERT', item.scores.colbert, 'bg-amber-600')}
            <button
              type="button"
              onClick={() => setExpandedChunkId(isExpanded ? null : item.chunk.id)}
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors cursor-pointer whitespace-nowrap"
            >
              {isExpanded ? (
                <>
                  Hide lexical & phrase vectors <ChevronUp className="w-3.5 h-3.5" />
                </>
              ) : (
                <>
                  Inspect sparse & ColBERT matches <ChevronDown className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>
        </div>

        {isExpanded && (
          <div className="mt-4 pt-3 border-t border-slate-100 grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
            <div>
              <div className="font-medium text-slate-800 mb-2">
                Sparse Lexical Weights (Query × Document BM25)
              </div>
              {item.sparseMatches.length === 0 ? (
                <p className="text-slate-500">No direct lexical term overlap in this chunk.</p>
              ) : (
                <div className="space-y-1 font-mono tabular-nums">
                  {item.sparseMatches.map((m) => (
                    <div
                      key={m.token}
                      className="flex items-center justify-between text-slate-700 py-0.5 border-b border-slate-100 last:border-b-0"
                    >
                      <span>{m.token}</span>
                      <span className="text-slate-500">
                        q:{m.queryWeight.toFixed(2)} · d:{m.docWeight.toFixed(2)} ·{' '}
                        <strong className="text-slate-900">+{m.contribution.toFixed(3)}</strong>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="font-medium text-slate-800 mb-2">
                Multi-Vector MaxSim Phrase Alignments
              </div>
              {item.phraseMatches.length === 0 ? (
                <p className="text-slate-500">No high-similarity token phrases matched.</p>
              ) : (
                <div className="space-y-1 font-mono tabular-nums">
                  {item.phraseMatches.map((pm, idx) => (
                    <div
                      key={`${pm.queryTerm}-${idx}`}
                      className="flex items-center justify-between text-slate-700 py-0.5 border-b border-slate-100 last:border-b-0"
                    >
                      <span className="truncate max-w-[70%]">
                        {pm.queryTerm} → “{pm.matchedPhrase}”
                      </span>
                      <span className="text-slate-900 font-medium">{pm.similarity.toFixed(3)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-8">
      {/* Empty Corpus Onboarding Banner */}
      {stats.totalPapers === 0 && (
        <div className="bg-white border border-slate-200 rounded-lg p-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1 max-w-2xl">
              <h2 className="text-base font-semibold text-slate-900">
                Ingest Mechanistic Interpretability Papers to Begin
              </h2>
              <p className="text-sm text-slate-600 leading-relaxed">
                The repository includes 19 curated paper URLs from{' '}
                <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">download_papers.py</code>.
                Fetch the starter arXiv papers now to extract their Title, Abstract, and Results
                sections, or upload your own PDFs in the Paper Corpus view.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={onSyncStarterBatch}
                disabled={isSyncing}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                {isSyncing ? 'Fetching arXiv PDFs...' : 'Fetch Starter 5 arXiv Papers'}
              </button>
              <button
                type="button"
                onClick={onNavigateQueue}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                Open arXiv Queue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Query Composer */}
      <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-900 text-balance">
              Hybrid Mechanistic Interpretability Search & Synthesis
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Combines dense semantic vectors, sparse BM25 lexical weights, and multi-vector
              MaxSim phrase matching across extracted paper sections.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowControls(!showControls)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            {showControls ? 'Hide Weights' : 'Retrieval Weights'}
          </button>
        </div>

        <form onSubmit={(e) => handleRunQuery(e)} className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ask about circuits, superposition, sparse autoencoders, or path patching..."
                className="w-full pl-10 pr-4 py-2.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
              />
            </div>
            <button
              type="submit"
              disabled={isSearching || stats.totalChunks === 0}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              {isSearching ? 'Retrieving...' : 'Run Hybrid Query'}
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-500">
            <span className="font-medium text-slate-600">Sample queries:</span>
            {SAMPLE_QUERIES.map((sq, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleRunQuery(undefined, sq)}
                disabled={isSearching || stats.totalChunks === 0}
                className="text-left text-slate-600 hover:text-blue-700 hover:underline disabled:opacity-50 transition-colors cursor-pointer"
              >
                {sq.length > 56 ? `${sq.slice(0, 56)}…` : sq}
              </button>
            ))}
          </div>

          {showControls && (
            <div className="pt-4 border-t border-slate-200 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
              <div>
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <label htmlFor="w-dense" className="font-medium text-slate-700">
                    Dense Weight (Semantic)
                  </label>
                  <span className="font-mono tabular-nums text-slate-600">{wDense.toFixed(2)}</span>
                </div>
                <input
                  id="w-dense"
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={wDense}
                  onChange={(e) => setWDense(Number(e.target.value))}
                  className="w-full accent-blue-700 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <label htmlFor="w-sparse" className="font-medium text-slate-700">
                    Sparse Weight (Lexical)
                  </label>
                  <span className="font-mono tabular-nums text-slate-600">
                    {wSparse.toFixed(2)}
                  </span>
                </div>
                <input
                  id="w-sparse"
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={wSparse}
                  onChange={(e) => setWSparse(Number(e.target.value))}
                  className="w-full accent-emerald-600 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <label htmlFor="w-colbert" className="font-medium text-slate-700">
                    Multi-Vector (ColBERT)
                  </label>
                  <span className="font-mono tabular-nums text-slate-600">
                    {wColbert.toFixed(2)}
                  </span>
                </div>
                <input
                  id="w-colbert"
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={wColbert}
                  onChange={(e) => setWColbert(Number(e.target.value))}
                  className="w-full accent-amber-600 cursor-pointer"
                />
              </div>

              <div className="flex flex-col justify-between gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-700">Section</span>
                  <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-md">
                    {(['all', 'abstract', 'results'] as const).map((sec) => (
                      <button
                        key={sec}
                        type="button"
                        onClick={() => setSectionFilter(sec)}
                        className={`px-2 py-1 text-xs font-medium rounded transition-colors cursor-pointer capitalize whitespace-nowrap ${
                          sectionFilter === sec
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {sec}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs text-slate-600">
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={useDense}
                      onChange={(e) => setUseDense(e.target.checked)}
                      className="rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                    />
                    Gemini Embeddings
                  </label>

                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={synthesize}
                      onChange={(e) => setSynthesize(e.target.checked)}
                      className="rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                    />
                    RAG Answer
                  </label>

                  <select
                    aria-label="Top K results"
                    value={topK}
                    onChange={(e) => setTopK(Number(e.target.value))}
                    className="bg-white border border-slate-200 rounded px-1.5 py-0.5 font-mono tabular-nums text-xs text-slate-700"
                  >
                    <option value={3}>K=3</option>
                    <option value={5}>K=5</option>
                    <option value={8}>K=8</option>
                    <option value={10}>K=10</option>
                  </select>
                </div>
              </div>
            </div>
          )}
        </form>
      </section>

      {error && (
        <div className="bg-white border border-red-200 rounded-lg p-4 flex items-start gap-3 text-sm text-red-700">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>{error}</div>
        </div>
      )}

      {/* Results Area */}
      {response && (
        <div className="space-y-8">
          {/* Grounded Synthesis */}
          {(response.answer !== null || response.synthesisError) && (
            <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
                <h2 className="text-base font-semibold text-slate-900">
                  Grounded Synthesis (Gemini 4 Hydrogen)
                </h2>
                <span className="text-xs text-slate-500 font-mono tabular-nums">
                  {response.results.length} cited passages ·{' '}
                  {response.denseActive ? 'Dense + Sparse + ColBERT' : 'Sparse + ColBERT'}
                </span>
              </div>

              {response.synthesisError ? (
                <div className="flex items-start gap-2.5 text-sm text-amber-800 bg-amber-50/60 border border-amber-200 rounded-lg p-3.5">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium">Answer synthesis unavailable</p>
                    <p className="text-xs text-amber-700 mt-0.5">{response.synthesisError}</p>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-slate-800 leading-relaxed whitespace-pre-line max-w-4xl">
                  {response.answer}
                </div>
              )}

              {response.denseError && (
                <p className="text-xs text-slate-500 pt-1">
                  Dense vector notice: {response.denseError} Scores below reflect Sparse BM25 and
                  ColBERT MaxSim.
                </p>
              )}
            </section>
          )}

          {/* Query Sparse Representation */}
          <section className="bg-white border border-slate-200 rounded-lg p-6">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-4 border-b border-slate-200">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Retrieved Evidence & Multi-Representation Scores
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Query lexical weights:{' '}
                  <span className="font-mono text-slate-700">
                    {Object.entries(response.querySparseWeights)
                      .slice(0, 8)
                      .map(([tok, w]) => `${tok}:${w.toFixed(2)}`)
                      .join(' · ') || 'none'}
                  </span>
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500 font-mono tabular-nums">
                <Database className="w-3.5 h-3.5" />
                <span>{stats.totalChunks} indexed chunks</span>
              </div>
            </div>

            {response.results.length === 0 ? (
              <p className="text-sm text-slate-500 py-6 text-center">
                No passages matched the selected section filter. Try switching section filter to
                All.
              </p>
            ) : (
              <div>{response.results.map((r, i) => renderChunkRow(r, i))}</div>
            )}
          </section>
        </div>
      )}
    </div>
  );
};
