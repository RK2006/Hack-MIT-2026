import type { Project, Source } from '../types';
import { renderContext, type RenderItem } from './render';
import type { Candidate } from './retrieval';
import { countTokens } from './tokenizer';
import type { Omission, Representation } from './types';

const ORDER: Representation[] = ['full', 'summary', 'title'];

export type PackInput = {
  project: Project;
  status: 'ok' | 'degraded';
  embeddingModel: string;
  tokenBudget: number;
  candidates: Candidate[];
  sources: Map<string, Pick<Source, 'id' | 'kind' | 'uri'>>;
  /** Omissions/warnings established before packing (candidate cap, degraded mode). */
  omissions: Omission[];
  warnings: string[];
};

export type PackResult = {
  items: Array<RenderItem & { candidate: Candidate }>;
  omissions: Omission[];
  warnings: string[];
  contextText: string;
  tokenCount: number;
};

function representationsFor(candidate: Candidate): Representation[] {
  return ORDER.filter(
    (rep) => rep !== 'summary' || candidate.node.current.summary.trim().length > 0,
  );
}

function incompleteWarning(candidate: Candidate, representation: Representation): string {
  return `Essential constraint "${candidate.node.current.title}" is included as ${representation} only; its full text did not fit.`;
}

/** Greedy rank-order packing; every acceptance re-renders the complete text and counts it whole. */
export function pack(input: PackInput): PackResult {
  const items: Array<RenderItem & { candidate: Candidate }> = [];
  const omissions: Omission[] = [...input.omissions];
  const extraWarnings: string[] = [];
  const render = (extra: { omissions?: Omission[]; warnings?: string[] } = {}) =>
    renderContext({
      project: input.project,
      status: input.status,
      embeddingModel: input.embeddingModel,
      items,
      omissions: extra.omissions ?? omissions,
      warnings: [...input.warnings, ...(extra.warnings ?? extraWarnings)],
    });
  const fits = (text: string) => countTokens(text) <= input.tokenBudget;
  const sourceOf = (candidate: Candidate) =>
    input.sources.get(candidate.node.current.sourceId) ?? {
      id: candidate.node.current.sourceId,
      kind: 'manual' as const,
      uri: 'unknown',
    };

  for (const candidate of input.candidates) {
    let accepted = false;
    for (const representation of representationsFor(candidate)) {
      const item = {
        node: candidate.node,
        representation,
        reasons: candidate.reasons,
        source: sourceOf(candidate),
        candidate,
      };
      items.push(item);
      const warnings =
        candidate.essential && representation !== 'full'
          ? [...extraWarnings, incompleteWarning(candidate, representation)]
          : extraWarnings;
      if (fits(render({ warnings }))) {
        extraWarnings.splice(0, extraWarnings.length, ...warnings);
        accepted = true;
        break;
      }
      items.pop();
    }
    if (!accepted) {
      omissions.push({
        nodeId: candidate.node.id,
        version: candidate.node.current.version,
        title: candidate.node.current.title,
        reason: 'budget',
        critical: candidate.essential,
      });
    }
  }

  // Omission lines added after acceptance may overflow; demote from the lowest rank until it fits.
  let text = render();
  while (!fits(text) && items.length > 0) {
    const last = items[items.length - 1]!;
    const options = representationsFor(last.candidate);
    const nextIndex = options.indexOf(last.representation) + 1;
    const rebuiltWarnings = () =>
      items
        .filter((item) => item.candidate.essential && item.representation !== 'full')
        .map((item) => incompleteWarning(item.candidate, item.representation));
    if (nextIndex < options.length) {
      last.representation = options[nextIndex]!;
    } else {
      items.pop();
      omissions.push({
        nodeId: last.node.id,
        version: last.node.current.version,
        title: last.node.current.title,
        reason: 'budget',
        critical: last.candidate.essential,
      });
    }
    extraWarnings.splice(0, extraWarnings.length, ...rebuiltWarnings());
    text = render();
  }
  if (!fits(text)) {
    // Nothing selected and even the omission list overflows: keep header plus a short budget warning if it fits.
    const minimal = renderContext({
      project: input.project,
      status: input.status,
      embeddingModel: input.embeddingModel,
      items: [],
      omissions: [],
      warnings: [
        ...input.warnings,
        `Budget of ${input.tokenBudget} tokens could not fit any context item.`,
      ],
    });
    text = fits(minimal)
      ? minimal
      : renderContext({
          project: input.project,
          status: input.status,
          embeddingModel: input.embeddingModel,
          items: [],
          omissions: [],
          warnings: [],
        });
    if (!fits(text)) text = '';
  }
  return {
    items,
    omissions,
    warnings: [...input.warnings, ...extraWarnings],
    contextText: text,
    tokenCount: countTokens(text),
  };
}
