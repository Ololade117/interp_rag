import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  ExternalLink,
  FileText,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import type { CorpusStats, PaperChunkView, PaperRecord } from '../types';

interface CorpusWorkspaceProps {
  papers: PaperRecord[];
  stats: CorpusStats;
  onCorpusUpdated: () => Promise<void>;
}

export const CorpusWorkspace: React.FC<CorpusWorkspaceProps> = ({
  papers,
  stats,
  onCorpusUpdated,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [arxivInput, setArxivInput] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [isIngestingUrl, setIsIngestingUrl] = useState(false);
  const [isEmbedding, setIsEmbedding] = useState(false);
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualTitle, setManualTitle] = useState('');
  const [manualUrl, setManualUrl] = useState('');
  const [manualAbstract, setManualAbstract] = useState('');
  const [manualResults, setManualResults] = useState('');

  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [selectedPaper, setSelectedPaper] = useState<{
    paper: PaperRecord;
    chunks: PaperChunkView[];
  } | null>(null);
  const [searchFilter, setSearchFilter] = useState('');

  const handleUploadPdf = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    setFeedback(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/papers/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ type: 'err', text: data.error || 'PDF upload failed.' });
        return;
      }

      setFeedback({
        type: 'ok',
        text: `Extracted "${data.paper.title}" (${data.paper.chunkCount} chunks).`,
      });
      await onCorpusUpdated();
      await inspectPaper(data.paper.id);
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to upload PDF.',
      });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleIngestUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!arxivInput.trim()) return;
    setIsIngestingUrl(true);
    setFeedback(null);

    try {
      const res = await fetch('/api/papers/ingest-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: arxivInput.trim(), allowHtml: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ type: 'err', text: data.error || 'Failed to ingest paper URL.' });
        return;
      }
      setFeedback({ type: 'ok', text: data.message });
      setArxivInput('');
      await onCorpusUpdated();
      if (data.paper?.id) {
        await inspectPaper(data.paper.id);
      }
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Network error ingesting URL.',
      });
    } finally {
      setIsIngestingUrl(false);
    }
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    try {
      const res = await fetch('/api/papers/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: manualTitle,
          sourceUrl: manualUrl,
          abstract: manualAbstract,
          results: manualResults,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ type: 'err', text: data.error || 'Failed to add manual paper.' });
        return;
      }
      setManualTitle('');
      setManualUrl('');
      setManualAbstract('');
      setManualResults('');
      setShowManualForm(false);
      setFeedback({ type: 'ok', text: `Added "${data.paper.title}" to corpus.` });
      await onCorpusUpdated();
      await inspectPaper(data.paper.id);
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to save manual paper.',
      });
    }
  };

  const handleComputeEmbeddings = async () => {
    setIsEmbedding(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/papers/embed', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ type: 'err', text: data.error || 'Embedding generation failed.' });
        return;
      }
      setFeedback({
        type: 'ok',
        text: `Generated Gemini dense embeddings for ${data.embeddedCount} new chunks.`,
      });
      await onCorpusUpdated();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Network error generating embeddings.',
      });
    } finally {
      setIsEmbedding(false);
    }
  };

  const inspectPaper = async (id: string) => {
    try {
      const res = await fetch(`/api/papers/${id}`);
      if (!res.ok) return;
      const data = await res.json();
      setSelectedPaper(data);
    } catch {
      // Ignore transient inspect failure
    }
  };

  const handleDeletePaper = async (id: string) => {
    try {
      const res = await fetch(`/api/papers/${id}`, { method: 'DELETE' });
      if (!res.ok) return;
      if (selectedPaper?.paper.id === id) {
        setSelectedPaper(null);
      }
      await onCorpusUpdated();
    } catch {
      // Ignore
    }
  };

  const filteredPapers = papers.filter((p) => {
    if (!searchFilter.trim()) return true;
    const q = searchFilter.toLowerCase();
    return (
      p.title.toLowerCase().includes(q) ||
      p.filename.toLowerCase().includes(q) ||
      (p.arxivId && p.arxivId.toLowerCase().includes(q))
    );
  });

  return (
    <div className="space-y-8">
      {/* Ingestion Bar */}
      <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">
              Paper Corpus & Section Extractor
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Extracts document title, Abstract, and Results sections from PDFs and arXiv papers
              into indexed passages.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              onChange={handleUploadPdf}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Upload className="w-3.5 h-3.5" />
              {isUploading ? 'Parsing PDF...' : 'Upload PDF'}
            </button>
            <button
              type="button"
              onClick={() => setShowManualForm(!showManualForm)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Text Excerpt
            </button>
            <button
              type="button"
              onClick={handleComputeEmbeddings}
              disabled={isEmbedding || stats.totalChunks === 0}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              {isEmbedding
                ? 'Embedding...'
                : `Embed Chunks (${stats.embeddedChunks}/${stats.totalChunks})`}
            </button>
          </div>
        </div>

        <form onSubmit={handleIngestUrl} className="flex flex-col sm:flex-row gap-3 pt-2">
          <input
            type="text"
            value={arxivInput}
            onChange={(e) => setArxivInput(e.target.value)}
            placeholder="Enter arXiv ID (e.g. 2209.10652) or paper URL (https://arxiv.org/pdf/2209.11895)"
            className="flex-1 px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
          <button
            type="submit"
            disabled={isIngestingUrl || !arxivInput.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            {isIngestingUrl ? 'Fetching...' : 'Fetch & Extract'}
          </button>
        </form>

        {showManualForm && (
          <form
            onSubmit={handleManualSubmit}
            className="pt-4 mt-2 border-t border-slate-200 space-y-3"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                type="text"
                required
                value={manualTitle}
                onChange={(e) => setManualTitle(e.target.value)}
                placeholder="Paper Title"
                className="px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
              <input
                type="text"
                value={manualUrl}
                onChange={(e) => setManualUrl(e.target.value)}
                placeholder="Source URL (optional)"
                className="px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <textarea
              rows={3}
              value={manualAbstract}
              onChange={(e) => setManualAbstract(e.target.value)}
              placeholder="Abstract text..."
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
            <textarea
              rows={4}
              value={manualResults}
              onChange={(e) => setManualResults(e.target.value)}
              placeholder="Results / findings text..."
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowManualForm(false)}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer"
              >
                Save to Corpus
              </button>
            </div>
          </form>
        )}

        {feedback && (
          <div
            className={`text-xs px-3.5 py-2.5 rounded-lg border flex items-center gap-2 ${
              feedback.type === 'ok'
                ? 'bg-emerald-50/70 border-emerald-200 text-emerald-800'
                : 'bg-red-50/70 border-red-200 text-red-800'
            }`}
          >
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{feedback.text}</span>
          </div>
        )}
      </section>

      {/* Corpus Table + Inspector Split */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <section
          className={`bg-white border border-slate-200 rounded-lg overflow-hidden ${
            selectedPaper ? 'xl:col-span-6' : 'xl:col-span-12'
          }`}
        >
          <div className="px-5 py-3.5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-900">
              Ingested Papers ({papers.length})
            </h2>
            <input
              type="search"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Filter corpus by title or ID..."
              className="px-3 py-1.5 text-xs border border-slate-200 rounded-md w-full sm:w-56 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          {filteredPapers.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              {papers.length === 0
                ? 'No papers ingested yet. Upload a PDF, paste an arXiv ID above, or sync from the arXiv Queue.'
                : 'No ingested papers match your filter.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 bg-slate-50/60">
                    <th className="py-2.5 px-4 font-medium">Paper Title</th>
                    <th className="py-2.5 px-3 font-medium text-right">Pages</th>
                    <th className="py-2.5 px-3 font-medium text-right">Abstract</th>
                    <th className="py-2.5 px-3 font-medium text-right">Results</th>
                    <th className="py-2.5 px-3 font-medium text-right">Chunks</th>
                    <th className="py-2.5 px-4 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredPapers.map((p) => {
                    const active = selectedPaper?.paper.id === p.id;
                    return (
                      <tr
                        key={p.id}
                        onClick={() => inspectPaper(p.id)}
                        className={`cursor-pointer transition-colors ${
                          active ? 'bg-blue-50/60' : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="py-3 px-4 max-w-xs">
                          <div className="font-medium text-slate-900 truncate">{p.title}</div>
                          <div className="text-[11px] text-slate-500 font-mono truncate">
                            {p.arxivId ? `arXiv:${p.arxivId}` : p.filename} ·{' '}
                            {p.embeddingReady ? 'Dense ready' : 'Lexical ready'}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-600">
                          {p.pageCount}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-600">
                          {p.abstract.length.toLocaleString()} ch
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-600">
                          {p.results.length.toLocaleString()} ch
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums font-medium text-slate-900">
                          {p.chunkCount}
                        </td>
                        <td
                          className="py-3 px-4 text-right"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="inline-flex items-center gap-2">
                            {p.sourceUrl && (
                              <a
                                href={p.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                                aria-label="Open original paper"
                                className="text-slate-400 hover:text-slate-700"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            )}
                            <button
                              type="button"
                              onClick={() => handleDeletePaper(p.id)}
                              aria-label={`Remove ${p.title}`}
                              className="text-slate-400 hover:text-red-600 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {selectedPaper && (
          <section className="xl:col-span-6 bg-white border border-slate-200 rounded-lg p-6 space-y-5">
            <div className="flex items-start justify-between gap-4 pb-3 border-b border-slate-200">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                  <FileText className="w-3.5 h-3.5" />
                  <span className="font-mono">{selectedPaper.paper.filename}</span>
                </div>
                <h3 className="text-base font-semibold text-slate-900 leading-snug">
                  {selectedPaper.paper.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPaper(null)}
                className="text-xs font-medium text-slate-500 hover:text-slate-900 cursor-pointer shrink-0"
              >
                Close
              </button>
            </div>

            <div className="space-y-4 text-sm">
              <div>
                <h4 className="text-xs font-semibold text-slate-700 mb-1">
                  Extracted Abstract ({selectedPaper.paper.abstract.length.toLocaleString()} chars)
                </h4>
                <p className="text-slate-700 leading-relaxed text-xs bg-slate-50 p-3 rounded border border-slate-200">
                  {selectedPaper.paper.abstract ||
                    'No standalone Abstract heading detected by regex; indexed via body fallback.'}
                </p>
              </div>

              <div>
                <h4 className="text-xs font-semibold text-slate-700 mb-1">
                  Extracted Results ({selectedPaper.paper.results.length.toLocaleString()} chars)
                </h4>
                <p className="text-slate-700 leading-relaxed text-xs bg-slate-50 p-3 rounded border border-slate-200 max-h-60 overflow-y-auto">
                  {selectedPaper.paper.results ||
                    'No standalone Results heading detected by regex.'}
                </p>
              </div>

              <div>
                <h4 className="text-xs font-semibold text-slate-700 mb-2">
                  Indexed Chunks ({selectedPaper.chunks.length})
                </h4>
                <div className="divide-y divide-slate-100 border border-slate-200 rounded max-h-72 overflow-y-auto">
                  {selectedPaper.chunks.map((chunk) => (
                    <div key={chunk.id} className="p-3 text-xs space-y-1">
                      <div className="flex items-center justify-between text-slate-500 font-mono">
                        <span className="capitalize">
                          {chunk.section} · chunk {chunk.chunkIndex + 1}
                        </span>
                        <span>{chunk.text.length} chars</span>
                      </div>
                      <p className="text-slate-700 leading-relaxed">{chunk.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
};
