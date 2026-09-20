'use client';

import { useMemo, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import {
  EXCERPT_PREVIEW_LINES,
  excerptLineCount,
  parseExcerpt,
  parseInline,
  previewExcerpt,
  stripModelPrefix,
  type ExcerptBlock,
} from '@/lib/excerpt';
import { isSafeLink } from '@/lib/layout';
import type { Source } from '@/server/context/types';

const KIND_LABEL: Record<Source['kind'], string> = {
  manual: 'Operator note',
  repository: 'Repository evidence',
  agent: 'Input the agent analyzed',
};

/** Inline Markdown as React text nodes only: bold and code, never HTML or links. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((span, index) =>
        span.kind === 'strong' ? (
          <strong key={index}>{span.text}</strong>
        ) : span.kind === 'code' ? (
          <code key={index}>{span.text}</code>
        ) : (
          span.text
        ),
      )}
    </>
  );
}

function ExcerptBlocks({ blocks }: { blocks: ExcerptBlock[] }) {
  return (
    <>
      {blocks.map((block, index) => {
        switch (block.kind) {
          case 'heading':
            return block.level <= 2 ? (
              <h4 key={index}>
                <Inline text={block.text} />
              </h4>
            ) : (
              <h5 key={index}>
                <Inline text={block.text} />
              </h5>
            );
          case 'quote':
            return (
              <blockquote key={index}>
                <Inline text={block.text} />
              </blockquote>
            );
          case 'list': {
            const items = block.items.map((item, i) => (
              <li key={i}>
                <Inline text={item} />
              </li>
            ));
            return block.ordered ? <ol key={index}>{items}</ol> : <ul key={index}>{items}</ul>;
          }
          case 'code':
            return <pre key={index}>{block.text}</pre>;
          default:
            return (
              <p key={index}>
                <Inline text={block.text} />
              </p>
            );
        }
      })}
    </>
  );
}

/** Structured, collapsible rendering of a stored excerpt; the stored text is never altered. */
export function Excerpt({ source }: { source: Source }) {
  const [expanded, setExpanded] = useState(false);
  const blocks = useMemo(
    () => parseExcerpt(source.kind === 'agent' ? stripModelPrefix(source.excerpt) : source.excerpt),
    [source],
  );
  const total = excerptLineCount(blocks);
  const collapsible = total > EXCERPT_PREVIEW_LINES;
  const shown = collapsible && !expanded ? previewExcerpt(blocks) : blocks;
  const single = blocks.length === 1 && blocks[0]?.kind === 'paragraph';
  return (
    <div className={`excerpt${single ? ' excerpt-single' : ''}`}>
      <ExcerptBlocks blocks={shown} />
      {collapsible ? (
        <button
          type="button"
          className="link excerpt-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Show less' : `Show full excerpt (${total} lines)`}
        </button>
      ) : null}
    </div>
  );
}

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
          <span className="section-kicker">{KIND_LABEL[source.kind]}</span>
          <h4>{source.label}</h4>
        </div>
        <span className="source-recorded">{new Date(source.createdAt).toLocaleDateString()}</span>
      </header>
      <div className="source-locator">
        <Locator uri={source.uri} />
        {source.revisionRef ? <span className="badge mono">ref {source.revisionRef}</span> : null}
      </div>
      <Excerpt source={source} />
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
