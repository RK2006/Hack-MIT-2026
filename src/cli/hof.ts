import { readFile } from 'node:fs/promises';
import { parseArgs, type ParseArgsConfig } from 'node:util';
import { compareRevisions } from '../lib/compare';
import { ACCEPT_DEFAULTS, pendingReview, REJECT_DEFAULTS } from '../lib/review';
import { compileContext, type CompilerDeps } from '../server/context/compiler/compile';
import { REQUEST_LIMITS } from '../server/context/compiler/types';
import { GraphError } from '../server/context/errors';
import {
  EDGE_TYPES,
  NODE_TYPES,
  snapshotOf,
  type ContextNode,
  type EdgeType,
  type GraphStore,
  type NodeType,
} from '../server/context/types';
import { importPreparedProject } from '../server/ingestion/import';
import { ingestDocumentation } from '../server/ingestion/docs';
import { ingestPullRequest } from '../server/ingestion/github-pr';
import type { ProposalModel } from '../server/proposals/model';
import { proposeContext } from '../server/proposals/propose';
import {
  createOperatorNode,
  reviseOperatorNode,
  type CreateNodeRequest,
} from '../server/workbench/mutations';
import {
  formatBundleExplanation,
  formatDiff,
  formatLog,
  formatNode,
  formatNodeTable,
  formatPending,
  formatProjects,
  formatSource,
  formatStatus,
} from './format';
import { optionalNumber, readContentArg } from './input';
import {
  projectIdFrom,
  resolveProject,
  resolveProjectRef,
  writeProjectBinding,
  type Env,
} from './project';
import { resolveNodeRef, resolveNodeRefs, shortId } from './refs';

export const EXIT = { ok: 0, domain: 1, usage: 2, environment: 3 } as const;

/** Everything the runner needs from the process; tests supply sinks and a fake cwd/env. */
export type Io = {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  cwd: string;
  env: Env;
  readStdin: () => Promise<string>;
  /** True when stdin is interactive; gates `review`. */
  isTTY: boolean;
  /** Asks one line; the answer is trimmed. */
  prompt: (question: string) => Promise<string>;
};

/** Lazily constructed services so read-only commands never touch the embedding model or LLM key. */
export type Services = {
  store: GraphStore;
  compiler: () => Promise<CompilerDeps>;
  proposalModel: () => ProposalModel | null;
  /** Runs the stdio MCP server until it closes; supplied by the script entry point. */
  serve?: () => Promise<void>;
  /** Round-trips text through $EDITOR; resolves with the edited text. */
  editText?: (initial: string) => Promise<string>;
  /** Copies text to the clipboard; resolves false when no clipboard tool exists. */
  copy?: (text: string) => Promise<boolean>;
};

type Options = ParseArgsConfig['options'];
type Parsed = { values: Record<string, unknown>; positionals: string[] };
type Ctx = { io: Io; services: Services; parsed: Parsed; json: boolean };

type Command = {
  summary: string;
  usage: string;
  options?: Options;
  run: (ctx: Ctx) => Promise<number>;
};

