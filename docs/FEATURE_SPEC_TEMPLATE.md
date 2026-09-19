# Feature Spec — <Feature Name>

Status: Draft
Owner:
Related issue/task:
Last updated:

---

## 1. Summary

One paragraph describing the feature.

## 2. Problem

What concrete user or system problem does this solve?

Why does it matter?

## 3. Goals

- Goal 1
- Goal 2
- Goal 3

## 4. Non-goals

Explicitly list what this feature will not solve.

## 5. User experience

Describe the expected flow from the user's perspective.

Example:

1. User ...
2. System ...
3. User sees ...
4. User can ...

## 6. Functional requirements

Use testable statements.

- [ ] Requirement 1
- [ ] Requirement 2
- [ ] Requirement 3

## 7. Data model

### New entities

Describe any new tables/types/models.

### Changed entities

Describe schema changes.

### Migration considerations

Describe migration/backfill needs.

If none, say "None."

## 8. API / interface changes

For each new or changed interface:

### `<METHOD> /path`

Request:

```json
{}
```

Response:

```json
{}
```

Errors:
- ...

If no HTTP API is involved, describe function/component/tool interfaces instead.

## 9. Context graph implications

Answer explicitly:

- Which node types are created/read/updated?
- Which edge types are created/read/updated?
- Does this create durable context?
- Does it affect provenance?
- Does it affect revision history?
- Does it affect retrieval/ranking?
- Does it affect token compilation?

## 10. Retrieval behavior

If relevant:

- seed discovery:
- graph traversal:
- ranking:
- compression:
- token-budget behavior:
- explainability:

If irrelevant, say "Not applicable."

## 11. Edge cases

Include:
- missing data
- duplicated data
- stale data
- conflicting context
- malformed input
- empty results
- large projects
- token-budget exhaustion
- partial failures

Only keep cases that actually apply.

## 12. Security / privacy considerations

Describe relevant concerns.

If none beyond existing architecture, state that.

## 13. Observability

How will failures be debugged?

Consider:
- logs
- metrics
- trace IDs
- context selection explanation
- ingestion errors

## 14. Acceptance criteria

The feature is complete when:

- [ ] ...
- [ ] ...
- [ ] ...

These must be objectively verifiable.

## 15. Test plan

### Unit tests
- ...

### Integration tests
- ...

### UI/manual verification
- ...

## 16. Implementation plan

Keep tasks small and ordered.

- [ ] Step 1
- [ ] Step 2
- [ ] Step 3
- [ ] Step 4

## 17. Alternatives considered

### Option A

Pros:
- ...

Cons:
- ...

### Option B

Pros:
- ...

Cons:
- ...

### Chosen approach

Explain why.

## 18. Durable context created by this feature

After implementation, update this section with anything future developers/agents need to know.

Examples:
- architectural decisions
- important constraints
- assumptions
- known limitations
- dependencies

Do not use this section as a work log.
