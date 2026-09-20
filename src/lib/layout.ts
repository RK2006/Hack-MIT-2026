export type Point = { x: number; y: number };

export const GRAPH_NODE_RADIUS = 20;
export const GRAPH_NODE_MIN_DISTANCE = 124;
export const GRAPH_LABEL_WIDTH = 124;
export const GRAPH_LABEL_MAX_HEIGHT = 34;
export const GRAPH_ZOOM_MIN = 0.6;
export const GRAPH_ZOOM_MAX = 2;
export const GRAPH_ZOOM_STEP = 0.2;
export const GRAPH_ZOOM_DEFAULT = 1.4;
export const GRAPH_RECIPROCAL_CURVE = 56;
export const GRAPH_PARALLEL_CURVE_GAP = 36;

export type GraphEdgeGeometry = {
  start: Point;
  control: Point;
  end: Point;
  label: Point;
};

/** FNV-1a 32-bit hash; gives every node a stable starting position without Math.random. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Deterministic force-directed layout (Fruchterman–Reingold style).
 * Same nodes, edges, and dimensions always produce the same coordinates.
 */
export function layoutGraph(
  nodes: ReadonlyArray<{ id: string }>,
  edges: ReadonlyArray<{ fromNodeId: string; toNodeId: string }>,
  width: number,
  height: number,
  iterations = 300,
): Map<string, Point> {
  const result = new Map<string, Point>();
  if (nodes.length === 0) return result;
  const ids = [...new Set(nodes.map((node) => node.id))].sort();
  const index = new Map(ids.map((id, i) => [id, i] as const));
  const n = ids.length;
  const margin = GRAPH_NODE_MIN_DISTANCE / 2;
  const innerW = Math.max(1, width - margin * 2);
  const innerH = Math.max(1, height - margin * 2);
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  ids.forEach((id, i) => {
    const h = hash(id);
    xs[i] = margin + ((h & 0xffff) / 0xffff) * innerW;
    ys[i] = margin + (((h >>> 16) & 0xffff) / 0xffff) * innerH;
  });
  if (n === 1) {
    result.set(ids[0]!, { x: width / 2, y: height / 2 });
    return result;
  }
  const links: Array<[number, number]> = [];
  for (const edge of edges) {
    const a = index.get(edge.fromNodeId);
    const b = index.get(edge.toNodeId);
    if (a !== undefined && b !== undefined && a !== b) links.push([a, b]);
  }
  const area = innerW * innerH;
  const k = Math.sqrt(area / n) * 1.05;
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  let temperature = Math.max(innerW, innerH) / 10;
  const cooling = temperature / Math.max(1, iterations);
  for (let step = 0; step < iterations; step += 1) {
    dx.fill(0);
    dy.fill(0);
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        let vx = xs[i]! - xs[j]!;
        let vy = ys[i]! - ys[j]!;
        let dist = Math.hypot(vx, vy);
        if (dist < 0.01) {
          // Coincident points: nudge deterministically by index.
          vx = (i - j) * 0.01;
          vy = 0.01;
          dist = Math.hypot(vx, vy);
        }
        const force = (k * k) / dist;
        const fx = (vx / dist) * force;
        const fy = (vy / dist) * force;
        dx[i] = dx[i]! + fx;
        dy[i] = dy[i]! + fy;
        dx[j] = dx[j]! - fx;
        dy[j] = dy[j]! - fy;
      }
    }
    for (const [a, b] of links) {
      const vx = xs[a]! - xs[b]!;
      const vy = ys[a]! - ys[b]!;
      const dist = Math.max(0.01, Math.hypot(vx, vy));
      const force = (dist * dist) / k;
      const fx = (vx / dist) * force;
      const fy = (vy / dist) * force;
      dx[a] = dx[a]! - fx;
      dy[a] = dy[a]! - fy;
      dx[b] = dx[b]! + fx;
      dy[b] = dy[b]! + fy;
    }
    // Weak pull to the center keeps disconnected components on the canvas.
    const cx = width / 2;
    const cy = height / 2;
    for (let i = 0; i < n; i += 1) {
      dx[i] = dx[i]! + (cx - xs[i]!) * 0.012;
      dy[i] = dy[i]! + (cy - ys[i]!) * 0.012;
      const len = Math.hypot(dx[i]!, dy[i]!);
      const limit = Math.min(len, temperature);
      if (len > 0) {
        xs[i] = xs[i]! + (dx[i]! / len) * limit;
        ys[i] = ys[i]! + (dy[i]! / len) * limit;
      }
      xs[i] = Math.min(width - margin, Math.max(margin, xs[i]!));
      ys[i] = Math.min(height - margin, Math.max(margin, ys[i]!));
    }
    temperature = Math.max(0.5, temperature - cooling);
  }

  // Preserve the organic force shape while reserving enough radial room for the
  // circle and its bounded label.
  separateNodes(xs, ys, width, height, margin);
  ids.forEach((id, i) => {
    result.set(id, { x: round(xs[i]!), y: round(ys[i]!) });
  });
  return result;
}

function separateNodes(
  xs: Float64Array,
  ys: Float64Array,
  width: number,
  height: number,
  margin: number,
) {
  for (let pass = 0; pass < 2_000; pass += 1) {
    let moved = false;
    for (let i = 0; i < xs.length; i += 1) {
      for (let j = i + 1; j < xs.length; j += 1) {
        let vx = xs[j]! - xs[i]!;
        let vy = ys[j]! - ys[i]!;
        let distance = Math.hypot(vx, vy);
        if (distance >= GRAPH_NODE_MIN_DISTANCE) continue;
        if (distance < 0.01) {
          vx = (i + j) % 2 === 0 ? 1 : -1;
          vy = 1;
          distance = Math.SQRT2;
        }
        moved = true;
        const push = (GRAPH_NODE_MIN_DISTANCE - distance) / 2 + 0.2;
        const ux = vx / distance;
        const uy = vy / distance;
        xs[i] = Math.min(width - margin, Math.max(margin, xs[i]! - ux * push));
        xs[j] = Math.min(width - margin, Math.max(margin, xs[j]! + ux * push));
        ys[i] = Math.min(height - margin, Math.max(margin, ys[i]! - uy * push));
        ys[j] = Math.min(height - margin, Math.max(margin, ys[j]! + uy * push));
      }
    }
    if (!moved) break;
  }
}

