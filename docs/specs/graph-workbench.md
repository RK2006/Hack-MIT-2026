# Feature Spec — Graph Workbench and Context Review

Status: Implementation-ready; implementation in progress
Owner: Project team
Related issue/task: [MVP plan](../MVP_PLAN.md); [foundation](context-graph-foundation.md), [ingestion](prepared-project-ingestion.md), [compiler](task-context-compiler.md)
Last updated: 2026-09-19

## 1. Summary

Add one local Next.js/React workbench to inspect the graph and its evidence, create
or revise context, review inferred claims, compare node revisions, and ask for and
copy bounded task context. Build the graph/detail/history slice first; integrate
task selection against the compiler's `ContextBundle` contract.

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

1. `/` lists projects; choosing one opens `/projects/<projectId>`.
2. The project page has three regions: graph/list (left), detail panel (right),
   task panel (bottom of the right column, collapsible). The graph is an SVG with
   a deterministic in-app force layout; nodes are colored by type, dashed outline
   for inferred, and edges are directed arrows labeled by type (dashed when
   inferred). A "List" toggle shows the same nodes as a table filterable by type
   and text, so the graph is never the only navigation.
3. Clicking a node shows: title, type, authority label, importance, confidence,
   version, actor/reason, external key/path, content, summary; relationships as
   directed sentences ("this node → REQUIRES → Idempotency (canonical)"); the
   source evidence (kind, label, locator, pinned ref, excerpt) loaded on demand.
4. "Edit" opens a form pre-filled with the current snapshot plus a change reason
   and evidence note. "Review as canonical" pre-sets authority to canonical.
   "Archive"/"Restore" toggle the archived flag with a reason. "New node" opens a
   blank form with an optional single edge to the selected node.
5. "History" lists revisions; choosing two shows a field-by-field comparison and
   each revision's source. Comparison never writes.
6. "Archived" tab lists archived nodes for detail/history/restore.
7. Task panel: task text, token budget (256–8,192, default 4,096), depth (0–3),
   optional start = selected node, "Allow degraded" checkbox off by default,
   Compile. Result: status, tokenizer, model, measured tokens vs budget vs
   measured project context tokens, ranked selected items with reasons/paths and
   authority labels, omissions, warnings, rendered text with Copy. Graph and list
   highlight selected node IDs. Editing after compile marks the bundle "stale;
   recompile" without hiding it.

Empty project, loading, validation error, conflict, compiler failure/degraded
response, and budget insufficiency states are visible. A stale edit shows the
conflict (expected/actual versions) and a "Reload current" action; drafts persist.

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

The foundation reader gains `listArchivedNodes(projectId): Promise<ContextNode[]>`
(current revision archived, ordered by node UUID). `getGraph` keeps active-only
semantics. Each operator write is one store transaction: create manual source,
then create node (+ optional edge) or revise node.

### Migration considerations

None.

## 8. API / interface changes

Route handlers live in `src/app/api/...`; they call a process-wide store from
`src/server/runtime.ts` (`getStore()` on `globalThis`, pool from `DATABASE_URL`,
migrations applied on first use). Browser code never imports `pg`.

All responses are JSON. Errors use `{ error: { code, message, details? } }` with
`VALIDATION_ERROR 400`, `NOT_FOUND 404`, `CONFLICT 409`, `AUTHORITY_VIOLATION 403`,
`LIMIT_EXCEEDED 422`, `EMBEDDING_UNAVAILABLE 503`, `STORAGE_ERROR 500`, and
`FORBIDDEN_ORIGIN 403` for cross-origin mutations. Mutations (`POST`) require the
`Origin` header, when present, to match the request's own origin, or
`Sec-Fetch-Site: same-origin`; requests with neither header are accepted as
non-browser local tooling.

| Route                                               | Response                                            |
| --------------------------------------------------- | --------------------------------------------------- |
| `GET /api/projects`                                 | `{ projects: Project[] }`                           |
| `GET /api/projects/:projectId/graph`                | `GraphSnapshot`                                     |
| `GET /api/projects/:projectId/nodes?archived=true`  | `{ nodes: ContextNode[] }` (archived only)          |
| `GET /api/projects/:projectId/nodes/:nodeId`        | `ContextNode` (archived included)                   |
| `GET /api/projects/:projectId/sources/:sourceId`    | `Source`                                            |
| `GET /api/projects/:projectId/nodes/:nodeId/revisions` | `{ revisions: NodeRevision[] }`                  |
| `POST /api/projects/:projectId/nodes`               | `{ node: ContextNode; edge: ContextEdge \| null }`  |
| `POST /api/projects/:projectId/nodes/:nodeId/revisions` | `{ node: ContextNode; changed: boolean }`       |
| `POST /api/projects/:projectId/context`             | `ContextBundle` (compiler-owned)                    |

