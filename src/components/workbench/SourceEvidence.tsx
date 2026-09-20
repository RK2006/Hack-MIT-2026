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
    <article className="source-card">
      <header className="source-card-header">
        <div>
          <span className="section-kicker">{source.kind} source</span>
          <h4>{source.label}</h4>
        </div>
        <span className="source-recorded">{new Date(source.createdAt).toLocaleDateString()}</span>
      </header>
      <div className="source-locator">
        <Locator uri={source.uri} />
        {source.revisionRef ? <span className="badge mono">ref {source.revisionRef}</span> : null}
      </div>
      <blockquote className="excerpt">{source.excerpt}</blockquote>
    </article>
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
      <div>
        <strong>Evidence is available</strong>
        <span className="source-loader-id mono">{sourceId}</span>
      </div>
      <button type="button" className="button-secondary" onClick={load} disabled={loading}>
        {loading ? 'Loading…' : error ? 'Retry' : 'Load source'}
      </button>
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
