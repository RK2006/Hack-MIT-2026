# AGENTS.md

## Purpose

This repository is developed using spec-driven development.

The goal is not to jump directly from a user request to code. For any non-trivial change, first establish what should be built, why it should be built, how it fits the architecture, and how success will be verified.

Treat the documents under `docs/` as the durable source of product and engineering context.

## Source of truth

Read these before making substantial changes:

1. `docs/PROJECT_SPEC.md`
   - Product vision
   - Core concepts
   - System boundaries
   - Architecture
   - MVP scope
   - Non-goals

2. `docs/FEATURE_SPEC_TEMPLATE.md`
   - Required structure for new feature specifications

3. Feature-specific specs under `docs/specs/`
   - These override general assumptions in `PROJECT_SPEC.md` for the feature they describe.

If code and documentation disagree, do not silently choose one.
Identify the mismatch and update the relevant spec when the intended behavior is clear.

## Required workflow

For any substantial feature, refactor, API change, schema change, integration, or architectural change:

### Phase 1: Understand

Before editing code:

- Read the relevant repository files.
- Read `docs/PROJECT_SPEC.md`.
- Search for existing specs that touch the requested area.
- Identify the existing architecture and conventions.
- Identify affected components, interfaces, data models, and tests.
- Do not assume a component does not exist until you have searched for it.

### Phase 2: Specify

If the requested behavior is not already fully specified:

1. Create a feature spec in:
   `docs/specs/<feature-name>.md`

2. Follow `docs/FEATURE_SPEC_TEMPLATE.md`.

3. The spec must include:
   - problem
   - goals
   - non-goals
   - user experience
   - functional requirements
   - data model changes
   - API/interface changes
   - context-graph implications
   - edge cases
   - acceptance criteria
   - test plan
   - implementation plan

4. Resolve reasonable ambiguity yourself using the simplest design consistent with `PROJECT_SPEC.md`.

5. If multiple reasonable designs exist, record the chosen approach and alternatives considered in the spec.

Do not implement until the spec is coherent enough that another engineer could implement it.

### Phase 3: Plan

Before implementation, create an explicit implementation checklist in the feature spec.

Break work into small independently verifiable steps.

Prefer changes that preserve working software throughout the implementation.

### Phase 4: Implement

Implement against the approved/current spec.

While implementing:

- Keep changes focused.
- Reuse existing abstractions before creating new ones.
- Do not introduce speculative infrastructure.
- Do not refactor unrelated code unless required for correctness.
- Preserve public interfaces unless the spec explicitly changes them.
- Prefer clear, boring code over clever code.
- Add comments for non-obvious reasoning, not for obvious syntax.

If implementation reveals that the spec is wrong or incomplete:
- update the spec first,
- then continue implementation.

### Phase 5: Verify

Before declaring work complete:

- Run relevant tests.
- Run formatting/linting/type-checking commands if present.
- Add tests for new behavior.
- Verify every acceptance criterion.
- Inspect the final diff for accidental unrelated changes.

If a check cannot be run, clearly state why.

### Phase 6: Update context

A core product principle of this repository is that important engineering knowledge should not disappear into code or chat history.

After a meaningful implementation, update the relevant spec when you learn something durable such as:

- architectural decisions
- new constraints
- assumptions proven false
- dependencies
- known limitations
- important implementation behavior
- changed relationships between system components

Do not record temporary debugging chatter as durable context.

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

- retrieve only the files and specs relevant to the current task,
- expand outward only when dependencies require it,
- avoid loading unrelated parts of the repository.

### Traceability

Important decisions should be traceable.

When practical, feature specs should reference:
- related source files,
- related APIs,
- relevant tests,
- related context node types,
- related graph edges,
- prior specs.

### No silent architectural decisions

If implementation introduces a durable architectural decision, record it in the feature spec or `PROJECT_SPEC.md`.

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

- behavior matches its feature spec,
- acceptance criteria are satisfied,
- appropriate tests exist and pass,
- relevant documentation is updated,
- durable context learned during implementation has been captured,
- there are no known silent spec/code mismatches.

## When receiving a new task

For a new substantial task, respond internally with this sequence:

1. What is being requested?
2. What existing product behavior does it affect?
3. Which specs/files are relevant?
4. Is the behavior already specified?
5. If not, write/update a spec.
6. What is the smallest implementation that satisfies it?
7. How will it be verified?
8. After implementation, what durable context changed?

Do not skip directly to coding unless the change is trivial.
