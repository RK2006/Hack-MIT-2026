import { describe, expect, it } from 'vitest';
import { isPendingReview, pendingReview } from '../../src/lib/review';
import { makeNode } from '../compiler/fixture';

const agent = { kind: 'agent' as const, label: 'gemini:test' };
const human = { kind: 'human' as const, label: 'local-operator' };

describe('pending review queue', () => {
  it('includes only inferred, agent-authored, active nodes', () => {
    expect(isPendingReview(makeNode('a', 'bug', { authority: 'inferred', actor: agent }))).toBe(
      true,
    );
    expect(isPendingReview(makeNode('b', 'bug', { authority: 'canonical', actor: agent }))).toBe(
      false,
    );
    expect(isPendingReview(makeNode('c', 'bug', { authority: 'inferred', actor: human }))).toBe(
      false,
    );
    expect(
      isPendingReview(
        makeNode('d', 'bug', { authority: 'inferred', actor: agent, archived: true }),
      ),
    ).toBe(false);
  });

  it('orders newest proposals first with a stable tie-break', () => {
    const older = makeNode('older', 'discovery', {
      authority: 'inferred',
      actor: agent,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const newer = makeNode('newer', 'decision', {
      authority: 'inferred',
      actor: agent,
      createdAt: '2026-02-01T00:00:00.000Z',
    });
    const reviewed = makeNode('reviewed', 'decision', { authority: 'canonical', actor: human });
    expect(pendingReview([older, reviewed, newer]).map((n) => n.externalKey)).toEqual([
      'newer',
      'older',
    ]);
    expect(pendingReview([newer, older])).toEqual(pendingReview([older, newer]));
  });
});
