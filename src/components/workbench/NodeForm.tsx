'use client';

import { useState, type FormEvent } from 'react';
import { api, ApiError, errorMessage } from '@/lib/api';
import {
  AUTHORITIES,
  EDGE_TYPES,
  NODE_TYPES,
  type Authority,
  type ContextNode,
  type EdgeType,
  type NodeType,
} from '@/server/context/types';
import type { CreateNodeRequest, ReviseNodeRequest } from '@/server/workbench/mutations';
import type { NodeAction } from './NodeDetail';

export type FormMode =
  | { kind: 'create'; selectedNode: ContextNode | null }
  | {
      kind: NodeAction;
      node: ContextNode;
    };

type Draft = {
  type: NodeType;
  title: string;
  content: string;
  summary: string;
  authority: Authority;
  importance: string;
  confidence: string;
  externalKey: string;
  path: string;
  archived: boolean;
  changeReason: string;
  evidenceNote: string;
  withEdge: boolean;
  edgeType: EdgeType;
  edgeDirection: 'outgoing' | 'incoming';
  edgeAuthority: Authority;
};

const DEFAULT_REASON: Record<NodeAction, string> = {
  edit: '',
  review: 'Reviewed and promoted to canonical',
  archive: '',
  restore: '',
};

function seed(mode: FormMode): Draft {
  if (mode.kind === 'create') {
    return {
      type: 'decision',
      title: '',
      content: '',
      summary: '',
      authority: 'canonical',
      importance: '3',
      confidence: '1',
      externalKey: '',
      path: '',
      archived: false,
      changeReason: '',
      evidenceNote: '',
      withEdge: mode.selectedNode !== null,
      edgeType: 'RELATED_TO',
      edgeDirection: 'outgoing',
      edgeAuthority: 'canonical',
    };
  }
  const c = mode.node.current;
  return {
    type: mode.node.type,
    title: c.title,
    content: c.content,
    summary: c.summary,
    authority: mode.kind === 'review' ? 'canonical' : c.authority,
    importance: String(c.importance),
    confidence: mode.kind === 'review' && c.authority === 'inferred' ? '1' : String(c.confidence),
    externalKey: mode.node.externalKey ?? '',
    path: mode.node.path ?? '',
    archived: mode.kind === 'archive' ? true : mode.kind === 'restore' ? false : c.archived,
    changeReason: DEFAULT_REASON[mode.kind],
    evidenceNote: '',
    withEdge: false,
    edgeType: 'RELATED_TO',
    edgeDirection: 'outgoing',
    edgeAuthority: 'canonical',
  };
}

const TITLES: Record<FormMode['kind'], string> = {
  create: 'New node',
  edit: 'Edit node',
  review: 'Review as canonical',
  archive: 'Archive node',
  restore: 'Restore node',
};

type Props = {
  projectId: string;
  mode: FormMode;
  onSaved: (nodeId: string) => void;
  onCancel: () => void;
};