```ts
type OperatorEvidence = { evidenceNote: string; changeReason: string };
type CreateNodeRequest = OperatorEvidence & {
  node: {
    type: NodeType; title: string; content: string; summary?: string;
    authority: Authority; importance?: number; confidence?: number;
    externalKey?: string | null; path?: string | null;
  };
  edge?: { otherNodeId: string; type: EdgeType; direction: 'outgoing' | 'incoming'; authority: Authority };
};
type ReviseNodeRequest = OperatorEvidence & {
  expectedVersion: number;
  snapshot: Omit<NodeSnapshot, 'sourceId'>;
};
```

The server creates the manual source `{ kind: 'manual', uri: 'manual://workbench/<uuid>',
label: 'Workbench operator note', excerpt: evidenceNote, revisionRef: null }` in
the same transaction and assigns `actor: { kind: 'human', label: 'local-operator' }`.
Payloads cannot choose the actor or source kind. `direction: 'outgoing'` stores
`new → other`; `'incoming'` stores `other → new`.

Files: `src/server/runtime.ts`, `src/server/http.ts` (error mapping, origin check,
JSON helpers), `src/server/workbench/mutations.ts`, `src/app/api/**/route.ts`,
`src/app/page.tsx`, `src/app/projects/[projectId]/page.tsx`,
`src/components/workbench/*.tsx`, `src/lib/{api,compare,layout}.ts`,
`tests/workbench/`.

## 9. Context graph implications

Reads all current nodes/edges and selected history. Creates manual nodes/edges and
new snapshots through the store only. Review is explicit canonical promotion with
new provenance; historical source evidence is not overwritten. UI comparison does
not create a revision. Highlighting/ranking belongs to compiler output, not an
independent frontend algorithm. Copy uses the compiler's exact budgeted text.

## 10. Retrieval behavior

Delegate seeds/traversal/ranking/compression to the compiler. Controls use its
task, startNodeIds, tokenBudget, maxDepth, and allowDegraded contract. Display
explanations and omissions, including inferred path edges. Budget applies to
copied context text; the rest of an agent's prompt is outside that budget. The
UI shows tokenizer identity and states that counts hold for that encoding only.

## 11. Edge cases

Handle empty/missing projects, archived selections, failed source loads, conflicting
claims, invalid input, stale edits, and unavailable compiler/provider. Render large
supported graphs with the list fallback; no automatic truncation hidden from the
operator. When edits happen after a bundle was compiled, label the bundle stale and
offer a rerun; do not relabel old text as current. Clipboard failure leaves the text
selectable in a read-only textarea. Budget exhaustion still shows omissions.

## 12. Security / privacy considerations

Local loopback deployment only (`next dev -H 127.0.0.1`). Same-origin check on
mutations; no CORS headers. Claims/evidence render as React text, never HTML.
Only `https:` evidence locators become links; `repo:`/`manual:`/`agent:` are text.
All credentials remain server-side. The workbench does not call an agent.

## 13. Observability

Show safe operation errors and IDs, conflict versions, compiler warnings, and
selection reasons. No source text or secrets in request logs.

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

- A3: `tests/workbench/compare.test.ts` — snapshot comparison across every field.
- A1: `tests/workbench/layout.test.ts` — deterministic layout and safe-link rule.

### Integration tests (`tests/workbench/routes.integration.test.ts`)

- A1/A2: invoke route handlers with real `Request` objects against an isolated
  PostgreSQL store: list/graph/node/source/revisions; create with edge; revise
  (review to canonical); stale expectedVersion → 409 without a new revision;
  archive → absent from graph, present in `?archived=true`, history readable;
  cross-origin POST → 403; invalid payload → 400.

### UI/manual verification (final demo checklist)

1. `npm run import:demo` (fresh DB), `npm run dev`, open `http://127.0.0.1:3000`.
2. Open the demo project; confirm graph and list; select "Stripe webhooks";
   confirm `→ REQUIRES →` constraint edge direction and canonical label; open
   the inferred bug node and confirm dashed/inferred labels and agent evidence.
