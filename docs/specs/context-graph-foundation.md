# Feature Spec — Versioned Context Graph Foundation

Status: Implemented and verified
Owner: Project team
Related issue/task: Initial Codex kickoff; [MVP plan](../MVP_PLAN.md)
Last updated: 2026-09-19

## 1. Summary

Build the minimum TypeScript/PostgreSQL graph store, with projects, typed nodes
and directed edges, immutable evidence, and immutable node revisions. Expose a
server-side service contract with explicit authority and concurrency rules. Include
only the package, database, migration, and test scaffold needed to verify it.

This comes first because inspection found no implementation to extend. Ingestion,
the workbench, and retrieval all depend on the same identities, evidence, authority,
and current/history semantics. Deferring these decisions would make those features
invent incompatible models. No UI or embedding service is needed to establish them.

## 2. Problem

The product currently has a concept but no persistent representation of knowledge.
Raw text alone cannot explain relationships, identify who reviewed a claim, or
preserve what changed. Every subsequent feature needs those guarantees from its
first write, including deterministic behavior when edits conflict.

## 3. Goals

- Persist a project-scoped relational graph with stable IDs and typed relationships.
- Separate immutable source evidence from editable claims.
- Preserve complete node snapshots and provenance for every revision.
- Enforce authority transitions through one service boundary.
- Supply independently testable read/write contracts without premature HTTP CRUD.

## 4. Non-goals

UI, HTTP endpoints, ingestion formats, arbitrary repository analysis, embeddings,
ranking, tokenization, authentication, multiple users/roles, context branches,
merges, historical graph checkout, edge editing/removal, hard deletion, automatic
staleness, vector indexes, generic event sourcing, and a graph database. The schema
contains no speculative fields for these features.

## 5. User experience

This feature is exercised through service tests and a documented smoke command:
create a project, record evidence, create two connected nodes, close/reopen the
store, edit a claim, and read both revisions. A stale expected version returns a
conflict instead of replacing the other edit. The later workbench exposes the same
operations to the operator; the foundation has no end-user screen.

## 6. Functional requirements

- [x] F1: Create/list/read projects and read a bounded current graph.
- [x] F2: Create immutable sources, nodes with revision 1, and typed edges.
- [x] F3: Require project-local evidence for every node revision and edge.
- [x] F4: Enforce the actor/authority rules below, including during edits.
- [x] F5: Append full revision snapshots with an expected-version check; preserve prior snapshots.
- [x] F6: Validate inputs, reject cross-project references, duplicates, self-edges, and over-limit writes.
- [x] F7: Commit related writes atomically; rollback failures and serialize project mutations.
- [x] F8: Hide archived nodes and incident edges from the current graph while retaining readable history.
- [x] F9: Supply migrations, repeatable tests against PostgreSQL, and minimal developer commands.

### Authority and mutation policy

`canonical` means a human accepted the claim or an importer observed a structural
fact. `inferred` means unreviewed; it is never an alias for canonical. Actors are
trusted server-supplied attribution (`human`, `importer`, `agent`), not user accounts.
Future route handlers set the actor kind themselves; a browser cannot choose it.

| Actor | Node writes | Edge creation |
| --- | --- | --- |
| human | Create/edit either authority; promote or demote; archive/unarchive | Either authority |
| importer | Create/update canonical `file` and `component` structure only, with `repository` evidence | Canonical `CONTAINS` only, component → component/file, with repository evidence |
| agent | Create/update inferred nodes only; cannot edit an existing canonical node, even to demote it | Inferred only, with `agent` evidence |

"Existing inferred/canonical" refers to the current revision. Importer updates
must preserve canonical authority and agent updates must preserve inferred
authority. Only a human may change authority or the archived flag; importer and
agent revisions must preserve the current archived value. Importer component/file
content is a labeled structural description supplied by the prepared manifest,
not an automatically verified semantic claim.

Human revisions require a `manual` source that records the author/reviewer note.
Agent revisions require an `agent` source. Importer writes require a `repository`
source. Human edge additions use manual sources too. A review does not rewrite
old evidence: the earlier inferred revision retains its source; the new manual
source identifies the reviewed revision in its note. No automatic promotion.

