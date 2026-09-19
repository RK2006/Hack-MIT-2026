import 'dotenv/config';
import { createEmbeddingCache } from '../src/server/context/compiler/cache';
import { compileContext } from '../src/server/context/compiler/compile';
import { embeddingProviderFromEnv } from '../src/server/context/compiler/embedding';
import { createGraphStore } from '../src/server/context/store';
import { migrate } from '../src/server/db/migrate';
import { createPool } from '../src/server/db/pool';
import {
  DEMO_PROJECT_ID,
  DEMO_TASK,
  EXPECTED_DISTRACTOR_KEYS,
  EXPECTED_RELEVANT_KEYS,
} from '../src/server/ingestion/demo-expectations';

// Real-provider semantic gate (compiler spec A1): the configured embedding backend must select
// every expected relevant node and none of the distractors for the paraphrased demo task.
const budget = Number(process.argv[2] ?? 4096);
const pool = createPool();
await migrate(pool);
const store = createGraphStore(pool);
const provider = embeddingProviderFromEnv();
try {
  const started = Date.now();
  const bundle = await compileContext(
    { store, provider, cache: createEmbeddingCache(pool) },
    DEMO_PROJECT_ID,
    { task: DEMO_TASK, tokenBudget: budget },
  );
  const graph = await store.getGraph(DEMO_PROJECT_ID);
  const keyOf = new Map(graph.nodes.map((node) => [node.id, node.externalKey ?? node.id]));
  const selectedKeys = bundle.selected.map((item) => keyOf.get(item.nodeId)!);
  const missing = EXPECTED_RELEVANT_KEYS.filter((key) => !selectedKeys.includes(key));
  const leaked = EXPECTED_DISTRACTOR_KEYS.filter((key) => selectedKeys.includes(key));
  console.log(
    JSON.stringify(
      {
        label: 'synthetic prepared example',
        task: DEMO_TASK,
        embeddingModel: bundle.embeddingModel,
        tokenizer: bundle.tokenizer,
        status: bundle.status,
        durationMs: Date.now() - started,
        tokenCount: bundle.tokenCount,
        tokenBudget: bundle.tokenBudget,
        projectContextTokens: bundle.metrics.projectContextTokens,
        metrics: bundle.metrics,
        selected: bundle.selected.map((item) => ({
          key: keyOf.get(item.nodeId),
          v: item.version,
          authority: item.authority,
          representation: item.representation,
          score: item.score,
          reasons: item.reasons.map((reason) => reason.description),
        })),
        omissions: bundle.omissions.map((o) => `${o.title} (${o.reason})`),
        warnings: bundle.warnings,
        missingRelevant: missing,
        leakedDistractors: leaked,
      },
      null,
      2,
    ),
  );
  if (bundle.status !== 'ok' || missing.length > 0 || leaked.length > 0) {
    console.error('Semantic smoke FAILED');
    process.exitCode = 1;
  } else {
    console.log('Semantic smoke PASSED');
  }
} finally {
  await store.close();
}
