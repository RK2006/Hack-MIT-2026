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
  const confidence = Math.round(current.confidence * 100);

  return (
    <section className="detail" aria-label="Node detail">
      <header className="detail-hero">
        <div className="badges">
          <TypeBadge type={node.type} />
          <AuthorityBadge authority={current.authority} />
          {current.archived ? <span className="badge badge-archived">archived</span> : null}
          <span className="badge">v{current.version}</span>
        </div>
        <h2>{current.title}</h2>
        <p className="detail-summary">
          {current.summary || <span className="muted">No summary has been added.</span>}
        </p>
        <p className="detail-updated">
          Updated by <strong>{current.actor.label}</strong> · {formatDate(current.createdAt)}
        </p>

        <div className="actions detail-actions">
          {current.authority === 'inferred' ? (
            <button type="button" className="button-primary" onClick={() => onAction('review')}>
              Review as canonical
            </button>
          ) : null}
          <button
            type="button"
            className={current.authority === 'inferred' ? undefined : 'button-primary'}
            onClick={() => onAction('edit')}
          >
            Edit
          </button>
          <button type="button" onClick={onHistory}>
            History
          </button>
          {current.archived ? (
            <button type="button" onClick={() => onAction('restore')}>
              Restore
            </button>
          ) : (
            <button
              type="button"
              className="button-danger-ghost"
              onClick={() => onAction('archive')}
            >
              Archive
            </button>
          )}
        </div>
      </header>

      <section className="detail-card" aria-labelledby="overview-heading">
        <div className="section-heading">
          <div>
            <span className="section-kicker">At a glance</span>
            <h3 id="overview-heading">Overview</h3>
          </div>
        </div>
        <div className="metric-grid">
          <div className="metric">
            <span className="metric-label">Importance</span>
            <span className="importance-pips" aria-label={`${current.importance} out of 5`}>
              {Array.from({ length: 5 }, (_, index) => (
                <span
                  key={index}
                  className={index < current.importance ? 'pip pip-active' : 'pip'}
                  aria-hidden="true"
                />
              ))}
            </span>
          </div>
          <div className="metric">
            <span className="metric-label">Confidence</span>
            <strong className="metric-value">{confidence}%</strong>
            <span className="confidence-track" aria-hidden="true">
              <span style={{ width: `${confidence}%` }} />
            </span>
          </div>
          <div className="metric">
            <span className="metric-label">Authority</span>
            <strong className="metric-value metric-value-capitalize">{current.authority}</strong>
          </div>
        </div>
      </section>

      <section className="detail-card" aria-labelledby="content-heading">
        <div className="section-heading">
          <div>
            <span className="section-kicker">Current knowledge</span>
            <h3 id="content-heading">Content</h3>
          </div>
        </div>
        <div className="detail-prose">{current.content}</div>
      </section>

      <section className="detail-card" aria-labelledby="relationships-heading">
        <div className="section-heading">
          <div>
            <span className="section-kicker">Connected context</span>
            <h3 id="relationships-heading">Relationships</h3>
          </div>
          <span className="section-count">{related.length}</span>
        </div>
        {related.length === 0 ? (
          <p className="muted section-empty">
            No active relationships.
            {current.archived ? ' Edges touching archived nodes are hidden from the graph.' : ''}
          </p>
        ) : (
          <ul className="relations">
            {related.map((edge) => {
              const outgoing = edge.fromNodeId === node.id;
              const otherId = outgoing ? edge.toNodeId : edge.fromNodeId;
              const other = nodesById.get(otherId);
              return (
                <li key={edge.id} className={`relation relation-${edge.authority}`}>
                  <div className="relation-direction" aria-hidden="true">
                    {outgoing ? '→' : '←'}
                  </div>
                  <div className="relation-body">
                    <div className="relation-type">
                      {outgoing ? 'Outgoing' : 'Incoming'} · {edge.type.replaceAll('_', ' ')}
                    </div>
                    <button
                      type="button"
                      className="link relation-title"
                      onClick={() => onSelectNode(otherId)}
                    >
                      {other?.current.title ?? otherId}
                    </button>
                    <div className="relation-badges">
                      <span className="relation-badge-label">
                        Edge <AuthorityBadge authority={edge.authority} />
                      </span>
                      {other ? (
                        <span className="relation-badge-label">
                          Node <AuthorityBadge authority={other.current.authority} />
                        </span>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="detail-card" aria-labelledby="evidence-heading">
        <div className="section-heading">
          <div>
            <span className="section-kicker">Provenance</span>
            <h3 id="evidence-heading">Source evidence</h3>
          </div>
        </div>
        <SourceEvidence key={current.sourceId} projectId={projectId} sourceId={current.sourceId} />
      </section>

      <details className="technical-details">
        <summary>Technical details</summary>
        <dl className="fields detail-meta">
          <dt>Node ID</dt>
          <dd className="mono">{node.id}</dd>
          <dt>External key</dt>
          <dd className="mono">{node.externalKey ?? '—'}</dd>
          <dt>Path</dt>
          <dd className="mono">{node.path ?? '—'}</dd>
          <dt>Actor</dt>
          <dd>
            {current.actor.kind}: {current.actor.label}
          </dd>
          <dt>Change reason</dt>
          <dd>{current.changeReason}</dd>
          <dt>Revision</dt>
          <dd>
            v{current.version} · {formatDate(current.createdAt)}
          </dd>
        </dl>
      </details>
    </section>
  );
}
