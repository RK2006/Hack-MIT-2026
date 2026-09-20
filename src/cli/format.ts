import type { FieldComparison } from '../lib/compare';
import { parseExcerpt, stripModelPrefix, type ExcerptBlock } from '../lib/excerpt';
import { isPendingReview } from '../lib/review';
import type { ContextBundle, SelectionReason } from '../server/context/compiler/types';
import type {
  ContextNode,
  GraphSnapshot,
  NodeRevision,
  Project,
  Source,
} from '../server/context/types';
import { shortId } from './refs';

/** Left-aligned columns; the last column is never padded so long titles do not trail spaces. */
export function table(rows: string[][], header?: string[]): string {
  const all = header ? [header, ...rows] : rows;
  if (all.length === 0) return '';
  const width = all[0]!.map((_, col) => Math.max(...all.map((row) => (row[col] ?? '').length)));
  return all
    .map((row) =>
      row
        .map((cell, col) => (col === row.length - 1 ? cell : cell.padEnd(width[col]!)))
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}

const day = (iso: string) => iso.slice(0, 10);
const ref = (node: ContextNode) => node.externalKey ?? node.path ?? shortId(node.id);

export function formatProjects(projects: Project[], boundId: string | null): string {
  return table(
    projects.map((project) => [
      project.id === boundId ? '*' : ' ',
      project.id,
      day(project.createdAt),
      project.name,
    ]),
    [' ', 'ID', 'CREATED', 'NAME'],
  );
}

export function formatStatus(graph: GraphSnapshot, archived: ContextNode[]): string {
  const nodes = graph.nodes;
  const canonical = nodes.filter((node) => node.current.authority === 'canonical').length;
  const pending = nodes.filter(isPendingReview).length;
  return [
    `${graph.project.name}  ${shortId(graph.project.id)}…`,
    `  ${nodes.length} active nodes · ${graph.edges.length} relationships · ${canonical} canonical · ${
      nodes.length - canonical
    } inferred · ${pending} pending review · ${archived.length} archived`,
  ].join('\n');
}

export function formatNodeTable(nodes: ContextNode[]): string {
  if (nodes.length === 0) return '(no nodes)';
  return table(
    nodes.map((node) => [
      shortId(node.id),
      node.type,
      node.current.authority,
      `v${node.current.version}`,
      node.current.title,
    ]),
    ['ID', 'TYPE', 'AUTH', 'V', 'TITLE'],
  );
}

export function formatExcerpt(blocks: ExcerptBlock[], indent = '    '): string {
  return blocks
    .map((block) => {
      switch (block.kind) {
        case 'heading':
          return `${indent}${block.level <= 2 ? block.text.toUpperCase() : block.text}:`;
        case 'quote':
          return `${indent}> ${block.text}`;
        case 'list':
          return block.items
            .map((item, i) => `${indent}${block.ordered ? `${i + 1}.` : '-'} ${item}`)
            .join('\n');
        case 'code':
          return block.text
            .split('\n')
            .map((line) => `${indent}  ${line}`)
            .join('\n');
        default:
          return `${indent}${block.text}`;
      }
    })
    .join('\n');
}

export function formatSource(source: Source): string {
  const excerpt = source.kind === 'agent' ? stripModelPrefix(source.excerpt) : source.excerpt;
  return [
    `Source ${source.id}`,
    `  kind: ${source.kind}   label: ${source.label}`,
    `  uri: ${source.uri}${source.revisionRef ? `   ref: ${source.revisionRef}` : ''}`,
    `  recorded: ${day(source.createdAt)}`,
    '  excerpt:',
    formatExcerpt(parseExcerpt(excerpt)),
  ].join('\n');
}

export function formatNode(node: ContextNode, graph: GraphSnapshot, source: Source | null): string {
  const c = node.current;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const related = graph.edges.filter((e) => e.fromNodeId === node.id || e.toNodeId === node.id);
  const lines = [
    `${c.title}`,
    `  ${node.type} · ${c.authority} · v${c.version}${c.archived ? ' · archived' : ''} · importance ${c.importance} · confidence ${c.confidence}`,
    `  id: ${node.id}`,
  ];
  if (node.externalKey) lines.push(`  key: ${node.externalKey}`);
  if (node.path) lines.push(`  path: ${node.path}`);
  lines.push(`  by: ${c.actor.kind} ${c.actor.label} · ${day(c.createdAt)} · ${c.changeReason}`);
  if (c.summary) lines.push('', `  ${c.summary}`);
  lines.push('', ...c.content.split('\n').map((line) => `  ${line}`));
  lines.push('', `Relationships (${related.length})`);
  if (related.length === 0) {
    lines.push(
      c.archived ? '  (edges touching archived nodes are hidden)' : '  (no active relationships)',
    );
  }
  for (const edge of related) {
    const outgoing = edge.fromNodeId === node.id;
    const other = byId.get(outgoing ? edge.toNodeId : edge.fromNodeId);
    const name = other ? `${other.current.title} [${ref(other)}]` : shortId(edge.toNodeId);
    lines.push(
      outgoing
        ? `  this → ${edge.type} → ${name} (${edge.authority})`
        : `  ${name} → ${edge.type} → this (${edge.authority})`,
    );
  }
  if (source) lines.push('', formatSource(source));
  return lines.join('\n');
}

export function formatLog(revisions: NodeRevision[]): string {
  return table(
    [...revisions]
      .sort((a, b) => b.version - a.version)
      .map((rev) => [
        `v${rev.version}`,
        rev.authority + (rev.archived ? ' (archived)' : ''),
        `${rev.actor.kind}:${rev.actor.label}`,
        day(rev.createdAt),
        rev.changeReason,
      ]),
    ['V', 'AUTH', 'ACTOR', 'WHEN', 'REASON'],
  );
}

const cell = (value: unknown) =>
  typeof value === 'string' ? value : value === undefined ? '—' : JSON.stringify(value);

export function formatDiff(rows: FieldComparison[], a: number, b: number): string {
  const changed = rows.filter((row) => row.changed);
  if (changed.length === 0) return `v${a} and v${b} are identical`;
  return changed
    .map((row) =>
      [`${row.field}:`, `  - v${a}: ${cell(row.before)}`, `  + v${b}: ${cell(row.after)}`].join(
        '\n',
      ),
    )
    .join('\n');
}

function formatReason(reason: SelectionReason, titles: Map<string, string>): string[] {
  const name = (id: string) => titles.get(id) ?? shortId(id);
  const lines = [`    ${reason.kind.replace('_', ' ')}: ${reason.description}`];
  for (const step of reason.path) {
    const [from, to] =
      step.traversed === 'forward'
        ? [step.fromNodeId, step.toNodeId]
        : [step.toNodeId, step.fromNodeId];
    const arrow = step.traversed === 'forward' ? '→' : '←';
    lines.push(
      `      ${name(from)} ${arrow} ${step.type} ${arrow} ${name(to)} (${step.authority})`,
    );
  }
  return lines;
}

/** The human-facing explanation of a bundle; never includes the context text itself. */
export function formatBundleExplanation(bundle: ContextBundle): string {
  const titles = new Map<string, string>();
  for (const item of [...bundle.selected, ...bundle.omissions]) titles.set(item.nodeId, item.title);
  const lines = [
    `status ${bundle.status} · ${bundle.tokenCount} / ${bundle.tokenBudget} tokens (project total ${bundle.metrics.projectContextTokens}) · ${bundle.tokenizer} · ${bundle.embeddingModel}`,
    `selected ${bundle.selected.length} of ${bundle.metrics.activeNodes} active nodes · ${bundle.metrics.seeds} seeds · ${bundle.metrics.candidates} candidates`,
  ];
  bundle.selected.forEach((item, index) => {
    lines.push(
      '',
      `${String(index + 1).padStart(2)}. ${item.title}  [${shortId(item.nodeId)} ${item.type} ${item.authority} v${item.version} ${item.representation} score ${item.score.toFixed(2)}]`,
    );
    for (const reason of item.reasons) lines.push(...formatReason(reason, titles));
  });
  if (bundle.omissions.length > 0) {
    lines.push('', `omitted (${bundle.omissions.length})`);
    for (const omission of bundle.omissions)
      lines.push(
        `  - ${omission.title} v${omission.version} · ${omission.reason}${omission.critical ? ' · critical' : ''}`,
      );
  }
  if (bundle.warnings.length > 0) {
    lines.push('', 'warnings');
    for (const warning of bundle.warnings) lines.push(`  ! ${warning}`);
  }
  return lines.join('\n');
}

export function formatPending(nodes: ContextNode[]): string {
  if (nodes.length === 0) return 'No proposals waiting for review.';
  return table(
    nodes.map((node) => [
      shortId(node.id),
      node.type,
      node.current.actor.label,
      day(node.current.createdAt),
      String(node.current.confidence),
      node.current.title,
    ]),
    ['ID', 'TYPE', 'PROPOSED BY', 'WHEN', 'CONF', 'TITLE'],
  );
}
