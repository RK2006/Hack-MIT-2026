/**
 * Display-only structure for stored source excerpts. Excerpts are plain text written by the
 * proposal service (agent input prefixed with `[model-id]`) or the PR digest builder
 * (`Label:` sections, `- ` bullets, then a diff). Nothing here changes what is stored.
 */

export type ExcerptBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'code'; text: string };

export const EXCERPT_PREVIEW_LINES = 8;

const MODEL_PREFIX = /^\[[^\]\n]{1,200}\]\s*/;
const BULLET = /^[-*•]\s+/;
/** Short label of at most three words such as `Description:` or `Changed files:`. */
const HEADING = /^[A-Za-z][A-Za-z0-9/#()'-]*(?: [A-Za-z0-9/#()'-]+){0,2}:$/;
const DIFF_HEADING = /^diff excerpt:$/i;

/** Removes a leading `[model-id]` tag; the source label already names the model. */
export function stripModelPrefix(excerpt: string): string {
  return excerpt.replace(MODEL_PREFIX, '');
}

export function parseExcerpt(excerpt: string): ExcerptBlock[] {
  const blocks: ExcerptBlock[] = [];
  const lines = excerpt.replace(/\r\n?/g, '\n').split('\n');
  let paragraph: string[] = [];
  let list: string[] = [];
  let code: string[] | null = null;

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
    paragraph = [];
  };
  const flushList = () => {
    if (list.length) blocks.push({ kind: 'list', items: list });
    list = [];
  };

  for (const raw of lines) {
    if (code) {
      code.push(raw);
      continue;
    }
    const line = raw.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    if (BULLET.test(line)) {
      flushParagraph();
      list.push(line.replace(BULLET, ''));
      continue;
    }
    flushList();
    if (HEADING.test(line)) {
      flushParagraph();
      blocks.push({ kind: 'heading', text: line.slice(0, -1) });
      if (DIFF_HEADING.test(line)) code = [];
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  if (code) {
    const text = code.join('\n').replace(/^\n+|\n+$/g, '');
    if (text) blocks.push({ kind: 'code', text });
  }
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
      preview.push({ kind: 'list', items: block.items.slice(0, remaining) });
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