export function nodesOverlap(a: Point, b: Point, minimumDistance = GRAPH_NODE_MIN_DISTANCE) {
  return Math.hypot(a.x - b.x, a.y - b.y) < minimumDistance;
}

export function graphLabelsOverlap(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < GRAPH_LABEL_WIDTH && Math.abs(a.y - b.y) < GRAPH_LABEL_MAX_HEIGHT;
}

/** Finds where a center-to-center edge meets the boundary of a circular graph node. */
export function circleBoundaryPoint(from: Point, to: Point, padding = 0): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return { ...from };
  const scale = (GRAPH_NODE_RADIUS + padding) / Math.hypot(dx, dy);
  return { x: from.x + dx * scale, y: from.y + dy * scale };
}

/**
 * Assigns stable curve offsets to edges sharing the same unordered node pair.
 * Reciprocal directions receive the same local offset; reversing the edge reverses
 * its normal, so the two paths bend onto opposite visual sides.
 */
export function graphEdgeCurveOffsets(
  edges: ReadonlyArray<{ id: string; fromNodeId: string; toNodeId: string }>,
): Map<string, number> {
  const result = new Map<string, number>();
  const groups = new Map<string, typeof edges>();

  for (const edge of edges) {
    if (edge.fromNodeId === edge.toNodeId) {
      result.set(edge.id, 0);
      continue;
    }
    const [a, b] = [edge.fromNodeId, edge.toNodeId].sort();
    const key = `${a}\u0000${b}`;
    groups.set(key, [...(groups.get(key) ?? []), edge]);
  }

  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => a.id.localeCompare(b.id));
    const canonicalFrom = [
      ...new Set(sorted.flatMap((edge) => [edge.fromNodeId, edge.toNodeId])),
    ].sort()[0]!;
    const forward = sorted.filter((edge) => edge.fromNodeId === canonicalFrom);
    const reverse = sorted.filter((edge) => edge.fromNodeId !== canonicalFrom);

    if (forward.length > 0 && reverse.length > 0) {
      for (const direction of [forward, reverse]) {
        direction.forEach((edge, index) => {
          result.set(edge.id, GRAPH_RECIPROCAL_CURVE + index * GRAPH_PARALLEL_CURVE_GAP);
        });
      }
      continue;
    }

    sorted.forEach((edge, index) => {
      const centeredIndex = index - (sorted.length - 1) / 2;
      result.set(edge.id, centeredIndex * GRAPH_PARALLEL_CURVE_GAP);
    });
  }

  return result;
}

/** Returns a circle-clipped quadratic edge and its path-relative label midpoint. */
export function graphEdgeGeometry(from: Point, to: Point, curveOffset: number): GraphEdgeGeometry {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const midpoint = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const control =
    distance === 0
      ? midpoint
      : {
          x: midpoint.x + (-dy / distance) * curveOffset,
          y: midpoint.y + (dx / distance) * curveOffset,
        };
  const start = circleBoundaryPoint(from, control, 1);
  const end = circleBoundaryPoint(to, control, 5);
  const label = {
    x: start.x * 0.25 + control.x * 0.5 + end.x * 0.25,
    y: start.y * 0.25 + control.y * 0.5 + end.y * 0.25,
  };

  return {
    start: roundPoint(start),
    control: roundPoint(control),
    end: roundPoint(end),
    label: roundPoint(label),
  };
}

export function clampGraphZoom(zoom: number): number {
  return Math.min(GRAPH_ZOOM_MAX, Math.max(GRAPH_ZOOM_MIN, round(zoom)));
}

/** Maps a background drag to a non-negative scroll offset. */
export function dragPanOffset(
  startScroll: number,
  startPointer: number,
  currentPointer: number,
): number {
  return Math.max(0, startScroll + startPointer - currentPointer);
}

/** Wraps a card title to a bounded number of deterministic SVG text lines. */
export function wrapGraphTitle(title: string, maxChars = 24, maxLines = 2): string[] {
  let remaining = title.trim().replace(/\s+/g, ' ');
  if (!remaining) return [];
  const lines: string[] = [];
  while (remaining && lines.length < maxLines) {
    if (remaining.length <= maxChars) {
      lines.push(remaining);
      remaining = '';
      break;
    }
    let split = remaining.lastIndexOf(' ', maxChars);
    if (split < Math.floor(maxChars / 2)) split = maxChars;
    lines.push(remaining.slice(0, split).trimEnd());
    remaining = remaining.slice(split).trimStart();
  }
  if (remaining && lines.length > 0) {
    lines[lines.length - 1] = `${lines[lines.length - 1]!.slice(0, maxChars - 1).trimEnd()}…`;
  }
  return lines;
}

const round = (value: number) => Math.round(value * 100) / 100;
const roundPoint = ({ x, y }: Point): Point => ({ x: round(x), y: round(y) });

/** Only https: locators become clickable; repo:/manual:/agent: schemes render as text. */
export function isSafeLink(uri: string): boolean {
  try {
    return new URL(uri).protocol === 'https:';
  } catch {
    return false;
  }
}
