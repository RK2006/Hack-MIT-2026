'use client';

import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { ACCEPT_DEFAULTS, REJECT_DEFAULTS } from '@/lib/review';
import { snapshotOf, type ContextNode } from '@/server/context/types';
import SourceEvidence from './SourceEvidence';
import { TypeBadge, formatDate } from './shared';

type Props = {
  projectId: string;
  nodes: ContextNode[];
  selectedNodeId: string | null;
  onSelect: (nodeId: string) => void;
  /** Open the full form (review or archive mode) for a proposal the operator wants to edit first. */
  onOpenForm: (node: ContextNode, mode: 'review' | 'archive') => void;
  onChanged: (nodeId: string) => void;
};

type Decision = 'accept' | 'reject';

/**
 * Queue of agent-authored, unreviewed claims. Accept promotes the current snapshot to canonical;
 * Reject archives it. Both write a fresh manual source with the note below, so provenance shows
 * who decided and why. Editing before accepting goes through the regular form.
 */
export default function PendingReviewList({
  projectId,
  nodes,
  selectedNodeId,
  onSelect,
  onOpenForm,
  onChanged,
}: Props) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [evidenceOpen, setEvidenceOpen] = useState<Set<string>>(() => new Set());

  const decide = async (node: ContextNode, decision: Decision) => {
    const defaults = decision === 'accept' ? ACCEPT_DEFAULTS : REJECT_DEFAULTS;
    const { sourceId: _previousSource, ...snapshot } = snapshotOf(node);
    void _previousSource;
    setBusy(node.id);
    setErrors((prev) => ({ ...prev, [node.id]: '' }));
    try {
      await api.reviseNode(projectId, node.id, {
        expectedVersion: node.current.version,
        changeReason: defaults.changeReason,
        evidenceNote: note.trim()
          ? `${defaults.evidenceNote} Note: ${note.trim()}`
          : defaults.evidenceNote,
        snapshot:
          decision === 'accept'
            ? { ...snapshot, authority: 'canonical', confidence: 1 }
            : { ...snapshot, archived: true },
      });
      onChanged(node.id);
    } catch (err) {
      setErrors((prev) => ({ ...prev, [node.id]: errorMessage(err) }));
    } finally {
      setBusy(null);
    }
  };

  if (nodes.length === 0) {
    return (
      <p className="empty">
        No proposals waiting for review. Agents add them with the MCP <code>propose_context</code>{' '}
        tool or <code>npm run propose</code>.
      </p>
    );
  }

  return (
    <div className="review-queue">
      <p className="muted">
        {nodes.length} agent {nodes.length === 1 ? 'proposal' : 'proposals'} not yet reviewed by a
        human. Accept promotes the claim to canonical; Reject archives it. Either way a new revision
        with your note is recorded and the original stays in history.
      </p>
      <label className="review-note">
        Review note (optional, recorded as evidence for every decision you make here)
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="e.g. Confirmed against staging config"
        />
      </label>
      <ul className="review-items">
        {nodes.map((node) => {
          const open = evidenceOpen.has(node.id);
          return (
            <li
              key={node.id}
              className={node.id === selectedNodeId ? 'review-item selected' : 'review-item'}
            >
              <div className="review-head">
                <button
                  type="button"
                  className="link review-title"
                  onClick={() => onSelect(node.id)}
                >
                  {node.current.title}
                </button>
                <TypeBadge type={node.type} />
                <span className="badge badge-inferred">inferred</span>
                <span className="muted small">
                  proposed by <span className="mono">{node.current.actor.label}</span> ·{' '}
                  {formatDate(node.current.createdAt)} · confidence {node.current.confidence}
                </span>
              </div>
              <p className="review-content">{node.current.summary || node.current.content}</p>
              <div className="review-actions">
                <button
                  type="button"
                  className="button-primary"
                  disabled={busy !== null}
                  onClick={() => void decide(node, 'accept')}
                >
                  {busy === node.id ? 'Saving…' : 'Accept as canonical'}
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => onOpenForm(node, 'review')}
                >
                  Edit & accept
                </button>
                <button
                  type="button"
                  className="button-danger"
                  disabled={busy !== null}
                  onClick={() => void decide(node, 'reject')}
                >
                  Reject (archive)
                </button>
                <button
                  type="button"
                  className="link"
                  aria-expanded={open}
                  onClick={() =>
                    setEvidenceOpen((prev) => {
                      const next = new Set(prev);
                      if (next.has(node.id)) next.delete(node.id);
                      else next.add(node.id);
                      return next;
                    })
                  }
                >
                  {open ? 'Hide evidence' : 'Show evidence'}
                </button>
              </div>
              {errors[node.id] ? (
                <p className="error" role="alert">
                  {errors[node.id]}
                  {errors[node.id]!.startsWith('CONFLICT')
                    ? ' — this proposal changed since the list loaded; it will refresh.'
                    : ''}
                </p>
              ) : null}
              {open ? (
                <SourceEvidence projectId={projectId} sourceId={node.current.sourceId} />
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
