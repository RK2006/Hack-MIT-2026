# Feature Spec — Graph Workbench and Context Review

Status: Implemented; graph interaction/readability enhancement in progress
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
2. The project page has two workspace regions: graph/list (left) and a tabbed
   inspector (right). The inspector gives node details and task context separate,
   full-height tabs so neither workflow competes for vertical space. Switching tabs
   preserves an in-progress task and compiled result; selecting a node from task
   results returns to node details. The graph is an SVG with
   a deterministic in-app force layout with collision-aware spacing on a roomy
   network canvas. Nodes render as colored circles with bounded labels, using a
   dashed outline plus an explicit badge for inferred context. Users can drag nodes
   to refine the transient layout, drag the dotted background to pan, reset them to the deterministic
   layout, and zoom with corner-mounted minus/percentage/plus controls. The dotted
   background covers the full graph viewport at every zoom. Edges are directed
   arrows labeled by type (dashed when inferred). A single relationship uses a
   straight path; reciprocal relationships between the same nodes use opposing
   curves with separately offset labels. Labels remain faintly visible by default
   and become prominent when related, highlighted, or hovered. The header omits the
   raw project UUID, and the graph summary contains only active-node and relationship
   counts. A "List" toggle shows the same nodes as a table filterable by type and
   text, so the graph is never the only navigation.
3. Clicking a node shows: title, type, authority label, importance, confidence,
   version, actor/reason, external key/path, content, summary; relationships as
   directed sentences ("this node → REQUIRES → Idempotency (canonical)"); the
   source evidence (kind, label, locator, pinned ref, excerpt) loaded on demand.
   The detail panel prioritizes title/summary/status, human-readable content,
   relationships, and evidence; raw IDs, paths, and other implementation metadata
   live in an expandable Technical details section.
4. "Edit" opens a form pre-filled with the current snapshot plus a change reason
   and evidence note. "Review as canonical" pre-sets authority to canonical.
   "Archive"/"Restore" toggle the archived flag with a reason. "New node" opens a
   blank form with an optional single edge to the selected node.
5. "History" lists revisions; choosing two shows a field-by-field comparison and
   each revision's source. Comparison never writes.
6. "Archived" tab lists archived nodes for detail/history/restore.
6a. "Review (n)" tab is the human-in-the-loop queue for agent proposals: every
   active node whose current revision is `inferred` and authored by an `agent`
   actor (no human has touched it yet), newest first. Each row shows title,
   type, proposer, confidence, summary/content, and on-demand evidence, with
   **Accept as canonical** (revise: authority → canonical, confidence → 1),
   **Edit & accept** (opens the review form), and **Reject (archive)**. One-click
   decisions record a fresh manual source whose note is a fixed sentence plus an
   optional operator note typed once at the top of the queue; the agent's
   original revision and evidence remain in history. A human revision that keeps
   a node inferred also removes it from the queue (the actor is now human).
7. Task panel: task text, token budget (256–8,192, default 4,096), depth (0–3),
   optional start = selected node, "Allow degraded" checkbox off by default,
   Compile. Depth, start-node behavior, and degraded fallback are grouped under
   progressive Advanced options. The tab shows a compact selected-node/token summary
   after compilation. Result: status, tokenizer, model, measured tokens vs budget vs
   measured project context tokens, ranked selected items with reasons/paths and
   authority labels, omissions, warnings, rendered text with Copy. Each graph
   reason lists its path steps (from → TYPE → to, with edge authority), and the
   graph highlights selected node IDs and path edges. A running or failed compile
   clears highlights so they never belong to a stale request. Editing after
   compile marks the bundle "stale; recompile" without hiding it.

Empty project, loading, validation error, conflict, compiler failure/degraded
response, and budget insufficiency states are visible. A stale edit shows the
conflict (expected/actual versions) and a "Reload current" action that advances
the expected version and reports the current title while keeping the operator's
draft untouched; saving again is a deliberate overwrite of the newer revision.

## 6. Functional requirements

- [x] W1: Render current active nodes and typed directed relationships; provide a
      node list/details fallback so the graph is not the sole means of navigation.
