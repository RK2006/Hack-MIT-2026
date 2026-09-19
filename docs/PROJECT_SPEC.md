# Project Spec — Context Graph

Status: MVP implemented (foundation, ingestion, workbench, compiler); see feature specs for verification state
Owner: Project team
Development model: Spec-driven
Last reconciled: 2026-09-19

The kickoff repository contained only planning documents. The selected architecture
has since been implemented as a Next.js/TypeScript application backed by PostgreSQL,
with prepared-project ingestion, a graph workbench, and an explainable task-context
compiler. See [MVP plan](MVP_PLAN.md) for the original repository evidence and the
current build status. Feature contracts and verification state live in [specs/](specs/).

---

## 1. One-sentence product definition

A version-controlled project knowledge graph that gives humans and AI agents only the context relevant to the task they are currently working on.

---

## 2. Problem

Software teams accumulate important context across:

- source code
- pull requests
- issues
- Slack/Discord conversations
- documentation
- architecture discussions
- experiments
- debugging sessions
- individual developer knowledge
- AI-agent conversations

That knowledge is fragmented.

When a developer or AI agent begins working on a specific part of a project, it often must reconstruct the relevant context from scratch.

For humans, this wastes time.

For LLMs, this creates an additional constraint: the entire project's context may be much larger than the available context window, and irrelevant context can reduce answer quality even when it technically fits.

The product should solve two related problems:

1. **Shared knowledge**
   - Maintain a durable representation of what the team knows.

2. **Scoped context**
   - Compile the smallest useful subset of that knowledge for a particular task.

---

## 3. Product thesis

Git manages versions of code.

This product manages versions of project understanding.

The system should make it possible to answer:

- What does the team currently believe about this component?
- Why was this architectural decision made?
- What changed in our understanding?
- What context does an agent need before working on this task?
- Where did this piece of context come from?
- What new context did this implementation create?

---

## 4. Core product concepts

### 4.1 Context graph

Project knowledge is represented as a graph.

Each node represents a meaningful unit of context.

Longer-term vocabulary (not all implemented in the MVP):

- Project
- Component
- Feature
- Decision
- Constraint
- Assumption
- Discovery
- Bug
- OpenQuestion
- File
- PullRequest
- Issue
- Source
- Person

Longer-term relationship vocabulary:

- CONTAINS
- DEPENDS_ON
- RELATED_TO
- IMPLEMENTS
- AFFECTS
- REQUIRES
- CONSTRAINS
- CAUSED_BY
- RESOLVES
- SUPERSEDES
- DERIVED_FROM
- DISCUSSED_IN
- OWNED_BY

The MVP uses only Component, File, Decision, Constraint, Assumption, Discovery,
and Bug nodes. Project is a scope record; Source is a separate evidence record,
not a graph node. MVP edges are CONTAINS, DEPENDS_ON, IMPLEMENTS, REQUIRES,
CONSTRAINS, AFFECTS, CAUSED_BY, and RELATED_TO. Their directions and stored
lowercase node names are defined in [the foundation spec](specs/context-graph-foundation.md).
New types require an explicit migration and spec change, not an ontology framework.

### 4.2 Provenance

Context should retain where it came from.

Examples:

- GitHub PR
- commit
- issue
- Slack message
- documentation
- human entry
- agent inference

Canonical context and raw evidence are separate.

An inferred statement should not automatically become authoritative.

### 4.3 Versions

Context changes over time.

The system should eventually support Git-like concepts such as:

- context commits
- context diffs
- context branches
- merge/review
- history
- blame/provenance

For the hackathon MVP, full Git semantics are not required.

Minimum MVP versioning:

- each canonical context node has revision history
- changed context can be compared
- provenance for each revision is stored

The MVP stores immutable full snapshots of every node revision, including
inferred nodes. It compares two node revisions; it does not reconstruct a past
whole graph. Edges are immutable additions with provenance and authority;
relationship editing, removal, and graph-wide history are deferred.

### 4.4 Context checkout

A user or agent provides a task such as:

> Fix duplicate Stripe webhook processing.

The system finds relevant graph nodes and produces a task-specific context bundle.

The bundle should contain only information likely to help perform the task.

