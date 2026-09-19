# Feature Spec — Explainable Task Context Compiler

Status: Scoped draft; expand before implementation
Owner: Project team
Related issue/task: [MVP plan](../MVP_PLAN.md); depends on [foundation](context-graph-foundation.md); evaluated with [prepared ingestion](prepared-project-ingestion.md)
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

A small embedding cache keyed by `(projectId, nodeId, version, providerModel)`.
Store vector and creation metadata only; no canonical knowledge in this cache.
The precise SQL migration, vector validation, embedding input serialization, and
cache ownership are pre-implementation gates. The key prevents an old embedding
being paired with edited content. The task embedding may be transient.

### Changed entities

None in the foundation. Ranking weights and token costs are derived, not mutations
of node confidence or authority. No persisted bundle entity is required.

### Migration considerations

Add the cache in this feature's own migration after foundation. Use ordinary
PostgreSQL storage and application cosine scoring for the bounded project size.
No pgvector dependency or search infrastructure is required.

## 8. API / interface changes

Proposed shared response contract to finalize before workbench integration:

```ts
type ContextRequest = {
  task: string;
  tokenBudget: number; // context text only; default 4096 at the UI
  startNodeIds?: string[];
  maxDepth?: number; // default 2
};
type PathStep = {
  edgeId: string;
  fromNodeId: string; toNodeId: string; // actual stored direction
  traversed: 'forward' | 'reverse';
  type: EdgeType; authority: Authority;
};
type SelectionReason = {
  kind: 'semantic_match' | 'explicit_reference' | 'graph_neighbor';
  description: string;
  seedNodeId: string;
  similarity: number | null;
  path: PathStep[];
};
type ContextBundle = {
  projectId: string; task: string;
  status: 'ok' | 'degraded';
  tokenBudget: number; tokenCount: number; tokenizer: string;
  contextText: string;
  selected: Array<{
    nodeId: string; version: number; authority: Authority;
    representation: 'full' | 'summary' | 'title';
    sourceId: string; sourceUri: string;
    reasons: SelectionReason[];
  }>;
  omissions: Array<{
    nodeId: string; version: number;
    reason: 'budget' | 'candidate_limit' | 'embedding_unavailable';
    critical: boolean;
  }>;
  warnings: string[];
};
// compileContext(projectId, request): Promise<ContextBundle>
```

`POST /api/projects/:projectId/context` accepts ContextRequest and returns
ContextBundle. Project IDs/start IDs are scoped through the store; invalid,
cross-project, or archived starts are rejected. Foundation errors retain the
workbench's HTTP mappings. A wholly unavailable embedding backend returns 503
unless the caller-facing policy explicitly opts into a labeled degraded result.
API errors do not contain provider credentials or submitted content.

Fix before implementation: task length/body limits, start count, seed/candidate
caps, maximum depth, representation eligibility, scoring/tie rules, tokenizer,
provider timeout/retry policy, cache schema, and exact error envelope. Proposed
budget range is integer 256–8192, depth 0–3; validate and freeze these with the
chosen tokenizer/fixtures. This scoped draft is not permission to code unresolved
ranking behavior. Planned files: `src/server/context/compiler/`, its route handler,
and `tests/compiler/`; no compiler code exists yet.

## 9. Context graph implications

Reads all supported node/edge types but writes no claims, relationships, authority,
or history. Embeddings are derived from current claim text, not raw evidence.
Every selected node is pinned to a version, and all graph explanations reference
real edges from the same captured snapshot. Evidence remains separately readable.
Compiler results can change after an edit without altering a prior revision.

## 10. Retrieval behavior

1. Capture getGraph once. Use node title/summary/content and optional file path for
   embeddings, never concatenate all project evidence into one prompt. One hosted
   provider/model is selected before implementation; use public/synthetic data only.
2. Find a bounded seed set by task similarity and explicit starts/path references.
   Fixed embedding fixtures test algorithms; a real-provider paraphrase check tests
   semantic behavior. Lexical matching may supplement or visibly degrade results,
   but cannot alone pass MVP acceptance.
3. Expand selected relation types in useful directions up to maxDepth; allow
   reverse traversal when appropriate (for example an incoming CONSTRAINS), retain
   actual direction, and suppress cycles/duplicate candidates. Structural hubs
   must not pull the entire project into the candidate set.
4. Establish relevance eligibility first, then rank using semantic/path relevance,
   canonical authority, importance, and confidence. Fix exact formulas and type
   priorities here before implementation; emit human-readable reasons from the
   actual computation, not post-hoc LLM explanations. Inferred edges never become
   canonical evidence just because their endpoints are canonical.
