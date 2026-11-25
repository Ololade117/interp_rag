import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PaperChunk, SectionKind } from './types.js';

export interface ExtractedPaper {
  title: string;
  abstract: string;
  results: string;
  fullText: string;
  pageCount: number;
}

const HEADING_RE = /^(?:[\dA-Z]{1,3}\.?\s+)?([A-Za-z ,&:-]{3,60})$/;

export function cleanText(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function findHeading(lines: string[], pattern: RegExp, start = 0): number | null {
  for (let i = start; i < lines.length; i++) {
    const match = HEADING_RE.exec(lines[i].trim());
    if (match && pattern.test(match[1])) {
      return i;
    }
  }
  return null;
}

export function extractSection(text: string, startPat: RegExp, endPat: RegExp): string {
  const lines = text.split('\n');
  const startIdx = findHeading(lines, startPat);
  if (startIdx === null) return '';

  const endIdx = findHeading(lines, endPat, startIdx + 1);
  const stop = endIdx === null ? lines.length : endIdx;
  return cleanText(lines.slice(startIdx + 1, stop).join(' '));
}

interface TextItemLike {
  str?: string;
  transform?: number[];
  hasEOL?: boolean;
}

function isTextItemLike(item: unknown): item is TextItemLike {
  return typeof item === 'object' && item !== null && 'str' in item;
}

export async function extractPaperFromPdfBuffer(
  buffer: Uint8Array,
  fallbackTitle: string
): Promise<ExtractedPaper> {
  const loadingTask = pdfjsLib.getDocument({
    data: buffer,
    useSystemFonts: true,
    disableFontFace: true,
    verbosity: 0,
  });

  const pdfDoc = await loadingTask.promise;
  const pageCount = pdfDoc.numPages;

  let metadataTitle = '';
  try {
    const meta = await pdfDoc.getMetadata();
    const info = meta?.info as Record<string, unknown> | undefined;
    if (info && typeof info.Title === 'string') {
      metadataTitle = info.Title.trim();
    }
  } catch {
    // Metadata extraction is optional
  }

  let detectedTitle = '';
  const pageTexts: string[] = [];

  for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.0 });
    const textContent = await page.getTextContent();

    const lines: string[] = [];
    let currentLine = '';

    // Replicate Cell 4 get_title(doc): largest non-rotated text in top 40% of page 1
    let bestSize = 0;
    const candidateLines: Array<{ y: number; size: number; text: string }> = [];

    for (const rawItem of textContent.items) {
      if (!isTextItemLike(rawItem) || typeof rawItem.str !== 'string') continue;

      const str = rawItem.str;
      currentLine += str;
      if (rawItem.hasEOL) {
        lines.push(currentLine);
        currentLine = '';
      }

      if (pageNum === 1 && Array.isArray(rawItem.transform) && rawItem.transform.length >= 6) {
        const [a, b, c, d, , y] = rawItem.transform;
        const fontHeight = Math.hypot(c, d);
        const fontWidth = Math.hypot(a, b);
        const isRotated = fontWidth > 0 ? Math.abs(a / fontWidth - 1) > 0.05 : false;
        const topOffset = viewport.height - y;
        const trimmed = str.trim();

        if (
          !isRotated &&
          topOffset <= viewport.height * 0.4 &&
          trimmed.length > 0 &&
          !trimmed.toLowerCase().startsWith('arxiv')
        ) {
          if (fontHeight > bestSize) {
            bestSize = fontHeight;
          }
          candidateLines.push({ y, size: fontHeight, text: trimmed });
        }
      }
    }

    if (currentLine.trim()) {
      lines.push(currentLine);
    }

    if (pageNum === 1 && bestSize > 0) {
      const titleParts = candidateLines
        .filter((item) => Math.abs(item.size - bestSize) <= 1.2)
        .map((item) => item.text);
      const joined = cleanText(titleParts.join(' '));
      if (joined.length >= 4) {
        detectedTitle = joined;
      }
    }

    pageTexts.push(lines.join('\n'));
  }

  const fullText = pageTexts.join('\n');
  const title = detectedTitle || metadataTitle || fallbackTitle;

  let abstract = extractSection(
    fullText,
    /^abstract$/i,
    /introduction|keywords?|background|contents/i
  );

  // Fallback for papers where "Abstract" is inline on page 1 without standalone heading
  if (!abstract) {
    const inlineAbs = /abstract[:.\s]+([\s\S]{80,2200}?)(?:\n\s*(?:1\.?\s+introduction|introduction|keywords?))/i.exec(
      fullText
    );
    if (inlineAbs) {
      abstract = cleanText(inlineAbs[1]);
    }
  }

  const results = extractSection(
    fullText,
    /\bresults\b/i,
    /discussion|conclusions?|limitations|related work|references|acknowledg|appendix/i
  );

  return {
    title,
    abstract,
    results,
    fullText: cleanText(fullText),
    pageCount,
  };
}

