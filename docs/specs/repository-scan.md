# Feature Spec — Repository Scan

Status: Implemented and verified, including a live scan of this repository driven from Codex over MCP
Owner: Project team
Related issue/task: [project spec](../PROJECT_SPEC.md) §7 stretch "arbitrary repository scanning"; extends [prepared project ingestion](prepared-project-ingestion.md); pairs with [GitHub PR ingestion](github-pr-ingestion.md) and [proposals](agent-context-proposals.md)
Last updated: 2026-09-20

## 1. Summary

Generate a prepared manifest from a real local git checkout — components from
its directory tree, File nodes from its tracked source files, `CONTAINS` edges
from the hierarchy — and import it as a new project. The scanner is purely
structural and deterministic: it reads the tree and file metadata, never
executes code and never invents claims. Knowledge is layered on afterwards by
PR ingestion, agent proposals, and human review.

## 2. Problem

Until now every project was hand-written (the synthetic payments fixture, the
self-describing manifest). Agents can only compile context about code that is
in the graph, so pointing the tool at an arbitrary codebase needs a one-command
path from checkout to canonical structure.

## 3. Goals

- `npm run scan:repo -- <path>` produces a valid manifest; `--import` loads it.
- Deterministic output for the same tree (stable project id, keys, order).
- Stay within store bounds with explicit errors and filtering options.
- Expose the same capability to agents as an MCP tool.

## 4. Non-goals

Parsing code (ASTs, imports, symbols), inferring architecture beyond
directories, cloning remotes, reading untracked or ignored files, executing
anything, updating an existing project (re-scan; follow-up), or claims of any
kind — the scanner emits only `component` and `file` nodes.

## 5. User experience

1. `npm run scan:repo -- ~/code/my-service --out /tmp/my-service.json` writes the
   manifest and prints counts; the operator may inspect or edit it.
2. `npm run import:manifest -- /tmp/my-service.json` (or `scan:repo … --import`)
   creates the project. A second import conflicts, as for any manifest.
3. In the workbench the project shows directories as components and files as
   File nodes with paths, all canonical with repository evidence; no claims yet.
4. `ingest:pr`, `propose_context`, or `ingest_pull_request` add knowledge that
   attaches to those real file/component nodes.

## 6. Functional requirements

- [x] S1: `scanRepository(rootPath, options)` lists files with `git ls-files -z` (tracked, non-ignored) via `execFile`; a path that is not a git work tree is `SOURCE_UNAVAILABLE`.
- [x] S2: Files are kept when their extension is in the source allowlist (code, config, docs) and they are ≤ 1 MiB; lockfiles, images, archives, fonts, and minified bundles are skipped. `--include <prefix>` (repeatable) restricts to path prefixes.
- [x] S3: Components are the repository root plus every directory up to `--depth` (default 2) that contains kept files (directly or below); a file belongs to the deepest component that is a prefix of its path. Components chain by `parentKey`.
- [x] S4: Node content is deterministic metadata: files → language, line count, byte size, and the first comment line if the file starts with one (≤ 200 chars); components → path, file count, direct subdirectories. Titles are basenames; summaries are paths.
- [x] S5: Keys are `component.<slug-of-path>` / `file.<slug-of-path>` (root is `component.root`), unique and stable; the project id is derived deterministically (UUID v5-style from the origin remote URL or the realpath), so re-importing the same repo is an explicit conflict.
- [x] S6: One `repository` source: `uri` is the `https:` origin URL when present, otherwise `repo://<name>/`; the excerpt states the scan rules and commit; the manifest validator's "synthetic prepared example" requirement applies only to projects whose name contains "synthetic".
- [x] S7: Bounds: total nodes ≤ 1,000 and files ≤ `--max-files` (default 600); exceeding either is `LIMIT_EXCEEDED` with counts and a hint to use `--include`/`--depth`.
- [x] S8: CLI `scan:repo` (`--out`, `--import`, `--depth`, `--max-files`, `--include`, `--name`) and MCP tool `scan_repository { path, name?, depth?, maxFiles?, include? }` that imports and returns `{ projectId, name, nodes, edges, sources }`.

