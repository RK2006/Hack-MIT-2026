# Feature Spec — Agent Context Proposals

Status: Implemented; automated criteria verified with a fixed model; live Anthropic run (A5) not yet performed
Owner: Project team
Related issue/task: [project spec](../PROJECT_SPEC.md) §6 Flow F and §7 stretch "LLM-generated candidate nodes/edges"; depends on [foundation](context-graph-foundation.md) authority rules; exposed via [agent handoff MCP](agent-handoff-mcp.md)
Last updated: 2026-09-19

## 1. Summary

Let an agent turn what it learned during work (a diff, a PR description, an
incident note) into *proposed* knowledge: inferred `decision`/`constraint`/
`discovery`/`bug`/`assumption` nodes, optionally linked to existing nodes, each
with an `agent` source recording the prompt excerpt and model. A human reviews
them in the existing workbench (edit → canonical, or archive). Nothing an agent
writes becomes canonical on its own.

## 2. Problem

Knowledge created while implementing a task currently has to be typed in by
hand. The product thesis is that project understanding should be captured as it
changes; the foundation already models agent-authored inferred claims but
nothing produces them.

## 3. Goals

- Extract a handful of candidate claims and relationships from supplied text with one LLM call.
- Persist them through the store as inferred nodes/edges with agent provenance, atomically.
- Make every proposal reviewable and distinguishable in the workbench with no UI changes.
- Offer the capability as a CLI and as an MCP tool so the agent can propose at the end of its own task.

## 4. Non-goals

Automatic acceptance, editing existing canonical nodes, deleting anything,
reading repositories or PRs from GitHub, background jobs, multi-turn extraction,
proposal queues/UI, or embedding calls (the compiler embeds new nodes lazily).

## 5. User experience

1. Agent (or operator) calls `propose_context` with project ID and the text to
   analyze (e.g. the diff summary and notes from the task it just finished).
2. The LLM returns up to 8 candidate claims and up to 12 relationships to
   existing nodes, referenced by the existing nodes' external keys/titles.
3. The service validates, drops anything unresolvable, and writes the rest in one
   transaction: one `agent` source, N inferred nodes, M inferred edges.
4. Response lists what was created (IDs, titles, types, edges) and what was
   dropped and why.
5. Operator opens the workbench: new nodes appear with the inferred badge and
   agent evidence; "Review as canonical" or "Archive" per node. Recompiling a
   task can now surface the reviewed knowledge.

## 6. Functional requirements