### 4.5 Context compiler

The context compiler turns a large project graph into a bounded context package.

Inputs:

- task description
- optional starting component/file
- optional branch/version (future; MVP reads current revisions only)
- token budget
- optional depth

Candidate signals may include:

- semantic similarity
- graph distance
- relationship type
- importance
- authority
- confidence
- recency
- direct code/file relevance
- token cost

Output:

- selected context items
- compressed context text
- estimated token usage
- explanation of why items were selected

### 4.6 Context diff

The system should eventually show how project understanding changed because of work.

Example:

Before:

- webhook retries happen synchronously

After:

- webhook events enter a queue
- retries run asynchronously
- maximum retry count is 5

This should be conceptually separate from the code diff.

---

## 5. Primary users

### Developer

Wants to quickly understand the part of a project they are about to modify.

### AI coding agent

Needs the minimum relevant context required to execute a task correctly.

### Team lead / reviewer

Wants important architectural context and decisions to remain durable and reviewable.

---

## 6. Core user flows

### Flow A — Connect a repository

1. Operator imports the supplied, labeled prepared example manifest.
2. System validates its file paths, component definitions, and curated claims.
3. System creates a persisted project graph with source provenance.
4. User opens the project and inspects the graph.

The prepared project satisfies the MVP ingestion requirement. Arbitrary local
repository scanning, GitHub authentication, and issue/PR ingestion are deferred.

### Flow B — Add project context

Context enters through one of:

- manual creation
- repository analysis
- GitHub issue/PR ingestion
- agent-proposed context
- optional chat integration

For MVP, support a prepared repository manifest + manual context first. Derive
file/component structure deterministically from that manifest; do not claim
automatic architectural understanding or arbitrary repository analysis.

### Flow C — Explore graph

User can:

- view project graph
- click a node
- inspect relationships
- inspect content
- inspect provenance
- inspect history

### Flow D — Ask for task context

User enters:

> Implement payment retry logic.

System:

1. understands the task
2. identifies seed nodes
3. traverses relevant graph relationships
4. ranks candidate nodes
5. fits selected context into a token budget
6. outputs a context bundle
7. explains selection

### Flow E — Give context to an LLM

The context bundle can be:

- copied as text
- retrieved through an API
- eventually exposed through MCP

MVP requirement:
- context bundle API or UI output

Stretch:
- MCP integration for Codex/Claude/etc.

### Flow F — Update context after work

After implementation:

1. code changes are analyzed
2. system proposes durable context changes
3. user reviews proposal
4. accepted changes become a new context revision

MVP uses a manual edit/review that creates a revision, followed by a before/after
comparison. Automated code analysis and agent proposal orchestration are deferred.

---

## 7. MVP

The hackathon MVP should demonstrate one complete loop extremely well.

### Required

#### Repository/project ingestion
- ingest a code repository or prepared example project
- identify files/components
- create graph nodes

#### Graph storage
- persist nodes
- persist typed edges
- persist node metadata

#### Context graph UI
- visualize nodes/relationships
- click node to inspect details

#### Task input
- accept natural language task description

#### Relevant-subgraph retrieval
- identify seed nodes
- retrieve related candidates
- rank candidates

#### Token budget
- user/system supplies max context budget
- output remains approximately within budget

#### Context bundle
- produce structured context for an LLM
- include relevant decisions/constraints/files/etc.

#### Explainability
- show why major nodes were included

#### Semantic matching
- use embedding similarity as well as graph relationships and explicit references
- a lexical-only degraded response does not satisfy the successful MVP demo

#### Context changes
- preserve immutable node revision snapshots and their provenance
- allow a human to edit/review context and compare two revisions
- keep inferred claims distinguishable from canonical knowledge

Example:

> Idempotency was included because Retry System DEPENDS_ON Webhook Processing, which REQUIRES Idempotency.

### Stretch

- LLM-generated candidate nodes/edges
- arbitrary repository scanning and GitHub integration
- MCP endpoint
- Slack/Discord ingestion
- automatic branch-specific context
- context PRs
- graph merge conflicts
- live agent context requests
- automated context updates from completed PRs
- multi-user permissions

---

