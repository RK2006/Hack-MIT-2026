export type Point = { x: number; y: number };

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
  const margin = 40;
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
  const k = Math.sqrt(area / n) * 0.8;
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
      dx[i] = dx[i]! + (cx - xs[i]!) * 0.02;
      dy[i] = dy[i]! + (cy - ys[i]!) * 0.02;
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
  ids.forEach((id, i) => {
    result.set(id, { x: round(xs[i]!), y: round(ys[i]!) });
  });
  return result;
}

const round = (value: number) => Math.round(value * 100) / 100;

/** Only https: locators become clickable; repo:/manual:/agent: schemes render as text. */
export function isSafeLink(uri: string): boolean {
  try {
    return new URL(uri).protocol === 'https:';
  } catch {
    return false;
  }
}
