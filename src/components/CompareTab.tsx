import React, { useState } from 'react';
import { AlertCircle, ArrowLeftRight } from 'lucide-react';
import {
  DEFAULT_SYSTEM_PROMPT,
  type RagConfigStatus,
  type RagRunResult,
  type SearchSettings,
  type StorageBackend,
} from '../types';

interface CompareTabProps {
  status: RagConfigStatus;
  defaultBackend: StorageBackend;
}

export const CompareTab: React.FC<CompareTabProps> = ({ status, defaultBackend }) => {
  const defaultDims = status.pineconeDimension || 768;

  const [query, setQuery] = useState('');
  const [configA, setConfigA] = useState<SearchSettings>({
    backend: defaultBackend,
    namespace: 'interp-rag',
    topK: 3,
    hybridAlpha: 1.0, // Pure vector search
    minScore: 0,
    dimensions: defaultDims,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
  });

  const [configB, setConfigB] = useState<SearchSettings>({
    backend: defaultBackend,
    namespace: 'interp-rag',
    topK: 6,
    hybridAlpha: 0.65, // Hybrid vector + keyword
    minScore: 0,
    dimensions: defaultDims,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
  });

  const [isComparing, setIsComparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<{
    resultA: RagRunResult;
    resultB: RagRunResult;
  } | null>(null);

  const handleCompare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setIsComparing(true);
    setError(null);

    try {
      const res = await fetch('/api/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: query.trim(),
          configA,
          configB,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Comparison failed.');
        return;
      }
      setResults({ resultA: data.resultA, resultB: data.resultB });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error running comparison.');
    } finally {
      setIsComparing(false);
    }
  };

  const renderConfigCard = (
    label: string,
    cfg: SearchSettings,
    onChange: (next: SearchSettings) => void
  ) => (
    <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4 text-xs">
      <div className="flex items-center justify-between pb-2 border-b border-slate-100">
        <h2 className="text-sm font-semibold text-slate-900">{label}</h2>
        <span className="font-mono text-slate-500">
          {cfg.backend} · {cfg.namespace}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block font-medium text-slate-700 mb-1">Storage</label>
          <select
            value={cfg.backend}
            onChange={(e) => onChange({ ...cfg, backend: e.target.value as StorageBackend })}
            className="w-full px-2.5 py-1.5 border border-slate-300 rounded-md bg-white"
          >
            <option value="pinecone">Pinecone</option>
            <option value="memory">In-Memory</option>
          </select>
        </div>

        <div>
          <label className="block font-medium text-slate-700 mb-1">Namespace</label>
          <input
            type="text"
            value={cfg.namespace}
            onChange={(e) => onChange({ ...cfg, namespace: e.target.value })}
            className="w-full px-2.5 py-1.5 border border-slate-300 rounded-md font-mono"
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <div className="flex justify-between font-medium text-slate-700 mb-1">
            <span>Top-K</span>
            <span className="font-mono tabular-nums">{cfg.topK}</span>
          </div>
          <input
            type="range"
            min={1}
            max={12}
            value={cfg.topK}
            onChange={(e) => onChange({ ...cfg, topK: Number(e.target.value) })}
            className="w-full accent-blue-700 cursor-pointer"
          />
        </div>

        <div>
          <div className="flex justify-between font-medium text-slate-700 mb-1">
            <span>Vector %</span>
            <span className="font-mono tabular-nums">{Math.round(cfg.hybridAlpha * 100)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={cfg.hybridAlpha}
            onChange={(e) => onChange({ ...cfg, hybridAlpha: Number(e.target.value) })}
            className="w-full accent-blue-700 cursor-pointer"
          />
        </div>

        <div>
          <div className="flex justify-between font-medium text-slate-700 mb-1">
            <span>Min Score</span>
            <span className="font-mono tabular-nums">{cfg.minScore.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min={0}
            max={0.9}
            step={0.05}
            value={cfg.minScore}
            onChange={(e) => onChange({ ...cfg, minScore: Number(e.target.value) })}
            className="w-full accent-blue-700 cursor-pointer"
          />
        </div>
      </div>

      <div>
        <label className="block font-medium text-slate-700 mb-1">System Prompt</label>
        <textarea
          rows={2}
          value={cfg.systemPrompt}
          onChange={(e) => onChange({ ...cfg, systemPrompt: e.target.value })}
          className="w-full px-2.5 py-1.5 border border-slate-300 rounded-md text-slate-700"
        />
      </div>
    </div>
  );

  const renderResultColumn = (label: string, run: RagRunResult) => (
    <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-slate-200">
        <h3 className="text-sm font-semibold text-slate-900">{label}</h3>
        <span className="text-xs font-mono tabular-nums text-slate-500">
          Top-{run.settings.topK} · {Math.round(run.settings.hybridAlpha * 100)}% vector ·{' '}
          {run.chunks.length} hits · {run.durationMs} ms
        </span>
      </div>

      <div>
        <div className="text-xs font-medium text-slate-500 mb-1.5">Answer</div>
        {run.answerError ? (
          <p className="text-xs text-red-700">{run.answerError}</p>
        ) : (
          <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-line">
            {run.answer}
          </p>
        )}
      </div>

      <div className="pt-3 border-t border-slate-100">
        <div className="text-xs font-medium text-slate-500 mb-2">
          Retrieved Chunks ({run.chunks.length})
        </div>
        {run.chunks.length === 0 ? (
          <p className="text-xs text-slate-400">No chunks matched.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {run.chunks.map((c, idx) => (
              <div key={c.id} className="py-2.5 space-y-1">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span className="font-medium text-slate-800 truncate">
                    #{idx + 1} · {c.documentTitle} (Chunk {c.chunkIndex + 1})
                  </span>
                  <span className="font-mono tabular-nums text-slate-700 shrink-0 ml-2">
                    {c.combinedScore.toFixed(3)}
                  </span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">{c.text}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Side-by-Side RAG Comparison</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Run the exact same question against two retrieval setups (different Top-K, hybrid
            weights, namespaces, or prompts) to see which gives better results.
          </p>
        </div>

        <form onSubmit={handleCompare} className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Enter a test question to compare Setup A vs Setup B..."
            className="flex-1 px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
          <button
            type="submit"
            disabled={isComparing || !query.trim()}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <ArrowLeftRight className="w-4 h-4" />
            {isComparing ? 'Comparing...' : 'Run Comparison'}
          </button>
        </form>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {renderConfigCard('Setup A', configA, setConfigA)}
        {renderConfigCard('Setup B', configB, setConfigB)}
      </div>

      {error && (
        <div className="bg-white border border-red-200 rounded-lg p-4 flex items-start gap-2.5 text-sm text-red-700">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {results && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {renderResultColumn('Setup A Result', results.resultA)}
          {renderResultColumn('Setup B Result', results.resultB)}
        </div>
      )}
    </div>
  );
};
