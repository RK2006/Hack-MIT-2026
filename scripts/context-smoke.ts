import 'dotenv/config';
import { createGraphStore } from '../src/server/context/store';
import { snapshotOf } from '../src/server/context/types';
import { createPool } from '../src/server/db/pool';
import { migrate } from '../src/server/db/migrate';

const firstPool = createPool();
await migrate(firstPool);
const firstStore = createGraphStore(firstPool);
let ids: { projectId: string; nodeId: string };
try {
  ids = await firstStore.transaction(async (tx) => {
    const project = await tx.createProject({
      name: `Foundation smoke ${new Date().toISOString()}`,
    });
    const source = await tx.createSource(project.id, {
      kind: 'manual',
      uri: `manual://smoke/${project.id}`,
      label: 'Smoke evidence',
      excerpt: 'Local synthetic smoke evidence',
      revisionRef: null,
    });
    const component = await tx.createNode(project.id, {
      type: 'component',
      title: 'Smoke component',
      content: 'Synthetic smoke content',
      authority: 'canonical',
      sourceId: source.id,
      actor: { kind: 'human', label: 'smoke' },
      changeReason: 'smoke create',
    });
    const constraint = await tx.createNode(project.id, {
      type: 'constraint',
      title: 'Smoke constraint',
      content: 'Synthetic constraint content',
      authority: 'canonical',
      sourceId: source.id,
      actor: { kind: 'human', label: 'smoke' },
      changeReason: 'smoke create',
    });
    await tx.createEdge(project.id, {
      fromNodeId: component.id,
      toNodeId: constraint.id,
      type: 'REQUIRES',
      authority: 'canonical',
      sourceId: source.id,
      actor: { kind: 'human', label: 'smoke' },
    });
    return { projectId: project.id, nodeId: component.id };
  });
} finally {
  await firstStore.close();
}

const secondPool = createPool();
const secondStore = createGraphStore(secondPool);
try {
  const current = await secondStore.getNode(ids.projectId, ids.nodeId);
  const changed = await secondStore.transaction(async (tx) => {
    const source = await tx.createSource(ids.projectId, {
      kind: 'manual',
      uri: `manual://smoke/${ids.nodeId}/revision`,
      label: 'Smoke revision',
      excerpt: 'Local synthetic revision evidence',
      revisionRef: null,
    });
    return tx.reviseNode(ids.projectId, ids.nodeId, {
      expectedVersion: 1,
      actor: { kind: 'human', label: 'smoke' },
      changeReason: 'smoke revise',
      snapshot: {
        ...snapshotOf(current),
        content: 'Revised synthetic smoke content',
        sourceId: source.id,
      },
    });
  });
  const graph = await secondStore.getGraph(ids.projectId);
  const history = await secondStore.listRevisions(ids.projectId, ids.nodeId);
  console.log(
    JSON.stringify({
      projectId: ids.projectId,
      nodeId: ids.nodeId,
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      currentVersion: changed.node.current.version,
      historyVersions: history.map((item) => item.version),
    }),
  );
} finally {
  await secondStore.close();
}
