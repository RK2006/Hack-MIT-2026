import type { Authority, NodeType } from '@/server/context/types';

export const NODE_COLORS: Record<NodeType, string> = {
  component: '#2563eb',
  file: '#6b7280',
  decision: '#7c3aed',
  constraint: '#dc2626',
  assumption: '#d97706',
  discovery: '#0891b2',
  bug: '#db2777',
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