- [x] W2: Display source locator, pinned reference, excerpt, actor/reason, revision,
      and canonical/inferred labels; inferred edges remain visibly distinguishable.
- [x] W2a: Render long excerpts (agent inputs, PR digests) readably without changing
      stored data: preserve line structure by rendering `- ` lines as a list, blank
      lines as paragraph breaks, `Label:` lines as small headings, and everything after
      a `Diff excerpt:` heading in monospace; hide a leading `[model-id]` prefix on
      agent sources because the card label already names the model; show at most eight
      lines by default with a "Show full excerpt" toggle; use upright body type, not
      italic, for multi-line excerpts. The parser is a pure function in
      `src/lib/excerpt.ts` covered by `tests/workbench/excerpt.test.ts`.
- [x] W3: Support manual node creation, editing, review, archive/unarchive, with
      foundation validation, fresh manual evidence, and expected-version conflicts.
- [x] W4: Display archived nodes in a separate list/detail/history path so they
      remain accessible after leaving the active graph.
- [x] W5: Compare any two revisions of the same node, showing changed snapshot
      fields and source references; history view does not imply historical graph state.
- [x] W6: Submit task/budget/depth, highlight bundle node IDs and explanation paths,
      show counted tokens/omissions/degraded status, and copy context text exactly.
- [x] W7: Preserve editable user input on failures; avoid displaying a previous
      successful bundle as if it belonged to a failed or still-running request.
- [x] W8: Provide a review queue of agent-authored inferred nodes with one-click
      accept/reject that writes ordinary human revisions through the existing
      revise route; the tab label shows the pending count.
- [~] W8: Keep active graph nodes and their title text visually distinct at the
      default layout, allow pointer dragging without accidental selection, and
      provide background drag-to-pan, deterministic reset, and bounded zoom controls.
      Dragged positions, viewport pan, and zoom are transient. Geometry and build
      checks pass; browser interaction verification remains open.
- [~] W8a: Route reciprocal relationships on deterministic opposing curves and
      offset each label along its own path, while retaining the existing faded-label
      treatment. Single relationships remain straight. Geometry checks pass; browser
      visual verification remains open.
- [~] W9: Use a consistent readable type scale, spacing rhythm, button hierarchy,
      cards, and restrained color tokens across the workbench. Normal prose uses
      sans-serif typography; monospace is limited to code, IDs, paths, locators,
      model names, and exact compiled context. Implementation and automated checks
      pass; browser visual verification remains open.
- [~] W9a: Adopt the "field notebook" visual direction. Pale sage-grey paper with
      muted green-grey hairline rules; sections are separated by rules and whitespace,
      not bordered/shadowed cards. Typography: Bricolage Grotesque for headings and
      node titles, Source Sans 3 for UI chrome and prose, Fira Code for IDs, paths,
      locators, model names, and exact compiled context, all loaded via `next/font`
      (self-hosted at build, no runtime dependency). Moss ink text; one rust accent
      for links and primary actions; amber reserved for task selection. Text inputs
      are underlined fields rather than boxes; badges are small-caps text rather than
      pills. Authority uses one device everywhere (canonical = solid rule/green ink;
      inferred = dashed rule/ochre ink). Every color, including SVG graph strokes and
      node type colors, comes from `globals.css` tokens or `shared.tsx` `NODE_COLORS`;
      components carry no hardcoded hex values. Existing class names and markup are
      unchanged. (A dark "instrument panel" variant and a cream/serif "editorial"
      variant were both tried in the browser and rejected: the first as a generic
      dev-tool look, the second as too close to a well-known AI assistant's brand.)
- [~] W10: Separate node inspection and task compilation into full-height right-rail
      tabs, preserve task state while switching, show a compact compiled-result
      summary in the task tab, and progressively disclose secondary task controls.
      Implementation and automated checks pass; browser visual verification remains open.

## 7. Data model

### New entities

None. Graph layout, selected node, draft form, selected history versions, and
current bundle are transient UI state. No browser-only copy of canonical knowledge.
Dragged node positions intentionally reset on reload or graph mutation.

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
`FORBIDDEN_ORIGIN 403` for cross-origin mutations. Mutations (`POST`) are accepted
when `Sec-Fetch-Site` is `same-origin` or `none` (user-initiated), or when the
`Origin` header's host equals the request `Host` header (Next normalizes
`request.url` to `localhost`, so the URL origin is not used); requests with neither
header are accepted as non-browser local tooling. Everything else is 403.
`GET .../nodes` without `archived=true` is a 400: active nodes come from `/graph`.
`POST .../nodes` answers 201.

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
the same transaction and assigns `actor: { kind: 'human', label: OPERATOR_LABEL ?? 'local-operator' }`.
`OPERATOR_LABEL` (≤ 120 chars) lets teammates who share one database appear as
themselves in provenance; it is attribution only, not authentication.
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

