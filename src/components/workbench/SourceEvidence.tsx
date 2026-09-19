'use client';

import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { isSafeLink } from '@/lib/layout';
import type { Source } from '@/server/context/types';

/** Renders a source locator as a link only for https:; other schemes stay plain text. */
export function Locator({ uri }: { uri: string }) {
  return isSafeLink(uri) ? (
    <a href={uri} target="_blank" rel="noreferrer noopener">
      {uri}
    </a>
  ) : (
    <span className="mono">{uri}</span>
  );
}

export function SourceCard({ source }: { source: Source }) {
  return (
    <dl className="source">
      <dt>Kind</dt>
      <dd>{source.kind}</dd>
      <dt>Label</dt>
      <dd>{source.label}</dd>
      <dt>Locator</dt>
      <dd>
        <Locator uri={source.uri} />
      </dd>
      <dt>Pinned ref</dt>
      <dd className="mono">{source.revisionRef ?? '—'}</dd>
      <dt>Recorded</dt>
      <dd>{new Date(source.createdAt).toLocaleString()}</dd>
      <dt>Excerpt</dt>
      <dd>
        <pre className="excerpt">{source.excerpt}</pre>
      </dd>
    </dl>
  );
}

/** Loads a source on demand; a failed load is visible and retryable. */
export default function SourceEvidence({
  projectId,
  sourceId,
}: {
  projectId: string;
  sourceId: string;
}) {
  const [source, setSource] = useState<Source | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setSource(await api.getSource(projectId, sourceId));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  if (source) return <SourceCard source={source} />;
  return (
    <div className="source-loader">
      <span className="mono muted">{sourceId}</span>{' '}
      <button type="button" onClick={load} disabled={loading}>
        {loading ? 'Loading…' : error ? 'Retry' : 'Load source'}
      </button>
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
