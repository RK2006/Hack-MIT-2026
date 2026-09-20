'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { ContextNode, GraphSnapshot } from '@/server/context/types';
import ArchivedList from './ArchivedList';
import GraphView from './GraphView';
import HistoryPanel from './HistoryPanel';
import NodeDetail, { type NodeAction } from './NodeDetail';
import NodeForm, { type FormMode } from './NodeForm';
import NodeList from './NodeList';
import TaskPanel, { type TaskSummary } from './TaskPanel';

type View = 'graph' | 'list' | 'archived';
type Panel = { kind: 'detail' } | { kind: 'history' } | { kind: 'form'; mode: FormMode };
type InspectorTab = 'node' | 'task';

export default function Workbench({ projectId }: { projectId: string }) {
  const [graph, setGraph] = useState<GraphSnapshot | null>(null);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [archived, setArchived] = useState<ContextNode[] | null>(null);
  const [archivedError, setArchivedError] = useState<string | null>(null);
  const [view, setView] = useState<View>('graph');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<ContextNode | null>(null);
  const [selectedError, setSelectedError] = useState<string | null>(null);
  const [highlightedNodeIds, setHighlightedNodeIds] = useState<Set<string>>(() => new Set());
  const [highlightedEdgeIds, setHighlightedEdgeIds] = useState<Set<string>>(() => new Set());
  const [graphVersion, setGraphVersion] = useState(0);
  const [panel, setPanel] = useState<Panel>({ kind: 'detail' });
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('node');
  const [taskSummary, setTaskSummary] = useState<TaskSummary>(null);

  // Graph snapshot: refetched whenever graphVersion changes (after every successful mutation).
  useEffect(() => {
    let cancelled = false;
    api
      .getGraph(projectId)
      .then((snapshot) => {
        if (cancelled) return;
        setGraph(snapshot);
        setGraphError(null);
      })
      .catch((err) => {
        if (!cancelled) setGraphError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, graphVersion]);

  // Archived list: loaded when the tab is open or after a mutation while it is open.
  useEffect(() => {
    if (view !== 'archived') return;
    let cancelled = false;
    setArchived(null);
    api
      .listArchivedNodes(projectId)
      .then(({ nodes }) => {
        if (!cancelled) {
          setArchived(nodes);
          setArchivedError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setArchivedError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, view, graphVersion]);

  // Selected node is fetched directly so archived nodes (absent from the graph) still open.
  useEffect(() => {
    if (!selectedNodeId) {
      setSelectedNode(null);
      setSelectedError(null);
      return;
    }
    let cancelled = false;
    api
      .getNode(projectId, selectedNodeId)
      .then((node) => {
        if (!cancelled) {
          setSelectedNode(node);
          setSelectedError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setSelectedNode(null);
          setSelectedError(errorMessage(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, selectedNodeId, graphVersion]);

  const nodesById = useMemo(
    () => new Map((graph?.nodes ?? []).map((node) => [node.id, node] as const)),
    [graph],
  );

  const selectNode = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    setPanel({ kind: 'detail' });
    setInspectorTab('node');
  }, []);

  const onSaved = useCallback((nodeId: string) => {
    setGraphVersion((v) => v + 1);
    setSelectedNodeId(nodeId);
    setPanel({ kind: 'detail' });
    setInspectorTab('node');
  }, []);

  const startAction = (action: NodeAction) => {
    if (!selectedNode) return;
    setPanel({ kind: 'form', mode: { kind: action, node: selectedNode } });
  };

  const onHighlight = useCallback((nodeIds: string[], edgeIds: string[] = []) => {
    setHighlightedNodeIds(new Set(nodeIds));
    setHighlightedEdgeIds(new Set(edgeIds));
  }, []);

  return (
    <div className="workbench">
      <header className="topbar">
        <Link href="/">← Projects</Link>
        <h1>{graph?.project.name ?? 'Loading project…'}</h1>
        <nav className="tabs" aria-label="View">
          {(['graph', 'list', 'archived'] as View[]).map((option) => (
            <button
              key={option}
              type="button"
              className={view === option ? 'tab active' : 'tab'}
              aria-pressed={view === option}
              onClick={() => setView(option)}
            >
              {option === 'graph' ? 'Graph' : option === 'list' ? 'List' : 'Archived'}
            </button>
          ))}
        </nav>
        <button
          type="button"
          className="button-primary"
          onClick={() => {
            setInspectorTab('node');
            setPanel({ kind: 'form', mode: { kind: 'create', selectedNode: selectedNode } });
          }}
        >
          New node
        </button>
        {highlightedNodeIds.size > 0 ? (
          <button type="button" className="button-secondary" onClick={() => onHighlight([])}>
            Clear highlight ({highlightedNodeIds.size})
          </button>
        ) : null}
      </header>

      <div className="columns">
        <section className="left" aria-label="Graph and list">
          {graphError ? (
            <p className="error">
              {graphError}
              {graphError.startsWith('NOT_FOUND') ? (
                <>
                  {' '}
                  — <Link href="/">back to projects</Link>
                </>
              ) : null}
            </p>
          ) : null}
          {!graph && !graphError ? <p className="muted">Loading graph…</p> : null}
          {graph && view === 'graph' ? (
            <>
              <p className="muted">
                {graph.nodes.length} active nodes · {graph.edges.length} relationships
              </p>
              <GraphView
                nodes={graph.nodes}
                edges={graph.edges}
                selectedNodeId={selectedNodeId}
                highlightedNodeIds={highlightedNodeIds}
                highlightedEdgeIds={highlightedEdgeIds}
                onSelect={selectNode}
              />
            </>
          ) : null}
          {graph && view === 'list' ? (
            <NodeList
              nodes={graph.nodes}
              selectedNodeId={selectedNodeId}
              highlightedNodeIds={highlightedNodeIds}
              onSelect={selectNode}
            />
          ) : null}
          {view === 'archived' ? (
            <ArchivedList
              nodes={archived}
              error={archivedError}
              selectedNodeId={selectedNodeId}
              onSelect={selectNode}
            />
          ) : null}
        </section>

        <aside className="right" aria-label="Project inspector">
          <div className="inspector-tabs" role="tablist" aria-label="Inspector view">
            <button
              id="node-details-tab"
              type="button"
              role="tab"
              aria-selected={inspectorTab === 'node'}
              aria-controls="node-details-panel"
              className={inspectorTab === 'node' ? 'inspector-tab active' : 'inspector-tab'}
              onClick={() => setInspectorTab('node')}
            >
              Node details
            </button>
            <button
              id="task-context-tab"
              type="button"
              role="tab"
              aria-selected={inspectorTab === 'task'}
              aria-controls="task-context-panel"
              className={inspectorTab === 'task' ? 'inspector-tab active' : 'inspector-tab'}
              onClick={() => setInspectorTab('task')}
            >
              <span>Task context</span>
              {taskSummary ? (
                <span className="inspector-tab-summary">
                  {taskSummary.selectedCount} nodes · {taskSummary.tokenCount.toLocaleString()} tok
                </span>
              ) : null}
            </button>
          </div>

          <div
            id="node-details-panel"
            role="tabpanel"
            aria-labelledby="node-details-tab"
            className="inspector-panel"
            hidden={inspectorTab !== 'node'}
          >
            {panel.kind === 'form' ? (
              <NodeForm
                key={`${panel.mode.kind}-${selectedNodeId ?? 'none'}`}
                projectId={projectId}
                mode={panel.mode}
                onSaved={onSaved}
                onCancel={() => setPanel({ kind: 'detail' })}
              />
            ) : panel.kind === 'history' && selectedNode ? (
              <HistoryPanel
                projectId={projectId}
                nodeId={selectedNode.id}
                nodeTitle={selectedNode.current.title}
                graphVersion={graphVersion}
                onClose={() => setPanel({ kind: 'detail' })}
              />
            ) : selectedError ? (
              <p className="error">{selectedError}</p>
            ) : selectedNode ? (
              <NodeDetail
                projectId={projectId}
                node={selectedNode}
                edges={graph?.edges ?? []}
                nodesById={nodesById}
                onSelectNode={selectNode}
                onAction={startAction}
                onHistory={() => setPanel({ kind: 'history' })}
              />
            ) : selectedNodeId ? (
              <p className="muted">Loading node…</p>
            ) : (
              <p className="empty">
                Select a node in the graph or list to see its details, evidence, and history.
              </p>
            )}
          </div>

          <div
            id="task-context-panel"
            role="tabpanel"
            aria-labelledby="task-context-tab"
            className="inspector-panel"
            hidden={inspectorTab !== 'task'}
          >
            <TaskPanel
              projectId={projectId}
              selectedNodeId={selectedNodeId}
              graphVersion={graphVersion}
              onHighlight={onHighlight}
              onSelectNode={selectNode}
              onSummaryChange={setTaskSummary}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}