3. Task panel: "Fix duplicate Stripe webhook processing", budget 4,096, depth 2 →
   selected includes the webhook component, handler file, constraint, decision,
   receipt store (no task keywords), bug; distractors absent; reasons/paths shown;
   token count < budget < project context tokens. Copy text; paste elsewhere.
4. Budget 512 → omissions/warnings shown; text still ≤ 512 tokens.
5. Edit "An in-memory seen-event set might be sufficient": review as canonical
   with corrected content; History shows v1/v2; compare shows authority,
   content, source, reason differences.
6. Recompile the same task → selected item shows version 2 and canonical label;
   v1 remains readable in History.
7. Two tabs: edit the same node in both; second save shows a 409 conflict with
   expected/actual versions and reload action.
8. Archive a distractor node; graph hides it; Archived tab shows it; restore.
9. Run `npm run build`, `npm test`, `npm run test:integration`, `npm run typecheck`,
   `npm run lint`, `npm run format:check`.

## 16. Implementation plan

- [x] Freeze renderer, route payloads, archived-list reader, conflict behavior, and browser acceptance steps (this document).
- [x] Add `listArchivedNodes`, runtime store, HTTP helpers, read routes, project list page, graph/list/detail/evidence; verify A1.
- [x] Add manual create/edit/review/archive/restore routes + forms and two-revision comparison; verify A2/A3.
- [ ] Integrate task panel against `ContextBundle`; verify A4.
- [ ] Execute the manual demo checklist (A5), run all checks, update durable context, commit/push.

## 17. Alternatives considered

### Separate graph UI, history UI, and integration features

They share selected-node state and source/revision views. One workbench delivered
in two slices avoids independent UI contracts while exposing early progress.

### Graph library (react-flow, cytoscape, d3)

Faster styling, but adds a large dependency and layout state for ≤ 1,000 nodes.
A ~100-line deterministic force layout in SVG is sufficient and fully testable.

### Full visual graph editor

Would require edge mutation/history and layout persistence. A read graph with
small node forms proves inspection/review without those dependencies.

## 18. Durable context created by this feature

Planned: the UI reads/writes through shared store contracts; node history is not
whole-graph history; reviewed authority needs a human action; displayed bundles
are revision-specific snapshots. Findings are recorded after implementation.

Findings from the read/edit/history slice:

- Route files under `src/app/api/**` only bind `await getStore()`; the request logic
  lives in `src/server/workbench/handlers.ts` as `handleX(store, request, params)`
  functions so integration tests exercise the exact handlers with a test store and
  real `Request` objects (`tests/workbench/routes.integration.test.ts`).
- `src/server/workbench/mutations.ts` validates only the request envelope (shape,
  enums, direction, `expectedVersion`); field rules (blank title, path form, limits,
  authority) stay in the foundation parsers inside the store, so both layers report
  `VALIDATION_ERROR` with `details.issues`. `POST /nodes` answers `201`.
- A revise request whose snapshot equals the current one returns `changed: false`
  and records no revision, but its manual source row was already inserted in the
  same transaction and is kept (harmless orphan; the UI reports "no new revision").
- Next.js 16 bundling (Turbopack and webpack) does not resolve the `.js`-suffixed
  relative imports used throughout `src/server/**` to `.ts` files. `next build`/`next dev`
  need either extensionless imports in `src/server/**` or
  `experimental.extensionAlias: { '.js': ['.ts', '.tsx', '.js'] }` plus the `--webpack`
  flag (verified to build). Turbopack also refuses a `node_modules` symlink that points
  outside the project (worktree setups) unless `turbopack.root` is the common parent.
- Inside Next, `request.url` is normalized to `http://localhost:<port>/…` even when the
  browser used `127.0.0.1`, so `assertSameOrigin`'s `Origin === new URL(request.url).origin`
  fallback rejects `Origin: http://127.0.0.1:3000` requests that lack `Sec-Fetch-Site`.
  Browsers send `Sec-Fetch-Site: same-origin`, so the UI works; comparing `Origin`
  against the `Host` header would also accept origin-only tooling.
- The graph layout is a seeded Fruchterman–Reingold pass (`src/lib/layout.ts`) keyed
  by sorted node IDs; node/edge order does not change positions. Edges touching an
  archived node are not returned by `getGraph`, so an archived node's detail shows no
  relationships until it is restored.
- The selected node is fetched via `GET /nodes/:id` rather than read from the graph
  snapshot so archived nodes open in the same detail/history/restore path.
