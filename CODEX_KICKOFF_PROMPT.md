# Codex Kickoff Prompt

You are helping build this repository using spec-driven development.

Before writing implementation code, inspect the repository and read:

- `AGENTS.md`
- `docs/PROJECT_SPEC.md`
- `docs/FEATURE_SPEC_TEMPLATE.md`
- any existing files under `docs/specs/`

Your first objective is to turn the product concept into an implementation-ready MVP plan without overengineering it.

## Product concept

We are building a version-controlled project context graph for humans and AI coding agents.

The system stores important project knowledge as nodes and relationships.

Examples of context nodes:
- components
- decisions
- constraints
- assumptions
- bugs
- discoveries
- files
- PRs
- issues

A user or coding agent supplies a task such as:

> "Fix duplicate Stripe webhook processing."

The system should retrieve only the part of the project's context graph relevant to that task, rank it, compress it to a configurable token budget, and produce an explainable context bundle suitable for an LLM.

The system should eventually support context history/diffs so that project understanding evolves alongside the codebase.

## What I want you to do now

Do NOT immediately build the entire product.

### Step 1 — Inspect

Inspect the current repository.

Identify:
- current stack
- current files/components
- existing database/auth/API structure
- existing tests
- existing dependencies
- anything already implementing pieces of the product

Do not infer absence without searching.

### Step 2 — Reconcile with the project spec

Compare the repository to `docs/PROJECT_SPEC.md`.

List:
- what already exists
- what is missing
- what assumptions in the spec need adjustment based on the actual repository

If `PROJECT_SPEC.md` contradicts established repository architecture, update the spec to use the existing architecture unless there is a strong reason not to.

### Step 3 — Define the MVP implementation sequence

Create a set of feature specs under `docs/specs/`.

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
Combine tightly coupled work where appropriate.

### Step 4 — Write the first implementation-ready spec

Choose the foundational feature that should be built first.

Create its spec using `docs/FEATURE_SPEC_TEMPLATE.md`.

The spec must be concrete enough that another engineer could implement it without making major product decisions.

Include:
- exact data model
- important TypeScript/types/interfaces if applicable
- relevant endpoints/functions
- acceptance criteria
- test plan
- implementation checklist

### Step 5 — Recommend the build order

At the end, provide a concise proposed sequence such as:

Feature A
→ Feature B
→ Feature C
→ end-to-end demo

For each step, state what becomes demonstrable after it is complete.

## Engineering constraints

Optimize for a hackathon MVP.

Prefer:
- simple relational `nodes` + `edges` storage
- PostgreSQL/pgvector if the repo already supports it
- simple application-level graph traversal
- one excellent end-to-end demo
- transparent retrieval logic
- testable interfaces

Avoid unless clearly necessary:
- Neo4j
- microservices
- distributed systems
- complex event sourcing
- elaborate ontology frameworks
- premature permissions systems
- building every external integration

## Core invariants

Do not violate these without explicitly updating the spec and explaining why:

- context is structured rather than only raw chunks
- context has provenance
- inferred context is distinguishable from reviewed/canonical context
- task retrieval uses graph relationships plus semantic relevance
- LLM context is bounded by a token budget
- retrieval is explainable
- durable project knowledge should survive individual chats
- important context changes should have history
- the MVP remains small enough to demo end-to-end

## Important working rule

When future implementation requests arrive:

1. read the relevant spec
2. update/create the spec if behavior is not sufficiently defined
3. create an implementation checklist
4. implement
5. test against acceptance criteria
6. update durable project context/specs if implementation changed what the team knows

Do not treat the spec as write-once documentation.
It should evolve with the implementation.