5. Pack deterministic full, stored summary, or title representations. A title-only
   essential constraint is an incomplete constraint, not full coverage. Show
   omissions/warnings when important substantive context does not fit. No generated
   summaries or arbitrary truncation that changes a claim's meaning.
6. Count the final rendered text as a whole, not the sum of independently tokenized
   snippets; recheck after adding labels/reasons/citations/warnings. Return only text
   within the supplied context budget. The request task, JSON metadata, and the
   consuming agent's other prompt messages are outside this budget. Report tokenizer
   identity; do not claim exact token equivalence for all downstream models.

Empty eligible sets return bounded text explaining no relevant context and empty
selection. If no item fits, return an empty selection with omissions and a short
budget warning if it fits; contextText may be empty. Required information must not
be silently removed to make a bundle look complete. Any degraded-mode warning that
affects interpretation must appear in copied text as well as response metadata.

## 11. Edge cases

Unknown/empty projects, no semantic matches, out-of-project starts, cyclic graphs,
high-degree hubs, duplicate paths, conflicting claims, large/Unicode content,
overlong constraints, small budgets, provider outages, malformed vectors, partial
embedding coverage, and edited nodes while compilation runs. Finish using the
captured revision snapshot; do not mix new versions into an in-flight bundle.
No graph-wide freshness or contradiction resolution is implied. A missing cached
embedding is recomputed or reported; never use the previous revision's vector.

## 12. Security / privacy considerations

Keys remain server-side; configure exactly one embedding backend. The MVP sends
only the prepared public/synthetic project context; arbitrary private ingestion
is out of scope. Claims/evidence are untrusted content and are rendered as context,
not higher-priority agent instructions. No tool execution or automatic canonical
writes arise from retrieval. Do not log submitted tasks, text, or vectors by default.

## 13. Observability

Expose tokenizer/model identity, stage counts, selected versions, reasons/paths,
omissions, and degraded status. Server logs include request ID, stage duration,
provider error category, and counts only. No monitoring platform is necessary.

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

### Unit tests

A1/A2/A4/A5: Fixed vectors and graph fixtures for seed discovery, eligibility,
authority, reverse paths, cycles, limits, stable ties, and explanations.
A3: Real chosen tokenizer over complete final text at budget boundaries, multiple
budgets, Unicode, long constraints, and empty-fit cases. Tokenizer mocks do not
establish the budget guarantee. A5: Provider timeout/error/malformed-vector fixtures.

### Integration tests

A1/A4/A6: Real PostgreSQL imported graph + deterministic embedding adapter for
revision/cache/snapshot behavior. A7: Route validation/error and response contract.
A5/A6: Partial coverage and edits during compilation do not silently mix versions.

### UI/manual verification

A1: Live configured-provider semantic smoke test with the agreed paraphrase and
expected relevant keys; record model and observed result. Unavailable credentials
mean this criterion is not passed, even if unit tests pass. A7: Workbench task →
highlight → explanation → copy demo with two budgets, source/version inspection,
and measured whole-project versus selected-context sizes. A2/A3/A5 are also
visually checked for honest labels and omission warnings in the copied text.

## 16. Implementation plan

- [ ] Finalize provider/model, tokenizer, cache migration, exact input/output/error contracts, scoring/eligibility, representation rules, caps, and fixture expectations before coding.
- [ ] Implement snapshot reads + revision-keyed embedding cache/provider; verify semantic seed behavior and A6.
- [ ] Implement bounded expansion/ranking and actual selection reasons; verify A1/A2/A4/A5 with fixed fixtures.
- [ ] Implement deterministic packing and complete-text token verification; verify A3 and budget-omission portions of A5.
- [ ] Add the JSON route and integrate the workbench; verify A7 plus real-provider A1 smoke.
- [ ] Run relevant tests/typecheck/lint/format/build and complete demo; record model/tokenizer/limitations in this spec and commit/push the verified feature.

## 17. Alternatives considered

### Independent retrieval, compression, and explainability features

They share candidate/representation contracts and cannot independently guarantee
honest budgeted output. Combine them into one compiler with separately tested functions.

### Pure lexical search or pure vector search

Lexical-only misses the semantic invariant. Vector-only misses relational evidence.
Use semantic seeds plus transparent bounded graph traversal.

### LLM-generated compression and pgvector

Generation adds cost, nondeterminism, and possible loss of constraints. A vector
index adds infrastructure for at most 1,000 nodes. Stored representations and
application scoring are sufficient for this MVP.

## 18. Durable context created by this feature

Planned: budget is for the exact rendered context under one named tokenizer;
bundle IDs cite node versions; evidence and inferred edges remain labeled;
canonical preference follows relevance eligibility; lexical fallback is degraded,
not semantic success. Provider/model and scoring details are deliberately explicit
next-spec gates. No retrieval capability has been implemented or evaluated yet.