export function extractPaperFromHtml(html: string, fallbackTitle: string): ExtractedPaper {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const h1Match = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const rawTitle = (h1Match?.[1] || titleMatch?.[1] || fallbackTitle).replace(/<[^>]+>/g, '');
  const title = cleanText(rawTitle) || fallbackTitle;

  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(?:p|div|h1|h2|h3|h4|li|section|article|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

  const abstract = extractSection(
    stripped,
    /^(?:abstract|summary|overview)$/i,
    /introduction|results|architecture|framework|notation/i
  );
  const results = extractSection(
    stripped,
    /\b(?:results|findings|observations|circuits)\b/i,
    /discussion|conclusions?|related work|references|acknowledg|appendix/i
  );

  return {
    title,
    abstract: abstract || cleanText(stripped.slice(0, 1400)),
    results,
    fullText: cleanText(stripped),
    pageCount: 1,
  };
}

export function chunkText(text: string, maxChars = 900, overlap = 160): string[] {
  const normalized = cleanText(text);
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];

  const chunks: string[] = [];
  let start = 0;

  while (start < normalized.length) {
    let end = Math.min(start + maxChars, normalized.length);
    if (end < normalized.length) {
      const sentenceBreak = normalized.lastIndexOf('. ', end);
      if (sentenceBreak > start + maxChars * 0.5) {
        end = sentenceBreak + 1;
      } else {
        const spaceBreak = normalized.lastIndexOf(' ', end);
        if (spaceBreak > start + maxChars * 0.5) {
          end = spaceBreak;
        }
      }
    }

    const slice = normalized.slice(start, end).trim();
    if (slice) chunks.push(slice);
    if (end >= normalized.length) break;
    start = Math.max(start + 1, end - overlap);
  }

  return chunks;
}

export function buildSectionChunks(
  paperId: string,
  extracted: ExtractedPaper
): Array<{ section: SectionKind; chunkIndex: number; text: string }> {
  const out: Array<{ section: SectionKind; chunkIndex: number; text: string }> = [];

  if (extracted.abstract) {
    chunkText(extracted.abstract).forEach((text, idx) => {
      out.push({ section: 'abstract', chunkIndex: idx, text });
    });
  }

  if (extracted.results) {
    chunkText(extracted.results).forEach((text, idx) => {
      out.push({ section: 'results', chunkIndex: idx, text });
    });
  }

  // If neither abstract nor results was matched by heading regex, or to supplement sparse results,
  // include bounded chunks of the extracted body text.
  if (out.length === 0 && extracted.fullText) {
    chunkText(extracted.fullText.slice(0, 18000)).forEach((text, idx) => {
      out.push({ section: 'body', chunkIndex: idx, text });
    });
  }

  return out;
}

export function unusedChunkRef(_c: PaperChunk | undefined): void {
  void _c;
}
