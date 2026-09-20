/**
 * Display-only structure for stored source excerpts. Excerpts are plain text written by the
 * proposal service (agent input prefixed with `[model-id]`, often Markdown) or the PR digest
 * builder (`Label:` sections, `- ` bullets, then a diff). Nothing here changes what is stored,
 * and nothing here produces HTML: blocks and spans are rendered as React text.
 */

/** Inline spans: plain text, `**bold**`, and `` `code` ``. Anything else stays literal. */
export type ExcerptSpan =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'code'; text: string };

export type ExcerptBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'heading'; text: string; level: number }
  | { kind: 'quote'; text: string }
  | { kind: 'list'; items: string[]; ordered: boolean }
  | { kind: 'code'; text: string };

export const EXCERPT_PREVIEW_LINES = 8;

const MODEL_PREFIX = /^\[[^\]\n]{1,200}\]\s*/;
const BULLET = /^[-*•]\s+/;
const NUMBERED = /^\d{1,3}[.)]\s+/;
const ATX_HEADING = /^(#{1,6})\s+(.+?)\s*#*$/;
const QUOTE = /^>\s?/;
const FENCE = /^(```|~~~)/;
/** Short label of at most three words such as `Description:` or `Changed files:`. */
const LABEL_HEADING = /^[A-Za-z][A-Za-z0-9/#()'-]*(?: [A-Za-z0-9/#()'-]+){0,2}:$/;
const DIFF_HEADING = /^diff excerpt:$/i;
const INLINE = /(\*\*[^*\n]+\*\*|`[^`\n]+`)/g;

/** Removes a leading `[model-id]` tag; the source label already names the model. */
export function stripModelPrefix(excerpt: string): string {
  return excerpt.replace(MODEL_PREFIX, '');
}

/** Splits a line into text/strong/code spans without interpreting anything else. */
export function parseInline(text: string): ExcerptSpan[] {
  const spans: ExcerptSpan[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (index > last) spans.push({ kind: 'text', text: text.slice(last, index) });
    spans.push(
      token.startsWith('`')
        ? { kind: 'code', text: token.slice(1, -1) }
        : { kind: 'strong', text: token.slice(2, -2) },
    );
    last = index + token.length;
  }
  if (last < text.length) spans.push({ kind: 'text', text: text.slice(last) });
  return spans.length ? spans : [{ kind: 'text', text }];
}

export function parseExcerpt(excerpt: string): ExcerptBlock[] {
  const blocks: ExcerptBlock[] = [];
  const lines = excerpt.replace(/\r\n?/g, '\n').split('\n');
  let paragraph: string[] = [];
  let quote: string[] = [];
  let list: { items: string[]; ordered: boolean } | null = null;
  /** Open code block: `fenced` closes at the next fence, `diff` runs to the end. */
  let code: { lines: string[]; mode: 'fenced' | 'diff' } | null = null;

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
    paragraph = [];
  };
  const flushQuote = () => {
    if (quote.length) blocks.push({ kind: 'quote', text: quote.join(' ') });
    quote = [];
  };
  const flushList = () => {
    if (list?.items.length) blocks.push({ kind: 'list', ...list });
    list = null;
  };
  const flushCode = () => {
    if (!code) return;
    const text = code.lines.join('\n').replace(/^\n+|\n+$/g, '');
    if (text) blocks.push({ kind: 'code', text });
    code = null;
  };
  const flushAll = () => {
    flushParagraph();
    flushQuote();
    flushList();
  };

  for (const raw of lines) {
    if (code) {
      if (code.mode === 'fenced' && FENCE.test(raw.trim())) flushCode();
      else code.lines.push(raw);
      continue;
    }
    const line = raw.trim();
    if (!line) {
      flushAll();
      continue;
    }
    if (FENCE.test(line)) {
      flushAll();
      code = { lines: [], mode: 'fenced' };
      continue;
    }
    if (QUOTE.test(line)) {
      flushParagraph();
      flushList();
      quote.push(line.replace(QUOTE, ''));
      continue;
    }
    flushQuote();
    const heading = ATX_HEADING.exec(line);
    if (heading) {
      flushAll();
      blocks.push({ kind: 'heading', text: heading[2]!, level: heading[1]!.length });
      continue;
    }
    const ordered = NUMBERED.test(line);
    if (ordered || BULLET.test(line)) {
      flushParagraph();
      if (list && list.ordered !== ordered) flushList();
      list ??= { items: [], ordered };
      list.items.push(line.replace(ordered ? NUMBERED : BULLET, ''));
      continue;
    }
    flushList();
    if (LABEL_HEADING.test(line)) {
      flushParagraph();
      blocks.push({ kind: 'heading', text: line.slice(0, -1), level: 6 });
      if (DIFF_HEADING.test(line)) code = { lines: [], mode: 'diff' };
      continue;
    }
    paragraph.push(line);
  }
  flushAll();
  flushCode();
  return blocks;
}

/** Number of rendered lines a block occupies, used to decide whether to collapse. */
export function excerptLineCount(blocks: ExcerptBlock[]): number {
  return blocks.reduce((count, block) => {
    switch (block.kind) {
      case 'list':
        return count + block.items.length;
      case 'code':
        return count + block.text.split('\n').length;
      default:
        return count + 1;
    }
  }, 0);
}

/** Truncates a block list to roughly `maxLines` rendered lines, cutting inside lists/code. */
export function previewExcerpt(blocks: ExcerptBlock[], maxLines = EXCERPT_PREVIEW_LINES) {
  const preview: ExcerptBlock[] = [];
  let remaining = maxLines;
  for (const block of blocks) {
    if (remaining <= 0) break;
    if (block.kind === 'list') {
      preview.push({ ...block, items: block.items.slice(0, remaining) });
      remaining -= block.items.length;
    } else if (block.kind === 'code') {
      const lines = block.text.split('\n');
      preview.push({ kind: 'code', text: lines.slice(0, remaining).join('\n') });
      remaining -= lines.length;
    } else {
      preview.push(block);
      remaining -= 1;
    }
  }
  return preview;
}
