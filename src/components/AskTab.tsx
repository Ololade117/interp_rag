import React, { useState } from 'react';
import { AlertCircle, ArrowRight } from 'lucide-react';
import {
  DEFAULT_SYSTEM_PROMPT,
  type RagConfigStatus,
  type RagRunResult,
  type SearchSettings,
  type StorageBackend,
} from '../types';

interface AskTabProps {
  status: RagConfigStatus;
  defaultBackend: StorageBackend;
}

export const AskTab: React.FC<AskTabProps> = ({ status, defaultBackend }) => {
  const [query, setQuery] = useState('');
  const [settings, setSettings] = useState<SearchSettings>({
    backend: defaultBackend,
    namespace: 'interp-rag',
    topK: 4,
    hybridAlpha: 0.75,
    minScore: 0,
    dimensions: status.pineconeDimension || 768,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
  });

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RagRunResult | null>(null);

  const handleAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), settings }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Query failed.');
        return;
      }
      setResult(data as RagRunResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error running query.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-5">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Ask & Tune Retrieval</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Adjust Top-K, vector vs keyword blending, score cutoff, and system prompt to see how
            each setting changes the retrieved chunks and answer.
          </p>
        </div>

        <form onSubmit={handleAsk} className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ask a question about your uploaded documents..."
              className="flex-1 px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
            <button
              type="submit"
              disabled={isLoading || !query.trim()}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              {isLoading ? 'Searching...' : 'Ask Question'}
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          <div className="pt-4 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 text-xs">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Storage</label>
              <select
                value={settings.backend}
                onChange={(e) =>
                  setSettings({ ...settings, backend: e.target.value as StorageBackend })
                }
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
                value={settings.namespace}
                onChange={(e) => setSettings({ ...settings, namespace: e.target.value })}
                className="w-full px-2.5 py-1.5 border border-slate-300 rounded-md font-mono"
              />
            </div>

            <div>
              <div className="flex justify-between font-medium text-slate-700 mb-1">
                <span>Top-K</span>
                <span className="font-mono tabular-nums">{settings.topK}</span>
              </div>
              <input
                type="range"
                min={1}
                max={12}
                value={settings.topK}
                onChange={(e) => setSettings({ ...settings, topK: Number(e.target.value) })}
                className="w-full accent-blue-700 cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between font-medium text-slate-700 mb-1">
                <span>Vector / Keyword</span>
                <span className="font-mono tabular-nums">
                  {Math.round(settings.hybridAlpha * 100)}% /{' '}
                  {Math.round((1 - settings.hybridAlpha) * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={settings.hybridAlpha}
                onChange={(e) =>
                  setSettings({ ...settings, hybridAlpha: Number(e.target.value) })
                }
                className="w-full accent-blue-700 cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between font-medium text-slate-700 mb-1">
                <span>Min Score</span>
                <span className="font-mono tabular-nums">{settings.minScore.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min={0}
                max={0.9}
                step={0.05}
                value={settings.minScore}
                onChange={(e) => setSettings({ ...settings, minScore: Number(e.target.value) })}
                className="w-full accent-blue-700 cursor-pointer"
              />
            </div>
          </div>

          <div className="text-xs">
            <label htmlFor="ask-prompt" className="block font-medium text-slate-700 mb-1">
              System Prompt (sent to Gemini)
            </label>
            <textarea
              id="ask-prompt"
              rows={2}
              value={settings.systemPrompt}
              onChange={(e) => setSettings({ ...settings, systemPrompt: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-md text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
        </form>
      </section>

      {error && (
        <div className="bg-white border border-red-200 rounded-lg p-4 flex items-start gap-2.5 text-sm text-red-700">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {result && (
        <div className="space-y-6">
          <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-3">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-900">Generated Answer</h2>
              <span className="text-xs font-mono tabular-nums text-slate-500">
                {result.chunks.length} chunks · {result.durationMs} ms
              </span>
            </div>

            {result.answerError ? (
              <p className="text-sm text-red-700">{result.answerError}</p>
            ) : (
              <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-line">
                {result.answer}
              </p>
            )}
          </section>

          <section className="bg-white border border-slate-200 rounded-lg p-6">
            <h2 className="text-sm font-semibold text-slate-900 pb-3 border-b border-slate-200">
              Retrieved Chunks ({result.chunks.length})
            </h2>

            {result.chunks.length === 0 ? (
              <p className="text-sm text-slate-500 py-6 text-center">
                No chunks matched in this namespace/store.
              </p>
            ) : (
              <div className="divide-y divide-slate-200">
                {result.chunks.map((chunk, i) => (
                  <div key={chunk.id} className="py-4 space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                      <span>
                        <strong className="text-slate-900">Source {i + 1}</strong> ·{' '}
                        {chunk.documentTitle} · Chunk {chunk.chunkIndex + 1}
                      </span>
                      <span className="font-mono tabular-nums text-slate-700">
                        Score {chunk.combinedScore.toFixed(3)} (Vec {chunk.vectorScore.toFixed(3)} ·
                        KW {chunk.keywordScore.toFixed(3)})
                      </span>
                    </div>
                    <p className="text-sm text-slate-700 leading-relaxed">{chunk.text}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
};
