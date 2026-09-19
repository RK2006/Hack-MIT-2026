'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import {
  REQUEST_LIMITS,
  type ContextBundle,
  type SelectionReason,
} from '@/server/context/compiler/types';
import { AuthorityBadge, TypeBadge } from './shared';

export type TaskPanelProps = {
  projectId: string;
  selectedNodeId: string | null;
  graphVersion: number;
  onHighlight: (nodeIds: string[], edgeIds?: string[]) => void;
  onSelectNode: (nodeId: string) => void;
};

type Result =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'error'; message: string }
  | { kind: 'bundle'; bundle: ContextBundle; graphVersion: number };

const DEFAULT_TASK = 'Fix duplicate Stripe webhook processing';

function ReasonList({
  reasons,
  titles,
  onSelectNode,
}: {
  reasons: SelectionReason[];
  titles: Map<string, string>;
  onSelectNode: (nodeId: string) => void;
}) {
  const name = (nodeId: string) => titles.get(nodeId) ?? nodeId.slice(0, 8);
  return (
    <ul className="reasons">
      {reasons.map((reason, index) => (
        <li key={index}>
          <span className={`reason-kind reason-${reason.kind}`}>
            {reason.kind.replace('_', ' ')}
          </span>{' '}
          {reason.description}
          {reason.path.length > 0 ? (
            <ol className="path">
              {reason.path.map((step) => {
                const [fromId, toId] =
                  step.traversed === 'forward'
                    ? [step.fromNodeId, step.toNodeId]
                    : [step.toNodeId, step.fromNodeId];
                return (
                  <li key={step.edgeId} className="mono small">
                    <button type="button" className="link" onClick={() => onSelectNode(fromId)}>
                      {name(fromId)}
                    </button>{' '}
                    {step.traversed === 'forward' ? '→' : '←'} {step.type}{' '}
                    {step.traversed === 'forward' ? '→' : '←'}{' '}
                    <button type="button" className="link" onClick={() => onSelectNode(toId)}>
                      {name(toId)}
                    </button>{' '}
                    <span className={`badge badge-${step.authority}`}>{step.authority} edge</span>
                  </li>
                );
              })}
            </ol>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export default function TaskPanel(props: TaskPanelProps) {
  const { projectId, selectedNodeId, graphVersion, onHighlight, onSelectNode } = props;
  const [task, setTask] = useState(DEFAULT_TASK);
  const [budget, setBudget] = useState<number>(REQUEST_LIMITS.budgetDefault);
  const [depth, setDepth] = useState<number>(REQUEST_LIMITS.depthDefault);
  const [useStart, setUseStart] = useState(false);
  const [allowDegraded, setAllowDegraded] = useState(false);
  const [result, setResult] = useState<Result>({ kind: 'idle' });
  const [copied, setCopied] = useState<'idle' | 'ok' | 'failed'>('idle');
  const requestId = useRef(0);

  // Highlights belong to the displayed bundle only; a running or failed request clears them (W7).
  useEffect(() => {
    if (result.kind === 'bundle') {
      const edgeIds = result.bundle.selected.flatMap((item) =>
        item.reasons.flatMap((reason) => reason.path.map((step) => step.edgeId)),
      );
      onHighlight(
        result.bundle.selected.map((item) => item.nodeId),
        [...new Set(edgeIds)],
      );
    } else if (result.kind !== 'idle') {
      onHighlight([]);
    }
  }, [result, onHighlight]);

  const titles = useMemo(() => {
    const map = new Map<string, string>();
    if (result.kind !== 'bundle') return map;
    for (const item of result.bundle.selected) map.set(item.nodeId, item.title);
    for (const item of result.bundle.omissions) map.set(item.nodeId, item.title);
    return map;
  }, [result]);

  const compile = async () => {
    const id = (requestId.current += 1);
    setResult({ kind: 'running' });
    setCopied('idle');
    try {
      const bundle = await api.compileContext(projectId, {
        task,
        tokenBudget: budget,
        maxDepth: depth,
        allowDegraded,
        ...(useStart && selectedNodeId ? { startNodeIds: [selectedNodeId] } : {}),
      });
      if (id === requestId.current) setResult({ kind: 'bundle', bundle, graphVersion });
    } catch (error) {
      if (id === requestId.current) setResult({ kind: 'error', message: errorMessage(error) });
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied('ok');
    } catch {
      setCopied('failed');
    }
  };

  const bundle = result.kind === 'bundle' ? result.bundle : null;
  const stale = result.kind === 'bundle' && result.graphVersion !== graphVersion;

  return (
    <section className="task-panel" aria-label="Task context">
      <h2>Task context</h2>
      <form
        className="task-form"
        onSubmit={(event) => {
          event.preventDefault();
          void compile();
        }}
      >
        <label>
          Task
          <textarea
            value={task}
            onChange={(event) => setTask(event.target.value)}
            rows={2}
            maxLength={REQUEST_LIMITS.taskMax}
            required
          />
        </label>
        <div className="task-controls">
          <label>
            Token budget
            <input
              type="number"
              min={REQUEST_LIMITS.budgetMin}
              max={REQUEST_LIMITS.budgetMax}
              step={1}
              value={budget}
              onChange={(event) => setBudget(Number(event.target.value))}
            />
          </label>
          <label>
            Depth
            <input
              type="number"
              min={0}
              max={REQUEST_LIMITS.depthMax}
              step={1}
              value={depth}
              onChange={(event) => setDepth(Number(event.target.value))}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={useStart}
              disabled={!selectedNodeId}
              onChange={(event) => setUseStart(event.target.checked)}
            />
            Start from selected node
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={allowDegraded}
              onChange={(event) => setAllowDegraded(event.target.checked)}
            />
            Allow degraded (lexical) fallback
          </label>
          <button type="submit" disabled={result.kind === 'running' || task.trim().length === 0}>
            {result.kind === 'running' ? 'Compiling…' : 'Compile context'}
          </button>
        </div>
      </form>

      {result.kind === 'running' ? (
        <p className="muted">Compiling… the first run loads the local embedding model.</p>
      ) : null}
      {result.kind === 'error' ? (
        <p className="error" role="alert">
          {result.message}
          {result.message.startsWith('EMBEDDING_UNAVAILABLE')
            ? ' — the embedding backend is unavailable; enable the degraded fallback only for debugging.'
            : ''}
        </p>
      ) : null}

      {bundle ? (
        <div className="bundle">
          {stale ? (
            <p className="warning" role="status">
              Knowledge changed since this bundle was compiled; it cites the revisions current at
              that time. Recompile to use the newest revisions.
            </p>
          ) : null}
          <dl className="bundle-metrics">
            <div>
              <dt>Status</dt>
              <dd className={bundle.status === 'ok' ? '' : 'warning'}>{bundle.status}</dd>
            </div>
            <div>
              <dt>Context tokens</dt>
              <dd>
                <strong>{bundle.tokenCount}</strong> / {bundle.tokenBudget} budget
              </dd>
            </div>
            <div>
              <dt>All active context</dt>
              <dd>
                {bundle.metrics.projectContextTokens} tokens (measured, full text of every active
                node)
              </dd>
            </div>
            <div>
              <dt>Selected</dt>
              <dd>
                {bundle.selected.length} of {bundle.metrics.activeNodes} active nodes ·{' '}
                {bundle.metrics.seeds} seeds · {bundle.metrics.candidates} candidates
              </dd>
            </div>
            <div>
              <dt>Tokenizer / model</dt>
              <dd className="mono">
                {bundle.tokenizer} · {bundle.embeddingModel}
                <span className="muted"> (counts hold for this tokenizer only)</span>
              </dd>
            </div>
          </dl>

          {bundle.warnings.length > 0 ? (
            <ul className="warnings">
              {bundle.warnings.map((warning) => (
                <li key={warning} className="warning">
                  {warning}
                </li>
              ))}
            </ul>
          ) : null}

          <h3>Selected context ({bundle.selected.length})</h3>
          {bundle.selected.length === 0 ? (
            <p className="empty">No relevant context was selected for this task.</p>
          ) : (
            <ol className="selected">
              {bundle.selected.map((item) => (
                <li key={item.nodeId}>
                  <div className="selected-head">
                    <button
                      type="button"
                      className="link"
                      onClick={() => onSelectNode(item.nodeId)}
                    >
                      {item.title}
                    </button>
                    <TypeBadge type={item.type} />
                    <AuthorityBadge authority={item.authority} />
                    <span className="muted mono">
                      v{item.version} · {item.representation} · score {item.score.toFixed(2)}
                    </span>
                  </div>
                  <ReasonList reasons={item.reasons} titles={titles} onSelectNode={onSelectNode} />
                  <div className="muted mono small">source {item.sourceUri}</div>
                </li>
              ))}
            </ol>
          )}

          {bundle.omissions.length > 0 ? (
            <>
              <h3>Omitted ({bundle.omissions.length})</h3>
              <ul className="omissions">
                {bundle.omissions.map((omission) => (
                  <li key={`${omission.nodeId}-${omission.version}`}>
                    <button
                      type="button"
                      className="link"
                      onClick={() => onSelectNode(omission.nodeId)}
                    >
                      {omission.title}
                    </button>{' '}
                    <span className="muted">
                      v{omission.version} · {omission.reason}
                      {omission.critical ? ' · critical' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          <div className="context-text-head">
            <h3>Context text (exact, {bundle.tokenCount} tokens)</h3>
            <button type="button" onClick={() => void copy(bundle.contextText)}>
              Copy
            </button>
            {copied === 'ok' ? <span className="muted">Copied</span> : null}
            {copied === 'failed' ? (
              <span className="warning">Clipboard unavailable — select the text below</span>
            ) : null}
          </div>
          <textarea className="context-text mono" readOnly value={bundle.contextText} rows={14} />
        </div>
      ) : null}
    </section>
  );
}
