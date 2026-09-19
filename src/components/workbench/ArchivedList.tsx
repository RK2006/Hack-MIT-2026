'use client';

import type { ContextNode } from '@/server/context/types';
import { AuthorityBadge, TypeBadge, formatDate } from './shared';

type Props = {
  nodes: ContextNode[] | null;
  error: string | null;
  selectedNodeId: string | null;
  onSelect: (nodeId: string) => void;
};

export default function ArchivedList({ nodes, error, selectedNodeId, onSelect }: Props) {
  if (error) return <p className="error">{error}</p>;
  if (!nodes) return <p className="muted">Loading archived nodes…</p>;
  if (nodes.length === 0) return <p className="empty">No archived nodes.</p>;
  return (
    <table className="archived">
      <thead>
        <tr>
          <th>Title</th>
          <th>Type</th>
          <th>Authority</th>
          <th>v</th>
          <th>Archived reason</th>
          <th>When</th>
        </tr>
      </thead>
      <tbody>
        {nodes.map((node) => (
          <tr key={node.id} className={node.id === selectedNodeId ? 'selected' : ''}>
            <td>
              <button type="button" className="link" onClick={() => onSelect(node.id)}>
                {node.current.title}
              </button>
            </td>
            <td>
              <TypeBadge type={node.type} />
            </td>
            <td>
              <AuthorityBadge authority={node.current.authority} />
            </td>
            <td>{node.current.version}</td>
            <td>{node.current.changeReason}</td>
            <td>{formatDate(node.current.createdAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