- [x] A1: An imported project can be explored by graph and list, with correct edge
      direction, evidence, current revision, and authority labels.
- [x] A2: Manual create/edit/review/archive/restore persist correctly; a stale edit
      displays a conflict without overwriting, and archived history remains reachable.
- [x] A3: Comparing two revisions shows changed content, authority, source, and reason while leaving current state unchanged.
- [ ] A4: Task controls display the compiler selection, paths, token count, omissions,
      and exact copyable text; invalid/unavailable/degraded/empty states are clear.
      Route/contract behavior is automated; visual rendering and clipboard behavior
      remain part of the browser checklist.
- [ ] A5: The complete demo in the MVP plan succeeds, including a history change and subsequent current-context retrieval.
- [ ] A6: At the default demo viewport, circular nodes and bounded labels do not
      overlap, dragging updates incident edges, Reset layout restores deterministic
      positions, the dotted background covers the full panel, background dragging
      pans without moving nodes, and the corner controls zoom within documented limits.
      Reciprocal arrows and their labels occupy opposing curved lanes rather than
      overlapping, while unrelated labels remain faintly visible.
- [ ] A7: The selected-node panel presents title, summary, status, primary actions,
      overview metrics, content, relationships, and provenance in that order; raw
      technical metadata is collapsed by default, and the detail/history/form/task
      surfaces use one consistent typography and spacing system.
- [ ] A8: Node details and task context occupy separate full-height right-rail tabs;
      task inputs/results survive tab switches, advanced controls are collapsed by
      default, a compiled result is summarized in the tab, and inferred nodes combine
      a dashed outline with a readable authority badge.

## 15. Test plan

### Unit tests

- A3: `tests/workbench/compare.test.ts` — snapshot comparison across every field.
- W8: `tests/workbench/review.test.ts` — queue membership and ordering (`src/lib/review.ts`).
- A1: `tests/workbench/layout.test.ts` — deterministic layout and safe-link rule.
- A6: `tests/workbench/layout.test.ts` — circular collision spacing, bounds,
  deterministic reset coordinates, title wrapping/truncation, circle-edge
  intersections, reciprocal curve assignment/geometry, zoom clamping, and drag-pan
  offset calculation.
- A7: production build/typecheck plus the browser checklist; semantic HTML remains
  keyboard navigable and all existing labels/values remain present.
- A8: production build/typecheck plus the browser checklist; tab/tabpanel relationships,
  preserved mounted task state, advanced disclosure, and graph authority labels remain
  keyboard and screen-reader discoverable.
- §8 same-origin rule and error mapping: `tests/workbench/http.test.ts`.

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
10. In Graph view, confirm the circular network and labels have breathing room; drag
    nodes from both mouse and touch input and confirm incident arrows follow. Zoom in,
    drag the dotted background to pan in every direction without moving a node,
    confirm dots cover the full viewport, exercise `− / percentage / +`, then Reset
    layout and confirm the original arrangement returns without selecting a node
    during a drag.
11. Select canonical and inferred nodes. Confirm the right panel has a clear title
    and action hierarchy, readable prose, compact relationship cards, accessible
    evidence, and collapsed Technical details. Open History, Edit, and Task context
    and confirm their typography, controls, focus states, and spacing are consistent.
