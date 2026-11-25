import type { CuratedPaperEntry } from './types.js';

// Deduplicated paper list preserved from interp_papers/download_papers.py
const RAW_URLS = [
  'https://arxiv.org/pdf/2209.10652',
  'https://arxiv.org/pdf/2209.11895',
  'https://arxiv.org/pdf/2211.00593',
  'https://arxiv.org/pdf/2304.14997',
  'https://arxiv.org/pdf/2301.05217',
  'https://arxiv.org/pdf/2309.08600',
  'https://arxiv.org/pdf/2310.02207',
  'https://transformer-circuits.pub/2021/framework/index.html',
  'https://arxiv.org/pdf/2403.19647',
  'https://arxiv.org/pdf/2409.14507',
  'https://arxiv.org/pdf/2406.17969',
  'https://arxiv.org/pdf/2610.20139',
  'https://arxiv.org/pdf/2606.06333',
  'https://arxiv.org/pdf/2609.15533',
  'https://arxiv.org/pdf/2610.15850',
  'https://arxiv.org/pdf/2606.08292',
  'https://arxiv.org/pdf/2606.08365',
  'https://arxiv.org/pdf/2605.31518',
  'https://arxiv.org/pdf/2605.03160',
];

export function extractArxivId(input: string): string | undefined {
  const trimmed = input.trim();
  const bareMatch = /^(\d{4}\.\d{4,5})(?:v\d+)?$/i.exec(trimmed);
  if (bareMatch) return bareMatch[1];

  const urlMatch = /arxiv\.org\/(?:pdf|abs)\/([A-Za-z0-9.-]+?)(?:\.pdf)?(?:v\d+)?\/?$/i.exec(
    trimmed
  );
  if (urlMatch) return urlMatch[1];

  return undefined;
}

export function createInitialCuratedQueue(): CuratedPaperEntry[] {
  const seen = new Set<string>();
  const entries: CuratedPaperEntry[] = [];

  for (const raw of RAW_URLS) {
    const key = raw.replace(/\/+$/, '');
    if (seen.has(key)) continue;
    seen.add(key);

    if (key.includes('transformer-circuits.pub')) {
      entries.push({
        url: key,
        kind: 'html',
        status: 'pending',
        message: 'HTML article (can be fetched and extracted directly as web text)',
      });
    } else {
      entries.push({
        url: key,
        arxivId: extractArxivId(key),
        kind: 'arxiv_pdf',
        status: 'pending',
      });
    }
  }

  return entries;
}
