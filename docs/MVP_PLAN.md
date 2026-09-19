# MVP kickoff and build plan

Status: Kickoff specification complete; product implementation not started
Date: 2026-09-19
Related: [project spec](PROJECT_SPEC.md), [kickoff workflow](../CODEX_KICKOFF_PROMPT.md)

## Repository evidence and reconciliation

The initial commit `2772607` contains four tracked files: `AGENTS.md`,
`CODEX_KICKOFF_PROMPT.md`, `docs/PROJECT_SPEC.md`, and
`docs/FEATURE_SPEC_TEMPLATE.md`. Tracked-tree inspection, recursive hidden-file
inventory, ignored-file inventory, and targeted searches found no product code,
package manifest, dependencies, database/schema, authentication, backend/API,
frontend, ingestion/retrieval, tests, CI, or build/lint/type-check commands.
There were no partially implemented product features and no existing feature specs.

The existing convention to preserve is spec-driven development. Next.js and
PostgreSQL were proposals, not established dependencies. The selected plan keeps
that direction with a single application and ordinary relational tables.

Kickoff started on `main`, tracking `origin/main`, with origin
`https://github.com/AnmolKaran/hackmit-2026.git`. Existing edits to `AGENTS.md` and
`CODEX_KICKOFF_PROMPT.md`, plus untracked `.DS_Store`, belong to the user and are
excluded from this documentation unit. No implementation worktree is needed.

The project spec now explicitly resolves these mismatches:

| Previous ambiguity | MVP decision |
| --- | --- |
| History required in concepts/demo but only desired in scope | Node snapshot history and a two-revision comparison are required |
| Semantic retrieval invariant but embeddings only desired | Embedding similarity + graph relationships are required; lexical-only is degraded |
| Undefined `IMPLEMENTED_BY` example | Store `IMPLEMENTS` from implementation to implemented concept |
| Possible authority states mixed with freshness | `canonical` / `inferred`; separate node archival; no automatic staleness |
| Many node types and duplicate Project/Source concepts | Seven node types; Project scope and Source evidence are relational records |
| MCP variously desired/stretch | JSON API and copy output are sufficient; MCP stays stretch |
| Optional branch/version retrieval | Current node revisions only; no historical whole-graph checkout |
| Repository analysis could imply arbitrary code understanding | A prepared, labeled repository manifest is the required ingestion path |

## Four feature boundaries

| Feature spec | Owns | Readiness |
| --- | --- | --- |
| [Context graph foundation](specs/context-graph-foundation.md) | Minimal runtime/test setup, relational store, provenance, authority, node history, stable service contracts | Implementation-ready specification; not implemented |
| [Prepared project ingestion](specs/prepared-project-ingestion.md) | One validated manifest, deterministic import and demo data | Scoped draft; expand before implementation |
| [Graph workbench](specs/graph-workbench.md) | Graph/detail UI, manual authoring/review, revision comparison, final task/copy UI | Scoped draft; expand before implementation |
| [Task context compiler](specs/task-context-compiler.md) | Semantic seeds, graph expansion, ranking, budget packing, explanations, JSON API | Scoped draft; expand before implementation |

Retrieval, compression, and explainability share candidate and output contracts,
so they form one feature. History belongs in storage from its first write, with
comparison in the workbench. Agent handoff is a compiler/workbench capability;
no separate MCP integration feature is necessary. Ingestion has independent
validation and repeat-import behavior, so it remains separate from storage.

## Dependency-aware build order

Foundation → prepared project → graph/detail/history workbench → context compiler
→ integrated task/highlight/copy demo.

| Step | Depends on | Capability added | What can be demonstrated |
| --- | --- | --- | --- |
| 1. Foundation | None | Persisted project-scoped graph, immutable sources/revisions, authority rules and conflicts | A test/smoke flow creates context, reloads it, revises it, and reads both versions |
| 2. Prepared project | Foundation contracts and transactions | Validated import, component/file graph, curated payment context and distractors | One command imports a project; repeated import is safe; store reads show a connected graph |
| 3. Workbench first slice | Foundation; ingestion for useful demo content | Browser graph, node/evidence details, manual node edits/review, history comparison | Inspect a project visually and show an inferred claim becoming reviewed context with its prior revision |
| 4. Context compiler | Foundation; ingestion fixture for relevance evaluation | Semantic+graph candidates, bounded representations, transparent selections, API | A task request returns a small explainable context bundle via JSON |
| 5. Workbench integration and demo verification | Workbench slice + compiler + imported fixture | Task/budget input, selection highlight, explanations, copy, honest metrics | Complete the product loop, then revise knowledge and compile the new current revision |

Step 3 supplies visible progress early without depending on unfinished ranking.
Step 5 is completion of the workbench spec, not a fifth feature or separate platform.

### Safe future parallel work