12. Switch repeatedly between Node details and Task context before and after compiling.
    Confirm task inputs/results persist, the compiled count/token summary appears in
    the tab, Advanced options are collapsed initially, and selecting a result opens
    that node's details. Confirm inferred graph nodes show both a dashed outline and
    an explicit Inferred marker while every node body remains circular.
13. Confirm the header has no raw project UUID and the graph summary contains only
    node/relationship counts. Inspect a reciprocal relationship pair: its arrows bend
    to opposite sides, its label pills do not overlap, and unrelated labels remain
    softly visible rather than disappearing.

## 16. Implementation plan

- [x] Freeze renderer, route payloads, archived-list reader, conflict behavior, and browser acceptance steps (this document).
- [x] Add `listArchivedNodes`, runtime store, HTTP helpers, read routes, project list page, graph/list/detail/evidence; verify A1.
- [x] Add manual create/edit/review/archive/restore routes + forms and two-revision comparison; verify A2/A3.
- [~] Integrate task panel against `ContextBundle`; route/contract verification passes,
      but A4 panel rendering and clipboard verification remain in the browser checklist.
- [~] Execute the manual demo checklist (A5): API-level run of steps 1–7 verified over HTTP on 2026-09-19; browser walkthrough is the operator's final check. All automated checks pass; durable context updated; committed.
- [~] Add collision-aware circular layout, bounded labels, pointer dragging,
      background drag-to-pan, full-viewport grid, corner zoom controls, and reset;
      verify geometry automatically and complete browser interaction check (A6).
- [~] Add deterministic reciprocal-edge lanes and path-relative label positions;
      simplify the graph summary/header; verify geometry automatically and complete
      browser visual review (A6).
- [~] Apply the shared typography/color/spacing system and restructure node detail;
      verify build/accessibility invariants automatically and complete browser visual
      review (A7).
- [~] Replace the stacked detail/task split with persistent tab panels, simplify the
      task form with progressive disclosure and result summary, and clarify inferred
      graph styling; verify automated checks and complete browser visual review (A8).
- [x] Apply the field-notebook theme (W9a): load Bricolage Grotesque / Source Sans 3 /
      Fira Code via `next/font`, replace the token set and remove card chrome in
      `globals.css`, move GraphView SVG colors into CSS classes and retune `NODE_COLORS`
      for sage paper; typecheck/lint/format/unit/build pass and the operator reviewed
      graph, detail, task, and review-queue surfaces in the browser (2026-09-19).

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

### Persist dragged coordinates

Persistence would require a new user-layout model and mutation API for presentation
state that is not canonical project knowledge. For the MVP, dragging is local UI
state and Reset/reload returns to the deterministic graph.

### Bottom task drawer or dedicated task page

A full-width drawer gives results more room but obscures the graph that explains the
selection. A dedicated page also breaks the immediate highlight-and-inspect loop. A
mutually exclusive right-rail tab keeps the graph visible, removes nested vertical
competition, and can preserve the task component state without a new persistence model.

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
- Graph nodes are SVG circles with separate two-line bounded labels on a 1,400×900
  logical canvas. The force pass uses circular collision spacing rather than a dense
  grid fallback, preserving an organic network shape. Pointer dragging updates only
  React layout state and incident edge geometry; reset/reload/graph mutation restores
  deterministic positions. Scrollable zoom defaults to 140% for label readability,
  is transient, and is clamped from 60% to 200%. Background pointer dragging changes
  the scroll viewport rather than graph coordinates; node pointer dragging remains
  separately captured. The dotted grid belongs to the viewport layer, so it covers
  empty panel space as well as the SVG at every zoom.
  Edge labels stay quiet until related to the selected node, highlighted by a task
  path, or hovered, reducing default clutter.
- Edge routes are grouped by unordered node pair. A lone edge receives zero curvature;
  reciprocal directions receive the same local positive offset, which becomes opposing
  visual curves because reversing an edge reverses its perpendicular normal. Parallel
  same-direction edges fan around the centerline. Labels use the midpoint of their own
  quadratic path and retain the existing low-opacity default instead of disappearing.
