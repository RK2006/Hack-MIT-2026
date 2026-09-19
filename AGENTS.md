# AGENTS.md

## Purpose

This repository is developed using spec-driven development.

The goal is not to jump directly from a user request to code. For any non-trivial change, first establish what should be built, why it should be built, how it fits the architecture, and how success will be verified.

Treat the documents under `docs/` as the durable source of product and engineering context.

## Source of truth

Read these before making substantial changes:

1. `docs/PROJECT_SPEC.md`

   * Product vision
   * Core concepts
   * System boundaries
   * Architecture
   * MVP scope
   * Non-goals

2. `docs/FEATURE_SPEC_TEMPLATE.md`

   * Required structure for new feature specifications

3. Feature-specific specs under `docs/specs/`

   * These override general assumptions in `PROJECT_SPEC.md` for the feature they describe.

If code and documentation disagree, do not silently choose one.

Identify the mismatch and update the relevant spec when the intended behavior is clear.

## Required workflow

For any substantial feature, refactor, API change, schema change, integration, or architectural change:

### Phase 1: Understand

Before editing code:

* Read the relevant repository files.
* Read `docs/PROJECT_SPEC.md`.
* Search for existing specs that touch the requested area.
* Identify the existing architecture and conventions.
* Identify affected components, interfaces, data models, and tests.
* Do not assume a component does not exist until you have searched for it.
* Inspect the current git branch and working-tree state before making substantial changes.

For substantial tasks that span multiple independent parts of the repository, use read-only explorer subagents when useful to investigate those areas in parallel.

The parent agent is responsible for synthesizing their findings before architecture or implementation decisions are made.

### Phase 2: Specify

If the requested behavior is not already fully specified:

1. Create a feature spec in:

   `docs/specs/<feature-name>.md`

2. Follow `docs/FEATURE_SPEC_TEMPLATE.md`.

3. The spec must include:

   * problem
   * goals
   * non-goals
   * user experience
   * functional requirements
   * data model changes
   * API/interface changes
   * context-graph implications
   * edge cases
   * acceptance criteria
   * test plan
   * implementation plan

4. Resolve reasonable ambiguity yourself using the simplest design consistent with `PROJECT_SPEC.md`.

5. If multiple reasonable designs exist, record the chosen approach and alternatives considered in the spec.

Do not implement until the spec is coherent enough that another engineer could implement it.

### Phase 3: Plan

Before implementation, create an explicit implementation checklist in the feature spec.

Break work into small, independently verifiable steps.

Prefer changes that preserve working software throughout the implementation.

Maintain the implementation checklist as work proceeds.

Use:

* `[ ]` not started
* `[~]` in progress
* `[x]` complete

Only mark an item complete after its associated verification passes.

Before declaring the feature complete, ensure every acceptance criterion maps to either:

* an automated test, or
* an explicitly documented manual verification.

### Phase 4: Implement

Implement against the current feature spec once it satisfies the specification requirements above.

While implementing:

* Keep changes focused.
* Reuse existing abstractions before creating new ones.
* Do not introduce speculative infrastructure.
* Do not refactor unrelated code unless required for correctness.
* Preserve public interfaces unless the spec explicitly changes them.
* Prefer clear, boring code over clever code.
* Add comments for non-obvious reasoning, not for obvious syntax.

If implementation reveals that the spec is wrong or incomplete:

* update the spec first,
* then continue implementation.

### Phase 5: Verify

Before declaring work complete:

* Run relevant tests.
* Run formatting/linting/type-checking commands if present.
* Add tests for new behavior.
* Verify every acceptance criterion.
* Inspect the final diff for accidental unrelated changes.
* Compare the final implementation against the relevant feature spec and project invariants.
* Review `git diff` and `git status` before committing.

If a check cannot be run, clearly state why.

### Phase 6: Update context

A core product principle of this repository is that important engineering knowledge should not disappear into code or chat history.

After a meaningful implementation, update the relevant spec when you learn something durable such as:

* architectural decisions
* new constraints
* assumptions proven false
* dependencies
* known limitations
* important implementation behavior
* changed relationships between system components

Do not record temporary debugging chatter as durable context.

### Phase 7: Commit and push

After a coherent unit of work has passed verification:

