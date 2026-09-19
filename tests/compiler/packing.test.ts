import { describe, expect, it } from 'vitest';
import { pack, type PackInput } from '../../src/server/context/compiler/pack';
import type { Candidate } from '../../src/server/context/compiler/retrieval';
import { countTokens } from '../../src/server/context/compiler/tokenizer';
import { DEGRADED_WARNING, NO_CONTEXT_TEXT } from '../../src/server/context/compiler/render';
import { makeNode, PROJECT_ID, SOURCE_ID } from './fixture';

const candidate = (
  node: ReturnType<typeof makeNode>,
  relevance = 1,
  essential = false,
): Candidate => ({
  node,
  relevance,
  score: relevance,
  similarity: relevance,
  semanticNorm: relevance,
  reasons: [
    {
      kind: 'semantic_match',
      description: 'semantic match to the task (similarity 0.50)',
      seedNodeId: node.id,
      similarity: 0.5,
      path: [],
    },
  ],
  essential,
});

const input = (
  candidates: Candidate[],
  tokenBudget: number,
  extra: Partial<PackInput> = {},
): PackInput => ({
  project: { id: PROJECT_ID, name: 'Synthetic payments', createdAt: '2026-01-01T00:00:00.000Z' },
  status: 'ok',
  embeddingModel: 'fixed:test',
  tokenBudget,
  candidates,
  sources: new Map([[SOURCE_ID, { id: SOURCE_ID, kind: 'manual', uri: 'manual://test' }]]),
  omissions: [],
  warnings: [],
  ...extra,
});

const longText = (words: number) =>
  Array.from({ length: words }, (_, i) => `término${i} 日本語 émoji🚀`).join(' ');

describe('packing', () => {
  const big = makeNode('constraint.big', 'constraint', {
    title: 'Very long constraint',
    content: longText(400),
    summary: 'Short summary of the long constraint.',
    importance: 5,
  });
  const medium = makeNode('decision.medium', 'decision', {
    content: longText(80),
    summary: 'Medium summary.',
  });
  const small = makeNode('bug.small', 'bug', { content: 'Small bug content.' });
  const candidates = [candidate(big, 1, true), candidate(medium, 0.9), candidate(small, 0.8)];

  it.each([256, 512, 1024, 4096])('keeps the complete rendered text within budget %i', (budget) => {
    const result = pack(input(candidates, budget));
    expect(countTokens(result.contextText)).toBe(result.tokenCount);
    expect(result.tokenCount).toBeLessThanOrEqual(budget);
  });

  it('includes everything in full when the budget is generous', () => {
    const result = pack(input(candidates, 8192));
    expect(result.items.map((i) => i.representation)).toEqual(['full', 'full', 'full']);
    expect(result.omissions).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.contextText).toContain('## Constraints');
    expect(result.contextText).toContain('labeled synthetic prepared example');
  });

  it('falls back to summary/title and warns about incomplete essential constraints', () => {
    const result = pack(input(candidates, 400));
    const bigItem = result.items.find((i) => i.node.id === big.id);
    expect(bigItem?.representation).not.toBe('full');
    expect(result.warnings.some((w) => w.includes('Essential constraint'))).toBe(true);
    expect(result.contextText).toContain('## Warnings');
    expect(result.tokenCount).toBeLessThanOrEqual(400);
  });

  it('reports budget omissions, marking essential constraints critical', () => {
    const noSummary = makeNode('constraint.nosummary', 'constraint', {
      content: longText(400),
      summary: '',
      importance: 5,
    });
    const result = pack(input([candidate(noSummary, 1, true), candidate(small, 0.8)], 256));
    const omitted = result.omissions.find((o) => o.nodeId === noSummary.id);
    if (omitted) expect(omitted).toMatchObject({ reason: 'budget', critical: true });
    else expect(result.items.find((i) => i.node.id === noSummary.id)?.representation).toBe('title');
    expect(result.contextText).toMatch(/Omitted context|title only/);
    expect(result.tokenCount).toBeLessThanOrEqual(256);
  });

  it('renders the no-context text for an empty candidate set', () => {
    const result = pack(input([], 256));
    expect(result.contextText).toContain(NO_CONTEXT_TEXT);
    expect(result.items).toEqual([]);
  });

  it('keeps degraded warnings inside the copied text', () => {
    const result = pack(
      input([candidate(small)], 512, {
        status: 'degraded',
        warnings: [DEGRADED_WARNING],
        embeddingModel: 'lexical-fallback',
      }),
    );
    expect(result.contextText).toContain(DEGRADED_WARNING);
    expect(result.contextText).toContain('Status: degraded');
  });

  it('cites version, authority, source, and reasons in the text', () => {
    const result = pack(input([candidate(small)], 1024));
    expect(result.contextText).toContain('[canonical] Title bug.small  (bug v1)');
    expect(result.contextText).toContain('Why: semantic match to the task (similarity 0.50)');
    expect(result.contextText).toContain(`Source: manual — manual://test (source ${SOURCE_ID})`);
  });
});
