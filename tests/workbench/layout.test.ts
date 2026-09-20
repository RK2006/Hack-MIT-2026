import { describe, expect, it } from 'vitest';
import demo from '../../fixtures/demo-payments.json';
import {
  circleBoundaryPoint,
  clampGraphZoom,
  dragPanOffset,
  graphEdgeCurveOffsets,
  graphCanvasSize,
  graphEdgeGeometry,
  graphLabelsOverlap,
  GRAPH_NODE_MIN_DISTANCE,
  GRAPH_NODE_RADIUS,
  GRAPH_ZOOM_MAX,
  GRAPH_ZOOM_MIN,
  isSafeLink,
  layoutGraph,
  nodesOverlap,
  wrapGraphTitle,
} from '../../src/lib/layout';

const nodes = Array.from({ length: 12 }, (_, i) => ({ id: `node-${i}` }));
const WIDTH = 1400;
const HEIGHT = 900;
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
    const a = layoutGraph(nodes, edges, WIDTH, HEIGHT);
    const b = layoutGraph(nodes, edges, WIDTH, HEIGHT);
    expect([...a.entries()]).toEqual([...b.entries()]);
  });

  it('does not depend on node or edge order', () => {
    const a = layoutGraph(nodes, edges, WIDTH, HEIGHT);
    const b = layoutGraph([...nodes].reverse(), [...edges].reverse(), WIDTH, HEIGHT);
    for (const [id, point] of a) expect(b.get(id)).toEqual(point);
  });

  it('positions every node inside the canvas and keeps connected nodes closer', () => {
    const positions = layoutGraph(nodes, edges, WIDTH, HEIGHT);
    expect(positions.size).toBe(nodes.length);
    for (const { x, y } of positions.values()) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(WIDTH);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(HEIGHT);
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

  it('keeps circular nodes separated inside the canvas', () => {
    const positions = layoutGraph(nodes, edges, WIDTH, HEIGHT);
    const points = [...positions.entries()];
    for (const [, { x, y }] of points) {
      expect(x).toBeGreaterThanOrEqual(GRAPH_NODE_MIN_DISTANCE / 2);
      expect(x).toBeLessThanOrEqual(WIDTH - GRAPH_NODE_MIN_DISTANCE / 2);
      expect(y).toBeGreaterThanOrEqual(GRAPH_NODE_MIN_DISTANCE / 2);
      expect(y).toBeLessThanOrEqual(HEIGHT - GRAPH_NODE_MIN_DISTANCE / 2);
    }
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        expect(nodesOverlap(points[i]![1], points[j]![1])).toBe(false);
      }
    }
  });

  it('keeps every node in the full demo graph separated on the roomy canvas', () => {
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
    const positions = [...layoutGraph(demoNodes, demoEdges, WIDTH, HEIGHT).values()];
    expect(positions).toHaveLength(29);
    for (let i = 0; i < positions.length; i += 1) {
      for (let j = i + 1; j < positions.length; j += 1) {
        expect(nodesOverlap(positions[i]!, positions[j]!)).toBe(false);
        expect(graphLabelsOverlap(positions[i]!, positions[j]!)).toBe(false);
      }
    }
    const xs = positions.map(({ x }) => x);
    const ys = positions.map(({ y }) => y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(1_000);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(650);
    expect(new Set(xs).size).toBeGreaterThan(10);
    expect(new Set(ys).size).toBeGreaterThan(10);
  });

  it('grows the canvas so a scanned repository (~90 nodes) stays separated with readable labels', () => {
    // Shaped like the Tripline demo: 13 directory components each containing a handful of files,
    // plus claims attached to a few of them.
    const big: Array<{ id: string }> = [];
    const bigEdges: Array<{ fromNodeId: string; toNodeId: string }> = [];
    for (let c = 0; c < 13; c += 1) {
      big.push({ id: `component-${c}` });
      bigEdges.push({ fromNodeId: 'component-0', toNodeId: `component-${c}` });
      for (let f = 0; f < 5; f += 1) {
        big.push({ id: `file-${c}-${f}` });
        bigEdges.push({ fromNodeId: `component-${c}`, toNodeId: `file-${c}-${f}` });
      }
    }
    for (let k = 0; k < 12; k += 1) {
      big.push({ id: `claim-${k}` });
      bigEdges.push({ fromNodeId: `claim-${k}`, toNodeId: `component-${k % 13}` });
    }
    expect(big.length).toBeGreaterThanOrEqual(88);
    const { width, height } = graphCanvasSize(big.length);
    expect(width).toBeGreaterThan(WIDTH);
    expect(graphCanvasSize(29)).toEqual({ width: WIDTH, height: HEIGHT });
    const positions = [...layoutGraph(big, bigEdges, width, height).values()];
    let onEdge = 0;
    for (const { x, y } of positions) {
      if (
        x <= GRAPH_NODE_MIN_DISTANCE / 2 ||
        y <= GRAPH_NODE_MIN_DISTANCE / 2 ||
        x >= width - GRAPH_NODE_MIN_DISTANCE / 2 ||
        y >= height - GRAPH_NODE_MIN_DISTANCE / 2
      )
        onEdge += 1;
    }
    for (let i = 0; i < positions.length; i += 1) {
      for (let j = i + 1; j < positions.length; j += 1) {
        expect(nodesOverlap(positions[i]!, positions[j]!)).toBe(false);
        expect(graphLabelsOverlap(positions[i]!, positions[j]!)).toBe(false);
      }
    }
    // The failure mode this guards against: nodes piled along the canvas border.
    expect(onEdge).toBeLessThan(positions.length / 4);
  });

  it('handles empty and single-node graphs', () => {
    expect(layoutGraph([], [], WIDTH, HEIGHT).size).toBe(0);
    expect(layoutGraph([{ id: 'only' }], [], WIDTH, HEIGHT).get('only')).toEqual({
      x: WIDTH / 2,
      y: HEIGHT / 2,
    });
  });
});