export default function NodeForm({ projectId, mode, onSaved, onCancel }: Props) {
  const [draft, setDraft] = useState<Draft>(() => seed(mode));
  const [expectedVersion, setExpectedVersion] = useState(
    mode.kind === 'create' ? 1 : mode.node.current.version,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const conflict =
    error instanceof ApiError && error.code === 'CONFLICT'
      ? (error.details as { expected?: number; actual?: number } | undefined)
      : null;

  const reloadCurrent = async () => {
    if (mode.kind === 'create') return;
    setBusy(true);
    try {
      const fresh = await api.getNode(projectId, mode.node.id);
      // Keep the operator's draft; only the expected version moves forward so the save can be retried
      // deliberately against the newer knowledge (never silently over it).
      setExpectedVersion(fresh.current.version);
      setError(null);
      setNotice(
        `Reloaded: current version is now ${fresh.current.version} ("${fresh.current.title}"). Your draft was kept; review it against the current node before saving.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const importance = Number(draft.importance);
      const confidence = Number(draft.confidence);
      if (mode.kind === 'create') {
        const payload: CreateNodeRequest = {
          evidenceNote: draft.evidenceNote,
          changeReason: draft.changeReason,
          node: {
            type: draft.type,
            title: draft.title,
            content: draft.content,
            summary: draft.summary,
            authority: draft.authority,
            importance,
            confidence,
            externalKey: draft.externalKey.trim() ? draft.externalKey : null,
            path: draft.type === 'file' && draft.path.trim() ? draft.path : null,
          },
        };
        if (draft.withEdge && mode.selectedNode) {
          payload.edge = {
            otherNodeId: mode.selectedNode.id,
            type: draft.edgeType,
            direction: draft.edgeDirection,
            authority: draft.edgeAuthority,
          };
        }
        const result = await api.createNode(projectId, payload);
        onSaved(result.node.id);
      } else {
        const payload: ReviseNodeRequest = {
          evidenceNote: draft.evidenceNote,
          changeReason: draft.changeReason,
          expectedVersion,
          snapshot: {
            title: draft.title,
            content: draft.content,
            summary: draft.summary,
            authority: draft.authority,
            importance,
            confidence,
            archived: draft.archived,
          },
        };
        const result = await api.reviseNode(projectId, mode.node.id, payload);
        if (!result.changed) {
          setNotice('No snapshot fields changed; no new revision was recorded.');
          setBusy(false);
          return;
        }
        onSaved(result.node.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      setBusy(false);
    }
  };

  const issues =
    error instanceof ApiError && Array.isArray(error.details?.issues)
      ? (error.details.issues as Array<{ path: string; message: string }>)
      : [];
  const isToggle = mode.kind === 'archive' || mode.kind === 'restore';

  return (
    <form className="node-form panel-stack" onSubmit={submit} aria-label={TITLES[mode.kind]}>
      <header className="panel-heading">
        <div>
          <span className="section-kicker">Context editor</span>
          <h2>{TITLES[mode.kind]}</h2>
          {mode.kind !== 'create' ? (
            <p className="panel-intro">
              {mode.node.current.title} · editing from version {expectedVersion}
            </p>
          ) : (
            <p className="panel-intro">Add durable, sourced knowledge to this project.</p>
          )}
        </div>
      </header>

      {mode.kind === 'create' ? (
        <label>
          Type
          <select value={draft.type} onChange={(e) => set('type', e.target.value as NodeType)}>
            {NODE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {!isToggle ? (
        <>
          <label>
            Title
            <input value={draft.title} onChange={(e) => set('title', e.target.value)} required />
          </label>
          <label>
            Content
            <textarea
              value={draft.content}
              rows={6}
              onChange={(e) => set('content', e.target.value)}
              required
            />
          </label>
          <label>
            Summary
            <textarea
              value={draft.summary}
              rows={2}
              onChange={(e) => set('summary', e.target.value)}
            />
          </label>
          <div className="row">
            <label>
              Authority
              <select
                value={draft.authority}
                onChange={(e) => set('authority', e.target.value as Authority)}
              >
                {AUTHORITIES.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Importance (1–5)
              <input
                type="number"
                min={1}
                max={5}
                step={1}
                value={draft.importance}
                onChange={(e) => set('importance', e.target.value)}
              />
            </label>
            <label>
              Confidence (0–1)
              <input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={draft.confidence}
                onChange={(e) => set('confidence', e.target.value)}
              />
            </label>
          </div>
          {mode.kind === 'create' ? (
            <div className="row">
              <label>
                External key (optional)
                <input
                  value={draft.externalKey}
                  onChange={(e) => set('externalKey', e.target.value)}
                />
              </label>
              {draft.type === 'file' ? (
                <label>
                  Path (required for files)
                  <input value={draft.path} onChange={(e) => set('path', e.target.value)} />
                </label>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <p>
          This will set <code>archived</code> to <strong>{String(draft.archived)}</strong> on a new
          revision. Existing history stays readable.
        </p>
      )}

      {mode.kind === 'create' && mode.selectedNode ? (
        <fieldset>
          <legend>
            <label>
              <input
                type="checkbox"
                checked={draft.withEdge}
                onChange={(e) => set('withEdge', e.target.checked)}
              />{' '}
              Connect to “{mode.selectedNode.current.title}”
            </label>
          </legend>
          {draft.withEdge ? (
            <div className="row">
              <label>
                Direction
                <select
                  value={draft.edgeDirection}
                  onChange={(e) => set('edgeDirection', e.target.value as 'outgoing' | 'incoming')}
                >
                  <option value="outgoing">new node → selected</option>
                  <option value="incoming">selected → new node</option>
                </select>
              </label>
              <label>
                Edge type
                <select
                  value={draft.edgeType}
                  onChange={(e) => set('edgeType', e.target.value as EdgeType)}
                >
                  {EDGE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Edge authority
                <select
                  value={draft.edgeAuthority}
                  onChange={(e) => set('edgeAuthority', e.target.value as Authority)}
                >
                  {AUTHORITIES.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
        </fieldset>
      ) : null}

      <label>
        Change reason
        <input
          value={draft.changeReason}
          onChange={(e) => set('changeReason', e.target.value)}
          required
          maxLength={500}
        />
      </label>
      <label>
        Evidence note (stored as a fresh manual source)
        <textarea
          value={draft.evidenceNote}
          rows={3}
          onChange={(e) => set('evidenceNote', e.target.value)}
          required
        />
      </label>

      {conflict ? (
        <div className="error-box" role="alert">
          <strong>Conflict:</strong> you edited version {conflict.expected ?? expectedVersion}, but
          the node is now at version {conflict.actual ?? '?'}. Nothing was written. Your draft is
          kept.{' '}
          <button type="button" onClick={reloadCurrent} disabled={busy}>
            Reload current
          </button>
        </div>
      ) : error ? (
        <div className="error-box" role="alert">
          <strong>{errorMessage(error)}</strong>
          {issues.length ? (
            <ul>
              {issues.map((issue, i) => (
                <li key={i}>
                  <code>{issue.path || '(root)'}</code>: {issue.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {notice ? <p className="notice">{notice}</p> : null}

      <div className="actions">
        <button type="submit" className="button-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="button-secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
