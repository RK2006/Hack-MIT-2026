import { describe, expect, it } from 'vitest';
import { GraphError } from '../../src/server/context/errors';
import { buildProposalPrompt, parseModelProposal } from '../../src/server/proposals/prompt';
import { makeGraph, makeNode } from '../compiler/fixture';

const valid = {
  nodes: [
    {
      key: 'receipt-claim-race',
      type: 'bug',
      title: 'Receipt claim happens after side effects',
      content: 'The handler writes the receipt after charging, so a retry can charge twice.',
      summary: 'Claim-after-charge race.',
      importance: 4,
      confidence: 0.9,
    },
  ],
  edges: [{ fromKey: 'receipt-claim-race', toKey: 'component.stripe-webhooks', type: 'AFFECTS' }],
};

const expectValidation = (raw: string, pathPart?: string) => {
  try {
    parseModelProposal(raw);
    throw new Error('expected failure');
  } catch (error) {
    expect(error).toBeInstanceOf(GraphError);
    expect((error as GraphError).code).toBe('VALIDATION_ERROR');
    if (pathPart) expect(String((error as GraphError).details?.path)).toContain(pathPart);
  }
};

describe('parseModelProposal', () => {
  it('accepts strict JSON and a json fence', () => {
    expect(parseModelProposal(JSON.stringify(valid))).toEqual(valid);
    expect(parseModelProposal('```json\n' + JSON.stringify(valid) + '\n```')).toEqual(valid);
  });

  it('normalizes model-style keys and edge references to slugs', () => {
    const parsed = parseModelProposal(
      JSON.stringify({
        nodes: [{ ...valid.nodes[0], key: 'Receipt_Claim Race!' }],
        edges: [
          { fromKey: 'Receipt_Claim Race!', toKey: 'component.stripe-webhooks', type: 'AFFECTS' },
        ],
      }),
    );
    expect(parsed.nodes[0]?.key).toBe('receipt-claim-race');
    expect(parsed.edges[0]).toMatchObject({
      fromKey: 'receipt-claim-race',
      toKey: 'component.stripe-webhooks',
    });
  });

  it('defaults an omitted summary to empty', () => {
    const { summary: _s, ...node } = valid.nodes[0]!;
    void _s;
    expect(parseModelProposal(JSON.stringify({ nodes: [node], edges: [] })).nodes[0]?.summary).toBe(
      '',
    );
  });

  it('rejects non-JSON, extra keys, forbidden types, bad keys, and bounds', () => {
    expectValidation('Sure! Here is the JSON: {', '$');
    expectValidation(JSON.stringify({ ...valid, extra: 1 }));
    expectValidation(
      JSON.stringify({ nodes: [{ ...valid.nodes[0], type: 'component' }], edges: [] }),
      'type',
    );
    expectValidation(
      JSON.stringify({ nodes: [{ ...valid.nodes[0], type: 'file' }], edges: [] }),
      'type',
    );
    expectValidation(
      JSON.stringify({ nodes: [{ ...valid.nodes[0], key: '!!' }], edges: [] }),
      'key',
    );
    expectValidation(
      JSON.stringify({ nodes: [{ ...valid.nodes[0], importance: 7 }], edges: [] }),
      'importance',
    );
    expectValidation(
      JSON.stringify({ nodes: [{ ...valid.nodes[0], confidence: 2 }], edges: [] }),
      'confidence',
    );
    expectValidation(
      JSON.stringify({ nodes: [], edges: [{ fromKey: 'a', toKey: 'b', type: 'CONTAINS' }] }),
      'type',
    );
    expectValidation(JSON.stringify({ nodes: Array(9).fill(valid.nodes[0]), edges: [] }), 'nodes');
    expectValidation(
      JSON.stringify({ nodes: [valid.nodes[0], valid.nodes[0]], edges: [] }),
      'nodes',
    );
  });
});

describe('buildProposalPrompt', () => {
  it('lists existing nodes by key/type/title and never includes their content', () => {
    const node = makeNode('component.webhooks', 'component', {
      title: 'Provider webhooks',
      content: 'SECRET-CONTENT-SHOULD-NOT-APPEAR',
    });
    const prompt = buildProposalPrompt(makeGraph([node], []), {
      text: 'We found retries double-charge.',
      taskHint: 'Fix duplicates',
    });
    expect(prompt.user).toContain('component.webhooks | component | Provider webhooks');
    expect(prompt.user).not.toContain('SECRET-CONTENT');
    expect(prompt.user).toContain('Fix duplicates');
    expect(prompt.system).toContain('"nodes"');
  });
});