An agent suggestion for an existing canonical claim must remain outside that
node's history until a human reviews it, or be a separate inferred node. This
feature does not implement proposal orchestration. Importers cannot turn an
existing inferred node into a canonical node; only a human can do that. Importer
updates require an existing canonical file/component and new repository evidence.

Node identity (`id`, project, type, external key, path) is immutable. A file rename
is a new File node; a human may archive the old one. All other node fields are in
the revision snapshot. Every successful changed revision increments `version`
by exactly one. The previous revision is version minus one (none for version 1).
There is no separate revision UUID or mutable current-content copy.

## 7. Data model

### New entities and exact vocabulary

Names below are the contract; SQL uses snake_case and TypeScript uses camelCase.
UUIDs are generated by the application with `crypto.randomUUID()`, except an
optional caller-supplied project ID for a reproducible prepared import. Dates are UTC
ISO strings at the service boundary. This is the complete MVP vocabulary:

```ts
type NodeType = 'component' | 'file' | 'decision' | 'constraint'
  | 'assumption' | 'discovery' | 'bug';
type EdgeType = 'CONTAINS' | 'DEPENDS_ON' | 'IMPLEMENTS' | 'REQUIRES'
  | 'CONSTRAINS' | 'AFFECTS' | 'CAUSED_BY' | 'RELATED_TO';
type Authority = 'canonical' | 'inferred';
type SourceKind = 'manual' | 'repository' | 'agent';
type Actor = { kind: 'human' | 'importer' | 'agent'; label: string };

type Project = { id: string; name: string; createdAt: string };
type SourceInput = {
  kind: SourceKind;
  uri: string;
  label: string;
  excerpt: string;
  revisionRef: string | null;
};
type Source = SourceInput & {
  id: string; projectId: string; createdAt: string;
};
type NodeIdentity = {
  id: string; projectId: string; type: NodeType;
  externalKey: string | null; path: string | null; createdAt: string;
};
type NodeSnapshot = {
  title: string; content: string; summary: string;
  authority: Authority; importance: number; confidence: number;
  archived: boolean; sourceId: string;
};
type NodeRevision = NodeSnapshot & {
  projectId: string; nodeId: string; version: number;
  actor: Actor; changeReason: string; createdAt: string;
};
type ContextNode = NodeIdentity & { current: NodeRevision };
type ContextEdge = {
  id: string; projectId: string; fromNodeId: string; toNodeId: string;
  type: EdgeType; authority: Authority; sourceId: string;
  actor: Actor; createdAt: string;
};
type GraphSnapshot = {
  project: Project; nodes: ContextNode[]; edges: ContextEdge[];
};
```

Project is a scope record, not a graph node. Source is a separate immutable
evidence record, not a claim. One source per revision/edge is sufficient for the
MVP; a source may support multiple records. Multi-source citations are deferred.
An external URI is a locator, never fetched by this store. `revisionRef` pins a
repository commit or a prepared-manifest digest; it is required for repository
sources. Manual and agent sources use a note/prompt excerpt and null revisionRef.
Archiving a node does not delete its revisions, evidence, or stored edges.

### SQL schema

The initial migration creates the following five product tables. The service
adds the validation and append-only guarantees specified below. No database
extension is required. Project-scoped composite foreign keys prevent accidental
cross-project references, including when using SQL directly.