## 8. Non-goals for MVP

Do not attempt to build:

- a full replacement for GitHub
- a general enterprise knowledge management platform
- perfect ontology extraction
- full Slack + GitHub + Jira + Notion integration simultaneously
- a distributed graph database
- autonomous acceptance of all agent-generated knowledge
- exact semantic version control equivalent to Git internals
- sophisticated permission systems
- production-grade billing/auth unless required by hosting

The demo matters more than infrastructure completeness.

---

## 9. Selected MVP architecture

No implementation stack existed at kickoff. These are new decisions that retain
the original spec's Next.js/React and PostgreSQL direction.

- One TypeScript application, Node.js runtime, npm and a committed lockfile.
- Next.js App Router + React for the workbench and same-origin route handlers.
- A server-only graph store using `pg` and parameterized SQL; no separate API
  service, ORM, graph database, or job queue.
- PostgreSQL 17 for local development/test/demo, configured by `DATABASE_URL`.
  A small local container configuration belongs to foundation implementation.
- Five product tables: `projects`, `context_sources`, `context_nodes`,
  `context_revisions`, and `context_edges`. Sources and revisions are immutable;
  node identity is separate from revision content. See the exact schema in
  [the foundation spec](specs/context-graph-foundation.md).
- Application-level traversal of a bounded project graph. Up to 1,000 nodes and
  5,000 edges per project; oversized imports fail explicitly.
- One configured embedding backend for semantic matching, with a small
  revision-keyed cache and cosine scoring in application code. The compiler spec
  selected a local in-process sentence-transformer as the default (no hosted
  embedding credential was available) and an optional hosted OpenAI adapter behind
  the same interface; tokenizer is `cl100k_base`. No pgvector dependency is needed
  at this graph size.
- Vitest for domain and real-PostgreSQL integration tests; TypeScript checking,
  ESLint, formatting, and later a Next.js build check.

Foundation implementation creates only the package/database/test scaffold and
graph store. The workbench adds Next.js when it has a consumer for the store.
Exact compatible package versions are pinned and verified during implementation;
no packages were installed during kickoff.

The demo runs locally under one trusted operator, bound to loopback. There is no
authentication, user-account system, or public deployment in the MVP. Actor labels
record provenance, not authenticated identity. Public hosting needs a separate
access-control decision. Credentials stay server-side. Only the prepared public
or synthetic context is sent to an embedding provider.

The compiler returns current node revision IDs, typed graph paths, selection
reasons, omissions, and bounded rendered text. The workbench highlights that
selection and supplies copyable text. JSON API + copy handoff fulfill the agent
interface requirement; MCP is stretch.

---

## 10. Retrieval design

Retrieval should be hybrid.

### Stage 1 — Seed discovery

Use:
- task semantic similarity
- explicitly referenced files/components
- lexical matches

Result:
small list of likely starting nodes

### Stage 2 — Graph expansion

Traverse high-value relationships from seeds.

Examples:

High priority:
- DEPENDS_ON
- REQUIRES
- CONSTRAINS
- IMPLEMENTS

Medium:
- AFFECTS
- CAUSED_BY

Lower:
- RELATED_TO
- CONTAINS

Depth should be configurable.

### Stage 3 — Candidate scoring

Conceptual candidate signals (not a finalized formula):

relevance
× relationship importance
× authority
× confidence
× recency factor

Token cost should be considered when selecting the final bundle.

Exact scoring does not need to be mathematically sophisticated for MVP. Among
relevant candidates, canonical context takes precedence over inferred context;
unrelated canonical nodes must not displace relevant inferred candidates merely
because of authority. The compiler spec fixes eligibility, ordering, and tests
before implementation. Inferred edges remain labeled even when both endpoints
are canonical.

### Stage 4 — Context compression

Nodes may have multiple representations:

- title only
- short summary
- detailed context

Raw evidence is inspected separately. The compiler includes its source reference,
not a separate unbounded raw-evidence representation.

Choose representation based on:
- relevance
- available token budget

### Stage 5 — Packing

Fit the most useful information into the budget.

