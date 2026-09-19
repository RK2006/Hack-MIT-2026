import { describe, expect, it } from 'vitest';
import { isSafeLink, layoutGraph } from '../../src/lib/layout';

const nodes = Array.from({ length: 12 }, (_, i) => ({ id: `node-${i}` }));
const edges = [
  { fromNodeId: 'node-0', toNodeId: 'node-1' },
  { fromNodeId: 'node-1', toNodeId: 'node-2' },
  { fromNodeId: 'node-2', toNodeId: 'node-3' },
  { fromNodeId: 'node-0', toNodeId: 'node-4' },
  { fromNodeId: 'node-5', toNodeId: 'node-6' },
  { fromNodeId: 'node-9', toNodeId: 'missing' },
];

describe('layoutGraph', () => {
  it('is deterministic for the same input', () => {
    const a = layoutGraph(nodes, edges, 900, 600);
    const b = layoutGraph(nodes, edges, 900, 600);
    expect([...a.entries()]).toEqual([...b.entries()]);
  });

  it('does not depend on node or edge order', () => {
    const a = layoutGraph(nodes, edges, 900, 600);
    const b = layoutGraph([...nodes].reverse(), [...edges].reverse(), 900, 600);
    for (const [id, point] of a) expect(b.get(id)).toEqual(point);
  });

  it('positions every node inside the canvas and keeps connected nodes closer', () => {
    const positions = layoutGraph(nodes, edges, 900, 600);
    expect(positions.size).toBe(nodes.length);
    for (const { x, y } of positions.values()) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(900);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(600);
    }
    const dist = (a: string, b: string) => {
      const p = positions.get(a)!;
      const q = positions.get(b)!;
      return Math.hypot(p.x - q.x, p.y - q.y);
    };
    const linked = dist('node-0', 'node-1');
    const unlinked = ['node-7', 'node-8', 'node-10', 'node-11'].map((id) => dist('node-0', id));
    expect(linked).toBeLessThan(Math.max(...unlinked));
  });

  it('handles empty and single-node graphs', () => {
    expect(layoutGraph([], [], 900, 600).size).toBe(0);
    expect(layoutGraph([{ id: 'only' }], [], 900, 600).get('only')).toEqual({ x: 450, y: 300 });
  });
});

describe('isSafeLink', () => {
  it('accepts only https URLs', () => {
    expect(isSafeLink('https://github.com/org/repo/blob/abc/file.ts')).toBe(true);
    expect(isSafeLink('http://example.com')).toBe(false);
    expect(isSafeLink('repo://demo/src/webhooks.ts')).toBe(false);
    expect(isSafeLink('manual://workbench/123')).toBe(false);
    expect(isSafeLink('agent://explorer/run-1')).toBe(false);
    expect(isSafeLink('javascript:alert(1)')).toBe(false);
    expect(isSafeLink('not a url')).toBe(false);
  });
});
