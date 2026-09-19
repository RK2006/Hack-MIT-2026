'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { compareRevisions } from '@/lib/compare';
import type { NodeRevision } from '@/server/context/types';
import SourceEvidence from './SourceEvidence';
import { AuthorityBadge, formatDate } from './shared';

type Props = {
  projectId: string;
  nodeId: string;
  nodeTitle: string;
  graphVersion: number;
  onClose: () => void;
};

const render = (value: unknown): string =>
  typeof value === 'string' ? value : value === undefined ? '—' : JSON.stringify(value);

export default function HistoryPanel({
  projectId,
  nodeId,
  nodeTitle,
  graphVersion,
  onClose,
}: Props) {
  const [revisions, setRevisions] = useState<NodeRevision[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const [right, setRight] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api
      .listRevisions(projectId, nodeId)
      .then(({ revisions: list }) => {
        if (cancelled) return;
        setRevisions(list);
        // Default to comparing the two most recent versions.
        const latest = list[list.length - 1]?.version ?? null;
        const previous = list[list.length - 2]?.version ?? latest;
        setLeft(previous);
        setRight(latest);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, nodeId, graphVersion]);

  const byVersion = useMemo(
    () => new Map((revisions ?? []).map((rev) => [rev.version, rev] as const)),
    [revisions],
  );
  const a = left !== null ? byVersion.get(left) : undefined;
  const b = right !== null ? byVersion.get(right) : undefined;
  const comparison = a && b ? compareRevisions(a, b) : null;

  return (
    <section className="history" aria-label="Revision history">
      <header className="detail-header">
        <h2>History: {nodeTitle}</h2>
        <button type="button" onClick={onClose}>
          Back to detail
        </button>
      </header>
      <p className="muted">
        History is per node. It does not show what the rest of the graph looked like at the time.
        Comparing never writes.
      </p>
      {error ? <p className="error">{error}</p> : null}
      {!revisions && !error ? <p className="muted">Loading revisions…</p> : null}
      {revisions ? (
        <>
          <table>
            <thead>
              <tr>
                <th>A</th>
                <th>B</th>
                <th>Version</th>
                <th>Authority</th>
                <th>Actor</th>
                <th>Reason</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {revisions.map((rev) => (
                <tr key={rev.version}>
                  <td>
                    <input
                      type="radio"
                      name="rev-a"
                      aria-label={`Compare A: version ${rev.version}`}
                      checked={left === rev.version}
                      onChange={() => setLeft(rev.version)}
                    />
                  </td>
                  <td>
                    <input
                      type="radio"
                      name="rev-b"
                      aria-label={`Compare B: version ${rev.version}`}
                      checked={right === rev.version}
                      onChange={() => setRight(rev.version)}
                    />
                  </td>
                  <td>
                    v{rev.version}
                    {rev.archived ? ' (archived)' : ''}
                  </td>
                  <td>
                    <AuthorityBadge authority={rev.authority} />
                  </td>
                  <td>
                    {rev.actor.kind}: {rev.actor.label}
                  </td>
                  <td>{rev.changeReason}</td>
                  <td>{formatDate(rev.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {comparison && a && b ? (
            <>
              <h3>
                Comparison: v{a.version} → v{b.version}
                {a.version === b.version ? ' (same version)' : ''}
              </h3>
              <table className="compare">
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>v{a.version}</th>
                    <th>v{b.version}</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.map((row) => (
                    <tr key={row.field} className={row.changed ? 'changed' : ''}>
                      <td>
                        {row.field}
                        {row.changed ? <span className="badge badge-changed">changed</span> : null}
                      </td>
                      <td>
                        <pre>{render(row.before)}</pre>
                      </td>
                      <td>
                        <pre>{render(row.after)}</pre>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="sources-two">
                <div>
                  <h4>Source of v{a.version}</h4>
                  <SourceEvidence key={a.sourceId} projectId={projectId} sourceId={a.sourceId} />
                </div>
                <div>
                  <h4>Source of v{b.version}</h4>
                  <SourceEvidence key={b.sourceId} projectId={projectId} sourceId={b.sourceId} />
                </div>
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
