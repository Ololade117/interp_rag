import React, { useRef, useState } from 'react';
import { AlertCircle, FileText, Trash2, Upload } from 'lucide-react';
import type { DocumentRecord, RagConfigStatus, StorageBackend } from '../types';

interface DocumentsTabProps {
  status: RagConfigStatus;
  documents: DocumentRecord[];
  defaultBackend: StorageBackend;
  onDocumentsChanged: () => Promise<void>;
}

export const DocumentsTab: React.FC<DocumentsTabProps> = ({
  status,
  documents,
  defaultBackend,
  onDocumentsChanged,
}) => {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [backend, setBackend] = useState<StorageBackend>(defaultBackend);
  const [namespace, setNamespace] = useState('interp-rag');
  const [chunkSize, setChunkSize] = useState(600);
  const [overlap, setOverlap] = useState(100);
  const [dimensions, setDimensions] = useState(status.pineconeDimension || 768);

  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; message: string } | null>(
    null
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFeedback(null);

    try {
      const formData = new FormData();
      formData.append('backend', backend);
      formData.append('namespace', namespace.trim() || 'interp-rag');
      formData.append('chunkSize', String(chunkSize));
      formData.append('overlap', String(overlap));
      formData.append('dimensions', String(dimensions));
      formData.append('title', title.trim());

      if (selectedFile) {
        formData.append('file', selectedFile);
      } else {
        formData.append('text', text.trim());
      }

      const res = await fetch('/api/documents', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        setFeedback({ kind: 'err', message: data.error || 'Could not add document.' });
        return;
      }

      setTitle('');
      setText('');
      setSelectedFile(null);
      if (fileRef.current) fileRef.current.value = '';
      setFeedback({
        kind: 'ok',
        message: `Saved "${data.document.title}" as ${data.document.chunkCount} chunks in ${
          data.document.backend === 'pinecone' ? 'Pinecone' : 'In-Memory'
        } (${data.document.namespace}).`,
      });
      await onDocumentsChanged();
    } catch (err) {
      setFeedback({
        kind: 'err',
        message: err instanceof Error ? err.message : 'Network error adding document.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    setFeedback(null);
    try {
      const res = await fetch(`/api/documents/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ kind: 'err', message: data.error || 'Delete failed.' });
        return;
      }
      await onDocumentsChanged();
    } catch (err) {
      setFeedback({
        kind: 'err',
        message: err instanceof Error ? err.message : 'Failed to delete document.',
      });
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
      {/* Left: Add & Chunk Document */}
      <section className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-6 space-y-5">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Add Document & Chunking</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Upload a file or paste text, choose chunking settings, and save embeddings to Pinecone
            or In-Memory.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Storage Backend
              </label>
              <div className="flex p-0.5 bg-slate-100 rounded-md">
                {(['pinecone', 'memory'] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setBackend(opt)}
                    className={`flex-1 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
                      backend === opt
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {opt === 'pinecone' ? 'Pinecone' : 'In-Memory'}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="doc-ns" className="block text-xs font-medium text-slate-700 mb-1">
                Namespace
              </label>
              <input
                id="doc-ns"
                type="text"
                value={namespace}
                onChange={(e) => setNamespace(e.target.value)}
                placeholder="interp-rag"
                className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          {backend === 'pinecone' && !status.pineconeConfigured && (
            <div className="text-xs text-amber-800 bg-amber-50/70 border border-amber-200 rounded-md p-3">
              Pinecone secrets are not set yet. Add <code className="font-mono">PINECONE_API_KEY</code>{' '}
              and <code className="font-mono">PINECONE_INDEX</code> in{' '}
              <strong>Settings &gt; Secrets</strong>, or switch to <strong>In-Memory</strong> to
              test right away.
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label htmlFor="chunk-size" className="block text-xs font-medium text-slate-700 mb-1">
                Chunk Size
              </label>
              <input
                id="chunk-size"
                type="number"
                min={100}
                max={4000}
                step={50}
                value={chunkSize}
                onChange={(e) => setChunkSize(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label htmlFor="overlap" className="block text-xs font-medium text-slate-700 mb-1">
                Overlap
              </label>
              <input
                id="overlap"
                type="number"
                min={0}
                max={1000}
                step={25}
                value={overlap}
                onChange={(e) => setOverlap(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label htmlFor="dims" className="block text-xs font-medium text-slate-700 mb-1">
                Dimensions
              </label>
              <select
                id="dims"
                value={dimensions}
                onChange={(e) => setDimensions(Number(e.target.value))}
                className="w-full px-2 py-1.5 text-xs font-mono tabular-nums border border-slate-300 rounded-md bg-white"
              >
                <option value={768}>768</option>
                <option value={1536}>1536</option>
                <option value={3072}>3072</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="doc-title" className="block text-xs font-medium text-slate-700 mb-1">
              Document Title
            </label>
            <input
              id="doc-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={selectedFile ? selectedFile.name : 'e.g. Toy Models of Superposition'}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="doc-text" className="text-xs font-medium text-slate-700">
                Paste Text or Upload File (.txt, .md, .pdf)
              </label>
              <input
                ref={fileRef}
                type="file"
                accept=".txt,.md,.pdf,application/pdf,text/plain,text/markdown"
                onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                {selectedFile ? 'Change File' : 'Choose File'}
              </button>
            </div>

            {selectedFile ? (
              <div className="flex items-center justify-between px-3 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-md">
                <span className="inline-flex items-center gap-2 text-slate-800 truncate">
                  <FileText className="w-4 h-4 text-slate-500 shrink-0" />
                  <span className="truncate">{selectedFile.name}</span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedFile(null);
                    if (fileRef.current) fileRef.current.value = '';
                  }}
                  className="text-slate-500 hover:text-red-600 ml-2 cursor-pointer"
                >
                  Clear
                </button>
              </div>
            ) : (
              <textarea
                id="doc-text"
                rows={6}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste paper abstract, notes, or article text here..."
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            )}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-2.5 px-4 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
          >
            {isSubmitting ? 'Chunking & Embedding...' : 'Embed & Store Document'}
          </button>

          {feedback && (
            <div
              className={`text-xs px-3 py-2.5 rounded-md border flex items-start gap-2 ${
                feedback.kind === 'ok'
                  ? 'bg-emerald-50/70 border-emerald-200 text-emerald-800'
                  : 'bg-red-50/70 border-red-200 text-red-800'
              }`}
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{feedback.message}</span>
            </div>
          )}
        </form>
      </section>

      {/* Right: Stored Documents & Pinecone Index Info */}
      <section className="lg:col-span-7 bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Session Documents ({documents.length})
            </h2>
            {status.pineconeConfigured && (
              <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
                Pinecone index: {status.pineconeIndex} ·{' '}
                {status.pineconeTotalRecords ?? 0} total vectors stored
              </p>
            )}
          </div>
        </div>

        {documents.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500 space-y-2">
            <p>No documents added in this session yet.</p>
            <p className="text-xs text-slate-400">
              {status.pineconeConfigured && (status.pineconeTotalRecords ?? 0) > 0
                ? 'Your Pinecone index already has saved vectors from earlier sessions—you can query them right away in the Ask or Compare tabs.'
                : 'Add a document on the left to chunk, embed, and store it.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500">
                  <th className="py-2.5 px-4 font-medium">Title</th>
                  <th className="py-2.5 px-3 font-medium">Store</th>
                  <th className="py-2.5 px-3 font-medium">Namespace</th>
                  <th className="py-2.5 px-3 font-medium text-right">Chunking</th>
                  <th className="py-2.5 px-3 font-medium text-right">Chunks</th>
                  <th className="py-2.5 px-4 font-medium text-right">Remove</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {documents.map((doc) => (
                  <tr key={doc.id} className="hover:bg-slate-50/60">
                    <td className="py-3 px-4 font-medium text-slate-900 max-w-xs truncate">
                      {doc.title}
                    </td>
                    <td className="py-3 px-3 text-slate-600 capitalize">{doc.backend}</td>
                    <td className="py-3 px-3 font-mono text-slate-600">{doc.namespace}</td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-500">
                      {doc.chunkSize} / {doc.overlap}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums font-medium text-slate-900">
                      {doc.chunkCount}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => handleDelete(doc.id)}
                        aria-label={`Delete ${doc.title}`}
                        className="text-slate-400 hover:text-red-600 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5 inline" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
