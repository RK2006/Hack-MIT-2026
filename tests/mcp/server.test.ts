import { describe, expect, it } from 'vitest';
import { memoryEmbeddingCache } from '../../src/server/context/compiler/cache';
import {
  embeddingInput,
  type EmbeddingProvider,
} from '../../src/server/context/compiler/embedding';
import { graphError } from '../../src/server/context/errors';
import type { GraphSnapshot, GraphStore } from '../../src/server/context/types';
import { fixedProposalModel } from '../../src/server/proposals/model';
import { makeEdge, makeGraph, makeNode, PROJECT_ID } from '../compiler/fixture';
import { connectMcp, textOf, type ToolCall } from './helpers';

const seed = makeNode('component.webhooks', 'component', { title: 'Provider webhooks' });
const neighbor = makeNode('constraint.once', 'constraint', { title: 'Side effects once' });
const graph = makeGraph([seed, neighbor], [makeEdge(seed, neighbor, 'REQUIRES')]);
const TASK = 'Fix duplicate webhook processing';

function fakeStore(snapshot: GraphSnapshot): GraphStore {
  const unsupported = () => Promise.reject(new Error('not used'));
  return {
    listProjects: async () => [snapshot.project],
    getProject: unsupported,
    getGraph: async (projectId) => {
      if (projectId !== PROJECT_ID) throw graphError('NOT_FOUND', 'Project not found');
      return snapshot;
    },
    getNode: async (_p, nodeId) => {
      const node = snapshot.nodes.find((n) => n.id === nodeId);
      if (!node) throw graphError('NOT_FOUND', 'Node not found');
      return node;
    },
    listArchivedNodes: unsupported,
    getSource: async (_p, sourceId) => ({
      id: sourceId,
      projectId: PROJECT_ID,
      kind: 'manual',
      uri: 'manual://test',
      label: 'Test',
      excerpt: 'synthetic prepared example',
      revisionRef: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    }),
    listRevisions: unsupported,
    getRevision: unsupported,
    transaction: unsupported,
    close: async () => undefined,
  };
}

const provider: EmbeddingProvider = {
  id: 'fixed:mcp',
  dimensions: 2,
  minSeedSimilarity: 0.25,
  async embed(texts) {
    const vectors = new Map([
      [TASK, [1, 0]],
      [embeddingInput(seed), [1, 0]],
      [embeddingInput(neighbor), [0, 1]],
    ]);
    return texts.map((t) => vectors.get(t)!);
  },
};

describe('context-graph MCP server', () => {
  const deps = () => ({ store: fakeStore(graph), provider, cache: memoryEmbeddingCache() });

  it('lists the documented tools with schemas (A1)', async () => {
    const mcp = await connectMcp({ ...deps(), proposalModel: fixedProposalModel('{}') });
    const { tools } = await mcp.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'compile_context',
      'get_node',
      'get_source',
      'ingest_pull_request',
      'list_projects',
      'propose_context',
      'scan_repository',
    ]);
    const compile = tools.find((t) => t.name === 'compile_context')!;
    expect(Object.keys(compile.inputSchema.properties ?? {})).toEqual(
      expect.arrayContaining(['projectId', 'task', 'tokenBudget', 'startNodeIds', 'maxDepth']),
    );
    expect(compile.description).toContain('[inferred]');
    await mcp.close();
  });

  it('omits propose_context when no model is configured', async () => {
    const mcp = await connectMcp(deps());
    const { tools } = await mcp.client.listTools();
    expect(tools.map((t) => t.name)).not.toContain('propose_context');
    expect(tools.map((t) => t.name)).toContain('scan_repository');
    await mcp.close();
  });

  it('compiles context and returns the exact text plus the bundle', async () => {
    const mcp = await connectMcp(deps());
    const result = (await mcp.client.callTool({
      name: 'compile_context',
      arguments: { projectId: PROJECT_ID, task: TASK, tokenBudget: 1024 },
    })) as ToolCall;
    expect(result.isError).toBeFalsy();
    const bundle = result.structuredContent as { contextText: string; selected: unknown[] };
    expect(textOf(result)).toBe(bundle.contextText);
    expect(bundle.selected).toHaveLength(2);
    const projects = (await mcp.client.callTool({
      name: 'list_projects',
      arguments: {},
    })) as ToolCall;
    expect(projects.structuredContent).toEqual({ projects: [graph.project] });
    const node = (await mcp.client.callTool({
      name: 'get_node',
      arguments: { projectId: PROJECT_ID, nodeId: seed.id },
    })) as ToolCall;
    expect((node.structuredContent as { id: string }).id).toBe(seed.id);
    await mcp.close();
  });

  it('maps typed errors to tool errors without internals (A3)', async () => {
    const broken: EmbeddingProvider = {
      ...provider,
      embed: async () => {
        throw graphError('EMBEDDING_UNAVAILABLE', 'down', { category: 'test' });
      },
    };
    const mcp = await connectMcp({ ...deps(), provider: broken });
    const unavailable = (await mcp.client.callTool({
      name: 'compile_context',
      arguments: { projectId: PROJECT_ID, task: TASK },
    })) as ToolCall;
    expect(unavailable.isError).toBe(true);
    expect(textOf(unavailable)).toMatch(/^EMBEDDING_UNAVAILABLE: /);
    const missing = (await mcp.client.callTool({
      name: 'get_node',
      arguments: { projectId: PROJECT_ID, nodeId: '00000000-0000-4000-8000-000000000000' },
    })) as ToolCall;
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toMatch(/^NOT_FOUND/);
    const unexpected = await connectMcp({
      ...deps(),
      store: { ...fakeStore(graph), listProjects: () => Promise.reject(new Error('pg secret')) },
    });
    const storage = (await unexpected.client.callTool({
      name: 'list_projects',
      arguments: {},
    })) as ToolCall;
    expect(storage.isError).toBe(true);
    expect(textOf(storage)).toBe('STORAGE_ERROR: Unexpected server error');
    await mcp.close();
    await unexpected.close();
  });

  it('rejects invalid arguments before reaching the compiler', async () => {
    const mcp = await connectMcp(deps());
    const result = (await mcp.client.callTool({
      name: 'compile_context',
      arguments: { projectId: 'nope', task: TASK },
    })) as ToolCall;
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('projectId');
    await mcp.close();
  });
});