```sql
CREATE TABLE projects (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE context_sources (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id),
  kind text NOT NULL CHECK (kind IN ('manual', 'repository', 'agent')),
  uri text NOT NULL CHECK (char_length(uri) BETWEEN 1 AND 2048),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 200),
  excerpt text NOT NULL CHECK (char_length(excerpt) <= 20000),
  revision_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, id),
  CHECK ((kind = 'repository' AND revision_ref IS NOT NULL
          AND char_length(revision_ref) BETWEEN 1 AND 200)
    OR (kind IN ('manual', 'agent') AND revision_ref IS NULL
          AND char_length(excerpt) > 0))
);

CREATE TABLE context_nodes (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id),
  type text NOT NULL CHECK (type IN
    ('component', 'file', 'decision', 'constraint', 'assumption', 'discovery', 'bug')),
  external_key text CHECK (char_length(external_key) BETWEEN 1 AND 200),
  path text CHECK (char_length(path) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, id),
  UNIQUE (project_id, external_key),
  UNIQUE (project_id, path),
  CHECK ((type = 'file' AND path IS NOT NULL)
      OR (type <> 'file' AND path IS NULL))
);

CREATE TABLE context_revisions (
  project_id uuid NOT NULL,
  node_id uuid NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 20000),
  summary text NOT NULL CHECK (char_length(summary) <= 1000),
  authority text NOT NULL CHECK (authority IN ('canonical', 'inferred')),
  importance integer NOT NULL CHECK (importance BETWEEN 1 AND 5),
  confidence double precision NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  archived boolean NOT NULL,
  source_id uuid NOT NULL,
  actor jsonb NOT NULL CHECK (jsonb_typeof(actor) = 'object'),
  change_reason text NOT NULL CHECK (char_length(change_reason) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (node_id, version),
  FOREIGN KEY (project_id, node_id) REFERENCES context_nodes(project_id, id),
  FOREIGN KEY (project_id, source_id) REFERENCES context_sources(project_id, id)
);

CREATE TABLE context_edges (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id),
  from_node_id uuid NOT NULL,
  to_node_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('CONTAINS', 'DEPENDS_ON', 'IMPLEMENTS',
    'REQUIRES', 'CONSTRAINS', 'AFFECTS', 'CAUSED_BY', 'RELATED_TO')),
  authority text NOT NULL CHECK (authority IN ('canonical', 'inferred')),
  source_id uuid NOT NULL,
  actor jsonb NOT NULL CHECK (jsonb_typeof(actor) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, from_node_id, to_node_id, type),
  CHECK (from_node_id <> to_node_id),
  FOREIGN KEY (project_id, from_node_id) REFERENCES context_nodes(project_id, id),
  FOREIGN KEY (project_id, to_node_id) REFERENCES context_nodes(project_id, id),
  FOREIGN KEY (project_id, source_id) REFERENCES context_sources(project_id, id)
);

CREATE INDEX context_revisions_project_idx ON context_revisions(project_id);
CREATE INDEX context_edges_from_idx ON context_edges(project_id, from_node_id);
CREATE INDEX context_edges_to_idx ON context_edges(project_id, to_node_id);
```

Primary/unique indexes already cover node/project and source/project lookup.
Read the greatest version for each node (for example `DISTINCT ON (node_id)`
ordered by node_id, version descending), then filter archival. Filtering archived
revisions before choosing the latest would incorrectly resurrect older content.
No physical UPDATE/DELETE operation is exposed for any product table. Node editing
is an INSERT into context_revisions; graph reads join identities to latest snapshots.
Append-only behavior is enforced at the application service boundary, not against
a database administrator. Application consumers must not write these tables directly.

### Validation and invariants

- Reject unknown object keys, invalid UUIDs, invalid enums, nonfinite numbers,
  fractional importance/version, and missing required fields. Optional defaults
  appear only in `createNode` as specified below; revision replacement is complete.
- Trim names, titles, labels, reasons, external keys, URIs, and revisionRef; reject
  empty/whitespace-only required strings. Preserve content, summary, and excerpts
  exactly, but content and manual/agent excerpts must contain non-whitespace text.
  Limits count Unicode code points, matching SQL char_length; reject NUL characters.
- Actor has exactly kind and a nonempty trimmed label of at most 120 characters.
  It records the writer, while source kind records evidence provenance.
- File paths are case-sensitive, relative POSIX paths. Reject leading/trailing
  slash, backslash, empty/`.`/`..` segments, drive-letter prefixes, and NUL; do not
  silently normalize aliases. Non-file nodes must have null path.
- URI accepts `https:`, `repo:`, `manual:`, or `agent:` schemes and no embedded
  credentials. It is stored as text and never dereferenced. Repository evidence
  can use `repo://example/src/payments/webhook.ts` with its pinned revisionRef.
- No unstructured metadata bag. Store the source locator, pinned reference,
  path, title, and claim fields explicitly.
- Every created node has revision 1 in the same transaction. Every revision/edge
  source and both edge endpoints must belong to the specified project.
- Node and edge limits are 1,000 / 5,000 per project, counting archived identities
  and all stored edges too. Limits are checked under the project's mutation lock.
