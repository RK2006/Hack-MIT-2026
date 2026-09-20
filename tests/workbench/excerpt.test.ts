import { describe, expect, it } from 'vitest';
import {
  excerptLineCount,
  parseExcerpt,
  previewExcerpt,
  stripModelPrefix,
} from '../../src/lib/excerpt';

const agentExcerpt = [
  '[gemini:gemini-3.5-flash] Implemented design for scheduled cleanup of receipts:',
  '',
  '- Add a scheduled cleanup job owned by the Provider Event Receipt Store.',
  '- Run the job once per day, independently of the webhook request path.',
  '- Delete only terminal receipt rows older than 90 days.',
].join('\n');

const prExcerpt = [
  'GitHub pull request #12: Retry webhooks asynchronously',
  'URL: https://github.com/example/repo/pull/12',
  '',
  'Description:',
  'Moves retries onto a queue.',
  '',
  'Changed files:',
  '- src/payments/webhook.ts (+40/-12)',
  '',
  'Diff excerpt:',
  '--- a/src/payments/webhook.ts',
  '+++ b/src/payments/webhook.ts',
  '',
  '+  await queue.enqueue(event);',
].join('\n');

describe('stripModelPrefix', () => {
  it('removes a leading [model-id] tag only', () => {
    expect(stripModelPrefix(agentExcerpt)).toMatch(/^Implemented design/);
    expect(stripModelPrefix('plain note [not a prefix]')).toBe('plain note [not a prefix]');
  });
});

describe('parseExcerpt', () => {
  it('turns bullets into a list and blank lines into paragraph breaks', () => {
    const blocks = parseExcerpt(stripModelPrefix(agentExcerpt));
    expect(blocks).toEqual([
      { kind: 'paragraph', text: 'Implemented design for scheduled cleanup of receipts:' },
      {
        kind: 'list',
        items: [
          'Add a scheduled cleanup job owned by the Provider Event Receipt Store.',
          'Run the job once per day, independently of the webhook request path.',
          'Delete only terminal receipt rows older than 90 days.',
        ],
      },
    ]);
  });

  it('recognises Label: headings and renders everything after Diff excerpt: as code', () => {
    const blocks = parseExcerpt(prExcerpt);
    expect(blocks.map((block) => block.kind)).toEqual([
      'paragraph',
      'heading',
      'paragraph',
      'heading',
      'list',
      'heading',
      'code',
    ]);
    expect(blocks[1]).toEqual({ kind: 'heading', text: 'Description' });
    const code = blocks.at(-1);
    expect(code?.kind).toBe('code');
    // Blank lines inside the diff are preserved; surrounding ones are trimmed.
    expect(code && code.kind === 'code' ? code.text.split('\n') : []).toEqual([
      '--- a/src/payments/webhook.ts',
      '+++ b/src/payments/webhook.ts',
      '',
      '+  await queue.enqueue(event);',
    ]);
  });

  it('does not treat a URL line or a sentence with a colon as a heading', () => {
    const blocks = parseExcerpt('URL: https://example.com\nNote: this is long enough: really');
    expect(blocks).toEqual([
      { kind: 'paragraph', text: 'URL: https://example.com Note: this is long enough: really' },
    ]);
  });

  it('joins wrapped lines of one paragraph with spaces', () => {
    expect(parseExcerpt('first line\nsecond line')).toEqual([
      { kind: 'paragraph', text: 'first line second line' },
    ]);
  });
});

describe('previewExcerpt', () => {
  it('counts list items and code lines individually and cuts inside them', () => {
    const blocks = parseExcerpt(prExcerpt);
    expect(excerptLineCount(blocks)).toBe(10);
    const preview = previewExcerpt(blocks, 8);
    expect(excerptLineCount(preview)).toBe(8);
    const last = preview.at(-1);
    expect(last?.kind).toBe('code');
    expect(last && last.kind === 'code' ? last.text.split('\n') : []).toHaveLength(2);
  });

  it('returns the whole excerpt when it already fits', () => {
    const blocks = parseExcerpt(stripModelPrefix(agentExcerpt));
    expect(previewExcerpt(blocks, 8)).toEqual(blocks);
  });
});
