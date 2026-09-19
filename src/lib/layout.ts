export type Point = { x: number; y: number };

export const GRAPH_NODE_WIDTH = 160;
export const GRAPH_NODE_HEIGHT = 64;
export const GRAPH_NODE_GAP = 14;

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
  const marginX = GRAPH_NODE_WIDTH / 2 + GRAPH_NODE_GAP;
  const marginY = GRAPH_NODE_HEIGHT / 2 + GRAPH_NODE_GAP;
  const innerW = Math.max(1, width - marginX * 2);
  const innerH = Math.max(1, height - marginY * 2);
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  ids.forEach((id, i) => {
    const h = hash(id);
    xs[i] = marginX + ((h & 0xffff) / 0xffff) * innerW;
    ys[i] = marginY + (((h >>> 16) & 0xffff) / 0xffff) * innerH;
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
      xs[i] = Math.min(width - marginX, Math.max(marginX, xs[i]!));
      ys[i] = Math.min(height - marginY, Math.max(marginY, ys[i]!));
    }
    temperature = Math.max(0.5, temperature - cooling);
  }

  // The force pass treats nodes as points. Resolve card-sized collisions after it
  // so both the node surfaces and their labels remain readable.
  separateCards(xs, ys, width, height, marginX, marginY);
  if (hasCardOverlap(xs, ys)) packCardsOnGrid(xs, ys, width, height);
  ids.forEach((id, i) => {
    result.set(id, { x: round(xs[i]!), y: round(ys[i]!) });
  });
  return result;
}

function hasCardOverlap(xs: Float64Array, ys: Float64Array): boolean {
  for (let i = 0; i < xs.length; i += 1) {
    for (let j = i + 1; j < xs.length; j += 1) {
      if (cardsOverlap({ x: xs[i]!, y: ys[i]! }, { x: xs[j]!, y: ys[j]! })) return true;
    }
  }
  return false;
}

/**
 * Dense graphs can pin collision relaxation against the canvas boundary. In that
 * case, assign the force-directed result to the nearest collision-free grid slots.
 * This keeps the force layout's broad grouping while guaranteeing readable cards.
 */
function packCardsOnGrid(xs: Float64Array, ys: Float64Array, width: number, height: number) {
  const stepX = GRAPH_NODE_WIDTH + GRAPH_NODE_GAP;
  const stepY = GRAPH_NODE_HEIGHT + GRAPH_NODE_GAP;
  const maxColumns = Math.max(1, Math.floor((width - GRAPH_NODE_WIDTH) / stepX) + 1);
  const maxRows = Math.max(1, Math.floor((height - GRAPH_NODE_HEIGHT) / stepY) + 1);
  const minimumColumns = Math.ceil(xs.length / maxRows);
  const idealColumns = Math.ceil(
    Math.sqrt((xs.length * width * stepY) / Math.max(1, height * stepX)),
  );
  const columns = Math.min(maxColumns, Math.max(minimumColumns, idealColumns));
  const rows = Math.ceil(xs.length / columns);
  const startX = (width - (columns - 1) * stepX) / 2;
  const startY = (height - (rows - 1) * stepY) / 2;
  const slots: Point[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns && slots.length < xs.length; column += 1) {
      slots.push({ x: startX + column * stepX, y: startY + row * stepY });
    }
  }
  const choices: Array<{ nodeIndex: number; slotIndex: number; distance: number }> = [];
  for (let nodeIndex = 0; nodeIndex < xs.length; nodeIndex += 1) {
    for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
      const slot = slots[slotIndex]!;
      choices.push({
        nodeIndex,
        slotIndex,
        distance: Math.hypot(xs[nodeIndex]! - slot.x, ys[nodeIndex]! - slot.y),
      });
    }
  }
  choices.sort(
    (a, b) => a.distance - b.distance || a.nodeIndex - b.nodeIndex || a.slotIndex - b.slotIndex,
  );
  const assignedNodes = new Set<number>();
  const assignedSlots = new Set<number>();
  for (const choice of choices) {
    if (assignedNodes.has(choice.nodeIndex) || assignedSlots.has(choice.slotIndex)) continue;
    const slot = slots[choice.slotIndex]!;
    xs[choice.nodeIndex] = slot.x;
    ys[choice.nodeIndex] = slot.y;
    assignedNodes.add(choice.nodeIndex);
    assignedSlots.add(choice.slotIndex);
    if (assignedNodes.size === xs.length) break;
  }
}

function separateCards(
  xs: Float64Array,
  ys: Float64Array,
  width: number,
  height: number,
  marginX: number,
  marginY: number,
) {
  const requiredX = GRAPH_NODE_WIDTH + GRAPH_NODE_GAP;
  const requiredY = GRAPH_NODE_HEIGHT + GRAPH_NODE_GAP;
  for (let pass = 0; pass < 240; pass += 1) {
    let moved = false;
    for (let i = 0; i < xs.length; i += 1) {
      for (let j = i + 1; j < xs.length; j += 1) {
        const vx = xs[j]! - xs[i]!;
        const vy = ys[j]! - ys[i]!;
        const overlapX = requiredX - Math.abs(vx);
        const overlapY = requiredY - Math.abs(vy);
        if (overlapX <= 0 || overlapY <= 0) continue;
        moved = true;
        if (overlapX <= overlapY) {
          const direction = vx === 0 ? ((i + j) % 2 === 0 ? 1 : -1) : Math.sign(vx);
          const push = overlapX / 2 + 0.05;
          xs[i] = xs[i]! - direction * push;
          xs[j] = xs[j]! + direction * push;
        } else {
          const direction = vy === 0 ? ((i + j) % 2 === 0 ? 1 : -1) : Math.sign(vy);
          const push = overlapY / 2 + 0.05;
          ys[i] = ys[i]! - direction * push;
          ys[j] = ys[j]! + direction * push;
        }
        xs[i] = Math.min(width - marginX, Math.max(marginX, xs[i]!));
        xs[j] = Math.min(width - marginX, Math.max(marginX, xs[j]!));
        ys[i] = Math.min(height - marginY, Math.max(marginY, ys[i]!));
        ys[j] = Math.min(height - marginY, Math.max(marginY, ys[j]!));
      }
    }
    if (!moved) break;
  }
}

export function cardsOverlap(a: Point, b: Point, gap = 0): boolean {
  return (
    Math.abs(a.x - b.x) < GRAPH_NODE_WIDTH + gap && Math.abs(a.y - b.y) < GRAPH_NODE_HEIGHT + gap
  );
}

/** Finds where a center-to-center edge meets the boundary of a graph node card. */
export function rectangleBoundaryPoint(from: Point, to: Point, padding = 0): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return { ...from };
  const scale = Math.min(
    (GRAPH_NODE_WIDTH / 2 + padding) / Math.max(Number.EPSILON, Math.abs(dx)),
    (GRAPH_NODE_HEIGHT / 2 + padding) / Math.max(Number.EPSILON, Math.abs(dy)),
  );
  return { x: from.x + dx * scale, y: from.y + dy * scale };
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

/** Only https: locators become clickable; repo:/manual:/agent: schemes render as text. */
export function isSafeLink(uri: string): boolean {
  try {
    return new URL(uri).protocol === 'https:';
  } catch {
    return false;
  }
}
