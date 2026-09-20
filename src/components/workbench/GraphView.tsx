'use client';

import { useMemo, useRef, useState } from 'react';
import {
  clampGraphZoom,
  dragPanOffset,
  graphEdgeCurveOffsets,
  graphEdgeGeometry,
  GRAPH_LABEL_MAX_HEIGHT,
  GRAPH_LABEL_WIDTH,
  GRAPH_NODE_MIN_DISTANCE,
  GRAPH_NODE_RADIUS,
  GRAPH_ZOOM_MAX,
  GRAPH_ZOOM_MIN,
  GRAPH_ZOOM_STEP,
  GRAPH_ZOOM_DEFAULT,
  graphCanvasSize,
  layoutGraph,
  wrapGraphTitle,
  type Point,
} from '@/lib/layout';
import { NODE_TYPES, type ContextEdge, type ContextNode } from '@/server/context/types';
import { NODE_COLORS } from './shared';

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
  const { width: WIDTH, height: HEIGHT } = graphCanvasSize(nodes.length);
  const defaultPositions = useMemo(
    () => layoutGraph(nodes, edges, WIDTH, HEIGHT),
    [nodes, edges, WIDTH, HEIGHT],
  );
  const edgeCurveOffsets = useMemo(() => graphEdgeCurveOffsets(edges), [edges]);
  const [layoutState, setLayoutState] = useState<{
    key: string;
    positions: Map<string, Point>;
  }>({ key: layoutKey, positions: defaultPositions });
  const [zoom, setZoom] = useState(GRAPH_ZOOM_DEFAULT);
  const [isPanning, setIsPanning] = useState(false);
  const positions = layoutState.key === layoutKey ? layoutState.positions : defaultPositions;
  const svgRef = useRef<SVGSVGElement>(null);
  const panRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startScrollLeft: number;
    startScrollTop: number;
  } | null>(null);
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

  const endPan = (pointerId: number) => {
    if (panRef.current?.pointerId !== pointerId) return;
    panRef.current = null;
    setIsPanning(false);
  };

  if (nodes.length === 0) {
    return <p className="empty">This project has no active nodes.</p>;
  }

  return (
    <div className="graph-wrap">
      <div className="graph-toolbar">
        <span>Drag nodes to arrange them. Drag empty space to pan. Use the corner to zoom.</span>
        <button
          type="button"
          onClick={() => setLayoutState({ key: layoutKey, positions: new Map(defaultPositions) })}
        >
          Reset layout
        </button>
      </div>
      <div className="graph-stage">
        <div
          className={`graph-scroll${isPanning ? ' graph-panning' : ''}`}
          aria-label="Pannable graph viewport"
          onPointerDown={(event) => {
            if (event.button !== 0 || (event.target as Element).closest('.node')) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            panRef.current = {
              pointerId: event.pointerId,
              startClientX: event.clientX,
              startClientY: event.clientY,
              startScrollLeft: event.currentTarget.scrollLeft,
              startScrollTop: event.currentTarget.scrollTop,
            };
            setIsPanning(true);
            event.preventDefault();
          }}
          onPointerMove={(event) => {
            const pan = panRef.current;
            if (!pan || pan.pointerId !== event.pointerId) return;
            event.currentTarget.scrollLeft = dragPanOffset(
              pan.startScrollLeft,
              pan.startClientX,
              event.clientX,
            );
            event.currentTarget.scrollTop = dragPanOffset(
              pan.startScrollTop,
              pan.startClientY,
              event.clientY,
            );
          }}
          onPointerUp={(event) => endPan(event.pointerId)}
          onPointerCancel={(event) => endPan(event.pointerId)}
        >
          <svg
            ref={svgRef}
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="graph"
            style={{ width: `${zoom * 100}%` }}
            role="img"
            aria-label={`Graph with ${nodes.length} nodes and ${edges.length} edges`}
          >
            <defs>
              {(['arrow', 'arrow-path'] as const).map((id) => (
                <marker
                  key={id}
                  id={id}
                  className={`marker-${id}`}
                  viewBox="0 0 10 10"
                  refX="10"
                  refY="5"
                  markerWidth="8"
                  markerHeight="8"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" />
                </marker>
              ))}
            </defs>
            {edges.map((edge) => {
              const from = positions.get(edge.fromNodeId);
              const to = positions.get(edge.toNodeId);
              if (!from || !to) return null;
              const geometry = graphEdgeGeometry(from, to, edgeCurveOffsets.get(edge.id) ?? 0);
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
                  <path
                    className="edge-line"
                    d={`M ${geometry.start.x} ${geometry.start.y} Q ${geometry.control.x} ${geometry.control.y} ${geometry.end.x} ${geometry.end.y}`}
                    fill="none"
                    strokeDasharray={inferred ? '5 4' : undefined}
                    markerEnd={onPath ? 'url(#arrow-path)' : 'url(#arrow)'}
                  />
                  <g
                    className="edge-label-group"
                    transform={`translate(${geometry.label.x} ${geometry.label.y})`}
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
                    if (!drag || drag.nodeId !== node.id || drag.pointerId !== event.pointerId)
                      return;
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
                    const margin = GRAPH_NODE_MIN_DISTANCE / 2;
                    const x = Math.min(WIDTH - margin, Math.max(margin, point.x - drag.offsetX));
                    const y = Math.min(HEIGHT - margin, Math.max(margin, point.y - drag.offsetY));
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
                    <circle className="node-highlight-ring" r={GRAPH_NODE_RADIUS + 7} fill="none" />
                  ) : null}
                  <circle
                    className={`node-circle${selected ? ' node-circle-selected' : ''}`}
                    r={GRAPH_NODE_RADIUS}
                    fill={NODE_COLORS[node.type]}
                    fillOpacity={inferred ? 0.72 : 1}
                    strokeDasharray={inferred ? '6 4' : undefined}
                  />
                  {inferred ? (
                    <g
                      className="node-authority-marker"
                      transform={`translate(0 ${-GRAPH_NODE_RADIUS})`}
                      aria-hidden="true"
                    >
                      <rect x={-23} y={-8} width={46} height={16} rx={8} />
                      <text y={3} textAnchor="middle">
                        INFERRED
                      </text>
                    </g>
                  ) : null}
                  <text y={3.5} textAnchor="middle" className="node-type">
                    {node.type.slice(0, 2).toUpperCase()}
                  </text>
                  <g
                    className="node-title-label"
                    transform={`translate(0 ${GRAPH_NODE_RADIUS + 9})`}
                  >
                    <rect
                      x={-GRAPH_LABEL_WIDTH / 2}
                      y={0}
                      width={GRAPH_LABEL_WIDTH}
                      height={lines.length > 1 ? GRAPH_LABEL_MAX_HEIGHT : 22}
                      rx={6}
                    />
                    <text y={lines.length > 1 ? 12 : 15} textAnchor="middle" className="node-label">
                      {lines.map((line, index) => (
                        <tspan key={`${index}-${line}`} x={0} dy={index === 0 ? 0 : 13}>
                          {line}
                        </tspan>
                      ))}
                    </text>
                  </g>
                </g>
              );
            })}
          </svg>
        </div>
        <div className="graph-zoom" role="group" aria-label="Graph zoom controls">
          <button
            type="button"
            aria-label="Zoom out"
            disabled={zoom <= GRAPH_ZOOM_MIN}
            onClick={() => setZoom((value) => clampGraphZoom(value - GRAPH_ZOOM_STEP))}
          >
            −
          </button>
          <button type="button" aria-label="Reset zoom" onClick={() => setZoom(GRAPH_ZOOM_DEFAULT)}>
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            aria-label="Zoom in"
            disabled={zoom >= GRAPH_ZOOM_MAX}
            onClick={() => setZoom((value) => clampGraphZoom(value + GRAPH_ZOOM_STEP))}
          >
            +
          </button>
        </div>
      </div>
      <ul className="legend" aria-label="Legend">
        {NODE_TYPES.map((type) => (
          <li key={type}>
            <span className="swatch" style={{ background: NODE_COLORS[type] }} aria-hidden="true" />
            {type}
          </li>
        ))}
        <li>
          <span className="swatch swatch-dashed" aria-hidden="true" />
          dashed + badge = inferred
        </li>
        <li>
          <span className="swatch swatch-solid" aria-hidden="true" />
          solid = canonical
        </li>
        <li>
          <span className="swatch swatch-highlight" aria-hidden="true" />
          highlighted by task
        </li>
      </ul>
    </div>
  );
}