### Documentation ingestion (`--docs`)

The scanner records structure only, but a repository's own documentation
(`README`, `AGENTS`/`CLAUDE`, `CONTRIBUTING`, `CHANGELOG`, `SECURITY`,
`ARCHITECTURE`, `docs/**/*.md`, `adr/**/*.md`) is where teams write down rules and
decisions. `ingestDocumentation(deps, projectId, rootPath, { files?, maxDocs? })`
reads each selected tracked file (≤ 256 KiB, ≥ 40 characters) and runs it through
`proposeContext` with a per-file source whose `uri` is the GitHub blob URL pinned
to the scanned commit. Results are ordinary inferred proposals for the Review tab;
edges resolve to the scanned File/Component nodes. A failing model call is
reported per document and never aborts the rest; a missing proposal model makes
`--docs` a no-op with a message. Available as `npm run scan:repo -- <path>
--import --docs`, `npm run ingest:docs -- <projectId> <path> [files…]`, MCP
`scan_repository { includeDocs: true }`, and MCP `ingest_documents`.

The two steps stay separate writes on purpose: tree facts are canonical and free;
interpretations of prose are inferred, cost a model call, and need a human.

- [x] S9: Documentation ingestion as specified above, with per-document status (`proposed` / `skipped` / `failed`) and reasons.

## 7. Data model

### New entities

None. Output is a `ManifestV1`; the importer creates canonical `component` and
`file` nodes with importer actor and repository evidence, exactly as today.

### Changed entities

Manifest validation: the "synthetic prepared example" label check becomes
conditional on the project name containing "synthetic" (case-insensitive). The
ingestion spec §6 is updated accordingly.

### Migration considerations

None.

## 8. API / interface changes

```ts
type ScanOptions = {
  name?: string; depth?: number; maxFiles?: number; include?: string[];
  run?: (cmd: string, args: string[], cwd: string) => Promise<{ stdout: string; code: number; stderr: string }>;
};
type ScanResult = { manifest: ManifestV1; stats: { files: number; components: number; skipped: number; commit: string | null } };
// scanRepository(rootPath: string, options?: ScanOptions): Promise<ScanResult>
```

Files: `src/server/ingestion/scan.ts`, `scripts/scan-repo.ts`,
`tests/ingestion/scan.test.ts`, `tests/ingestion/scan.integration.test.ts`;
MCP tool in `src/server/mcp/server.ts`; `manifest.ts` label rule.

## 9. Context graph implications

Creates canonical `component`/`file` nodes and `CONTAINS` edges only, with one
repository source pinned to the scanned commit (via the importer's manifest
digest as `revisionRef`, plus the commit in the excerpt). No claims, no inferred
content, no history changes. Retrieval gains real file nodes whose paths make
explicit-reference seeding work for tasks that mention them.

## 10. Retrieval behavior

Not applicable beyond §9.

## 11. Edge cases

Empty repo or nothing kept → `VALIDATION_ERROR` (a manifest needs ≥ 1 node and
≥ 1 edge; the root alone has no edge). Paths with characters the store rejects
(backslash, NUL, `..`) are skipped and counted. Very deep trees are cut at
`--depth` (files still attach to the nearest component). Files with identical
slugs after normalization get a short hash suffix. Windows paths are not
supported (POSIX only, matching the store).

## 12. Security / privacy considerations

Reads only tracked files' metadata and first line, never contents beyond that,
never executes anything, and never leaves the given root. Nothing is sent to
any model by the scanner itself. The generated manifest can be reviewed before
import. The MCP tool imports directly; it is only exposed locally over stdio.

## 13. Observability

CLI prints counts (files, components, skipped, commit) and the project id.

## 14. Acceptance criteria

