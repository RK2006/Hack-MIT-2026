# Feature Spec — Graph Workbench and Context Review

Status: Scoped draft; expand before implementation
Owner: Project team
Related issue/task: [MVP plan](../MVP_PLAN.md); [foundation](context-graph-foundation.md), [ingestion](prepared-project-ingestion.md), [compiler](task-context-compiler.md)
Last updated: 2026-09-19

## 1. Summary

Add one local Next.js/React workbench to inspect the graph and its evidence, create
or revise context, review inferred claims, compare node revisions, and eventually
ask for and copy bounded task context. Build the graph/detail/history slice first;
integrate task selection once the compiler response contract is stable.

## 2. Problem

Stored knowledge is difficult to trust or demonstrate without seeing its structure,
origin, authority, and changes. A raw API does not show why a task needs one small
part of a project or make review of inferred claims approachable.

## 3. Goals

- Make connected project knowledge, evidence, and authority visible.
- Let the operator manually create/update/review claims with provenance.
- Show an immutable before/after node history example.
- Complete the task-to-context demo with highlighting, explanations, and copy output.

## 4. Non-goals

An elaborate design system, collaboration, graph layout persistence, arbitrary
edge editing/removal, graph time travel, auth, public hosting, proposal queues,
GitHub controls, MCP, or generating code with an LLM inside this application.

## 5. User experience

1. Select an imported project and see a readable directed graph.
2. Click a node to see content, authority, confidence, relationships, and source evidence.
3. Add context, optionally connected to one existing node, or edit an existing
   node. Supply a note explaining the source/reason; inferred claims have an
   explicit human review action to make them canonical.
4. Inspect revision history and compare two chosen revisions, including authority
   and provenance changes, without changing current knowledge.
5. Enter a task and context budget; inspect the selected subgraph and reasons,
   adjust budget, and copy the exact rendered context text.

Empty project, loading, validation error, conflict, compiler failure/degraded
response, and budget insufficiency states must be visible. A stale edit asks the
operator to reload current values; it never silently retries over newer knowledge.

## 6. Functional requirements

- [ ] W1: Render current active nodes and typed directed relationships; provide a
  node list/details fallback so the graph is not the sole means of navigation.
- [ ] W2: Display source locator, pinned reference, excerpt, actor/reason, revision,
  and canonical/inferred labels; inferred edges remain visibly distinguishable.
- [ ] W3: Support manual node creation, editing, review, archive/unarchive, with
  foundation validation, fresh manual evidence, and expected-version conflicts.
- [ ] W4: Display archived nodes in a separate list/detail/history path so they
  remain accessible after leaving the active graph.
- [ ] W5: Compare any two revisions of the same node, showing changed snapshot
  fields and source references; history view does not imply historical graph state.
- [ ] W6: Submit task/budget/depth, highlight bundle node IDs and explanation paths,
  show counted tokens/omissions/degraded status, and copy context text exactly.
- [ ] W7: Preserve editable user input on failures; avoid displaying a previous
  successful bundle as if it belonged to a failed or still-running request.

## 7. Data model

### New entities

None. Graph layout, selected node, draft form, selected history versions, and
current bundle are transient UI state. No browser-only copy of canonical knowledge.

### Changed entities

Use foundation mutations in one transaction per user action. Creation/review/edit
adds a manual source and a node revision atomically. A new node may include one
explicit manual edge in the same transaction. Editing an existing edge is deferred.
Archiving preserves all evidence/history; it is not a delete.

### Migration considerations

None. An archived-node listing read will be added to the foundation reader before
this UI is implemented; specify its exact shape with route payloads at that gate.
It must not change getGraph's active-only semantics.

## 8. API / interface changes

Next.js server routes call the graph store; browser code never imports the DB pool.
Planned route surface, to freeze with payloads before implementation:

| Route | Purpose |
| --- | --- |
| `GET /api/projects` | Choose a project |
| `GET /api/projects/:projectId/graph` | Active GraphSnapshot |
| `GET /api/projects/:projectId/nodes?archived=true` | Discover archived identities for restore/history |
| `GET /api/projects/:projectId/nodes/:nodeId` | Detail, including archived nodes |
| `GET /api/projects/:projectId/sources/:sourceId` | Immutable evidence detail |
| `GET /api/projects/:projectId/nodes/:nodeId/revisions` | Ordered full node snapshots |
| `POST /api/projects/:projectId/nodes` | Human source + new node + optional edge |
| `POST /api/projects/:projectId/nodes/:nodeId/revisions` | Human source + revision, including review/archive |
| `POST /api/projects/:projectId/context` | Compiler-owned request/response used by task panel |

Routes assign `actor: {kind: 'human', label: 'local-operator'}` for operator writes;
payloads cannot impersonate an importer/agent. Use server-side validation and map
VALIDATION_ERROR to 400, NOT_FOUND to 404, CONFLICT to 409,
AUTHORITY_VIOLATION to 403, LIMIT_EXCEEDED to 422, STORAGE_ERROR to 500.
The compiler owns provider-specific statuses and its route implementation.

