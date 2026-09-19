# Project Spec — Context Graph

Status: Draft / MVP
Owner: Project team
Development model: Spec-driven

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

Initial node types:

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

Initial relationship types:

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

The schema should remain extensible.

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
- optional branch/version
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

1. User selects/connects a GitHub repository.
2. System ingests basic repository structure.
3. System identifies components/files.
4. System creates initial graph nodes and relationships.
5. User can inspect the generated graph.

MVP may support a local repository import if GitHub OAuth is too expensive for hackathon time.

### Flow B — Add project context

Context enters through one of:

- manual creation
- repository analysis
- GitHub issue/PR ingestion
- agent-proposed context
- optional chat integration

For MVP, support repository analysis + manual context first.

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

MVP may demo this manually or with a simplified proposal flow.

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

Example:

> Idempotency was included because Retry System DEPENDS_ON Webhook Processing, which REQUIRES Idempotency.

### Strongly desired

- embeddings for semantic matching
- context revision history
- context diff
- LLM-generated candidate nodes/edges
- simple GitHub integration
- MCP endpoint

### Stretch

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

## 9. Proposed MVP architecture

The implementation may change this if the feature specs justify it.

### Frontend

Possible:
- Next.js / React

Responsibilities:
- project selection
- graph visualization
- node detail panel
- task input
- context bundle display
- token-budget controls
- context-diff display

### Backend/API

Possible:
- Next.js API routes or lightweight separate API

Responsibilities:
- ingestion
- node/edge CRUD
- retrieval
- ranking
- context compilation
- LLM calls
- version creation

### Database

Preferred hackathon approach:

PostgreSQL

Tables conceptually:

#### context_nodes

- id
- project_id
- type
- title
- content
- summary
- importance
- confidence
- authority
- created_at
- updated_at

#### context_edges

- id
- project_id
- from_node_id
- to_node_id
- relationship_type
- weight
- metadata

#### context_sources

- id
- node_id
- source_type
- source_uri
- source_metadata

#### context_revisions

- id
- node_id
- previous_revision_id
- content
- change_reason
- created_by
- created_at

#### embeddings

Use pgvector if convenient.

Embedding may be stored directly on nodes instead of a separate table.

### Graph implementation

For MVP, do not require Neo4j.

Use relational node/edge tables unless graph-specific functionality becomes necessary.

Graph traversal can be performed in application code or recursive SQL.

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
- RESOLVES
- SUPERSEDES

Lower:
- RELATED_TO
- DISCUSSED_IN

Depth should be configurable.

### Stage 3 — Candidate scoring

Initial conceptual score:

relevance
× relationship importance
× authority
× confidence
× recency factor

Token cost should be considered when selecting the final bundle.

Exact scoring does not need to be mathematically sophisticated for MVP.

### Stage 4 — Context compression

Nodes may have multiple representations:

- title only
- short summary
- detailed context
- raw evidence

Choose representation based on:
- relevance
- available token budget

### Stage 5 — Packing

Fit the most useful information into the budget.

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

Each context node should have an authority/state field.

Possible states:

- canonical
- reviewed
- inferred
- proposed
- stale

Recommended MVP behavior:

- repository structure may be automatically canonical
- LLM-extracted architectural claims begin as inferred/proposed
- human approval can promote them
- retrieval scoring favors reviewed/canonical knowledge

---

## 13. Example

Task:

> Fix duplicate Stripe webhook processing.

Relevant graph:

Project
→ Backend
→ Payments
→ Stripe
→ Webhooks

Webhooks
→ REQUIRES → Idempotency

Webhooks
→ IMPLEMENTED_BY → `src/payments/webhook.ts`

Duplicate Payments
→ CAUSED_BY → Duplicate Webhook Delivery

Idempotency
→ IMPLEMENTED_BY → Event ID Store

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

## 16. Open questions

These should be resolved through feature specs as implementation progresses.

- What exact node types should MVP support?
- How much graph extraction should be automatic?
- Should code files themselves be graph nodes or metadata on components?
- How should token cost be estimated?
- How should node summaries be generated and cached?
- How are stale nodes detected?
- What qualifies as a context revision?
- Does MVP require context branches or only revision history?
- Should GitHub integration be OAuth-based or demo-repository based?
- What agent interface is best for the demo: copyable prompt, API, or MCP?
- Which graph visualization library should be used?
