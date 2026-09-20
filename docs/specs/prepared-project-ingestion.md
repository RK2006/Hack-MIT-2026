# Feature Spec — Prepared Project Ingestion

Status: Implemented and verified
Owner: Project team
Related issue/task: [MVP plan](../MVP_PLAN.md); depends on [foundation](context-graph-foundation.md)
Last updated: 2026-09-19

## 1. Summary

Import one explicit, labeled prepared repository manifest into the graph store.
It describes files, components, curated claims, evidence, and typed relationships.
Derive structure deterministically and preserve where each claim came from. Supply
a synthetic payments example suitable for retrieval and a history demo. This is
the smallest ingestion path permitted by the project spec, not a general scanner.

## 2. Problem

An empty graph cannot demonstrate selective context. Later workbench and compiler
features need a repeatable connected example with meaningful evidence, inferred
claims, and irrelevant project areas, without an OAuth or extraction dependency.

## 3. Goals

- Populate persisted files/components and curated context from one local manifest.
- Validate the whole import and commit it atomically.
- Make origin, synthetic content, and authority transparent.
- Provide a shared semantic/graph retrieval evaluation fixture.

## 4. Non-goals

Arbitrary local filesystem scanning, repository cloning, OAuth, PR/issue ingestion,
AST analysis, LLM extraction, background jobs, incremental synchronization, merge
resolution, embedding calls, or executing imported code.

## 5. User experience

1. Operator runs the future `npm run import:demo` command with the bundled manifest.
2. Importer validates the manifest and creates a new project atomically.
3. It prints the project ID, source/node/edge counts, and the synthetic-data label.
4. A repeat import of its fixed project ID returns an actionable conflict directing
   the operator to the existing project. It never overwrites manual work.
5. Once the workbench exists, open that project and inspect its imported evidence.

## 6. Functional requirements

- [x] I1: Accept one versioned JSON manifest with an explicit project UUID, name,
  provenance records, component/file entries, claim entries, and directed edges.
- [x] I2: Derive canonical component/file nodes and structural CONTAINS edges from
  declared structure only. Do not infer architecture from names or directories.
- [x] I3: Curated claims/relations are attributed to the fixture's named human
  curator and manual evidence; example agent claims are inferred with agent evidence.
- [x] I4: Resolve manifest-local keys to generated UUIDs and validate all references
  and store bounds before opening the write transaction.
- [x] I5: Use one foundation transaction for project, sources, nodes, and edges;
  failures leave no partial project, and repeated project IDs conflict.
- [x] I6: Bundle enough unrelated context for measurable reduction; fixture facts
  and paths are labeled synthetic, not observed facts about this repository.

The digest of original manifest bytes (`sha256:<hex>`) pins repository-type
evidence for the prepared example. Evidence URIs use `repo://demo-payments/...`;
curator notes explicitly say “synthetic prepared example.” That label is
validated only for projects whose name contains “synthetic”; manifests produced
by the [repository scanner](repository-scan.md) or curated for real repositories
are exempt. A new manifest version
does not update an existing project: edit knowledge through the workbench or give
the manifest a new project UUID to create a separate project.

## 7. Data model

### New entities

No new database table. The manifest is an input artifact; the foundation stores
its typed structure and immutable evidence. Every node has a unique manifest key
in `externalKey`, and File nodes use the foundation's normalized-path contract.
The manifest project UUID supplies createProject's optional id.

Manifest version 1 has this exact strict shape; unknown properties are rejected
at every level:

```ts
type ManifestV1 = {
  schemaVersion: 1;
  project: { id: string; name: string };
  sources: Array<{ key: string; kind: 'repository' | 'manual' | 'agent';
    uri: string; label: string; excerpt: string; actorLabel: string }>;
  components: Array<{ key: string; title: string; content: string; summary: string;
    importance: number; confidence: number; sourceKey: string; parentKey?: string }>;
  files: Array<{ key: string; path: string; title: string; content: string;
    summary: string; importance: number; confidence: number; sourceKey: string;
    componentKey: string }>;
  claims: Array<{ key: string;
    type: 'decision' | 'constraint' | 'assumption' | 'discovery' | 'bug';
    title: string; content: string; summary: string; importance: number;
    confidence: number; sourceKey: string; changeReason: string }>;
  edges: Array<{ fromKey: string; toKey: string;
    type: Exclude<EdgeType, 'CONTAINS'>; sourceKey: string }>;
};
```

Keys are case-sensitive ASCII slugs matching `^[a-z][a-z0-9._-]{0,79}$`.
Source keys are unique among sources; node keys are unique across components,
files, and claims and become `externalKey`. References resolve by exact key.
Node/source/edge UUIDs are generated; only the project UUID is supplied.
Components/files are canonical importer writes using repository evidence.
Structural `CONTAINS` edges derive only from `parentKey` and `componentKey`;
explicit `CONTAINS` is invalid. Manual sources create canonical human claims and
edges; agent sources create inferred agent claims and edges. Repository sources
cannot support claims or explicit edges.

### Changed entities

None. Reuse the foundation's exact enums, authority matrix, and source semantics.

### Migration considerations

None. Raw input must be valid UTF-8 JSON without a BOM or duplicate object-member
names and at most 1 MiB. Bounds are 1–1,000 resulting nodes, 1–1,000 sources, and
1–5,000 total derived plus explicit edges. Duplicate keys, paths, directed typed
edges, dangling references, incompatible sources, and foundation field violations
fail before opening a transaction. Do not add import tracking tables.

## 8. API / interface changes

No upload endpoint in the MVP; a local operator command avoids file-upload scope.
Planned service boundary:

```ts
// rawBytes are hashed before parsing; they are never executed or fetched.
importPreparedProject(rawBytes: Uint8Array, store: GraphStore):
  Promise<{ schemaVersion: 1; projectId: string; sources: number;
    nodes: number; edges: number; digest: string }>;
```

Use the foundation error codes. Add field/key locations to manifest validation
errors. Existing project UUID is CONFLICT regardless of whether bytes match; do
not classify duplicate imports as a new successful write. Duplicate imports and
invalid manifests leave all original revisions and sources unchanged.

Repository `revisionRef` is `sha256:<lowercase hex>` of the exact raw bytes; it is
not a self-referential manifest field. Manual/agent sources use null. A
duplicate-aware JSON pass runs before `JSON.parse`. Validation errors include a
safe `details.path` when practical and never echo the full manifest.

Planned paths: `src/server/ingestion/`, `fixtures/demo-payments.json`,
`scripts/import-demo.ts`, and `tests/ingestion/`. These do not exist at kickoff.

## 9. Context graph implications

- Creates Component/File nodes and a small set of Decision/Constraint/Bug/
  Assumption/Discovery nodes from declared entries.
- Uses CONTAINS for structural hierarchy and the foundation's other relationships
  for explicitly curated/inferred links; never introduces an inverse-only edge enum.
- Creates durable context with source references and initial node revision 1.
- Changes no existing revisions and performs no hidden authority promotion.
- Supplies meaningful task-relevance, graph-neighbor, authority, and distractor
  cases to the compiler; does not select or compile context itself.

## 10. Retrieval behavior

No retrieval algorithm here. The exact bundled `demo-payments` fixture uses project
UUID `7f63f0c8-9a4e-4e2a-8ebd-a8f2b3f8c101`. It contains backend, payments,
Stripe-webhooks, event-receipt-storage, catalog, search, email, analytics, admin,
and tax components plus handler/storage files. Pinned anchors are inferred
`bug.repeated-delivery-side-effects`, canonical
`constraint.provider-event-id-unique`, canonical
`decision.record-before-side-effects`, inferred
`assumption.process-memory-dedupe`, a useful storage neighbor without direct task
terms, unrelated canonical distractors, and long canonical
`constraint.webhook-audit-retention`. Compiler expectations live in TypeScript,
not product ontology. Every evidence excerpt says “synthetic prepared example.”