Count the entire rendered context text, including its headings, provenance,
authority labels, and explanations, with the configured tokenizer. The task and
the consuming agent's other messages are outside this context-only budget. Report
when important eligible context could not fit. Preserve claims using stored
content/summary/title representations; generative rewriting is outside the MVP.

Prioritize:
1. critical constraints
2. task-specific decisions
3. relevant architecture
4. direct dependencies
5. known bugs/discoveries
6. useful source references

---

## 11. Explainability

The context compiler must not feel like an opaque RAG query.

For each important selected context item, retain an explanation.

Examples:

- directly matched task description
- associated with file being modified
- one hop from Stripe Webhooks through REQUIRES
- canonical architectural decision
- direct dependency of selected component

The UI should allow a user to inspect these explanations.

---

## 12. Canonical vs inferred context

MVP nodes and edges have exactly two authority values: `canonical` and `inferred`.
Canonical means reviewed by the operator, or a deterministic file/component fact
from the importer. Agent-generated claims and relationships start inferred.
Only a human review can promote a claim; agents cannot replace canonical content.

Nodes have a separate `archived` flag in their revision snapshot. Archived nodes
remain in history but do not enter current graph traversal. Automatic staleness
detection is deferred. There are no separate reviewed/proposed/stale authority
states. The foundation spec defines enforced write rules.

---

## 13. Example

Task:

> Fix duplicate Stripe webhook processing.

Relevant graph within one project scope (Project itself is not a graph node):

Backend
→ Payments
→ Stripe
→ Webhooks

Webhooks
→ REQUIRES → Idempotency

`src/payments/webhook.ts`
→ IMPLEMENTS → Webhooks

Duplicate Payments
→ CAUSED_BY → Duplicate Webhook Delivery

Event ID Store
→ IMPLEMENTS → Idempotency

Context compiler may output:

### Task
Fix duplicate Stripe webhook processing.

### Architecture
Stripe events enter through `/api/webhooks/stripe`.

### Important constraints
- Stripe can deliver the same event multiple times.
- Processing must be idempotent.
- A Stripe event ID may only create one payment.

### Current implementation
`src/payments/webhook.ts`

### Relevant decision
Store processed Stripe event IDs in PostgreSQL before creating payment state.

### Known issue
Current handler checks the event ID after payment creation, allowing a race.

### Related components
- Payment database
- Queue
- Retry strategy

Token usage:
~1,100 / 5,000

---

## 14. Success criteria for hackathon demo

The demo is successful if judges can immediately understand:

1. the project contains much more context than an LLM should receive
2. the system stores that context as structured, connected knowledge
3. a user provides a specific engineering task
4. the system highlights/selects a small relevant subgraph
5. the resulting LLM context is far smaller than total project context
6. the system explains why the selected context is relevant
7. the selected context can be handed to an AI coding agent
8. the project can show at least one context change/history example

Ideal demo metric:

> Entire project knowledge: 100k+ tokens
> Compiled task context: <5k tokens

The exact numbers may be synthetic/demo data as long as clearly labeled.

---

## 15. Product principles

### Context is structured
Do not reduce everything to raw chunks in a vector database.

### Context is scoped
An agent should receive what it needs, not everything available.

### Context is traceable
Important claims should have provenance.

### Context changes
Project understanding is not static.

### Humans remain authoritative
AI may infer and propose; important context should be reviewable.

### Retrieval is explainable
Users should understand why knowledge entered an agent's context.

### Simplicity wins
For the hackathon, prefer the smallest architecture that proves the idea.

---

## 16. Decisions and remaining verification gates

Resolved at kickoff: seven node types, eight edge types, File as a node, Project
and Source as separate records, prepared-example ingestion, manual summaries,
two authority values, immutable node snapshots, current-only retrieval, and
JSON/copy agent handoff. No branch model, OAuth, or automatic stale detection.

The manifest schema/fixture, workbench renderer and route contracts, compiler
provider/model, tokenizer, scoring constants, and evaluation fixture are frozen in
their feature specs and implemented. PostgreSQL integration, the local semantic
provider, automated checks, production build, and live JSON compile route have been
verified. The remaining MVP acceptance gate is the workbench's browser walkthrough;
the optional hosted OpenAI provider also remains unexercised because no credential
is available.
