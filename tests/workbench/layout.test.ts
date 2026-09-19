import { describe, expect, it } from 'vitest';
import demo from '../../fixtures/demo-payments.json';
import {
  cardsOverlap,
  GRAPH_NODE_HEIGHT,
  GRAPH_NODE_WIDTH,
  isSafeLink,
  layoutGraph,
  rectangleBoundaryPoint,
  wrapGraphTitle,
} from '../../src/lib/layout';

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

  it('keeps card-sized nodes separated inside the canvas', () => {
    const positions = layoutGraph(nodes, edges, 900, 600);
    const points = [...positions.entries()];
    for (const [, { x, y }] of points) {
      expect(x).toBeGreaterThanOrEqual(GRAPH_NODE_WIDTH / 2);
      expect(x).toBeLessThanOrEqual(900 - GRAPH_NODE_WIDTH / 2);
      expect(y).toBeGreaterThanOrEqual(GRAPH_NODE_HEIGHT / 2);
      expect(y).toBeLessThanOrEqual(600 - GRAPH_NODE_HEIGHT / 2);
    }
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        expect(cardsOverlap(points[i]![1], points[j]![1])).toBe(false);
      }
    }
  });

  it('keeps every card in the full demo graph separated', () => {
    const demoNodes = [...demo.components, ...demo.files, ...demo.claims].map(({ key }) => ({
      id: key,
    }));
    const demoEdges = [
      ...demo.edges.map((edge) => ({ fromNodeId: edge.fromKey, toNodeId: edge.toKey })),
      ...demo.components.flatMap((node) =>
        node.parentKey ? [{ fromNodeId: node.parentKey, toNodeId: node.key }] : [],
      ),
      ...demo.files.map((node) => ({ fromNodeId: node.componentKey, toNodeId: node.key })),
    ];
    const positions = [...layoutGraph(demoNodes, demoEdges, 900, 620).values()];
    expect(positions).toHaveLength(29);
    for (let i = 0; i < positions.length; i += 1) {
      for (let j = i + 1; j < positions.length; j += 1) {
        expect(cardsOverlap(positions[i]!, positions[j]!)).toBe(false);
      }
    }
  });

  it('handles empty and single-node graphs', () => {
    expect(layoutGraph([], [], 900, 600).size).toBe(0);
    expect(layoutGraph([{ id: 'only' }], [], 900, 600).get('only')).toEqual({ x: 450, y: 300 });
  });
});

describe('graph card geometry', () => {
  it('clips horizontal and diagonal edges to the card boundary', () => {
    expect(rectangleBoundaryPoint({ x: 100, y: 100 }, { x: 300, y: 100 })).toEqual({
      x: 100 + GRAPH_NODE_WIDTH / 2,
      y: 100,
    });
    const diagonal = rectangleBoundaryPoint({ x: 100, y: 100 }, { x: 300, y: 300 });
    expect(diagonal.y).toBe(100 + GRAPH_NODE_HEIGHT / 2);
    expect(diagonal.x).toBe(100 + GRAPH_NODE_HEIGHT / 2);
  });

  it('wraps titles to two bounded lines and marks truncation', () => {
    expect(wrapGraphTitle('Provider Event Receipt Store', 18, 2)).toEqual([
      'Provider Event',
      'Receipt Store',
    ]);
    const long = wrapGraphTitle('A provider event ID may produce side effects once', 18, 2);
    expect(long).toHaveLength(2);
    expect(long.every((line) => line.length <= 18)).toBe(true);
    expect(long[1]).toMatch(/…$/);
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
