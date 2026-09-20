/**
 * The mechanism, drawn once: a project's knowledge graph is inked onto the page, the few nodes a
 * task needs are marked, and they are gathered into a bundle that is handed off. Pure SVG + CSS
 * keyframes; the timeline lives in globals.css under "Cover sketch". Decorative for assistive tech.
 */

type Node = { id: string; x: number; y: number; picked?: true; to?: [number, number] };

// Positions are hand-set so the picked cluster reads as one neighborhood, not a random sample.
const NODES: Node[] = [
  { id: 'a', x: 96, y: 92 },
  { id: 'b', x: 178, y: 162, picked: true, to: [438, 100] },
  { id: 'c', x: 262, y: 74 },
  { id: 'd', x: 334, y: 148, picked: true, to: [438, 120] },
  { id: 'e', x: 414, y: 64 },
  { id: 'f', x: 612, y: 236, picked: true, to: [438, 140] },
  { id: 'g', x: 124, y: 262 },
  { id: 'h', x: 228, y: 318 },
  { id: 'i', x: 322, y: 262, picked: true, to: [438, 160] },
  { id: 'j', x: 428, y: 322 },
  { id: 'k', x: 546, y: 262 },
  { id: 'l', x: 580, y: 350 },
  { id: 'm', x: 62, y: 352 },
  { id: 'n', x: 392, y: 214, picked: true, to: [438, 180] },
];

const EDGES: Array<[string, string, boolean?]> = [
  ['a', 'b'],
  ['a', 'c'],
  ['b', 'd', true],
  ['c', 'd'],
  ['c', 'e'],
  ['d', 'n', true],
  ['e', 'f'],
  ['n', 'f', true],
  ['n', 'i', true],
  ['b', 'g'],
  ['g', 'h'],
  ['h', 'i'],
  ['i', 'j'],
  ['j', 'k'],
  ['k', 'l'],
  ['g', 'm'],
  ['f', 'k'],
];

const byId = new Map(NODES.map((n) => [n.id, n] as const));

export default function HandoffSketch() {
  return (
    <svg className="sketch" viewBox="0 0 640 400" aria-hidden="true" focusable="false">
      {/* Edges: drawn in as hairlines; the ones inside the picked neighborhood are re-inked. */}
      <g className="sketch-edges">
        {EDGES.map(([from, to, inside], index) => {
          const a = byId.get(from)!;
          const b = byId.get(to)!;
          return (
            <line
              key={`${from}-${to}`}
              className={inside ? 'sketch-edge inside' : 'sketch-edge'}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              style={{ ['--i' as string]: index }}
            />
          );
        })}
      </g>

      {/* The bundle: a small card the picked nodes travel into. */}
      <g className="sketch-bundle" transform="translate(424 66)">
        <rect className="sketch-bundle-card" x="0" y="0" width="176" height="150" rx="2" />
        <line className="sketch-bundle-rule" x1="10" y1="20" x2="166" y2="20" />
        <text className="sketch-bundle-label" x="10" y="14">
          task context
        </text>
        {[0, 1, 2, 3, 4].map((row) => (
          <line
            key={row}
            className="sketch-bundle-line"
            x1="26"
            y1={34 + row * 20}
            x2={26 + [118, 96, 130, 82, 108][row]!}
            y2={34 + row * 20}
            style={{ ['--i' as string]: row }}
          />
        ))}
        <text className="sketch-bundle-meta" x="10" y="140">
          5 of 14 nodes · 1,461 tokens
        </text>
      </g>

      {/* The hand-off: bundle leaves the page toward whoever is doing the work. */}
      <g className="sketch-handoff">
        <line x1="606" y1="141" x2="634" y2="141" />
        <polyline points="627,134 634,141 627,148" />
      </g>

      {/* Nodes: appear, then the picked ones are marked and gathered. */}
      <g className="sketch-nodes">
        {NODES.map((node, index) => (
          <g
            key={node.id}
            className={node.picked ? 'sketch-node picked' : 'sketch-node'}
            style={{
              ['--i' as string]: index,
              ['--x' as string]: `${node.x}px`,
              ['--y' as string]: `${node.y}px`,
              ...(node.to && {
                ['--tx' as string]: `${node.to[0] - node.x}px`,
                ['--ty' as string]: `${node.to[1] - node.y}px`,
              }),
            }}
          >
            <circle className="sketch-node-dot" cx={node.x} cy={node.y} r="6" />
          </g>
        ))}
      </g>
    </svg>
  );
}