- The workbench originally used a dependency-free system sans stack; W9a replaced it
  with Bricolage Grotesque / Source Sans 3 / Fira Code via `next/font/google`, which
  downloads once at build/dev start and self-hosts from `/_next/static/media` (no
  runtime request, but the first `next dev`/`next build` needs network). Monospace is
  reserved for technical values and exact agent context. The detail panel exposes the
  same data as before but progressively discloses raw IDs, paths, and revision
  metadata under native `<details>` rather than presenting the entire node as a
  database-style definition list.

Findings from the field-notebook theme (W9a):

- All color lives in `:root` tokens in `globals.css` plus `NODE_COLORS` in
  `shared.tsx`; `GraphView` carries no hex values. SVG colors are applied through
  classes (`edge-line`, `node-circle`, `node-circle-selected`, `node-highlight-ring`)
  and two `<marker>` definitions (`arrow`, `arrow-path`) so highlighted arrowheads
  match their amber stroke. Changing the palette is a token edit only.
- Hover states never change hue. Rust is a static mark (inline links, focus rings,
  relationship arrows, "changed"); hover feedback is tint, underline, or a revealed
  arrow. A brand color reacting to the cursor was the strongest "generic AI UI" tell.
- Graph labels are text with a paper-colored halo (`paint-order: stroke fill`), not
  boxed rectangles; the label `<rect>`s remain in the markup for geometry tests but
  render transparent. The dashed ochre INFERRED tag is the one intentional badge.
- Authority uses a single device everywhere: canonical = solid rule / green ink with a
  dot; inferred = dashed rule / ochre ink. Pending proposals in the review queue reuse
  the dashed ochre rule rather than their own color.
- Two directions were tried and rejected in the browser before this one: a dark
  "instrument panel" (read as a generic dev tool) and a cream paper + reading serif
  "editorial" variant (read as a well-known AI assistant's brand).
- The selected node is fetched via `GET /nodes/:id` rather than read from the graph
  snapshot so archived nodes open in the same detail/history/restore path.

Findings from the review queue (W8):

- "Pending review" is derived, not stored: `inferred && actor.kind === 'agent'`
  on the current revision. No schema or route changes; the queue is a filter
  over the graph snapshot the page already loads, and decisions reuse
  `POST .../revisions`. Accept sets confidence to 1 because a human is now
  vouching for the claim; Reject is an archive, so the proposal stays readable.
- The fixture's own agent-sourced claims (e.g. the repeated-delivery bug) appear
  in the queue on a fresh import — correct, since no human has reviewed them, and
  useful for the demo before any live proposal exists.

Findings from the task-panel integration:

- Node details and task compilation are sibling tab panels in the right rail rather
  than vertically stacked regions. Both remain mounted while one is hidden, so task
  inputs and compiled results survive inspection switches without persisting a new
  browser or server model. Selecting a task result deliberately returns to node
  details, while the compact task-tab summary remains visible.
- `TaskPanel` is the only consumer of `ContextBundle`; it renders reasons and
  `PathStep` sequences verbatim from the compiler and never re-ranks. Highlights
  (node IDs plus path edge IDs) are derived from the displayed bundle and cleared
  while a request runs or after it fails, so a failed compile cannot leave a
  previous selection looking current. A bundle compiled before a mutation is
  labeled stale using the workbench's `graphVersion` counter.
- The metric shown as "All active context" is `metrics.projectContextTokens`
  (measured, `cl100k_base`, full text of every active node); the demo fixture is
  ~2.2–2.4k tokens total, so the honest demo ratio is roughly 1.5k/2.3k at a
  4,096 budget and ~0.5k/2.3k at 512, not the aspirational 5k/100k figure.
- The process-wide runtime drops a failed store initialization instead of caching
  the rejected promise, and migrations are embedded TypeScript strings because
  Turbopack rewrites `new URL(..., import.meta.url)` file reads as static assets.
- The first compile in a fresh process loads the local embedding model (~15 s on
  first ever run while it downloads; a few seconds afterwards); later compiles are
  sub-second. The UI says so while running.
