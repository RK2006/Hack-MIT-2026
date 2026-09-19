'use client';

import { useMemo, useRef, useState } from 'react';
import {
  GRAPH_NODE_HEIGHT,
  GRAPH_NODE_WIDTH,
  layoutGraph,
  rectangleBoundaryPoint,
  wrapGraphTitle,
  type Point,
} from '@/lib/layout';
import { NODE_TYPES, type ContextEdge, type ContextNode } from '@/server/context/types';
import { NODE_COLORS } from './shared';

const WIDTH = 900;
const HEIGHT = 620;
const DRAG_THRESHOLD = 4;

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
  const layoutKey = useMemo(
    () =>
      `${nodes
        .map((node) => node.id)
        .sort()
        .join(',')}|${edges
        .map((edge) => edge.id)
        .sort()
        .join(',')}`,
    [nodes, edges],
  );
  const defaultPositions = useMemo(() => layoutGraph(nodes, edges, WIDTH, HEIGHT), [nodes, edges]);
  const [layoutState, setLayoutState] = useState<{
    key: string;
    positions: Map<string, Point>;
  }>({ key: layoutKey, positions: defaultPositions });
  const positions = layoutState.key === layoutKey ? layoutState.positions : defaultPositions;
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{
    nodeId: string;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    offsetX: number;
    offsetY: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef<string | null>(null);

  const graphPoint = (clientX: number, clientY: number): Point | null => {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return null;
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const transformed = point.matrixTransform(matrix.inverse());
    return { x: transformed.x, y: transformed.y };
  };

  const endDrag = (nodeId: string, pointerId: number) => {
    const drag = dragRef.current;
    if (!drag || drag.nodeId !== nodeId || drag.pointerId !== pointerId) return;
    if (drag.moved) suppressClickRef.current = nodeId;
    dragRef.current = null;
  };

  if (nodes.length === 0) {
    return <p className="empty">This project has no active nodes.</p>;
  }

  return (
    <div className="graph-wrap">
      <div className="graph-toolbar">
        <span>Drag nodes to adjust this view. Positions reset after reload or graph changes.</span>
        <button
          type="button"
          onClick={() => setLayoutState({ key: layoutKey, positions: new Map(defaultPositions) })}
        >
          Reset layout
        </button>
      </div>
      <svg
        ref={svgRef}
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
          const start = rectangleBoundaryPoint(from, to, 1);
          const end = rectangleBoundaryPoint(to, from, 5);
          const inferred = edge.authority === 'inferred';
          const onPath = highlightedEdgeIds?.has(edge.id) ?? false;
          const related =
            selectedNodeId === edge.fromNodeId || selectedNodeId === edge.toNodeId || onPath;
          const label = `${edge.type}${inferred ? ' · inferred' : ''}`;
          const labelWidth = label.length * 5.2 + 14;
          return (
            <g
              key={edge.id}
              className={`edge edge-${edge.authority}${onPath ? ' edge-path' : ''}${related ? ' edge-related' : ''}`}
            >
              <title>{label}</title>
              <line
                x1={start.x}
                y1={start.y}
                x2={end.x}
                y2={end.y}
                stroke={onPath ? '#f59e0b' : '#555'}
                strokeWidth={onPath ? 3 : 1.2}
                strokeDasharray={inferred ? '5 4' : undefined}
                markerEnd="url(#arrow)"
              />
              <g
                className="edge-label-group"
                transform={`translate(${(from.x + to.x) / 2} ${(from.y + to.y) / 2})`}
              >
                <rect x={-labelWidth / 2} y={-9} width={labelWidth} height={16} rx={8} />
                <text className="edge-label" textAnchor="middle" y={2.5}>
                  {label}
                </text>
              </g>
            </g>
          );
        })}
        {nodes.map((node) => {
          const p = positions.get(node.id);
          if (!p) return null;
          const selected = node.id === selectedNodeId;
          const highlighted = highlightedNodeIds.has(node.id);
          const inferred = node.current.authority === 'inferred';
          const lines = wrapGraphTitle(node.current.title);
          return (
            <g
              key={node.id}
              className={`node${dragRef.current?.nodeId === node.id ? ' node-dragging' : ''}`}
              transform={`translate(${p.x} ${p.y})`}
              tabIndex={0}
              role="button"
              aria-label={`${node.current.title} (${node.type}, ${node.current.authority})`}
              aria-pressed={selected}
              onClick={() => {
                if (suppressClickRef.current === node.id) {
                  suppressClickRef.current = null;
                  return;
                }
                onSelect(node.id);
              }}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                const point = graphPoint(event.clientX, event.clientY);
                if (!point) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                dragRef.current = {
                  nodeId: node.id,
                  pointerId: event.pointerId,
                  startClientX: event.clientX,
                  startClientY: event.clientY,
                  offsetX: point.x - p.x,
                  offsetY: point.y - p.y,
                  moved: false,
                };
              }}
              onPointerMove={(event) => {
                const drag = dragRef.current;
                if (!drag || drag.nodeId !== node.id || drag.pointerId !== event.pointerId) return;
                const point = graphPoint(event.clientX, event.clientY);
                if (!point) return;
                if (
                  Math.hypot(
                    event.clientX - drag.startClientX,
                    event.clientY - drag.startClientY,
                  ) >= DRAG_THRESHOLD
                ) {
                  drag.moved = true;
                }
                if (!drag.moved) return;
                event.preventDefault();
                const x = Math.min(
                  WIDTH - GRAPH_NODE_WIDTH / 2,
                  Math.max(GRAPH_NODE_WIDTH / 2, point.x - drag.offsetX),
                );
                const y = Math.min(
                  HEIGHT - GRAPH_NODE_HEIGHT / 2,
                  Math.max(GRAPH_NODE_HEIGHT / 2, point.y - drag.offsetY),
                );
                setLayoutState((current) => {
                  const next = new Map(
                    current.key === layoutKey ? current.positions : defaultPositions,
                  );
                  next.set(node.id, { x, y });
                  return { key: layoutKey, positions: next };
                });
              }}
              onPointerUp={(event) => endDrag(node.id, event.pointerId)}
              onPointerCancel={(event) => endDrag(node.id, event.pointerId)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect(node.id);
                }
              }}
            >
              {highlighted ? (
                <rect
                  x={-GRAPH_NODE_WIDTH / 2 - 5}
                  y={-GRAPH_NODE_HEIGHT / 2 - 5}
                  width={GRAPH_NODE_WIDTH + 10}
                  height={GRAPH_NODE_HEIGHT + 10}
                  rx={13}
                  fill="none"
                  stroke="#f59e0b"
                  strokeWidth={4}
                />
              ) : null}
              <rect
                className="node-card"
                x={-GRAPH_NODE_WIDTH / 2}
                y={-GRAPH_NODE_HEIGHT / 2}
                width={GRAPH_NODE_WIDTH}
                height={GRAPH_NODE_HEIGHT}
                rx={9}
                fill={NODE_COLORS[node.type]}
                fillOpacity={inferred ? 0.78 : 0.96}
                stroke={selected ? '#111827' : '#fff'}
                strokeWidth={selected ? 3 : 2}
                strokeDasharray={inferred ? '6 4' : undefined}
              />
              <text y={-15} textAnchor="middle" className="node-type">
                {node.type}
              </text>
              <text y={lines.length === 1 ? 8 : 1} textAnchor="middle" className="node-label">
                {lines.map((line, index) => (
                  <tspan key={`${index}-${line}`} x={0} dy={index === 0 ? 0 : 14}>
                    {line}
                  </tspan>
                ))}
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
