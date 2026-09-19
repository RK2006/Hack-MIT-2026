'use client';

import { useMemo } from 'react';
import { layoutGraph } from '@/lib/layout';
import { NODE_TYPES, type ContextEdge, type ContextNode } from '@/server/context/types';
import { NODE_COLORS, truncate } from './shared';

const WIDTH = 900;
const HEIGHT = 620;
const RADIUS = 14;

type Props = {
  nodes: ContextNode[];
  edges: ContextEdge[];
  selectedNodeId: string | null;
  highlightedNodeIds: Set<string>;
  highlightedEdgeIds?: Set<string>;
  onSelect: (nodeId: string) => void;
};

export default function GraphView({
  nodes,
  edges,
  selectedNodeId,
  highlightedNodeIds,
  highlightedEdgeIds,
  onSelect,
}: Props) {
  const positions = useMemo(() => layoutGraph(nodes, edges, WIDTH, HEIGHT), [nodes, edges]);

  if (nodes.length === 0) {
    return <p className="empty">This project has no active nodes.</p>;
  }

  return (
    <div className="graph-wrap">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="graph"
        role="img"
        aria-label={`Graph with ${nodes.length} nodes and ${edges.length} edges`}
      >
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="10"
            refY="5"
            markerWidth="8"
            markerHeight="8"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#555" />
          </marker>
        </defs>
        {edges.map((edge) => {
          const from = positions.get(edge.fromNodeId);
          const to = positions.get(edge.toNodeId);
          if (!from || !to) return null;
          const dx = to.x - from.x;
          const dy = to.y - from.y;
          const len = Math.max(1, Math.hypot(dx, dy));
          // Stop the line at the target circle's edge so the arrowhead is visible.
          const ex = to.x - (dx / len) * (RADIUS + 2);
          const ey = to.y - (dy / len) * (RADIUS + 2);
          const sx = from.x + (dx / len) * RADIUS;
          const sy = from.y + (dy / len) * RADIUS;
          const inferred = edge.authority === 'inferred';
          const onPath = highlightedEdgeIds?.has(edge.id) ?? false;
          return (
            <g key={edge.id} className={`edge edge-${edge.authority}${onPath ? ' edge-path' : ''}`}>
              <line
                x1={sx}
                y1={sy}
                x2={ex}
                y2={ey}
                stroke={onPath ? '#f59e0b' : '#555'}
                strokeWidth={onPath ? 3 : 1.2}
                strokeDasharray={inferred ? '5 4' : undefined}
                markerEnd="url(#arrow)"
              />
              <text
                x={(from.x + to.x) / 2}
                y={(from.y + to.y) / 2 - 3}
                className="edge-label"
                textAnchor="middle"
              >
                {edge.type}
                {inferred ? ' (inferred)' : ''}
              </text>
            </g>
          );
        })}
        {nodes.map((node) => {
          const p = positions.get(node.id);
          if (!p) return null;
          const selected = node.id === selectedNodeId;
          const highlighted = highlightedNodeIds.has(node.id);
          const inferred = node.current.authority === 'inferred';
          return (
            <g
              key={node.id}
              className="node"
              transform={`translate(${p.x} ${p.y})`}
              tabIndex={0}
              role="button"
              aria-label={`${node.current.title} (${node.type}, ${node.current.authority})`}
              aria-pressed={selected}
              onClick={() => onSelect(node.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect(node.id);
                }
              }}
            >
              {highlighted ? (
                <circle r={RADIUS + 6} fill="none" stroke="#f59e0b" strokeWidth={4} />
              ) : null}
              <circle
                r={RADIUS}
                fill={NODE_COLORS[node.type]}
                fillOpacity={inferred ? 0.55 : 0.95}
                stroke={selected ? '#111' : '#fff'}
                strokeWidth={selected ? 3 : 1.5}
                strokeDasharray={inferred ? '4 3' : undefined}
              />
              <text y={RADIUS + 12} textAnchor="middle" className="node-label">
                {truncate(node.current.title, 26)}
              </text>
            </g>
          );
        })}
      </svg>
      <ul className="legend" aria-label="Legend">
        {NODE_TYPES.map((type) => (
          <li key={type}>
            <span className="swatch" style={{ background: NODE_COLORS[type] }} aria-hidden="true" />
            {type}
          </li>
        ))}
        <li>
          <span className="swatch swatch-dashed" aria-hidden="true" />
          dashed = inferred
        </li>
        <li>
          <span className="swatch swatch-highlight" aria-hidden="true" />
          highlighted by task
        </li>
      </ul>
    </div>
  );
}