const GLOBAL_OPTIONS: Options = {
  project: { type: 'string', short: 'p' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
};

const str = (values: Record<string, unknown>, key: string) =>
  typeof values[key] === 'string' ? (values[key] as string) : undefined;
const num = (values: Record<string, unknown>, key: string, fallback: number) => {
  const raw = str(values, key);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw usageError(`--${key} must be a number`);
  return value;
};
const list = (values: Record<string, unknown>, key: string): string[] =>
  Array.isArray(values[key]) ? (values[key] as string[]) : [];

class UsageError extends Error {}
const usageError = (message: string) => new UsageError(message);
class EnvironmentError extends Error {}

const emit = (ctx: Ctx, human: string, data: unknown) =>
  ctx.io.stdout(`${ctx.json ? JSON.stringify(data, null, 2) : human}\n`);

async function project(ctx: Ctx) {
  return resolveProject(ctx.services.store, {
    project: str(ctx.parsed.values, 'project'),
    cwd: ctx.io.cwd,
    env: ctx.io.env,
  });
}

async function allNodes(store: GraphStore, projectId: string) {
  const [graph, archived] = await Promise.all([
    store.getGraph(projectId),
    store.listArchivedNodes(projectId),
  ]);
  return { graph, archived, nodes: [...graph.nodes, ...archived] };
}

function requireModel(ctx: Ctx): ProposalModel {
  const model = ctx.services.proposalModel();
  if (!model) {
    throw new EnvironmentError(
      'A proposal model key is required: set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY (optionally PROPOSAL_PROVIDER / PROPOSAL_MODEL) in .env',
    );
  }
  return model;
}

const positional = (ctx: Ctx, index: number, name: string) => {
  const value = ctx.parsed.positionals[index];
  if (value === undefined) throw usageError(`Missing <${name}>`);
  return value;
};

export const COMMANDS: Record<string, Command> = {
  projects: {
    summary: 'List projects; * marks the one bound to this directory',
    usage: 'hof projects',
    run: async (ctx) => {
      const projects = await ctx.services.store.listProjects();
      const bound = projectIdFrom({
        project: str(ctx.parsed.values, 'project'),
        cwd: ctx.io.cwd,
        env: ctx.io.env,
      });
      emit(ctx, formatProjects(projects, bound), { projects, bound });
      return EXIT.ok;
    },
  },
  use: {
    summary: 'Bind this directory to a project (UUID or unique name substring)',
    usage: 'hof use <project>',
    run: async (ctx) => {
      const found = await resolveProjectRef(ctx.services.store, positional(ctx, 0, 'project'));
      const file = writeProjectBinding(ctx.io.cwd, found.id);
      emit(ctx, `Bound to ${found.name} (${found.id}) via ${file}`, { project: found, file });
      return EXIT.ok;
    },
  },
  init: {
    summary: 'Import a prepared manifest and bind this directory to it',
    usage: 'hof init <manifest.json>',
    run: async (ctx) => {
      const bytes = await readFile(positional(ctx, 0, 'manifest.json'));
      const result = await importPreparedProject(bytes, ctx.services.store);
      const file = writeProjectBinding(ctx.io.cwd, result.projectId);
      emit(
        ctx,
        `Imported ${result.nodes} nodes, ${result.edges} edges, ${result.sources} sources into ${result.projectId}; bound via ${file}`,
        { ...result, file },
      );
      return EXIT.ok;
    },
  },
  status: {
    summary: 'Node, relationship, authority, pending-review, and archive counts',
    usage: 'hof status',
    run: async (ctx) => {
      const p = await project(ctx);
      const { graph, archived } = await allNodes(ctx.services.store, p.id);
      const canonical = graph.nodes.filter((n) => n.current.authority === 'canonical').length;
      emit(ctx, formatStatus(graph, archived), {
        project: graph.project,
        activeNodes: graph.nodes.length,
        edges: graph.edges.length,
        canonical,
        inferred: graph.nodes.length - canonical,
        pendingReview: pendingReview(graph.nodes).length,
        archived: archived.length,
      });
      return EXIT.ok;
    },
  },
  ls: {
    summary: 'List nodes',
    usage: 'hof ls [--type <type>] [--canonical|--inferred] [--archived] [--grep <text>]',
    options: {
      type: { type: 'string', short: 't' },
      canonical: { type: 'boolean' },
      inferred: { type: 'boolean' },
      archived: { type: 'boolean' },
      grep: { type: 'string', short: 'g' },
    },
    run: async (ctx) => {
      const p = await project(ctx);
      const { values } = ctx.parsed;
      const type = str(values, 'type');
      if (type && !(NODE_TYPES as readonly string[]).includes(type))
        throw usageError(`--type must be one of ${NODE_TYPES.join(', ')}`);
      const { graph, archived } = await allNodes(ctx.services.store, p.id);
      const needle = str(values, 'grep')?.toLowerCase();
      const nodes = (values.archived ? archived : graph.nodes)
        .filter((n) => !type || n.type === (type as NodeType))
        .filter((n) => !values.canonical || n.current.authority === 'canonical')
        .filter((n) => !values.inferred || n.current.authority === 'inferred')
        .filter(
          (n) =>
            !needle ||
            [n.current.title, n.current.summary, n.current.content, n.externalKey, n.path].some(
              (field) => field?.toLowerCase().includes(needle),
            ),
        )
        .sort((a, b) => a.current.title.localeCompare(b.current.title));
      emit(ctx, formatNodeTable(nodes), { nodes });
      return EXIT.ok;
    },
  },
  show: {
    summary: 'Current revision, relationships, and source evidence of a node',
    usage: 'hof show <node>',
    run: async (ctx) => {
      const p = await project(ctx);
      const { graph, nodes } = await allNodes(ctx.services.store, p.id);
      const node = resolveNodeRef(positional(ctx, 0, 'node'), nodes);
      const source = await ctx.services.store.getSource(p.id, node.current.sourceId);
      emit(ctx, formatNode(node, graph, source), { node, source });
      return EXIT.ok;
    },
  },
  log: {
    summary: 'Revision history of a node',
    usage: 'hof log <node>',
    run: async (ctx) => {
      const p = await project(ctx);
      const { nodes } = await allNodes(ctx.services.store, p.id);
      const node = resolveNodeRef(positional(ctx, 0, 'node'), nodes);
      const revisions = await ctx.services.store.listRevisions(p.id, node.id);
      emit(ctx, `${node.current.title}\n${formatLog(revisions)}`, { node: node.id, revisions });
      return EXIT.ok;
    },
  },
  diff: {
    summary: 'Compare two revisions of a node (default: the two latest)',
    usage: 'hof diff <node> [vA] [vB]',
    run: async (ctx) => {
      const p = await project(ctx);
      const { nodes } = await allNodes(ctx.services.store, p.id);
      const node = resolveNodeRef(positional(ctx, 0, 'node'), nodes);
      const revisions = await ctx.services.store.listRevisions(p.id, node.id);
      const latest = revisions[revisions.length - 1]!.version;
      const b = Number(ctx.parsed.positionals[2] ?? latest);
      const a = Number(ctx.parsed.positionals[1] ?? Math.max(1, b - 1));
      const byVersion = new Map(revisions.map((rev) => [rev.version, rev]));
      const left = byVersion.get(a);
      const right = byVersion.get(b);
      if (!left || !right)
        throw new GraphError('NOT_FOUND', `Node has versions 1..${latest}`, { a, b });
      const rows = compareRevisions(left, right);
      emit(ctx, `${node.current.title}: v${a} → v${b}\n${formatDiff(rows, a, b)}`, {
        node: node.id,
        a,
        b,
        rows,
      });
      return EXIT.ok;
    },
  },
  source: {
    summary: 'Show an evidence record',
    usage: 'hof source <sourceId>',
    run: async (ctx) => {
      const p = await project(ctx);
      const source = await ctx.services.store.getSource(p.id, positional(ctx, 0, 'sourceId'));
      emit(ctx, formatSource(source), source);
      return EXIT.ok;
    },
  },
  checkout: {
    summary: 'Compile task context: exact text on stdout, explanation on stderr',
    usage:
      'hof checkout "<task>" [--budget N] [--depth N] [--start <node>]... [--degraded] [--explain] [--copy]',
    options: {
      budget: { type: 'string', short: 'b' },
      depth: { type: 'string', short: 'd' },
      start: { type: 'string', short: 's', multiple: true },
      degraded: { type: 'boolean' },
      explain: { type: 'boolean', short: 'e' },
      copy: { type: 'boolean', short: 'c' },
    },
    run: async (ctx) => {
      const p = await project(ctx);
      const task = positional(ctx, 0, 'task');
      const { values } = ctx.parsed;
      const starts = list(values, 'start');
      const startNodeIds = starts.length
        ? resolveNodeRefs(starts, (await ctx.services.store.getGraph(p.id)).nodes).map((n) => n.id)
        : undefined;
      const bundle = await compileContext(await ctx.services.compiler(), p.id, {
        task,
        tokenBudget: num(values, 'budget', REQUEST_LIMITS.budgetDefault),
        maxDepth: num(values, 'depth', REQUEST_LIMITS.depthDefault),
        allowDegraded: Boolean(values.degraded),
        ...(startNodeIds && { startNodeIds }),
      });
      const explanation = formatBundleExplanation(bundle);
      if (ctx.json) ctx.io.stdout(`${JSON.stringify(bundle, null, 2)}\n`);
      else if (values.explain) ctx.io.stdout(`${explanation}\n`);
      else {
        ctx.io.stdout(bundle.contextText);
        ctx.io.stderr(`${explanation}\n`);
      }
      if (values.copy) {
        const copied = ctx.services.copy ? await ctx.services.copy(bundle.contextText) : false;
        ctx.io.stderr(
          copied
            ? `copied ${bundle.tokenCount} tokens to the clipboard\n`
            : 'warning: no clipboard tool found (pbcopy, wl-copy, or xclip); text is on stdout only\n',
        );
      }
      return EXIT.ok;
    },
  },
  note: {
    summary: 'Create a node by hand (canonical unless --inferred), optionally linked to another',
    usage:
      'hof note <type> "<title>" --content <text|@file|-> [--summary] [--key] [--path] [--importance N] [--confidence N] [--inferred] [--link <node> --edge <TYPE> [--incoming]] -m "<reason>" --evidence "<note>"',
    options: {
      content: { type: 'string', short: 'c' },
      summary: { type: 'string', short: 's' },
      key: { type: 'string', short: 'k' },
      path: { type: 'string' },
      importance: { type: 'string', short: 'i' },
      confidence: { type: 'string' },
      inferred: { type: 'boolean' },
      link: { type: 'string', short: 'l' },
      edge: { type: 'string' },
      incoming: { type: 'boolean' },
      message: { type: 'string', short: 'm' },
      evidence: { type: 'string' },
    },
    run: async (ctx) => {
      const p = await project(ctx);
      const { values } = ctx.parsed;
      const type = positional(ctx, 0, 'type');
      if (!(NODE_TYPES as readonly string[]).includes(type))
        throw usageError(`<type> must be one of ${NODE_TYPES.join(', ')}`);
      const title = positional(ctx, 1, 'title');
      const rawContent = str(values, 'content');
      if (rawContent === undefined) throw usageError('--content is required (text, @file, or -)');
      const { changeReason, evidenceNote } = operatorEvidence(ctx);
      const node: CreateNodeRequest['node'] = {
        type: type as NodeType,
        title,
        content: await readContentArg(rawContent, ctx.io.readStdin),
        authority: values.inferred ? 'inferred' : 'canonical',
      };
      const summary = str(values, 'summary');
      if (summary !== undefined) node.summary = summary;
      const key = str(values, 'key');
      if (key) node.externalKey = key;
      const path = str(values, 'path');
      if (path) node.path = path;
      const importance = optionalNumber(str(values, 'importance'), 'importance');
      if (importance !== undefined) node.importance = importance;
      const confidence = optionalNumber(str(values, 'confidence'), 'confidence');
      if (confidence !== undefined) node.confidence = confidence;
      const payload: CreateNodeRequest = { changeReason, evidenceNote, node };
      const link = str(values, 'link');
      if (link) {
        const edgeType = str(values, 'edge');
        if (!edgeType || !(EDGE_TYPES as readonly string[]).includes(edgeType))
          throw usageError(`--link needs --edge <${EDGE_TYPES.join('|')}>`);
        const { nodes } = await allNodes(ctx.services.store, p.id);
        payload.edge = {
          otherNodeId: resolveNodeRef(link, nodes).id,
          type: edgeType as EdgeType,
          direction: values.incoming ? 'incoming' : 'outgoing',
          authority: values.inferred ? 'inferred' : 'canonical',
        };
      }
      const result = await createOperatorNode(ctx.services.store, p.id, payload);
      const edgeText = result.edge
        ? ` · edge ${result.edge.fromNodeId === result.node.id ? 'this' : shortId(result.edge.fromNodeId)} → ${result.edge.type} → ${result.edge.toNodeId === result.node.id ? 'this' : shortId(result.edge.toNodeId)}`
        : '';
      emit(
        ctx,
        `Created ${shortId(result.node.id)} ${result.node.type} "${result.node.current.title}" (${result.node.current.authority} v1)${edgeText}`,
        result,
      );
      return EXIT.ok;
    },
  },
  edit: {
    summary: 'Revise fields of a node as a new revision',
    usage:
      'hof edit <node> [--title] [--content <text|@file|->] [--summary] [--importance N] [--confidence N] [--canonical|--inferred] -m "<reason>" --evidence "<note>"',
    options: {
      title: { type: 'string', short: 't' },
      content: { type: 'string', short: 'c' },
      summary: { type: 'string', short: 's' },
      importance: { type: 'string', short: 'i' },
      confidence: { type: 'string' },
      canonical: { type: 'boolean' },
      inferred: { type: 'boolean' },
      message: { type: 'string', short: 'm' },
      evidence: { type: 'string' },
    },
    run: async (ctx) => {
      const p = await project(ctx);
      const { values } = ctx.parsed;
      const fields = [
        'title',
        'content',
        'summary',
        'importance',
        'confidence',
        'canonical',
        'inferred',
      ];
      if (!fields.some((field) => values[field] !== undefined))
        throw usageError(
          `Give at least one field to change (${fields.map((f) => `--${f}`).join(', ')})`,
        );
      if (values.canonical && values.inferred) throw usageError('Choose --canonical or --inferred');
      const { changeReason, evidenceNote } = operatorEvidence(ctx);
      const { nodes } = await allNodes(ctx.services.store, p.id);
      const node = resolveNodeRef(positional(ctx, 0, 'node'), nodes);
      const current = proposedSnapshot(node);
      const snapshot = { ...current };
      const title = str(values, 'title');
      if (title !== undefined) snapshot.title = title;
      const content = str(values, 'content');
      if (content !== undefined) snapshot.content = await readContentArg(content, ctx.io.readStdin);
      const summary = str(values, 'summary');
      if (summary !== undefined) snapshot.summary = summary;
      const importance = optionalNumber(str(values, 'importance'), 'importance');
      if (importance !== undefined) snapshot.importance = importance;
      const confidence = optionalNumber(str(values, 'confidence'), 'confidence');
      if (confidence !== undefined) snapshot.confidence = confidence;
      if (values.canonical) snapshot.authority = 'canonical';
      if (values.inferred) snapshot.authority = 'inferred';
      if (sameSnapshot(current, snapshot)) {
        emit(ctx, `${shortId(node.id)}: nothing changed; no revision recorded`, {
          node: node.id,
          changed: false,
        });
        return EXIT.ok;
      }
      const result = await reviseOperatorNode(ctx.services.store, p.id, node.id, {
        expectedVersion: node.current.version,
        changeReason,
        evidenceNote,
        snapshot,
      });
      emit(
        ctx,
        `${shortId(node.id)} "${result.node.current.title}" → v${result.node.current.version} (${result.node.current.authority})`,
        result,
      );
      return EXIT.ok;
    },
  },
  archive: {
    summary: 'Archive nodes (they leave the active graph but keep their history)',
    usage: 'hof archive <node>... -m "<reason>" --evidence "<note>"',
    options: { message: { type: 'string', short: 'm' }, evidence: { type: 'string' } },
    run: (ctx) => toggleArchived(ctx, true),
  },
  restore: {
    summary: 'Restore archived nodes to the active graph',
    usage: 'hof restore <node>... -m "<reason>" --evidence "<note>"',
    options: { message: { type: 'string', short: 'm' }, evidence: { type: 'string' } },
    run: (ctx) => toggleArchived(ctx, false),
  },
  review: {
    summary: 'Step through pending proposals interactively: accept / reject / edit / skip / quit',
    usage: 'hof review [--note "<why>"]',
    options: { note: { type: 'string', short: 'n' } },
    run: async (ctx) => {
      const p = await project(ctx);
      const graph = await ctx.services.store.getGraph(p.id);
      const pending = pendingReview(graph.nodes);
      if (!ctx.io.isTTY) {
        ctx.io.stderr('hof review needs an interactive terminal; showing `hof pending` instead.\n');
        ctx.io.stdout(`${formatPending(pending)}\n`);
        return EXIT.usage;
      }
      if (pending.length === 0) {
        ctx.io.stdout('No proposals waiting for review.\n');
        return EXIT.ok;
      }
      const note = str(ctx.parsed.values, 'note')?.trim();
      const tally = { accepted: 0, rejected: 0, edited: 0, skipped: 0, failed: 0 };
      for (const [index, node] of pending.entries()) {
        const source = await ctx.services.store.getSource(p.id, node.current.sourceId);
        ctx.io.stdout(`\n[${index + 1}/${pending.length}] ${formatNode(node, graph, source)}\n\n`);
        let answer = '';
        while (!['a', 'r', 'e', 's', 'q'].includes(answer)) {
          answer = (
            await ctx.io.prompt('(a)ccept  (r)eject  (e)dit then accept  (s)kip  (q)uit > ')
          )
            .trim()
            .toLowerCase()
            .slice(0, 1);
        }
        if (answer === 'q') break;
        if (answer === 's') {
          tally.skipped += 1;
          continue;
        }
        try {
          if (answer === 'e') {
            if (!ctx.services.editText) throw usageError('No editor available in this environment');
            const content = (await ctx.services.editText(node.current.content)).trim();
            if (!content) throw new GraphError('VALIDATION_ERROR', 'Edited content is empty');
            const snapshot = proposedSnapshot(node);
            await reviseOperatorNode(ctx.services.store, p.id, node.id, {
              expectedVersion: node.current.version,
              changeReason: 'Edited and accepted agent proposal',
              evidenceNote: evidenceWithNote(
                'Operator edited the agent proposal before accepting it as canonical.',
                note,
              ),
              snapshot: { ...snapshot, content, authority: 'canonical', confidence: 1 },
            });
            tally.edited += 1;
            ctx.io.stdout('✓ edited and accepted\n');
          } else {
            const decision = answer === 'a' ? 'accept' : 'reject';
            const message = await applyDecision(ctx.services.store, p.id, node, decision, note);
            tally[decision === 'accept' ? 'accepted' : 'rejected'] += 1;
            ctx.io.stdout(`✓ ${message}\n`);
          }
        } catch (error) {
          tally.failed += 1;
          ctx.io.stdout(`✗ ${describe(error)}\n`);
        }
      }
      emit(
        ctx,
        `accepted ${tally.accepted} · edited ${tally.edited} · rejected ${tally.rejected} · skipped ${tally.skipped} · failed ${tally.failed}`,
        tally,
      );
      return tally.failed === 0 ? EXIT.ok : EXIT.domain;
    },
  },
  pending: {
    summary: 'Agent proposals not yet reviewed by a human',
    usage: 'hof pending',
    run: async (ctx) => {
      const p = await project(ctx);
      const graph = await ctx.services.store.getGraph(p.id);
      const nodes = pendingReview(graph.nodes);
      emit(ctx, formatPending(nodes), { nodes });
      return EXIT.ok;
    },
  },
  accept: {
    summary: 'Promote proposals to canonical (confidence 1) with a fresh operator source',
    usage: 'hof accept <node>... [--note "<why>"]',
    options: { note: { type: 'string', short: 'n' } },
    run: (ctx) => decide(ctx, 'accept'),
  },
  reject: {
    summary: 'Archive proposals with a fresh operator source',
    usage: 'hof reject <node>... [--note "<why>"]',
    options: { note: { type: 'string', short: 'n' } },
    run: (ctx) => decide(ctx, 'reject'),
  },
  propose: {
    summary: 'Turn notes or a diff summary into inferred proposals (LLM)',
    usage: 'hof propose [file|-] [--task "<hint>"]',
    options: { task: { type: 'string', short: 't' } },
    run: async (ctx) => {
      const p = await project(ctx);
      const model = requireModel(ctx);
      const file = ctx.parsed.positionals[0];
      const text = file && file !== '-' ? await readFile(file, 'utf8') : await ctx.io.readStdin();
      const taskHint = str(ctx.parsed.values, 'task');
      const result = await proposeContext(
        {
          store: ctx.services.store,
          model,
          log: (event) => ctx.io.stderr(`${JSON.stringify(event)}\n`),
        },
        p.id,
        { text, ...(taskHint !== undefined && { taskHint }) },
      );
      const created = result.created.nodes.map(
        (n) => `  + ${shortId(n.nodeId)} ${n.type} ${n.title}`,
      );
      const dropped = result.dropped.map((d) => `  - ${d.kind} ${d.ref}: ${d.reason}`);
      emit(
        ctx,
        [
          `${result.created.nodes.length} nodes, ${result.created.edges.length} edges proposed by ${result.model}`,
          ...created,
          ...dropped,
          'Review with `hof pending`.',
        ].join('\n'),
        result,
      );
      return EXIT.ok;
    },
  },
  ingest: {
    summary: 'Ingest a GitHub pull request or repository docs as proposals (LLM)',
    usage:
      'hof ingest pr <url|owner/repo#n|n> [--repo owner/name] | hof ingest docs <path> [file...]',
    options: { repo: { type: 'string', short: 'r' } },
    run: async (ctx) => {
      const p = await project(ctx);
      const model = requireModel(ctx);
      const kind = positional(ctx, 0, 'pr|docs');
      const deps = { store: ctx.services.store, model };
      if (kind === 'pr') {
        const repo = str(ctx.parsed.values, 'repo');
        const result = await ingestPullRequest(deps, p.id, positional(ctx, 1, 'ref'), { repo });
        emit(
          ctx,
          `PR #${result.pullRequest.number} "${result.pullRequest.title}": ${result.proposal.created.nodes.length} nodes, ${result.proposal.created.edges.length} edges proposed. Review with \`hof pending\`.`,
          result,
        );
        return EXIT.ok;
      }
      if (kind === 'docs') {
        const files = ctx.parsed.positionals.slice(2);
        const result = await ingestDocumentation(deps, p.id, positional(ctx, 1, 'path'), {
          files: files.length > 0 ? files : undefined,
        });
        emit(ctx, `Docs ingested. Review with \`hof pending\`.`, result);
        return EXIT.ok;
      }
      throw usageError('hof ingest expects "pr" or "docs"');
    },
  },
  serve: {
    summary: 'Run the stdio MCP server for coding agents',
    usage: 'hof serve',
    run: async (ctx) => {
      if (!ctx.services.serve) throw new EnvironmentError('MCP server is not available here');
      await ctx.services.serve();
      return EXIT.ok;
    },
  },
};

/** Snapshot without sourceId; the store's own equality check includes the fresh source, so compare here. */
function proposedSnapshot(node: ContextNode) {
  const { sourceId: _s, ...snapshot } = snapshotOf(node);
  void _s;
  return snapshot;
}
const sameSnapshot = (a: object, b: object) => JSON.stringify(a) === JSON.stringify(b);

const evidenceWithNote = (base: string, note: string | undefined) =>
  note ? `${base} Note: ${note}` : base;

/** `-m` and `--evidence` are mandatory on authoring commands, like a commit message. */
function operatorEvidence(ctx: Ctx): { changeReason: string; evidenceNote: string } {
  const changeReason = str(ctx.parsed.values, 'message')?.trim();
  const evidenceNote = str(ctx.parsed.values, 'evidence')?.trim();
  if (!changeReason) throw usageError('-m "<reason>" is required');
  if (!evidenceNote) throw usageError('--evidence "<note>" is required (stored as the source)');
  return { changeReason, evidenceNote };
}

/** One accept/reject revision; shared by `accept`, `reject`, and `review`. */
async function applyDecision(
  store: GraphStore,
  projectId: string,
  node: ContextNode,
  decision: 'accept' | 'reject',
  note: string | undefined,
): Promise<string> {
  const defaults = decision === 'accept' ? ACCEPT_DEFAULTS : REJECT_DEFAULTS;
  const current = proposedSnapshot(node);
  const next =
    decision === 'accept'
      ? { ...current, authority: 'canonical' as const, confidence: 1 }
      : { ...current, archived: true };
  const state = decision === 'accept' ? 'canonical' : 'archived';
  if (sameSnapshot(current, next))
    return `${shortId(node.id)} ${node.current.title}: already ${state}`;
  const result = await reviseOperatorNode(store, projectId, node.id, {
    expectedVersion: node.current.version,
    changeReason: defaults.changeReason,
    evidenceNote: evidenceWithNote(defaults.evidenceNote, note),
    snapshot: next,
  });
  return `${shortId(node.id)} ${node.current.title} → v${result.node.current.version} ${state}`;
}

type RefResult = { ref: string; nodeId?: string; ok: boolean; message: string };

/** Runs `work` for every positional node ref, continuing past failures; exit 1 if any failed. */
async function forEachRef(
  ctx: Ctx,
  nodes: ContextNode[],
  work: (node: ContextNode) => Promise<string>,
  data: Record<string, unknown>,
): Promise<number> {
  if (ctx.parsed.positionals.length === 0) throw usageError('Give at least one <node>');
  const results: RefResult[] = [];
  for (const ref of ctx.parsed.positionals) {
    try {
      const node = resolveNodeRef(ref, nodes);
      results.push({ ref, nodeId: node.id, ok: true, message: await work(node) });
    } catch (error) {
      results.push({ ref, ok: false, message: describe(error) });
    }
  }
  emit(ctx, results.map((r) => `${r.ok ? '✓' : '✗'} ${r.message}`).join('\n'), {
    ...data,
    results,
  });
  return results.every((r) => r.ok) ? EXIT.ok : EXIT.domain;
}

async function decide(ctx: Ctx, decision: 'accept' | 'reject'): Promise<number> {
  const p = await project(ctx);
  const { nodes } = await allNodes(ctx.services.store, p.id);
  const note = str(ctx.parsed.values, 'note')?.trim();
  return forEachRef(
    ctx,
    nodes,
    (node) => applyDecision(ctx.services.store, p.id, node, decision, note),
    { decision },
  );
}

async function toggleArchived(ctx: Ctx, archived: boolean): Promise<number> {
  const p = await project(ctx);
  const { changeReason, evidenceNote } = operatorEvidence(ctx);
  const { nodes } = await allNodes(ctx.services.store, p.id);
  const state = archived ? 'archived' : 'restored';
  return forEachRef(
    ctx,
    nodes,
    async (node) => {
      if (node.current.archived === archived)
        return `${shortId(node.id)} ${node.current.title}: already ${state}`;
      const result = await reviseOperatorNode(ctx.services.store, p.id, node.id, {
        expectedVersion: node.current.version,
        changeReason,
        evidenceNote,
        snapshot: { ...proposedSnapshot(node), archived },
      });
      return `${shortId(node.id)} ${node.current.title} → v${result.node.current.version} ${state}`;
    },
    { action: state },
  );
}

function describe(error: unknown): string {
  if (error instanceof GraphError) {
    const candidates = error.details?.candidates as
      Array<{ id: string; title?: string; name?: string }> | undefined;
    const extra = candidates
      ? `\n${candidates.map((c) => `  ${c.id}  ${c.title ?? c.name ?? ''}`).join('\n')}`
      : error.details?.hint
        ? `\n  hint: ${String(error.details.hint)}`
        : '';
    return `${error.code}: ${error.message}${extra}`;
  }
  return error instanceof Error ? error.message : String(error);
}

export function help(command?: string): string {
  if (command && COMMANDS[command]) {
    const spec = COMMANDS[command]!;
    const flags = Object.entries({ ...spec.options, ...GLOBAL_OPTIONS })
      .map(([name, opt]) => `  --${name}${opt?.short ? `, -${opt.short}` : ''}`)
      .join('\n');
    return `${spec.usage}\n\n${spec.summary}\n\nOptions:\n${flags}`;
  }
  const width = Math.max(...Object.keys(COMMANDS).map((name) => name.length));
  const rows = Object.entries(COMMANDS)
    .map(([name, spec]) => `  ${name.padEnd(width)}  ${spec.summary}`)
    .join('\n');
  return [
    'hof — hand off task context between a project graph, humans, and agents',
    '',
    'Usage: hof <command> [options]   (hof <command> --help for details)',
    '',
    rows,
    '',
    'Global: --project/-p <id|name>   --json   --help',
    'Project resolution: --project, then HOF_PROJECT, then the nearest .hof/project (see `hof use`).',
  ].join('\n');
}

/** Parses argv, dispatches a command, and maps every failure to a documented exit code. */
export async function run(argv: string[], io: Io, services: Services): Promise<number> {
  const [name, ...rest] = argv;
  if (!name || name === '--help' || name === '-h' || name === 'help') {
    io.stdout(`${help(rest[0])}\n`);
    return name ? EXIT.ok : EXIT.usage;
  }
  const command = COMMANDS[name];
  if (!command) {
    io.stderr(`Unknown command "${name}"\n\n${help()}\n`);
    return EXIT.usage;
  }
  let parsed: Parsed;
  try {
    parsed = parseArgs({
      args: rest,
      options: { ...GLOBAL_OPTIONS, ...command.options },
      allowPositionals: true,
      strict: true,
    }) as Parsed;
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n\n${help(name)}\n`);
    return EXIT.usage;
  }
  if (parsed.values.help) {
    io.stdout(`${help(name)}\n`);
    return EXIT.ok;
  }
  const ctx: Ctx = { io, services, parsed, json: Boolean(parsed.values.json) };
  try {
    return await command.run(ctx);
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`${error.message}\n\n${help(name)}\n`);
      return EXIT.usage;
    }
    if (error instanceof EnvironmentError) {
      io.stderr(`${error.message}\n`);
      return EXIT.environment;
    }
    if (error instanceof GraphError) {
      io.stderr(
        `${ctx.json ? JSON.stringify({ error: { code: error.code, message: error.message, details: error.details } }) : describe(error)}\n`,
      );
      return EXIT.domain;
    }
    throw error;
  }
}
