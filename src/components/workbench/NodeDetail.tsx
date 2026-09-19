'use client';

import type { ContextEdge, ContextNode } from '@/server/context/types';
import SourceEvidence from './SourceEvidence';
import { AuthorityBadge, TypeBadge, formatDate } from './shared';

export type NodeAction = 'edit' | 'review' | 'archive' | 'restore';

type Props = {
  projectId: string;
  node: ContextNode;
  edges: ContextEdge[];
  nodesById: Map<string, ContextNode>;
  onSelectNode: (nodeId: string) => void;
  onAction: (action: NodeAction) => void;
  onHistory: () => void;
};

export default function NodeDetail({
  projectId,
  node,
  edges,
  nodesById,
  onSelectNode,
  onAction,
  onHistory,
}: Props) {
  const current = node.current;
  const related = edges.filter((edge) => edge.fromNodeId === node.id || edge.toNodeId === node.id);

  return (
    <section className="detail" aria-label="Node detail">
      <header className="detail-header">
        <h2>{current.title}</h2>
        <div className="badges">
          <TypeBadge type={node.type} />
          <AuthorityBadge authority={current.authority} />
          {current.archived ? <span className="badge badge-archived">archived</span> : null}
          <span className="badge">v{current.version}</span>
        </div>
      </header>

      <div className="actions">
        <button type="button" onClick={() => onAction('edit')}>
          Edit
        </button>
        {current.authority === 'inferred' ? (
          <button type="button" onClick={() => onAction('review')}>
            Review as canonical
          </button>
        ) : null}
        {current.archived ? (
          <button type="button" onClick={() => onAction('restore')}>
            Restore
          </button>
        ) : (
          <button type="button" onClick={() => onAction('archive')}>
            Archive
          </button>
        )}
        <button type="button" onClick={onHistory}>
          History
        </button>
      </div>

      <dl className="fields">
        <dt>Node ID</dt>
        <dd className="mono">{node.id}</dd>
        <dt>Importance</dt>
        <dd>{current.importance} / 5</dd>
        <dt>Confidence</dt>
        <dd>{current.confidence}</dd>
        <dt>Actor</dt>
        <dd>
          {current.actor.kind}: {current.actor.label}
        </dd>
        <dt>Change reason</dt>
        <dd>{current.changeReason}</dd>
        <dt>Revised</dt>
        <dd>{formatDate(current.createdAt)}</dd>
        <dt>External key</dt>
        <dd className="mono">{node.externalKey ?? '—'}</dd>
        <dt>Path</dt>
        <dd className="mono">{node.path ?? '—'}</dd>
        <dt>Summary</dt>
        <dd>{current.summary || <span className="muted">(none)</span>}</dd>
        <dt>Content</dt>
        <dd>
          <pre className="content">{current.content}</pre>
        </dd>
      </dl>

      <h3>Relationships ({related.length})</h3>
      {related.length === 0 ? (
        <p className="muted">
          No active relationships.
          {current.archived ? ' Edges touching archived nodes are hidden from the graph.' : ''}
        </p>
      ) : (
        <ul className="relations">
          {related.map((edge) => {
            const outgoing = edge.fromNodeId === node.id;
            const otherId = outgoing ? edge.toNodeId : edge.fromNodeId;
            const other = nodesById.get(otherId);
            const otherLabel = (
              <button type="button" className="link" onClick={() => onSelectNode(otherId)}>
                {other?.current.title ?? otherId}
              </button>
            );
            return (
              <li key={edge.id} className={`relation relation-${edge.authority}`}>
                {outgoing ? (
                  <>
                    <em>this node</em> → <strong>{edge.type}</strong> → {otherLabel}
                  </>
                ) : (
                  <>
                    {otherLabel} → <strong>{edge.type}</strong> → <em>this node</em>
                  </>
                )}{' '}
                <span className="muted">edge:</span> <AuthorityBadge authority={edge.authority} />
                {other ? (
                  <>
                    {' '}
                    <span className="muted">node:</span>{' '}
                    <AuthorityBadge authority={other.current.authority} />
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <h3>Source evidence</h3>
      <SourceEvidence key={current.sourceId} projectId={projectId} sourceId={current.sourceId} />
    </section>
  );
}
