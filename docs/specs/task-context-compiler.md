# Feature Spec — Explainable Task Context Compiler

Status: Implementation-ready; implementation in progress
Owner: Project team
Related issue/task: [MVP plan](../MVP_PLAN.md); depends on [foundation](context-graph-foundation.md); evaluated with [prepared ingestion](prepared-project-ingestion.md); consumed by [workbench](graph-workbench.md)
Last updated: 2026-09-19

## 1. Summary

Turn a natural-language engineering task into a small, explainable context bundle.
Use semantic similarity and explicit references to find seeds, expand through
typed graph relationships, rank relevant candidates with authority preference,
and pack stored representations into a measured token budget. Return structured
selection evidence and copyable text through one API consumed by the workbench.

## 2. Problem

The full project graph is too broad for a task, and raw semantic search misses
related decisions or constraints. A useful bundle must show why claims were
included, preserve evidence and uncertainty, and state what did not fit.

## 3. Goals

- Combine semantic relevance with explainable graph paths.
- Prefer relevant canonical knowledge over weak inferred claims.
- Bound the complete rendered context with a configurable tokenizer budget.
- Return revision-specific selections, explanations, and meaningful omissions.
- Supply API/copy output that an external coding agent can consume.

## 4. Non-goals

Generative summarization, source-code execution, agent orchestration, MCP, vector
databases, background indexing workers, model-provider frameworks, branch-aware
retrieval, persisted bundles, whole-graph history, or a production search service.

## 5. User experience

The operator enters a task, optionally chooses starting nodes, and sets the context
budget. The response identifies relevant nodes, connects graph-derived choices
to seeds, shows authority/provenance and token use, and provides copyable context.
Reducing budget keeps the text bounded and exposes important omissions. A failed
embedding request is visibly unavailable/degraded, never a silent successful
semantic match. Copying hands off text; the product does not invoke a coding agent.

## 6. Functional requirements

- [ ] C1: Read a consistent snapshot of current, active project nodes/edges; never
      retrieve historical revisions or raw evidence records as independent claims.
- [ ] C2: Use real embedding similarity plus explicit file/component references
      for seed discovery; graph expansion must add useful related context.
- [ ] C3: Bound seeds, depth, and candidates with deterministic tie-breaks and
      visited-node tracking, while retaining actual edge directions and authority.
- [ ] C4: Rank eligible candidates transparently; canonical precedes inferred
      among relevant candidates, and unrelated canonical nodes are excluded.
- [ ] C5: Pack full/summary/title representations using the configured tokenizer;
      headings, citations, authority, reasons, and text warnings count toward the budget.
- [ ] C6: Include source IDs/locators, node versions, representations, reason codes,
      paths, token accounting, and omissions; label inferred paths as well as claims.
- [ ] C7: Report essential constraints that cannot fit and provider/indexing gaps;
      do not invent a summary or imply all necessary context was included.
- [ ] C8: Expose one JSON route and the exact rendered text for copying.

## 7. Data model

### New entities

One compiler-owned cache table, created by migration `002_context_embeddings`:

```sql
CREATE TABLE context_embeddings (
  project_id uuid NOT NULL,
  node_id uuid NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  provider_model text NOT NULL CHECK (char_length(provider_model) BETWEEN 1 AND 200),
  dimensions integer NOT NULL CHECK (dimensions BETWEEN 1 AND 4096),
  vector double precision[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (node_id, version, provider_model),
  FOREIGN KEY (project_id, node_id) REFERENCES context_nodes(project_id, id),
  FOREIGN KEY (node_id, version) REFERENCES context_revisions(node_id, version)
);
CREATE INDEX context_embeddings_project_idx ON context_embeddings(project_id, provider_model);
```

The cache stores derived vectors only; no canonical knowledge. The key
`(nodeId, version, providerModel)` prevents pairing an old vector with edited
content: a new revision has no cache row until it is embedded. Writes use
`INSERT ... ON CONFLICT DO NOTHING` outside graph transactions, through the
compiler's own module (`src/server/context/compiler/cache.ts`); it is not one of
the five product tables and the append-only foundation rule does not apply to it.
Vectors are validated before storage: finite numbers, length equal to `dimensions`,
and the provider's fixed dimensionality. The task embedding is transient.

### Changed entities

`GraphErrorCode` gains `EMBEDDING_UNAVAILABLE` (HTTP 503). No foundation table,
authority, confidence, or history semantics change. No persisted bundle entity.

### Migration considerations