- [x] A1: Scanning a temp git repo yields the expected components, file assignment, keys, content metadata, skips, and identical output on repeat (unit).
- [x] A2: Bounds and filters: `--max-files`, `--include`, non-git path, empty result behave as specified (unit).
- [x] A3: The scanned manifest of this repository validates and imports into PostgreSQL; a second import conflicts (integration).
- [x] A4: MCP `scan_repository` on this repo returns the project and it appears in the workbench (manual, recorded in §18).
- [x] A5: Documentation ingestion writes inferred claims per document citing the file URL, skips trivial files, reports model failures per document, and one-command `scan:repo --import --docs` works on an unfamiliar repository (integration + manual, recorded in §18).

## 15. Test plan

Unit (`tests/ingestion/scan.test.ts`, `tests/ingestion/docs.test.ts`) with a temp `git init` repo. Integration
(`tests/ingestion/scan.integration.test.ts`) scanning this repository into an
isolated schema. Manual A4.

## 16. Implementation plan

- [x] Relax the manifest label rule; implement `scanRepository` with unit tests (A1/A2).
- [x] CLI and MCP tool; integration test (A3); live scan of this repo (A4).
- [x] Documentation ingestion (`--docs`, `ingest:docs`, MCP tools) with unit/integration tests and live runs (A5).
- [x] Docs, spec §18, commit/push.

## 17. Alternatives considered

**Import/AST analysis for DEPENDS_ON edges** — richer, but language-specific
and the spec's "perfect ontology extraction" non-goal; agents and PRs supply
relationships instead. **Scanning GitHub via API** — works without a checkout,
but local `git ls-files` respects `.gitignore` for free and needs no network;
a `gh api` variant can follow.

## 18. Durable context created by this feature

Implemented decisions and findings:

- The scanner emits a `ManifestV1` and reuses the importer unchanged, so scanned
  projects have exactly the same guarantees (canonical structure, importer
  actor, repository evidence, one transaction, repeat = conflict) as curated ones.
- Project identity is derived from the `https:` origin remote (or the realpath)
  as an RFC-4122-shaped UUID, so re-scanning the same repository is an explicit
  conflict rather than a duplicate; updating an existing project is a follow-up.
- Directory depth 2 is a good default for this repository (19 components for
  111 files); deeper trees attach files to the nearest scanned ancestor.
- The manifest validator's "synthetic prepared example" rule now applies only
  when the project name contains "synthetic", so real repositories are not
  mislabeled; the payments fixture keeps the rule.
- Live A4 on 2026-09-20: `npm run scan:repo -- . --import` produced 130 nodes /
  129 edges for `hackmit-2026`; Codex over MCP then compiled context for "Add a
  GitHub issue ingestion adapter next to the pull request one" (1,500-token
  budget) and was pointed at `src/server/ingestion/github-pr.ts`, its spec, and
  its tests by semantic match plus `tests/ingestion/` by explicit mention, correctly
  noting the freshly scanned project had no decisions yet; `ingest_pull_request`
  on PR #4 then added 6 inferred claims and 7 edges — structure first, knowledge
  layered on top, as intended.
- Found while verifying: `main` did not typecheck after the UI_fixes merge
  (`TaskSummary` import dropped in `Workbench.tsx`); fixed here.

Documentation ingestion, live on 2026-09-20 with `gemini:gemini-3.8-flash`:
- `ai-website-cloner-template` (a repository none of us had read): 5 documents →
  18 inferred nodes / 22 edges, e.g. constraint "Pixel-Perfect Emulation First
  Principle" and bug "Windows CRLF Line Endings Break Script File Resolution"
  from `CHANGELOG.md`; `CLAUDE.md` correctly skipped as too short.
- `sindresorhus/is-online`, freshly cloned, in one command
  (`scan:repo --import --docs`): 14 structural nodes + 6 proposals from its readme.
- Selection order and blob-URL construction are unit tested; per-document
  failure isolation and the skip rules are integration tested with a fixed model.