- Duplicate external keys, file paths, or directed typed edges are conflicts.
  Null external keys are allowed. Node titles and project names need not be unique.
- Edges are directed as stored. `A DEPENDS_ON B` means A depends on B;
  `A REQUIRES B` means A needs B; `A CONSTRAINS B` means A limits B;
  `A IMPLEMENTS B` means A implements B; `A CAUSED_BY B` means B causes A;
  `A AFFECTS B` means A affects B; `A CONTAINS B` means A contains B.
  `RELATED_TO` is stored once in caller-supplied direction; traversal may use
  either direction with the actual direction recorded. A reverse edge is distinct.
- Except importer CONTAINS restrictions, do not impose an endpoint-type ontology.
  Reject self-edges. Cycles are allowed, even for CONTAINS; traversal must use a
  visited set later. Do not perform an expensive acyclicity check in storage.
- Reject a new edge if either endpoint is currently archived. Existing edges
  disappear from active graph reads when an endpoint is archived and reappear on
  unarchive. There is no individual edge correction/deletion in the MVP.

### Changed entities and migration considerations

No existing entities or data need migration. Create one numbered SQL migration
and a tiny migration runner with a `schema_migrations(version text PRIMARY KEY,
applied_at timestamptz NOT NULL DEFAULT now())` bookkeeping table. Apply each
migration transactionally and skip an already recorded version. Startup reports
missing configuration/migrations clearly. Never drop a populated database or
perform automatic destructive resets. Embedding caches belong to a later compiler
migration. The prepared importer uses a stable project ID and rejects repeat imports,
so needs no import-state table. The runner accepts an ordered list of
`{ version, sql }` migration definitions, defaulting to the checked-in production
migrations. This test seam verifies rollback without changing production behavior.
Migration startup is single-process for the local MVP; concurrent migration
coordination is out of scope.

## 8. API / interface changes

No HTTP API in this feature. Implement a server-only module; the future Next.js
routes, importer, and compiler reuse it. Proposed files are not present yet:

- `src/server/context/types.ts`, `validation.ts`, `store.ts`
- `src/server/db/pool.ts`, `migrate.ts`, `migrations.ts` (SQL embedded as strings so Next.js bundling and tsx resolve migrations identically; originally planned as `migrations/001_context_graph.sql`)
- `tests/context/validation.test.ts`, `store.integration.test.ts`
- `scripts/context-smoke.ts` (future verification command, not a separate product CLI)

```ts
type CreateNodeInput = {
  type: NodeType; externalKey?: string | null; path?: string | null;
  title: string; content: string; summary?: string;
  authority: Authority; importance?: number; confidence?: number;
  sourceId: string; actor: Actor; changeReason: string;
};
type ReviseNodeInput = {
  expectedVersion: number; snapshot: NodeSnapshot;
  actor: Actor; changeReason: string;
};
type CreateEdgeInput = Pick<ContextEdge,
  'fromNodeId' | 'toNodeId' | 'type' | 'authority' | 'sourceId' | 'actor'>;

interface GraphReader {
  listProjects(): Promise<Project[]>;
  getProject(projectId: string): Promise<Project>;
  getGraph(projectId: string): Promise<GraphSnapshot>;
  getNode(projectId: string, nodeId: string): Promise<ContextNode>;
  getSource(projectId: string, sourceId: string): Promise<Source>;
  listRevisions(projectId: string, nodeId: string): Promise<NodeRevision[]>;
  getRevision(projectId: string, nodeId: string, version: number): Promise<NodeRevision>;
}
interface GraphTransaction extends GraphReader {
  createProject(input: { id?: string; name: string }): Promise<Project>;
  createSource(projectId: string, input: SourceInput): Promise<Source>;
  createNode(projectId: string, input: CreateNodeInput): Promise<ContextNode>;
  reviseNode(projectId: string, nodeId: string, input: ReviseNodeInput):
    Promise<{ node: ContextNode; changed: boolean }>;
  createEdge(projectId: string, input: CreateEdgeInput): Promise<ContextEdge>;
}
interface GraphStore extends GraphReader {
  transaction<T>(work: (tx: GraphTransaction) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
type StoreLogger = {
  error(event: { operation: string; code: string; projectId?: string;
    nodeId?: string; durationMs: number }): void;
};
// createGraphStore(pool: import('pg').Pool, { logger }?: { logger?: StoreLogger }): GraphStore
```

