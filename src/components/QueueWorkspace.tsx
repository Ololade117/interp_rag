import React, { useState } from 'react';
import { Download, ExternalLink } from 'lucide-react';
import type { CuratedPaperEntry } from '../types';

interface QueueWorkspaceProps {
  queue: CuratedPaperEntry[];
  onCorpusUpdated: () => Promise<void>;
  onInspectPaper: () => void;
}

export const QueueWorkspace: React.FC<QueueWorkspaceProps> = ({
  queue,
  onCorpusUpdated,
  onInspectPaper,
}) => {
  const [filter, setFilter] = useState<'all' | 'pending' | 'ingested' | 'error'>('all');
  const [busyUrl, setBusyUrl] = useState<string | null>(null);
  const [isBatchSyncing, setIsBatchSyncing] = useState(false);
  const [includeHtml, setIncludeHtml] = useState(true);
  const [batchLog, setBatchLog] = useState<
    Array<{ url: string; ok: boolean; skipped?: boolean; message: string }>
  >([]);

  const handleIngestSingle = async (entry: CuratedPaperEntry) => {
    setBusyUrl(entry.url);
    try {
      await fetch('/api/papers/ingest-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: entry.url, allowHtml: true }),
      });
      await onCorpusUpdated();
    } finally {
      setBusyUrl(null);
    }
  };

  const handleBatchSync = async (limit: number) => {
    setIsBatchSyncing(true);
    setBatchLog([]);
    try {
      const res = await fetch('/api/papers/sync-curated', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit, includeHtml }),
      });
      const data = await res.json();
      if (Array.isArray(data.outcomes)) {
        setBatchLog(data.outcomes);
      }
      await onCorpusUpdated();
    } finally {
      setIsBatchSyncing(false);
    }
  };

  const filtered = queue.filter((entry) => {
    if (filter === 'all') return true;
    if (filter === 'error') return entry.status === 'error' || entry.status === 'skipped';
    return entry.status === filter;
  });

  const statusLabel = (status: CuratedPaperEntry['status']) => {
    if (status === 'ingested') return 'text-emerald-700 font-medium';
    if (status === 'error') return 'text-red-700 font-medium';
    if (status === 'skipped') return 'text-amber-700 font-medium';
    return 'text-slate-500';
  };

  return (
    <div className="space-y-6">
      <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">
              Curated arXiv Paper Queue
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Deduplicated list of {queue.length} Mechanistic Interpretability references preserved
              from <code className="text-xs bg-slate-100 px-1 py-0.5 rounded">download_papers.py</code>.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={includeHtml}
                onChange={(e) => setIncludeHtml(e.target.checked)}
                className="rounded border-slate-300 text-blue-700"
              />
              Extract HTML pages
            </label>
            <button
              type="button"
              onClick={() => handleBatchSync(5)}
              disabled={isBatchSyncing}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              {isBatchSyncing ? 'Syncing Batch...' : 'Sync Next 5 Papers'}
            </button>
            <button
              type="button"
              onClick={() => handleBatchSync(20)}
              disabled={isBatchSyncing}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              Sync All Remaining
            </button>
          </div>
        </div>

        {batchLog.length > 0 && (
          <div className="border-t border-slate-200 pt-3 space-y-1 text-xs font-mono">
            {batchLog.map((item) => (
              <div
                key={item.url}
                className={
                  item.ok
                    ? 'text-emerald-700'
                    : item.skipped
                      ? 'text-amber-700'
                      : 'text-red-700'
                }
              >
                [{item.ok ? 'saved' : item.skipped ? 'skip' : 'error'}] {item.url} — {item.message}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between gap-4">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(['all', 'pending', 'ingested', 'error'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer capitalize whitespace-nowrap ${
                  filter === f
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <span className="text-xs text-slate-500 font-mono tabular-nums">
            Showing {filtered.length} of {queue.length}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 bg-slate-50/60">
                <th className="py-2.5 px-4 font-medium">Reference</th>
                <th className="py-2.5 px-3 font-medium">Type</th>
                <th className="py-2.5 px-3 font-medium">Status</th>
                <th className="py-2.5 px-3 font-medium">Outcome / Title</th>
                <th className="py-2.5 px-4 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((entry) => (
                <tr key={entry.url} className="hover:bg-slate-50/70">
                  <td className="py-3 px-4 font-mono text-slate-800">
                    <a
                      href={entry.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 hover:text-blue-700 hover:underline"
                    >
                      {entry.arxivId ? `arXiv:${entry.arxivId}` : entry.url}
                      <ExternalLink className="w-3 h-3 text-slate-400" />
                    </a>
                  </td>
                  <td className="py-3 px-3 text-slate-600">
                    {entry.kind === 'arxiv_pdf' ? 'arXiv PDF' : 'HTML Article'}
                  </td>
                  <td className={`py-3 px-3 capitalize ${statusLabel(entry.status)}`}>
                    {entry.status}
                  </td>
                  <td className="py-3 px-3 text-slate-600 max-w-md truncate">
                    {entry.title || entry.message || 'Ready to download & extract'}
                  </td>
                  <td className="py-3 px-4 text-right">
                    {entry.status === 'ingested' ? (
                      <button
                        type="button"
                        onClick={onInspectPaper}
                        className="text-blue-700 hover:underline font-medium cursor-pointer whitespace-nowrap"
                      >
                        View in Corpus
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleIngestSingle(entry)}
                        disabled={busyUrl === entry.url || isBatchSyncing}
                        className="px-3 py-1 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 disabled:opacity-50 rounded-md cursor-pointer whitespace-nowrap"
                      >
                        {busyUrl === entry.url ? 'Fetching...' : 'Ingest'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
