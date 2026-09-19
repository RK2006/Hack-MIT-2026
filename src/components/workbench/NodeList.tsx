'use client';

import { useMemo, useState } from 'react';
import { NODE_TYPES, type ContextNode, type NodeType } from '@/server/context/types';
import { AuthorityBadge, TypeBadge, truncate } from './shared';

type Props = {
  nodes: ContextNode[];
  selectedNodeId: string | null;
  highlightedNodeIds: Set<string>;
  onSelect: (nodeId: string) => void;
};

export default function NodeList({ nodes, selectedNodeId, highlightedNodeIds, onSelect }: Props) {
  const [type, setType] = useState<NodeType | 'all'>('all');
  const [text, setText] = useState('');

  const filtered = useMemo(() => {
    const needle = text.trim().toLowerCase();
    return nodes
      .filter((node) => type === 'all' || node.type === type)
      .filter(
        (node) =>
          !needle ||
          node.current.title.toLowerCase().includes(needle) ||
          node.current.summary.toLowerCase().includes(needle) ||
          node.current.content.toLowerCase().includes(needle) ||
          (node.path ?? '').toLowerCase().includes(needle) ||
          (node.externalKey ?? '').toLowerCase().includes(needle),
      )
      .sort((a, b) => a.current.title.localeCompare(b.current.title));
  }, [nodes, type, text]);

  return (
    <div className="node-list">
      <div className="filters">
        <label>
          Type{' '}
          <select
            value={type}
            onChange={(event) => setType(event.target.value as NodeType | 'all')}
          >
            <option value="all">all</option>
            {NODE_TYPES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label>
          Filter{' '}
          <input
            type="search"
            value={text}
            placeholder="title, summary, content, path…"
            onChange={(event) => setText(event.target.value)}
          />
        </label>
        <span className="muted">
          {filtered.length} of {nodes.length}
        </span>
      </div>
      {filtered.length === 0 ? (
        <p className="empty">No nodes match the current filter.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Type</th>
              <th>Authority</th>
              <th>v</th>
              <th>Summary</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((node) => {
              const classes = [
                node.id === selectedNodeId ? 'selected' : '',
                highlightedNodeIds.has(node.id) ? 'highlighted' : '',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <tr key={node.id} className={classes}>
                  <td>
                    <button type="button" className="link" onClick={() => onSelect(node.id)}>
                      {node.current.title}
                    </button>
                    {highlightedNodeIds.has(node.id) ? (
                      <span className="badge badge-highlight">selected by task</span>
                    ) : null}
                  </td>
                  <td>
                    <TypeBadge type={node.type} />
                  </td>
                  <td>
                    <AuthorityBadge authority={node.current.authority} />
                  </td>
                  <td>{node.current.version}</td>
                  <td className="muted">{truncate(node.current.summary, 90)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
