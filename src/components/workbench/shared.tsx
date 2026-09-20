import type { Authority, NodeType } from '@/server/context/types';

// Ink-like tones for the sage paper surfaces; the amber task highlight and the rust accent
// are deliberately not reused here so a highlighted node is never confused with a node type.
export const NODE_COLORS: Record<NodeType, string> = {
  component: '#2b5f8e',
  file: '#6f7a72',
  decision: '#5a4b8f',
  constraint: '#a03a3a',
  assumption: '#7d6a2a',
  discovery: '#1f7a72',
  bug: '#a3427c',
};

export function AuthorityBadge({ authority }: { authority: Authority }) {
  return <span className={`badge badge-${authority}`}>{authority}</span>;
}

export function TypeBadge({ type }: { type: NodeType }) {
  return (
    <span className="badge badge-type" style={{ borderColor: NODE_COLORS[type] }}>
      <span className="swatch" style={{ background: NODE_COLORS[type] }} aria-hidden="true" />
      {type}
    </span>
  );
}

export const formatDate = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
};

export const truncate = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;