describe('graph node geometry', () => {
  it('clips horizontal and diagonal edges to the circle boundary', () => {
    expect(circleBoundaryPoint({ x: 100, y: 100 }, { x: 300, y: 100 })).toEqual({
      x: 100 + GRAPH_NODE_RADIUS,
      y: 100,
    });
    const diagonal = circleBoundaryPoint({ x: 100, y: 100 }, { x: 300, y: 300 });
    const diagonalOffset = GRAPH_NODE_RADIUS / Math.SQRT2;
    expect(diagonal.y).toBeCloseTo(100 + diagonalOffset);
    expect(diagonal.x).toBeCloseTo(100 + diagonalOffset);
  });

  it('clamps zoom to the supported range', () => {
    expect(clampGraphZoom(0.2)).toBe(GRAPH_ZOOM_MIN);
    expect(clampGraphZoom(1.2)).toBe(1.2);
    expect(clampGraphZoom(3)).toBe(GRAPH_ZOOM_MAX);
  });

  it('maps background dragging to scroll offsets without going negative', () => {
    expect(dragPanOffset(300, 500, 440)).toBe(360);
    expect(dragPanOffset(300, 500, 560)).toBe(240);
    expect(dragPanOffset(20, 100, 180)).toBe(0);
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

describe('graph edge geometry', () => {
  it('keeps a single relationship straight', () => {
    const offsets = graphEdgeCurveOffsets([{ id: 'only', fromNodeId: 'a', toNodeId: 'b' }]);
    expect(offsets.get('only')).toBe(0);
    expect(graphEdgeGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }, 0).control).toEqual({
      x: 50,
      y: 0,
    });
  });

  it('routes reciprocal relationships on opposite sides with separate labels', () => {
    const edges = [
      { id: 'forward', fromNodeId: 'a', toNodeId: 'b' },
      { id: 'reverse', fromNodeId: 'b', toNodeId: 'a' },
    ];
    const offsets = graphEdgeCurveOffsets(edges);
    const forward = graphEdgeGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }, offsets.get('forward')!);
    const reverse = graphEdgeGeometry({ x: 100, y: 0 }, { x: 0, y: 0 }, offsets.get('reverse')!);

    expect(forward.control.y).toBeGreaterThan(0);
    expect(reverse.control.y).toBeLessThan(0);
    expect(forward.label.y).toBeGreaterThan(0);
    expect(reverse.label.y).toBeLessThan(0);
    expect(Math.abs(forward.label.y - reverse.label.y)).toBeGreaterThan(16);
  });

  it('assigns routes deterministically and fans parallel relationships', () => {
    const edges = [
      { id: 'second', fromNodeId: 'a', toNodeId: 'b' },
      { id: 'first', fromNodeId: 'a', toNodeId: 'b' },
    ];
    const a = graphEdgeCurveOffsets(edges);
    const b = graphEdgeCurveOffsets([...edges].reverse());
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
    expect(a.get('first')).not.toBe(a.get('second'));
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
