# Codex Kickoff Prompt

You are helping build this repository using spec-driven development.

Before writing implementation code, inspect the repository and read:

* `AGENTS.md`
* `docs/PROJECT_SPEC.md`
* `docs/FEATURE_SPEC_TEMPLATE.md`
* any existing files under `docs/specs/`

Follow the workflow and git rules defined in `AGENTS.md`.

Your first objective is to turn the product concept into an implementation-ready MVP plan without overengineering it.

For this kickoff task, do **not** implement product code.

## Product concept

We are building a version-controlled project context graph for humans and AI coding agents.

The system stores important project knowledge as nodes and relationships.

Examples of context nodes:

* components
* decisions
* constraints
* assumptions
* bugs
* discoveries
* files
* PRs
* issues

A user or coding agent supplies a task such as:

> "Fix duplicate Stripe webhook processing."

The system should retrieve only the part of the project's context graph relevant to that task, rank it, compress it to a configurable token budget, and produce an explainable context bundle suitable for an LLM.

The system should eventually support context history/diffs so that project understanding evolves alongside the codebase.

## What I want you to do now

Do NOT immediately build the entire product.

This kickoff pass is for:

`repository inspection → architecture reconciliation → MVP specification → implementation planning`

not implementation.

## Step 0 — Inspect repository and git state

Before making changes:

* inspect `git status`,
* identify the current branch,
* identify the configured remote if present,
* preserve unrelated existing local changes,
* do not reset or discard user work.

Do not create implementation worktrees yet.

## Step 1 — Inspect

Inspect the current repository thoroughly enough to understand its existing architecture.

Identify:

* current stack
* current files/components
* existing database structure
* existing authentication
* existing API/backend structure
* existing frontend structure
* existing tests
* existing build/lint/type-check tooling
* existing dependencies
* anything already implementing pieces of the product

Do not infer absence without searching.

Use read-only explorer subagents when useful to inspect independent parts of the repository in parallel.

Good exploration areas may include:

* architecture and stack
* database and data models
* API/backend
* frontend
* tests and tooling
* existing context/retrieval functionality

Explorer agents should inspect and report findings rather than modify implementation code.

Wait for relevant explorer findings before making cross-cutting architecture decisions.

## Step 2 — Reconcile with the project spec

Compare the actual repository to `docs/PROJECT_SPEC.md`.

Determine:

* what already exists,
* what is partially implemented,
* what is missing,
* which assumptions in the spec need adjustment based on repository reality,
* which existing architectural conventions should be preserved.

If `PROJECT_SPEC.md` contradicts established repository architecture, prefer adapting the spec to the existing architecture unless there is a strong product or technical reason not to.

Do not silently resolve contradictions.

Update `PROJECT_SPEC.md` when repository reality establishes a better or more accurate durable architecture description.

## Step 3 — Define the MVP feature boundaries

Determine the smallest coherent set of feature specs needed to build the MVP.

At minimum, consider whether separate specs are appropriate for:

1. context graph data model
2. project/repository ingestion
3. graph visualization
4. task-to-context retrieval
5. token-budget context compiler
6. explainable selection
7. context revisions/diffs
8. LLM/MCP integration

Do not create unnecessary specs merely to match this list.

Combine tightly coupled features where doing so results in a simpler architecture and implementation sequence.

Split features when they have:

* distinct responsibilities,
* meaningful independent acceptance criteria,
* different dependency boundaries,
* independent implementation value.

Create the required spec files under:

`docs/specs/`

For specs that will be implemented later, define enough scope and dependency information to establish the MVP build order.

Do not unnecessarily fully design every later feature during this kickoff pass.

## Step 4 — Choose the foundational feature

Choose the feature that should be implemented first based on actual repository architecture and dependency order.

Do not assume in advance that a particular feature must come first.

Prefer the feature that establishes the minimum stable contracts required by the greatest number of later features.

Explain briefly in its spec why it is foundational.

## Step 5 — Write the first implementation-ready spec

Fully write the foundational feature spec using:

`docs/FEATURE_SPEC_TEMPLATE.md`

The spec must be concrete enough that another engineer or fresh Codex session could implement it without making major product or architecture decisions.

Include, where applicable:

* exact data model
* database tables/schema
* important TypeScript types/interfaces
* enums/constants
* repository/service interfaces
* relevant endpoints
* relevant functions
* provenance semantics
* canonical vs inferred semantics
* revision/history behavior required at this stage
* graph relationships
* validation rules
* edge cases
* acceptance criteria
* test plan
* explicit implementation checklist