1. Review the final diff.
2. Ensure only intended changes are included.
3. Create a concise, descriptive commit.
4. Push the current branch to its configured remote when GitHub access is available.

Do not push work merely because files changed.

A commit should represent a coherent, verified unit of work.

If verification fails because of an unrelated pre-existing repository issue, clearly distinguish that issue from changes introduced by the current task before deciding whether the task is safe to commit.

## Subagents and parallel work

Use subagents selectively when they improve understanding, review quality, or allow genuinely independent work to proceed in parallel.

Do not use multiple agents merely because they are available.

### Exploration

For substantial tasks, prefer parallel read-only exploration when multiple independent areas of the repository need investigation.

Examples include:

* architecture
* data model
* API surface
* context graph
* retrieval and ranking
* frontend behavior
* persistence
* integrations
* testing infrastructure

Explorer subagents should:

* inspect code, specs, and tests,
* identify relevant files and dependencies,
* report findings to the parent agent,
* avoid modifying files unless explicitly assigned implementation work.

The parent agent is responsible for:

* synthesizing findings,
* resolving contradictions,
* identifying cross-cutting dependencies,
* making architectural decisions,
* deciding what can safely be implemented in parallel.

Do not begin implementation simply because one explorer finishes early. Wait for relevant exploration work when its findings could affect architecture or interfaces.

### Implementation

Do not parallelize implementation merely to increase throughput.

Parallel implementation is appropriate only when work items:

* have clearly defined boundaries,
* do not depend on unresolved architectural decisions,
* modify largely independent areas,
* have stable interfaces between them,
* can be independently tested and reviewed.

Before parallel implementation:

1. Resolve shared architectural decisions.
2. Define shared interfaces, schemas, and contracts.
3. Identify ownership boundaries for each work item.
4. Identify integration points.
5. Define verification criteria for each work item.

When parallel implementation would cause agents to:

* edit overlapping code,
* modify the same schema,
* make competing architectural decisions,
* independently define the same interface,
* depend heavily on unfinished work from one another,

implement sequentially instead.

### Worktrees and branches

For independent implementation tasks, prefer isolated git branches or worktrees when available.

Each implementation agent should have a clearly defined scope.

Agents working in separate worktrees should not assume changes from another worktree are already present unless the shared interface was defined beforehand.

The parent agent is responsible for:

* assigning independent scopes,
* defining shared contracts first,
* integrating changes,
* resolving conflicts,
* verifying the integrated result,
* ensuring the final code still matches the feature spec.

Do not create worktrees for trivial tasks or work that is tightly coupled.

When a worktree or feature branch is used:

* commit its changes on that branch,
* push that branch if appropriate,
* do not independently merge it into the default branch unless explicitly requested.

### Parent-agent responsibility

Subagents provide focused investigation, implementation, or review.

The parent agent remains responsible for the overall task.

Do not delegate away responsibility for:

* architecture
* cross-component consistency
* requirement coverage
* spec coherence
* integration
* final verification

The parent agent should retain enough context to understand how all delegated work fits together.

### Review agents

After substantial implementation, use a separate reviewer or review subagent when practical.

The reviewer should compare the implementation against:

* the relevant feature spec,
* acceptance criteria,
* `PROJECT_SPEC.md`,
* product invariants,
* tests,
* affected interfaces and data models.

Review agents should prioritize:

1. incorrect behavior
2. missing requirements
3. spec/code mismatches
4. broken assumptions
5. architectural inconsistencies
6. insufficient edge-case handling
7. missing or weak tests

Review agents should not silently redesign the feature or change architectural decisions.

If a reviewer identifies a durable design issue, update the feature spec before changing the implementation.

## Git and GitHub workflow

Use git as part of the normal development workflow.

### Before making changes

* Inspect `git status`.
* Identify the current branch.
* Do not overwrite unrelated local work.
* If unrelated uncommitted changes already exist, preserve them and avoid including them in the current task's commit.

### Commits

Create commits only for coherent, verified units of work.

Before committing:

* run the relevant verification,
* inspect `git diff`,
* inspect `git status`,
* ensure temporary files and debugging changes are excluded,
* ensure secrets or credentials are not being committed.

Use concise commit messages that describe the completed change.

Prefer one logical commit per completed feature or meaningful milestone rather than committing every small edit.

### Pushes