The store owns its supplied pool; do not share that pool between stores. close()
ends the pool, is idempotent, and is called only after outstanding operations
finish. The application keeps one store for its server process; test stores use
separate pools when independent lifetimes are needed.

The optional logger receives identifiers and safe typed codes only. It never
receives SQL, connection strings, source excerpts, claim text, or raw errors;
the default logger emits only the same safe event for unexpected storage failures.

createProject accepts an optional valid UUID; an existing ID is CONFLICT even if
the name matches. Otherwise it generates a new UUID. It never upserts a project.
Create-node defaults: externalKey/path null, summary empty, importance 3,
confidence 1 for canonical and 0.5 for inferred, archived false. Authority is
always explicit. Confidence is an attributed estimate, never proof of authority.
The full replacement snapshot is required on revision; omissions cannot silently
erase fields. A changed sourceId counts as a change even when content is identical.

For revisions, validate/authorize first, then compare expectedVersion to the latest
under lock. Any mismatch is `CONFLICT`, including a stale no-op. With a matching
version, compare all normalized snapshot fields. An identical snapshot returns
`changed: false`, preserving version and metadata; a different actor/reason alone
does not create history. Otherwise append version + 1 with actor and changeReason.
There is no revision cap or trimming of old evidence.

Reads always require projectId except listProjects. Missing IDs, wrong-project
IDs, or nonexistent revision numbers return `NOT_FOUND`. getNode and history
include archived nodes; getGraph includes only current nonarchived nodes and edges
whose endpoints are both included. Lists are deterministic: projects/nodes/edges
by UUID string ascending, revisions by version ascending. A graph read uses one
consistent database snapshot; it cannot mix edges and nodes from different commits.

`transaction` uses one checked-out pg client for BEGIN/COMMIT/ROLLBACK and all its
queries; clients are released in finally. All mutations in a transaction belong
to one project (creating that project and its graph together is supported).
For an existing project, lock its row with SELECT FOR UPDATE before the first
mutation and hold it to commit; lock before reading limits/current versions.
createProject instead inserts the new row first and treats it as transaction-owned;
its primary key serializes competing creation of the same ID. No absent row is
locked, and later writes to the newly created project reuse that transaction.
A second project's
mutation or nested transaction is `VALIDATION_ERROR`. This deliberately coarse
lock suffices for the local demo. Mutations use READ COMMITTED so a waiting writer
sees the committed latest revision after acquiring the lock. Standalone getGraph
uses a read-only REPEATABLE READ transaction. GraphTransaction.getGraph must
retrieve the project, latest nodes, and active edges in one SQL statement so its
READ COMMITTED transaction still sees one statement snapshot, even before a
mutation lock is taken. Other reads may be ordinary queries.