Planned files: `src/app/`, `src/components/workbench/`,
`tests/workbench/`. Renderer/library choice and a simple wireframe remain explicit
pre-implementation decisions. Existing foundation setup is reused.

## 9. Context graph implications

Reads all current nodes/edges and selected history. Creates manual nodes/edges and
new snapshots through the store only. Review is explicit canonical promotion with
new provenance; historical source evidence is not overwritten. UI comparison does
not create a revision. Highlighting/ranking belongs to compiler output, not an
independent frontend algorithm. Copy uses the compiler's exact budgeted text.

## 10. Retrieval behavior

Delegate seeds/traversal/ranking/compression to the compiler. Controls use its
task, startNodeIds, tokenBudget, and maxDepth contract. Display explanations and
omissions, including inferred path edges. Budget applies to copied context text;
the rest of an agent's prompt is outside that budget. The UI must show tokenizer
identity and must not claim the count holds for every model.

## 11. Edge cases

Handle empty/missing projects, archived selections, failed source loads, conflicting
claims, invalid input, stale edits, and unavailable compiler/provider. Render large
supported graphs with the list fallback; no automatic truncation hidden from the
operator. When edits happen after a bundle was compiled, identify its cited
revisions as a snapshot and offer a rerun; do not relabel old text as current.
Clipboard failure leaves selectable text. Budget exhaustion still shows omissions.

## 12. Security / privacy considerations

Local loopback deployment only. Enforce same-origin mutation requests; no permissive
CORS. Render claims/evidence as escaped text, never trusted HTML. Open only safe
HTTPS evidence links; show custom repo/manual/agent locators as text. All credentials
remain server-side. The workbench does not itself call an agent or execute context.

## 13. Observability

Show safe operation errors and IDs, conflict versions, compiler warnings, and
selection reasons. No source text or secrets in request logs. Error UI should help
the operator retry deliberately without losing the draft.

## 14. Acceptance criteria

- [ ] A1: An imported project can be explored by graph and list, with correct edge
  direction, evidence, current revision, and authority labels.
- [ ] A2: Manual create/edit/review/archive/restore persist correctly; a stale edit
  displays a conflict without overwriting, and archived history remains reachable.
- [ ] A3: Comparing two revisions shows changed content, authority, source, and reason while leaving current state unchanged.
- [ ] A4: Task controls display the compiler selection, paths, token count, omissions,
  and exact copyable text; invalid/unavailable/degraded/empty states are clear.
- [ ] A5: The complete demo in the MVP plan succeeds, including a history change and subsequent current-context retrieval.

## 15. Test plan

### Unit tests

A3: Snapshot comparison across every mutable field. A4: Bundle rendering/copy
payload and failed-request state. A1: Escaped content and unsafe locator handling.

### Integration tests

A1/A2: Routes with a real test store, server-assigned actors, atomic source/revision
writes, expected-version conflict, archive listing, and same-origin checks.
A4: Task panel against compiler contract fixtures, including omissions and failure.

### UI/manual verification

A1–A5: Document a browser checklist using the prepared project: explore graph/list,
inspect source and inferred edge, create/edit/review, provoke two-tab conflict,
archive/restore, compare history, run task with two budgets, inspect highlights,
copy/paste text, simulate failure, revise a claim and rerun. Verify keyboard access
to controls and that graph/list/detail remain usable at a typical laptop viewport.
This is the final integrated demo gate; no full browser automation framework is
required solely for kickoff. Run Next.js production build plus existing checks.

## 16. Implementation plan

- [ ] Before coding, freeze wireframe/renderer, route payloads, archive-list reader, conflict/no-op behavior, and browser acceptance steps against foundation.
- [ ] Add Next.js/React to the existing package and implement read routes + graph/list/detail/evidence; verify A1.
- [ ] Add manual create/edit/review/archive/restore and two-revision comparison; verify A2/A3 and show the first visual/history demo.
- [ ] After ContextBundle is stable, integrate task/budget controls, highlights, explanations, and copy; verify A4.
- [ ] Execute the complete prepared-project demo, A5 and all manual checks; run tests/typecheck/lint/format/build, update durable context, commit/push.

## 17. Alternatives considered

### Separate graph UI, history UI, and integration features

They share selected-node state and source/revision views. One workbench delivered
in two slices avoids independent UI contracts while exposing early progress.

### Full visual graph editor

Would require edge mutation/history and layout persistence. A read graph with
small node forms proves inspection/review without those dependencies.

## 18. Durable context created by this feature

Planned: the UI reads/writes through shared store contracts; node history is not
whole-graph history; reviewed authority needs a human action; displayed bundles
are revision-specific snapshots. UI functionality has not been implemented.