After a verified commit, push the current branch to its configured GitHub remote when access is available.

Do not:

* force-push,
* rewrite published history,
* push unresolved merge conflicts,
* push known broken implementation,
* push secrets or credentials,
* merge into the default branch unless explicitly requested.

When working on a feature branch or worktree, push that branch rather than merging directly into the default branch.

If the current branch is already the default branch, do not create an unnecessary branch solely because of this rule. However, do not perform automatic merges or history rewrites.

If push fails because of:

* authentication,
* permissions,
* branch protection,
* network restrictions,
* remote configuration,

preserve the local commit and clearly report the failure.

### Subagents and git

Implementation subagents should not independently push overlapping work.

The parent agent is responsible for coordinating commits and pushes when multiple agents contribute to the same feature.

For independent worktrees, each branch may be committed separately when appropriate, but integration should still be coordinated by the parent agent.

## Working style

### Prefer repository evidence

When answering questions about the project:

1. inspect code,
2. inspect specs,
3. inspect tests,
4. then reason.

Do not invent project behavior from filenames or assumptions.

### Small context principle

This project itself is about context management.

Apply the same principle while working:

* retrieve only the files and specs relevant to the current task,
* expand outward only when dependencies require it,
* avoid loading unrelated parts of the repository,
* use targeted exploration rather than repeatedly loading the entire project.

Do not confuse small context with incomplete investigation. Retrieve additional context when dependencies or uncertainty require it.

### Traceability

Important decisions should be traceable.

When practical, feature specs should reference:

* related source files,
* related APIs,
* relevant tests,
* related context node types,
* related graph edges,
* prior specs.

Implementation should make it reasonably possible to trace:

`requirement → implementation → verification`

### No silent architectural decisions

If implementation introduces a durable architectural decision, record it in the feature spec or `PROJECT_SPEC.md`.

Do not allow an implementation detail to quietly become architecture without documenting it.

### Prefer the smallest sufficient implementation

When multiple implementations satisfy the spec, prefer the one with:

* fewer new abstractions,
* fewer moving parts,
* less infrastructure,
* fewer dependencies,
* clearer behavior,
* easier verification.

Do not design for hypothetical future requirements unless the current spec requires it.

## Product-specific invariants

Unless a feature spec explicitly changes these:

1. The system stores project knowledge as structured context, not just raw chat summaries.

2. Context is organized as nodes and relationships.

3. Context must preserve provenance where possible.

4. Context can change over time and therefore requires version/history semantics.

5. LLMs should receive task-relevant context rather than the entire project context.

6. Context selection must respect a configurable token budget.

7. Retrieval should be explainable: the system should be able to say why a context item was included.

8. Human-reviewed/canonical context should outrank weak inferred context.

9. Raw source material and canonical context are distinct concepts.

10. Agents may propose context changes, but inferred information should not silently become canonical truth.

11. The MVP should remain simple enough to demonstrate end-to-end at a hackathon.

12. Avoid building infrastructure that is not required for the current MVP.

## Definition of done

A substantial feature is complete only when:

* behavior matches its feature spec,
* acceptance criteria are satisfied,
* appropriate tests exist and pass,
* relevant documentation is updated,
* the implementation checklist is complete,
* durable context learned during implementation has been captured,
* there are no known silent spec/code mismatches,
* the integrated result has been verified rather than only individual components,
* unrelated changes have not been introduced.

Once those conditions are satisfied, the completed unit of work may be committed and pushed according to the Git and GitHub workflow above.

## When receiving a new task

For a new substantial task, reason through this sequence before coding:

1. What is being requested?
2. What existing product behavior does it affect?
3. Which specs, code, and tests are relevant?
4. Is the behavior already specified?
5. If not, what spec needs to be written or updated?
6. What architectural decisions must be resolved first?
7. Can any investigation happen safely in parallel?
8. What is the smallest implementation that satisfies the spec?
9. Which implementation steps are independent enough to parallelize?
10. How will every acceptance criterion be verified?
11. After implementation, what durable context changed?
12. Is the resulting unit of work coherent and verified enough to commit and push?

Do not skip directly to coding unless the change is trivial.

For substantial work, the preferred sequence is:

`understand → specify → plan → implement → verify → update context → commit → push`

Use subagents and worktrees to support this sequence, not to bypass it.
