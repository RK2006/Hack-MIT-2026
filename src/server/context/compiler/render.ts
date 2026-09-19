import type { ContextNode, NodeType, Project, Source } from '../types';
import type { Omission, Representation, SelectionReason } from './types';
import { TOKENIZER_ID } from './tokenizer';

export const SECTION_ORDER: Array<{ title: string; types: NodeType[] }> = [
  { title: 'Constraints', types: ['constraint'] },
  { title: 'Decisions', types: ['decision'] },
  { title: 'Components', types: ['component'] },
  { title: 'Files', types: ['file'] },
  { title: 'Bugs and discoveries', types: ['bug', 'discovery'] },
  { title: 'Assumptions', types: ['assumption'] },
];

export const DEGRADED_WARNING =
  'Semantic embeddings were unavailable; selection used lexical matching only.';
export const NO_CONTEXT_TEXT = 'No relevant context was found for this task.';

export type RenderItem = {
  node: ContextNode;
  representation: Representation;
  reasons: SelectionReason[];
  source: Pick<Source, 'id' | 'kind' | 'uri'>;
};

export type RenderInput = {
  project: Project;
  status: 'ok' | 'degraded';
  embeddingModel: string;
  items: RenderItem[];
  omissions: Omission[];
  warnings: string[];
};

export function renderHeader(
  input: Pick<RenderInput, 'project' | 'status' | 'embeddingModel'>,
): string {
  const synthetic = /synthetic/i.test(input.project.name)
    ? ' This project is a labeled synthetic prepared example.'
    : '';
  return (
    `# Task context: ${input.project.name}\n` +
    `Tokenizer: ${TOKENIZER_ID}. Embedding model: ${input.embeddingModel}. Status: ${input.status}.${synthetic}\n`
  );
}

export function renderItem(item: RenderItem): string {
  const { node, representation, reasons, source } = item;
  const { title, authority, version, content, summary } = node.current;
  const lines = [`### [${authority}] ${title}  (${node.type} v${version})`];
  if (node.path) lines.push(`Path: ${node.path}`);
  if (representation === 'full') lines.push(content);
  else if (representation === 'summary') lines.push(summary);
  else lines.push('(title only)');
  if (reasons.length > 0)
    lines.push(`Why: ${reasons.map((reason) => reason.description).join('; ')}`);
  lines.push(`Source: ${source.kind} — ${source.uri} (source ${source.id})`);
  return lines.join('\n') + '\n';
}

export function renderContext(input: RenderInput): string {
  let text = renderHeader(input);
  if (input.items.length === 0) {
    text += `\n${NO_CONTEXT_TEXT}\n`;
  } else {
    for (const section of SECTION_ORDER) {
      const items = input.items.filter((item) => section.types.includes(item.node.type));
      if (items.length === 0) continue;
      text += `\n## ${section.title}\n`;
      text += items.map(renderItem).join('');
    }
  }
  if (input.omissions.length > 0) {
    text += '\n## Omitted context\n';
    for (const omission of input.omissions) {
      text += `- ${omission.title} (v${omission.version}, ${omission.reason}${omission.critical ? ', critical' : ''})\n`;
    }
  }
  if (input.warnings.length > 0) {
    text += '\n## Warnings\n';
    for (const warning of input.warnings) text += `- ${warning}\n`;
  }
  return text;
}