## 11. Edge cases

Missing evidence, dangling edge keys, duplicate keys/paths, invalid authority,
invalid URI/path, too many nodes/edges, and malformed JSON fail before writes.
Transaction errors roll back the whole import. Existing project IDs conflict even
after manual edits or archival. An empty graph manifest is rejected because it
cannot demonstrate ingestion; the final JSON schema will define required minimal
structure. Source locators may be unreachable since they are not fetched. Conflicting
claims remain separate and visibly attributed rather than silently reconciled.

## 12. Security / privacy considerations

Read only the explicitly supplied manifest; no recursive filesystem access,
shell execution, repository scripts, or remote URI fetching. Do not ingest
credentials or private files. The bundled fixture is public/synthetic and labeled
as such. CLI output contains counts and IDs, not full evidence contents.

## 13. Observability

Report manifest version/digest, validation field/key, counts, and safe error code.
Record attribution in immutable sources, not just transient import logs.

## 14. Acceptance criteria

- [x] A1: The prepared manifest creates the expected project, files/components,
  claims, edges, provenance, authority, and initial revisions and survives reopening.
- [x] A2: Repeating its project ID, including after a human edit, conflicts without changing any existing row.
- [x] A3: Invalid manifests and injected mid-import failures leave no partial project.
- [x] A4: The fixture includes every retrieval case in §10 and clearly identifies synthetic content.

## 15. Test plan

### Unit tests

A3: Manifest schema, reference resolution, bounds, and malformed/duplicate inputs.
A4: Structural fixture assertions for semantic-case labels, paths, distractors,
authority, and evidence labels; semantic quality itself belongs to the compiler.

### Integration tests

A1–A3: Import into a real PostgreSQL test schema, reopen/read, edit/reimport,
simulate partial failure, and assert exact identities/counts/history. Concurrent
same-project imports produce one project and one conflict.

### UI/manual verification

A1/A4: Run the import command from a fresh test database; inspect counts and
synthetic labeling. Once the workbench exists, open nodes and evidence and follow
the webhook → REQUIRES → idempotency relationship.

## 16. Implementation plan

- [x] Finish the manifest schema, key/path rules, input bounds, fixture, and field-level error contract; review against foundation before coding.
- [x] Implement parse/validate/key resolution with unit tests for A3/A4.
- [x] Implement one atomic import and repeat-conflict handling; verify A1/A2/A3 against PostgreSQL.
- [x] Add the labeled demo manifest, CLI, and setup documentation; verify A4 and the manual flow.
- [x] Run relevant tests/typecheck/lint/format checks; update this spec and commit/push the verified feature in its implementation session.

## 17. Alternatives considered

### Automatic GitHub/local repository analysis

Broader real-world input, but adds auth, filesystem safety, parsing, extraction,
and provenance questions before the core demo works. Defer.

### Raw SQL seed file

Fast to load, but bypasses authority/validation contracts and is hard to explain
as a product input. Choose a validated prepared manifest through the store instead.

### Upsert/reimport synchronization

Convenient refresh, but risks replacing human edits and requires change tracking.
Choose an explicit existing-project conflict; no import-state infrastructure.

## 18. Durable context created by this feature

Implemented: prepared input is intentionally narrower than repository discovery;
synthetic claims are not observations about the actual codebase; repeat imports
cannot replace reviewed context. Ingestion owns fixture keys/evidence, while the
compiler owns relevance evaluation. Version 1 uses duplicate-aware JSON parsing,
shared foundation preflight before transactions, a raw-byte SHA-256 evidence pin,
and an explicit conflict on repeat. The bundled fixture imports 29 nodes and 34
edges with three immutable sources; 34 unit and 21 real-PostgreSQL integration
tests passed on 2026-09-19.