After foundation verification, stabilize its DTOs and mutation contracts. Ingestion
and the workbench's read/edit/history slice can then proceed independently. The
compiler's algorithms may also proceed using a shared, agreed test graph; final
quality verification waits for the ingestion fixture. Stabilize `ContextBundle`
before the workbench task panel is implemented. Assign schema changes to one owner
and integrate/test before declaring any combined milestone complete.

Do not parallelize foundation schema/authority/revision decisions. Do not let
independent agents invent manifest or bundle contracts. No implementation agents
or worktrees are created during kickoff.

## Demo scope and verification

Use one visibly labeled synthetic payments repository with a webhook component,
handler file, idempotency constraint, storage decision, duplicate-processing bug,
and unrelated project areas. Its manifest preserves provenance for every claim
and relationship. The fixture must include a paraphrased semantic match and a
useful graph neighbor that lacks direct task keywords.

Demonstrate, in order:

1. Import and reopen persisted data; inspect nodes, directed relationships, and evidence.
2. Show measured total eligible context size and a smaller chosen context budget.
3. Ask “Fix duplicate Stripe webhook processing”; select useful semantic seeds
   and graph neighbors while excluding irrelevant distractors.
4. Inspect explanations, source references, canonical/inferred labels, and the
   measured bounded text; copy it for an agent.
5. Review/edit a claim, compare revisions and provenance, compile again, and show
   that the current revision is used while the old one remains readable.

Each feature spec maps acceptance criteria to automated tests or named manual
checks. Foundation tests use an actual PostgreSQL test database. Compiler tests
use fixed embeddings for deterministic algorithms plus a real-provider semantic
smoke check; mocks alone do not establish semantic quality. The workbench owns
the final integrated manual demo checklist. Do not claim 100k tokens unless
measured; label synthetic data and measured versus estimated metrics explicitly.

## Decisions, assumptions, and remaining gates

- Single trusted local operator; no public deployment or authentication. Actor
  labels are attribution, not identity verification.
- PostgreSQL 17, TypeScript/Node, direct `pg`, npm, Vitest, and later Next.js/React.
  No database service or credentials were verified during kickoff. Foundation
  implementation must validate startup, migration, tests, and persistence.
- At most 1,000 nodes and 5,000 edges per project. No paging/search cluster/vector
  database is required. Larger inputs receive explicit errors.
- Sources and node revisions are immutable. Edges are immutable additions;
  correcting/removing individual relationships and graph-wide time travel are
  deferred. Archive a node to exclude it and incident edges from the active graph.
- Prepared manifest import is intentionally narrower than arbitrary GitHub/local
  scanning. It must not execute code, fetch remote evidence, or invent claims.
- Before ingestion implementation: freeze manifest fields, identity mapping,
  bounds, and the exact fixture. A stable manifest project ID makes repeat imports
  an explicit conflict; the importer never overwrites a populated project.
- Before workbench implementation: freeze route payloads from store DTOs, simple
  wireframe/rendering choice, and manual acceptance steps. No design system project.
- Before compiler implementation: select one hosted embedding provider/model,
  credentials, tokenizer, cache schema, concrete scoring/packing rules, and
  evaluation thresholds. Use only prepared public/synthetic context. Network,
  provider availability, and semantic quality are open integration risks. Explicit
  degraded lexical retrieval may aid debugging but cannot pass the MVP semantic gate.
- Package versions and native/runtime compatibility must be verified and locked
  at implementation. Documentation does not claim dependencies have been tested.

These later-feature gates are explicit scope work for their next sessions. The
foundation has no dependency on choosing a graph UI library or an embedding vendor.

## Kickoff verification and final review

Read-only repository and scope explorers independently confirmed the inventory
and the scope contradictions before architecture decisions. The parent synthesized
the findings into this plan and the four feature specs.

The parent and two read-only reviewers checked unnecessary architecture, spec
contradictions, missing dependencies, hidden decisions, invariant coverage, feature
boundaries, verifiable acceptance criteria, and demo size. The review retained four
feature specs and found no need for additional infrastructure. Corrections made:

- Explicitly separate newly inserted project ownership from existing-project locks.
- Require transaction-bound graph reads to use one statement snapshot; include
  that path in concurrency verification.
- Define database pool ownership and shutdown semantics.
- Align legacy project-spec examples with MVP edge types, representations, and
  Project-as-scope semantics.

All foundation acceptance criteria map to concrete verification (A1–A12); later
feature criteria also map to tests or manual checks. All implementation items
remain unchecked. The three downstream specs explicitly list decisions to finish
before implementation; those gates do not block the foundation.

Documentation checks cover the template's 18 sections in every feature spec,
balanced code fences, resolving local Markdown links, whitespace errors, unchanged
preexisting user files, and a documentation-only diff. No product test/build/lint
command exists at kickoff, so no product verification or database execution is
claimed. Product code, dependencies, and implementation worktrees were not created.