Resolve reasonable ambiguity using the simplest design consistent with `PROJECT_SPEC.md`.

When multiple reasonable designs exist:

* choose one,
* explain why,
* record important alternatives considered.

Optimize for an end-to-end hackathon MVP, not hypothetical production scale.

## Step 6 — Define verification

For the foundational spec, ensure every acceptance criterion can be verified through either:

* an automated test, or
* an explicitly documented manual verification.

The implementation checklist should use:

* `[ ]` not started
* `[~]` in progress
* `[x]` complete

At kickoff, implementation items should remain uncompleted because product code is not being implemented yet.

## Step 7 — Recommend the build order

Create a dependency-aware MVP build sequence.

Use a concise structure such as:

Feature A
→ Feature B
→ Feature C
→ end-to-end demo

For each step, state:

* what it depends on,
* what capability it adds,
* what becomes demonstrable after completion.

Favor a sequence that produces visible/demoable progress early.

Identify which future steps could plausibly be developed in parallel once their shared interfaces are stable.

Do not parallelize tightly coupled foundational work just for speed.

## Engineering constraints

Optimize for a hackathon MVP.

Prefer:

* simple relational `nodes` + `edges` storage
* PostgreSQL/pgvector if the repository already supports it
* simple application-level graph traversal
* one excellent end-to-end demo
* transparent retrieval logic
* testable interfaces
* existing repository abstractions and conventions

Avoid unless clearly necessary:

* Neo4j
* microservices
* distributed systems
* complex event sourcing
* elaborate ontology frameworks
* premature permissions systems
* building every external integration
* infrastructure for hypothetical scale

Prefer the smallest design that proves the core product idea.

## Core invariants

Do not violate these without explicitly updating the spec and explaining why:

* context is structured rather than only raw chunks
* context has provenance
* inferred context is distinguishable from reviewed/canonical context
* task retrieval uses graph relationships plus semantic relevance
* LLM context is bounded by a token budget
* retrieval is explainable
* durable project knowledge should survive individual chats
* important context changes should have history
* the MVP remains small enough to demo end-to-end

## Important working rule

When future implementation requests arrive:

1. read the relevant spec,
2. update/create the spec if behavior is not sufficiently defined,
3. create or verify the implementation checklist,
4. implement,
5. test against acceptance criteria,
6. update durable project context/specs if implementation changed what the team knows,
7. inspect the final diff,
8. commit the coherent verified change,
9. push the current branch when GitHub access is available.

Do not treat the spec as write-once documentation.

It should evolve with the implementation.

## Git and GitHub instructions for this kickoff

This kickoff should change documentation/specification files only.

Do not implement product code during this task.

After completing the kickoff work:

1. Inspect `git diff`.
2. Inspect `git status`.
3. Confirm that the changes are limited to intentional planning/specification work.
4. Review the resulting specs for internal consistency.
5. Create one logical commit containing the completed kickoff/specification work.
6. Use a concise commit message describing the planning/spec work.
7. Push the current branch to its configured GitHub remote if access is available.

Do not:

* force-push,
* rewrite history,
* merge into another branch,
* discard unrelated local changes,
* include unrelated user changes in the commit,
* commit secrets or credentials.

If pushing is blocked by authentication, permissions, network restrictions, branch protection, or remote configuration:

* keep the local commit,
* do not attempt destructive workarounds,
* clearly report what prevented the push.

## Final review before committing

Before committing the kickoff work, perform a final read-only review of the proposed plan.

Check specifically for:

* unnecessary architecture,
* contradictions between specs,
* missing dependencies,
* hidden major product decisions left for implementation,
* violations of the product invariants,
* features that should be combined or split,
* acceptance criteria that are not actually verifiable,
* anything that makes the MVP unnecessarily large.

Fix legitimate specification issues before committing.

Do not begin implementation as part of this review.

## Final report

After the kickoff task is complete, report:

* what you discovered about the existing repository,
* what already existed,
* what was missing,
* specs created,
* specs updated,
* the foundational feature selected,
* why it comes first,
* the proposed implementation sequence,
* which later steps may safely run in parallel,
* important assumptions,
* unresolved risks,
* files changed,
* commit created,
* branch pushed or reason push was unavailable.

Do not implement the first feature during this kickoff task.