Any operation failure inside a transaction aborts the entire transaction, even if
the callback catches it; track failed state and refuse commit. No external provider
calls inside a transaction. The pg transaction must not use pool.query for its
individual statements; see [the pg transaction contract](https://node-postgres.com/features/transactions).
Composite referential constraints use ordinary
[PostgreSQL foreign keys](https://www.postgresql.org/docs/17/ddl-constraints.html).

Typed errors carry `code`, a safe `message`, and optional field/reason details:
`VALIDATION_ERROR`, `NOT_FOUND`, `CONFLICT`, `AUTHORITY_VIOLATION`,
`LIMIT_EXCEEDED`, `STORAGE_ERROR`. Revision conflicts include expected/actual
versions; unique conflicts identify the violated logical key. Map known database
constraint errors to these codes; log unexpected errors server-side and return
STORAGE_ERROR without SQL/connection secrets. Later routes map these to HTTP.

## 9. Context graph implications

- Creates all seven node types and eight edge types; updates nodes only by revision.
- Creates durable structured knowledge, distinct from source excerpts.
- Every claim revision and relationship has project-local immutable provenance.
- Records all node history, including review, confidence, summary, source, and archive changes.
- Supplies current authority and typed edge direction for later ranking; inferred
  edges must remain visible as inferred in explanations, even between canonical nodes.
- Supplies full/summary/title representations for compilation but computes no tokens.

## 10. Retrieval behavior

Seed discovery, traversal, ranking, compression, token budgets, and selection
explanations are not implemented here. getGraph provides only current active
snapshots, never historical or raw evidence text as independent candidates.
Consumers cite `(nodeId, version)` and obtain its immutable source by sourceId.

## 11. Edge cases

Missing projects/sources/endpoints fail without partial data. Same-project
duplicates conflict instead of silently merging. Contradictory claims may coexist
as distinct nodes with separate authority; storage does not infer truth or resolve
contradictions. Stale revisions conflict. Archived records remain directly readable.
Cycles do not affect storage. Empty existing projects return empty graph arrays;
unknown projects fail. Oversized projects fail before mutation. Invalid text,
NaN/Infinity, path aliases, foreign source IDs, and malformed actor data are rejected.
Connection loss rolls back; a lost response after commit may require rereading
state, as generic retry/idempotency infrastructure is out of scope. Token budget
exhaustion is not applicable to storage.

## 12. Security / privacy considerations

Parameterized SQL only; credentials come from DATABASE_URL and never enter logs
or source control. Evidence and claims are untrusted data, never executed. No URI
fetching. No authentication is claimed: this is a trusted local server-side API,
not an internet-facing database or authorization service. Actor rules protect
program behavior, not against a malicious operator with database access. Tests
use a separate TEST_DATABASE_URL and isolated schema, never reset a user's project.

## 13. Observability

Log operation name, typed error code, project/node IDs, and duration for failures;
do not log source excerpts, claim content, SQL parameters, or connection strings.
Revision actor, reason, timestamp, and source are the durable explanation of a
write. No telemetry service or metrics infrastructure is required.

## 14. Acceptance criteria

- [x] A1: A fresh PostgreSQL database migrates; rerunning migrations makes no changes or data loss.
- [x] A2: A created graph survives store closure/reopening with identical IDs, fields, directions, and sources.
- [x] A3: Every supported enum/default validates; malformed/boundary-invalid inputs fail without writes.
- [x] A4: Project/source/edge isolation and uniqueness hold, including database-level foreign-key checks.
- [x] A5: The complete actor/authority matrix is enforced; inferred content is never silently promoted or allowed to overwrite canonical content.
- [x] A6: A changed snapshot produces the next full revision; all prior snapshots/provenance remain byte-for-byte readable.
- [x] A7: No-op edits preserve the version; stale edits conflict; two concurrent edits at one version yield exactly one new revision.
- [x] A8: Multi-operation failure rolls back everything, including a newly created project and its evidence.
- [x] A9: Archival removes a node/incident edges from active reads, preserves history, and unarchive restores visibility.
- [x] A10: Cycles are storable, self-edges fail, empty graphs work, and graph reads are internally consistent and deterministically ordered.
- [x] A11: Project limits are enforced atomically, including competing writes near the cap.
- [x] A12: Developer commands and the smoke flow pass; secrets and private context are absent from error output.

## 15. Test plan

All test files/commands below are planned; none exist at kickoff.

| Criteria | Required verification |
| --- | --- |
| A1 | Integration: fresh migration, repeat migration, preserve a seeded revision; failed migration rolls back its marker and DDL |
| A2 | Integration: create two nodes/edge/source, close all connections, reopen and assert persisted values |
| A3 | Unit: enum matrix, defaults, Unicode lengths, whitespace, NUL, URI/path rules, numbers, actor shape; integration: rejected writes leave counts unchanged |
| A4 | Integration: wrong-project reads; cross-project source/endpoints; duplicate keys/path/edge; direct SQL attempts against composite FKs |
| A5 | Unit + integration: every matrix row, human promotion/demotion, agent canonical edit/demotion rejection, importer claim/promotion rejection, mismatched evidence kinds |
| A6 | Integration: content, title, summary, source, authority, importance, confidence, and archive edits; source immutability through exposed API; ordered history |
| A7 | Integration: no-op, stale no-op, actor/reason-only no-op, simultaneous writes from two clients with same expectedVersion |
| A8 | Integration: injected mid-transaction failure and caught operation failure; no orphan node/revision/source/project; client released on error |
| A9 | Integration: archive/unarchive, archived detail/history, edge visibility and rejection of new edges to archived endpoints |
| A10 | Integration: cycles, self-edge rejection, empty/missing project, deterministic reads; concurrent write cannot create a mixed getGraph snapshot, both standalone and through GraphTransaction before any mutation lock |
| A11 | Integration: exactly-at-cap succeeds, next write fails, two writers for last slot; archived nodes still counted |
| A12 | Manual smoke + command checks; automated log redaction assertions for storage failure with a sentinel connection credential and content |

### Unit tests

Use Vitest table-driven tests for pure validators and authority rules. Avoid
mock-only persistence tests or treating compile-time TypeScript types as validation.

### Integration tests

Use real PostgreSQL 17 via TEST_DATABASE_URL, unique test schemas, and two clients
where concurrency matters. Fail clearly if integration configuration is absent;
do not report skipped database tests as passed. Tests create/drop only their own
explicitly named schemas. Test reads/mutations through the public store API except
the deliberate foreign-key probes. No SQLite substitution for PostgreSQL semantics.
Each test pool fixes its generated identifier-safe schema through the PostgreSQL
connection `options` setting, so every pooled connection uses the same isolated
`search_path`; cleanup drops only that explicitly generated schema.

### UI/manual verification

No UI exists in this feature. `npm run context:smoke` uses a dedicated test project
to create/reload/revise/read a graph and print IDs/versions without private text.
Document PostgreSQL startup, `.env.example` placeholders, migration and test
commands in the future README. Ignore actual `.env` files and local database data.

## 16. Implementation plan

All items remain unstarted at kickoff. Complete each only after its verification.

- [x] Bootstrap npm/TypeScript, `pg`, Zod runtime validation, Vitest, ESLint/Prettier, and lockfile; add typecheck/lint/format:check/test scripts. Verify a minimal test and typecheck. Select compatible versions without scaffolding UI.
- [x] Add local PostgreSQL 17 configuration, example environment, pool, migration runner, and schema; verify A1 and database startup.
- [x] Implement types, validators, error codes, and authority matrix; verify unit portions of A3/A5.
- [x] Implement transactional project/source/node/edge creation and current reads; verify A2/A4/A8/A10/A11.
- [x] Implement revision replacement, conflicts, history, and archival; verify A5/A6/A7/A9, including concurrent clients.
- [x] Finish isolated integration fixtures, smoke command, redacted errors, and setup documentation; verify A3/A12 and all automated acceptance mappings.
- [x] Run test, test:integration, typecheck, lint, format:check, and smoke; review diff against this spec and invariants. Update durable findings, then commit/push the verified feature in its future implementation session.

## 17. Alternatives considered

### Mutable nodes with history added later

Fewer initial records, but early imports/edits lose provenance and every consumer
must later change. Rejected. Identity + full revision snapshots avoid duplicating
current content and avoid a mutable-head foreign-key cycle.

### SQLite or an in-memory store

SQLite removes a running database; memory is easiest for a prototype. PostgreSQL
retains the project's original preference and provides one storage/test target.
Its setup is a real dependency, addressed by a small local configuration. No ORM
or pgvector extension is justified for the foundation.

### Full graph event log, rich ontology, generic CRUD routes

Would support edge history/branching and more consumers but adds event replay,
extra semantics, and unused endpoints. Rejected for the demo. Immutable edges,
node snapshots, eight relations, and a typed in-process service are sufficient.

### Chosen approach

Five relational product tables, append-only node history/evidence, one project
mutation lock, and a plain TypeScript store. This supplies stable contracts for
all three downstream features without building their behavior prematurely.

## 18. Durable context created by this feature

Implemented decisions: node identity is separate from content revisions; version is
per node; evidence is immutable and singular per revision/edge; authority is not
freshness or authentication; graph reads use latest active revisions; edges are
immutable and carry their own authority. Retrieval must preserve direction and
inferred-path labels. Relationship correction, full graph history, and public
deployment are known MVP limitations. PostgreSQL 17 migrations, isolated-schema
integration tests, close/reopen smoke verification, authority checks, project
mutation serialization, nested-transaction rejection, history, and archival were
verified on 2026-09-19. The store owns its pool and logs only safe typed metadata.