Migration `002_context_embeddings` follows `001_context_graph` in the existing
runner. It is additive; no backfill. Deleting cache rows is safe at any time.

## 8. API / interface changes

### Resolved gates

| Gate                | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Embedding provider  | One `EmbeddingProvider` interface with exactly one configured backend, chosen by `EMBEDDING_PROVIDER`. Default `local`: `@xenova/transformers` running `Xenova/all-MiniLM-L6-v2` (quantized ONNX, mean pooling, L2-normalized, 384 dimensions) in-process; model id `local:Xenova/all-MiniLM-L6-v2`. Optional `openai`: `POST https://api.openai.com/v1/embeddings` with `text-embedding-3-small` (1536 dimensions) via `fetch`, requiring `OPENAI_API_KEY`; model id `openai:text-embedding-3-small`. The original plan preferred a hosted backend; no hosted embedding credential exists in this environment (the available Anthropic key has no embedding endpoint), so the local model is the default semantic backend and the hosted adapter is retained behind the same interface. Tests inject a `fixed` provider; it is never selectable from the environment. |
| Tokenizer           | `js-tiktoken` `cl100k_base`, reported as `tokenizer: "cl100k_base"`. Counts apply to that encoding only; the UI says so.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Embedding input     | `"<type>: <title>\n<summary>\n<content>"` with `"\npath: <path>"` appended for files, truncated to the first 1,500 Unicode code points (title and summary come first, so they are never cut). Batches of at most 32 texts per provider call.                                                                                                                                                                                                                                                                                                                                                                                                  |
| Provider policy     | Per-call timeout 30 s (local first load may download the model; later calls are fast). Hosted: one retry on network/5xx/429 after 500 ms. Any remaining failure, wrong count, wrong dimensionality, or non-finite values is `EMBEDDING_UNAVAILABLE`.                                                                                                                                                                                                                                                                                                                                                                                             |
| Request limits      | `task` 1–2,000 code points after trimming, no NUL; `tokenBudget` integer 256–8,192; `startNodeIds` 0–5 distinct UUIDs that are active nodes of the project; `maxDepth` integer 0–3, default 2; `allowDegraded` boolean, default false.                                                                                                                                                                                                                                                                                                                                                                                                       |
| Caps                | At most 5 semantic seeds plus all explicit seeds; at most 40 eligible candidates; BFS visited set per compile.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Error envelope      | `{ error: { code, message, details? } }` with the workbench's HTTP mapping plus `EMBEDDING_UNAVAILABLE → 503`. No provider credentials or submitted text appear in errors.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

### Shared contract

```ts
type ContextRequest = {
  task: string;
  tokenBudget: number; // context text only; default 4096 at the UI
  startNodeIds?: string[];
  maxDepth?: number; // default 2
  allowDegraded?: boolean; // default false: provider failure is a 503
};
type PathStep = {
  edgeId: string;
  fromNodeId: string;
  toNodeId: string; // actual stored direction
  traversed: 'forward' | 'reverse';
  type: EdgeType;
  authority: Authority;
};
type SelectionReason = {
  kind: 'semantic_match' | 'explicit_reference' | 'graph_neighbor' | 'lexical_match';
  description: string;
  seedNodeId: string;
  similarity: number | null;
  path: PathStep[];
};
type SelectedItem = {
  nodeId: string;
  version: number;
  type: NodeType;
  title: string;
  authority: Authority;
  representation: 'full' | 'summary' | 'title';
  score: number;
  relevance: number;
  sourceId: string;
  sourceUri: string;
  reasons: SelectionReason[];
};
type ContextBundle = {
  projectId: string;
  task: string;
  status: 'ok' | 'degraded';
  tokenBudget: number;
  tokenCount: number;
  tokenizer: 'cl100k_base';
  embeddingModel: string; // provider model id, or 'lexical-fallback' when degraded
  contextText: string;
  selected: SelectedItem[];
  omissions: Array<{
    nodeId: string;
    version: number;
    title: string;
    reason: 'budget' | 'candidate_limit' | 'embedding_unavailable';
    critical: boolean;
  }>;
  warnings: string[];
  metrics: {
    activeNodes: number;
    activeEdges: number;
    seeds: number;
    candidates: number;
    projectContextTokens: number; // measured: all active nodes rendered in full
  };
};
// compileContext(deps, projectId, request): Promise<ContextBundle>
```