- [x] P1: `proposeContext(deps, projectId, { text, taskHint?, model? })` reads the current graph, builds a prompt listing existing node keys/titles/types, and calls a `ProposalModel` once.
- [x] P2: Model output is parsed as strict JSON matching the schema below; malformed output is a `VALIDATION_ERROR` naming the offending path, never a partial write.
- [x] P3: Each proposal becomes an inferred node with `externalKey = agent.<slug>-<8 hex>` (unique), `confidence ≤ 0.7`, `importance 1–5`, `actor { kind: 'agent', label: <model id> }`, and one shared `agent` source whose excerpt is the first 2,000 code points of the input text prefixed with the model id.
- [x] P4: Relationships resolve `toKey`/`fromKey` against the existing external keys (or a newly proposed key); unresolved, duplicate, self, or archived-endpoint edges are dropped and reported, not fatal.
- [x] P5: Bounds: input text 1–20,000 code points; ≤ 8 nodes and ≤ 12 edges per call; project node/edge limits still enforced by the store.
- [x] P6: The write is one `store.transaction`; a store failure leaves no partial proposal.
- [x] P7: Available as `npm run propose -- <projectId> <file>` (or stdin) and as the MCP tool `propose_context`.
- [x] P8: The model backend is Anthropic Messages (`fetch`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` default `claude-sonnet-4-5`) behind a `ProposalModel` interface; tests use a fixed model.

## 7. Data model

### New entities

None in the database. Proposals are ordinary inferred nodes/edges with `agent`
sources (`uri: agent://proposals/<uuid>`, `label: 'Agent proposal (<model>)'`).

### Changed entities

None. The foundation's authority matrix already restricts agents to inferred
writes with agent evidence.

### Migration considerations

None.

## 8. API / interface changes

```ts
type ProposalRequest = { text: string; taskHint?: string };
type ProposalModel = {
  id: string; // e.g. anthropic:claude-sonnet-4-5
  complete(prompt: { system: string; user: string }): Promise<string>; // raw model text
};
// Strict JSON the model must return (after stripping optional ```json fences):
type ModelProposal = {
  nodes: Array<{
    key: string;               // slug ^[a-z][a-z0-9-]{2,40}$, unique within the response
    type: 'decision' | 'constraint' | 'assumption' | 'discovery' | 'bug';
    title: string;             // 1–200
    content: string;           // 1–4000
    summary: string;           // 0–300
    importance: 1 | 2 | 3 | 4 | 5;
    confidence: number;        // 0–1, clamped to ≤ 0.7 on write
  }>;
  edges: Array<{
    fromKey: string;           // proposed key or existing externalKey
    toKey: string;
    type: 'DEPENDS_ON' | 'IMPLEMENTS' | 'REQUIRES' | 'CONSTRAINS' | 'AFFECTS' | 'CAUSED_BY' | 'RELATED_TO';
  }>;
};
type ProposalResult = {
  projectId: string; model: string; sourceId: string;
  created: { nodes: Array<{ nodeId: string; externalKey: string; type: NodeType; title: string }>;
             edges: Array<{ edgeId: string; from: string; to: string; type: EdgeType }> };
  dropped: Array<{ kind: 'node' | 'edge'; reason: string; ref: string }>;
};
// proposeContext(deps: { store: GraphStore; model: ProposalModel }, projectId, request): Promise<ProposalResult>
```

Prompt: system text states the role (extract durable engineering knowledge, not
code narration), the JSON contract, and that claims must be supported by the
input; user text contains the optional task hint, the list of existing nodes as
`key | type | title` lines (≤ 1,000 nodes, so ≤ ~40k characters), and the input
text. Temperature 0, `max_tokens` 4,000. One retry on 429/5xx/network after 1 s;
otherwise `graphError('EMBEDDING_UNAVAILABLE')` is *not* reused — add
`MODEL_UNAVAILABLE` to `GraphErrorCode` (HTTP 503) for model backend failures.

Files: `src/server/proposals/{model,prompt,propose}.ts`, `scripts/propose.ts`,
`tests/proposals/`. MCP tool in `src/server/mcp/server.ts`:
`propose_context { projectId, text, taskHint? } → ProposalResult`.

## 9. Context graph implications

Creates `decision`/`constraint`/`assumption`/`discovery`/`bug` nodes (never
`component`/`file`) and non-`CONTAINS` edges, all `inferred`, all with an `agent`
source pinned to the input excerpt and model id. Provenance is explicit; history
starts at revision 1; promotion requires a human revision. Retrieval sees the
new nodes on the next compile (new cache keys), ranked below canonical peers by
the authority factor.

## 10. Retrieval behavior

Not applicable; the compiler treats proposals like any inferred node.

## 11. Edge cases

Empty or non-JSON model output; JSON with extra keys (rejected: strict); keys
colliding with existing external keys (suffix guarantees uniqueness); edges to
archived nodes (dropped by store validation → reported); model proposes
`component`/`file` (schema rejects → whole response invalid, reported to caller
so it can retry); 0 nodes proposed (valid: result with empty `created`, no
source written); project limits hit mid-write (transaction rolls back; error).

## 12. Security / privacy considerations

Only text the operator/agent explicitly supplies is sent to the model; the
existing node list sent as context contains titles/keys only (no content, no
evidence). The API key stays in the environment. Model output is untrusted:
schema-validated, size-bounded, stored as inferred claims, never executed or
rendered as HTML. Agent proposals cannot alter canonical nodes by construction.

## 13. Observability

Stderr/console: `{ operation: 'proposeContext', model, durationMs, created, dropped }`
counts only. Dropped items are returned to the caller with reasons.

## 14. Acceptance criteria

- [x] A1: With a fixed model, a proposal creates inferred nodes/edges with one agent source, correct actor, clamped confidence, unique keys; the workbench graph shows them as inferred.
- [x] A2: Unresolvable/self/duplicate/archived-endpoint edges are dropped and reported while valid ones are written.
- [x] A3: Malformed model JSON, forbidden types, and oversize input produce `VALIDATION_ERROR` with no writes; model backend failure produces `MODEL_UNAVAILABLE`.
- [x] A4: A proposed node can be reviewed to canonical through the existing revise route, and a later compile selects the revised version.
- [~] A5: `npm run propose` and MCP `propose_context` return the same `ProposalResult` shape; a live Anthropic call succeeds when a valid key is present (manual, recorded in §18).

## 15. Test plan

### Unit tests (`tests/proposals/parse.test.ts`)

Model-output parsing: fences, strict schema, bounds, forbidden types, key regex.

### Integration tests (`tests/proposals/propose.integration.test.ts`)

A1–A4 against an isolated PostgreSQL schema with the imported fixture and a
fixed `ProposalModel`; A3 rollback on store failure (edge to archived node) and
`MODEL_UNAVAILABLE`.

### UI/manual verification

A5: run `ANTHROPIC_API_KEY=… npm run propose -- <projectId> notes.md` with a
short incident note about webhook retries; open the workbench, confirm inferred
badge and agent evidence, review one node canonical, recompile. Record model and
result in §18.

## 16. Implementation plan

- [x] `MODEL_UNAVAILABLE` code + HTTP mapping; `ProposalModel` interface with Anthropic and fixed implementations.
- [x] Prompt builder and strict output parser with unit tests.
- [x] `proposeContext` transactional write with drop reporting; integration tests A1–A4.
- [~] CLI script + MCP tool registration done; manual A5 live run pending a valid `ANTHROPIC_API_KEY` (the key in the implementation environment was rejected as invalid).
- [x] Docs (README, this spec §18), commit/push.

## 17. Alternatives considered

### Let the agent write nodes directly through generic MCP write tools

Simpler, but hands the model the full node/edge API and invites unbounded or
canonical-looking writes. A single structured proposal tool with schema-bounded
output and forced `inferred` authority is safer and matches Flow F.

### Store proposals in a separate pending table

A review queue is cleaner UX but needs new schema and UI. Existing inferred
nodes plus the archive action already give accept/reject semantics for the MVP.

## 18. Durable context created by this feature

Implemented decisions and findings:

- Proposals are ordinary inferred nodes/edges with an `agent` source; the
  foundation's authority matrix (agent actor + agent source ⇒ inferred only) is
  the enforcement, not new code paths. External keys are `agent.<slug>-<8 hex>`.
- Edge validation is done before calling the store (unresolved/self/duplicate/
  already-existing/not touching a proposed node) because the store transaction
  marks itself failed on any error; only genuinely unexpected store errors abort.
  "Edge must touch a proposed node" prevents the model from adding relationships
  between existing nodes it did not discover anything about.
- The prompt sends existing node keys/types/titles only — never content or
  evidence — plus the operator/agent-supplied text; the reply must be strict JSON
  (one ```json fence tolerated). `component`/`file` proposals fail validation for
  the whole response so the caller can retry with clearer notes.
- Model backend failures are `MODEL_UNAVAILABLE` (503), distinct from the
  compiler's `EMBEDDING_UNAVAILABLE`. The Anthropic adapter (Messages API,
  `anthropic-version: 2023-06-01`, temperature 0, one retry on 429/5xx) is unit
  tested with a mocked `fetch`; a live run still needs a valid key.
- A4 verified on PostgreSQL: a proposed decision reviewed to canonical is selected
  by the compiler at v2 while v1 stays readable as inferred.