`POST /api/projects/:projectId/context` accepts ContextRequest and returns
ContextBundle. Project IDs/start IDs are scoped through the store; invalid,
cross-project, or archived starts are `VALIDATION_ERROR`. Unknown projects are
`NOT_FOUND`. A wholly unavailable embedding backend returns 503 unless the
request sets `allowDegraded: true`, which returns a labeled `degraded` bundle
computed with lexical matching.

Files: `src/server/context/compiler/{types,embedding,cache,tokenizer,retrieval,render,compile,lexical}.ts`,
route `src/app/api/projects/[projectId]/context/route.ts`, tests `tests/compiler/`,
smoke `scripts/semantic-smoke.ts` (`npm run semantic:smoke`).

## 9. Context graph implications

Reads all supported node/edge types but writes no claims, relationships, authority,
or history. Embeddings are derived from current claim text, not raw evidence.
Every selected node is pinned to a version, and all graph explanations reference
real edges from the same captured snapshot. Evidence remains separately readable.
Compiler results can change after an edit without altering a prior revision.

## 10. Retrieval behavior

All constants below are the contract; tests assert them with fixed vectors.

### Stage 0 — Snapshot

Call `store.getGraph(projectId)` once (REPEATABLE READ). All later stages use
that snapshot's node versions and edges. Archived nodes and their edges are
already absent. Edits committed during compilation do not enter the bundle.

### Stage 1 — Similarity

Embed the task and every active node (cache hits by `(nodeId, version, model)`).
`sim(n) = clamp(cosine(task, n), 0, 1)`. Let `sMax = max sim(n)`;
`semanticNorm(n) = sim(n) / sMax` when `sMax > 0`, else 0.

### Stage 2 — Seeds

- Explicit seeds: every `startNodeIds` entry; every node whose `path` appears
  in the task (case-insensitive substring); every node whose `externalKey`
  appears in the task; every node whose title (≥ 8 code points) appears in the
  task case-insensitively. Explicit seed relevance is `1.0`.
- Semantic seeds: nodes with `sim ≥ minSeedSimilarity` (local `0.25`,
  openai `0.30`), sorted by `sim` desc then nodeId asc, top 5. Seed relevance
  is `semanticNorm(n)`.
- A node that is both keeps relevance `1.0` and both reasons.

### Stage 3 — Expansion

Breadth-first from all seeds to `maxDepth`. Queue order is `(depth asc,
relevance desc, nodeId asc)`. For an edge `from → to` of type `T`, traversal
from `u` to `v` uses weight `w(T, direction)`:

| Type       | forward (u = from → v = to)              | reverse (u = to → v = from)                    |
| ---------- | ---------------------------------------- | ---------------------------------------------- |
| REQUIRES   | 1.0 (what u needs)                       | 0.6                                            |
| CONSTRAINS | 0.6 (what the constraint limits)         | 1.0 (constraints on u)                         |
| DEPENDS_ON | 0.9 (u's dependency)                     | 0.5                                            |
| IMPLEMENTS | 0.9 (concept u implements)               | 0.9 (implementations of u)                     |
| AFFECTS    | 0.6                                      | 0.8 (things affecting u, e.g. bugs)            |
| CAUSED_BY  | 0.8 (cause of u)                         | 0.5                                            |
| RELATED_TO | 0.5                                      | 0.5                                            |
| CONTAINS   | 0.3 (children) — skipped from hubs       | 0.4 (parent)                                   |

`relevance(v) = max(relevance(v), relevance(u) × w)`. The path producing the
best relevance is recorded; a node is expanded once (visited set), with the
depth at which it was first dequeued. Hub rule: forward CONTAINS edges are not
followed from a node with more than 5 outgoing CONTAINS edges. Nodes whose
relevance is below `ELIGIBILITY_FLOOR = 0.25` are neither eligible nor expanded.
Cycles terminate through the visited set; every path contains real edge IDs
with actual stored direction and authority.

### Stage 4 — Eligibility and ranking

Eligible candidates: seeds and expanded nodes with `relevance ≥ 0.25`. Unrelated
nodes, however canonical, are excluded because they are never reached.

```
score = relevance
      × authorityFactor        (canonical 1.0, inferred 0.8)
      × (0.7 + 0.06 × importance)   // 0.76 … 1.0
      × (0.7 + 0.3 × confidence)    // 0.7 … 1.0
      × typeFactor             (constraint 1.10, decision 1.05, bug 1.0, component 1.0,
                                discovery 0.95, file 0.95, assumption 0.90)
      + 0.15 × semanticNorm(n)
```

Order by `score` desc, then canonical before inferred, then importance desc,
then nodeId asc. Candidates beyond the 40th become `candidate_limit` omissions.
Reasons are emitted from the actual computation: `semantic_match` when
`sim ≥ minSeedSimilarity` (with similarity), `explicit_reference` for explicit
seeds (which reference matched), `graph_neighbor` with the recorded best path and
a description such as `one hop from "Stripe webhooks" via REQUIRES (canonical)`;
inferred edges are labeled `(inferred)` in the description.

### Stage 5 — Packing

Iterate candidates in rank order. For each, try representation `full` (title,
content, reasons, source citation), then `summary` (only if the stored summary
is non-empty), then `title`. Accept the first representation for which the
complete rendered text — header, all sections, all accepted items, omission
list, and warnings — is ≤ `tokenBudget` in `cl100k_base`. If none fits, record a
`budget` omission. Essential constraint = `constraint` node with importance ≥ 4
and relevance ≥ 0.5. An essential constraint that is omitted is `critical: true`;
one included as `summary`/`title` adds a warning naming it as incomplete.
After the loop, re-render with all omissions/warnings; if the text exceeds the
budget, demote the lowest-ranked accepted item (full → summary → title → omit)
and repeat until it fits. The result always satisfies `tokenCount ≤ tokenBudget`.

### Rendering

Markdown sections in priority order: Constraints, Decisions, Components, Files,
Bugs and discoveries, Assumptions. Each item:

```
### [canonical] A provider event ID may produce side effects once  (constraint v1)
<content | summary | (title only)>
Why: semantic match (similarity 0.41); one hop from "Stripe webhooks" via REQUIRES (canonical)
Source: manual — manual://demo-payments/curator-notes (source <id>)
```

Header: `# Task context: <project name>` and a line with tokenizer, embedding
model, status, and the synthetic-data note when the project name contains
"synthetic". Then `## Omitted context` (title, version, reason, critical flag)
and `## Warnings` when non-empty. Degraded mode always includes the warning
`Semantic embeddings were unavailable; selection used lexical matching only.`
in the text. Empty eligible set renders header plus
`No relevant context was found for this task.` with empty selection.

### Degraded mode

When the provider fails and `allowDegraded` is true: `sim` is replaced by
lexical overlap (Jaccard of lowercase word tokens ≥ 3 characters between the
task and the node's embedding input, `minSeedSimilarity = 0.08`), reasons use
kind `lexical_match`, `status = 'degraded'`, `embeddingModel = 'lexical-fallback'`.
This is a debugging mode and does not satisfy A1.

### Project context metric

`metrics.projectContextTokens` is the `cl100k_base` count of all active nodes
rendered as `full` items with the same header; it is measured, not estimated,
and the UI labels it as such.

## 11. Edge cases

Unknown/empty projects, no semantic matches, out-of-project starts, cyclic graphs,
high-degree hubs, duplicate paths, conflicting claims, large/Unicode content,
overlong constraints, small budgets, provider outages, malformed vectors, and
edited nodes while compilation runs are covered by Stages 0–5. Finish using the
captured revision snapshot; do not mix new versions into an in-flight bundle.
No graph-wide freshness or contradiction resolution is implied. A missing cached
embedding is recomputed; a previous revision's vector is never reused. Cache rows
for the same key from concurrent compiles are deduplicated by `ON CONFLICT`.

## 12. Security / privacy considerations

Keys remain server-side; exactly one embedding backend is configured. The local
model runs in-process and sends nothing over the network after its one-time
model download from the Hugging Face hub (cached under
`node_modules/@xenova/transformers/.cache`). The hosted adapter sends only the
prepared public/synthetic project context. Claims/evidence are untrusted content
rendered as context, not agent instructions. No tool execution or canonical
writes arise from retrieval. Tasks, text, and vectors are not logged. Known
limitation: `@xenova/transformers@2.17.2` carries transitive audit findings in
`protobufjs` (used only by the unused `onnxruntime-web` path) and `sharp` (image
pipelines, unused); the ONNX Node runtime is exercised only on trusted local text.

## 13. Observability

Expose tokenizer/model identity, stage counts (`metrics`), selected versions,
reasons/paths, omissions, and degraded status. Server logs include provider error
category, stage durations, and counts only.

## 14. Acceptance criteria

- [ ] A1: A paraphrased task retrieves a useful semantic seed and at least one
      useful graph neighbor without direct keyword overlap; unrelated distractors are excluded.
- [ ] A2: Among eligible competing claims, canonical precedes weak inferred;
      inferred claims/path edges stay labeled, and unrelated canonical nodes do not win.
- [ ] A3: Complete rendered context always fits the selected tokenizer budget,
      including Unicode, headers, citations, warnings, and small-budget cases.
- [ ] A4: Every selected item has an existing node/version/source and a faithful
      reason; graph paths contain real edges with correct direction and authority.
- [ ] A5: Cycles/limits terminate deterministically; critical omissions, no fits,
      no matches, provider failure, and partial coverage are explicit.
- [ ] A6: Editing a node changes the retrieved current version and cache key without
      altering old history; an in-flight snapshot stays internally consistent.
- [ ] A7: JSON route and copied context match the bundle contract and satisfy the integrated workbench demo.

## 15. Test plan

### Unit tests (`tests/compiler/*.test.ts`, fixed provider)

- A1/A2/A4: `retrieval.test.ts` — synthetic graph with fixed vectors: semantic
  seed, neighbor without keywords, distractor exclusion, canonical-before-inferred
  with equal relevance, inferred path labels, reverse traversal direction, hub rule.
- A5: cycle termination, candidate cap → `candidate_limit`, depth 0, no seeds →
  empty bundle text, provider failure → `EMBEDDING_UNAVAILABLE` or degraded bundle.
- A3: `packing.test.ts` — real `cl100k_base` over budgets 256/512/1024/4096 with
  Unicode content and a long constraint; `tokenCount ≤ tokenBudget` and critical
  omission reporting; empty-fit case.
- Validation: request limits and error codes.

### Integration tests (`tests/compiler/compile.integration.test.ts`)

- A1/A4/A6: import the fixture into an isolated PostgreSQL schema, compile with a
  fixed provider, assert selected keys/versions/sources; revise a node, compile
  again, assert the new version is selected and a new cache row exists while the
  old revision and old cache row remain readable.
- A7: route handler validation/error envelope and response contract.

### UI/manual verification

- A1 (semantic gate): `npm run semantic:smoke` compiles `DEMO_TASK` against the
  imported demo project with the configured real provider and asserts
  `EXPECTED_RELEVANT_KEYS` ⊆ selected and `EXPECTED_DISTRACTOR_KEYS` ∩ selected = ∅;
  it prints model id, similarities, and token counts. Record the observed result
  in §18.
- A7: workbench task → highlight → explanation → copy demo with two budgets.

## 16. Implementation plan

- [x] Finalize provider/model, tokenizer, cache migration, contracts, scoring/eligibility, representation rules, caps, and fixture expectations (this document).
- [ ] Migration 002, `EMBEDDING_UNAVAILABLE`, provider interface with local/openai/fixed adapters, cache module; verify cache keying (A6).
- [ ] Retrieval (similarity, seeds, expansion, ranking, reasons); verify A1/A2/A4/A5 with fixed fixtures.
- [ ] Tokenizer, rendering, packing; verify A3 and budget omissions.
- [ ] `compileContext`, JSON route, semantic smoke script; verify A7 and real-provider A1.
- [ ] Run tests/typecheck/lint/format/build; record model/tokenizer/observations in §18; commit/push.

## 17. Alternatives considered

### Independent retrieval, compression, and explainability features

They share candidate/representation contracts and cannot independently guarantee
honest budgeted output. Combine them into one compiler with separately tested functions.

### Pure lexical search or pure vector search

Lexical-only misses the semantic invariant. Vector-only misses relational evidence.
Use semantic seeds plus transparent bounded graph traversal.

### Hosted-only embeddings

Preferred by the kickoff plan, but no hosted embedding credential is available in
the implementation environment. A local sentence-transformer behind the same
interface provides real semantic similarity for the demo; the hosted adapter
remains one environment variable away.

### LLM-generated compression and pgvector

Generation adds cost, nondeterminism, and possible loss of constraints. A vector
index adds infrastructure for at most 1,000 nodes. Stored representations and
application scoring are sufficient for this MVP.

## 18. Durable context created by this feature

Budget is for the exact rendered context under `cl100k_base`; bundle items cite
node versions and source IDs; evidence and inferred edges remain labeled;
canonical preference follows relevance eligibility; lexical fallback is degraded,
not semantic success. Embedding backend is selected by `EMBEDDING_PROVIDER`
(`local` default, `openai` optional); the cache key includes the model id so
switching providers never reuses vectors. Observed results are recorded here
after implementation.
