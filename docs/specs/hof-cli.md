# Feature Spec — `hof` Command-Line Interface

Status: Implemented and verified (slices one and two)
Owner: Project team
Related issue/task: [project spec](../PROJECT_SPEC.md) §6 Flow E (agent handoff) and Flow F (update after work); reuses [compiler](task-context-compiler.md), [foundation](context-graph-foundation.md), [agent proposals](agent-context-proposals.md), [PR ingestion](github-pr-ingestion.md), and the review semantics of [the workbench](graph-workbench.md)
Last updated: 2026-09-20

---

## 1. Summary

One terminal command, `hof` ("handoff"), that lets a developer work with the
context graph the way they work with git: bind a directory to a project, explore
nodes and their history, check out a bounded task context to hand to an agent,
and review what agents proposed. It is a thin shell over the existing store,
compiler, proposal, and ingestion services — the same role the MCP server plays
for agents, but for humans and shell pipelines.

## 2. Problem

Today the graph is reachable through the browser workbench, the MCP server, and
eight unrelated `npm run …` scripts that each take a raw project UUID. A
developer at a terminal cannot ask "what does the project know about webhooks",
pipe compiled context into `claude -p`, or review proposals without leaving the
shell. The scripts also duplicate argument parsing and error handling.

## 3. Goals

- A single, discoverable command with git-shaped verbs and `--help` everywhere.
- Bind a working directory to a project once so commands never need a UUID.
- Make `hof checkout "<task>"` emit exactly the compiler's `contextText` on
  stdout so it composes with pipes and `$(…)`.
- Address nodes by UUID prefix, external key, or path instead of full UUIDs.
- Expose the review loop (`pending` / `accept` / `reject`) without the browser.
- Keep `--json` available on every command for scripting and for agents that
  have no MCP client.

## 4. Non-goals

Branches or merges of the graph, editing or deleting edges (the store has no such
operation), a remote/HTTP mode, authentication, a full-screen TUI, shell
completion scripts, or replacing the MCP server. Slice one also excludes manual
authoring (`note`/`edit`/`archive`/`restore`) and interactive `review`; both are
specified here for slice two.

## 5. User experience

```sh
$ hof use "Demo Payments"                 # binds ./.hof/project to the UUID
$ hof status
Demo Payments Platform (synthetic)  7f63f0c8…
  32 active nodes · 41 relationships · 27 canonical · 5 inferred · 3 pending review · 1 archived

$ hof ls --type constraint
ID        TYPE        AUTH       V  TITLE
a1b2c3d4  constraint  canonical  1  Provider events must be processed idempotently
…

$ hof show component.webhooks
$ hof log a1b2c3d4
$ hof diff a1b2c3d4 1 2

$ hof checkout "Fix duplicate Stripe webhook processing" --budget 2048 | pbcopy
# stdout: the exact rendered context; stderr: status line + ranked selection with reasons

$ claude -p "$(hof checkout 'Fix duplicate Stripe webhook processing')"

$ hof pending
$ hof accept 9f8e7d6c --note "Confirmed against staging"
$ hof reject 1a2b3c4d
$ hof propose notes.md --task "Fix duplicate Stripe webhook processing"
$ hof serve                               # stdio MCP server
```

Errors print `CODE: message` on stderr, matching the HTTP envelope. `hof <cmd>
--help` prints usage for that command; `hof` alone prints the command list.

## 6. Functional requirements

Slice one:

- [x] C1: `scripts/hof.ts` is the single entry point, exposed as `npm run hof --` and
      as a `bin` named `hof` in `package.json` (`npm link` yields a `hof` binary).
      Arguments are parsed with Node's built-in `util.parseArgs`; no new dependency.
- [x] C2: Project binding. `hof use <uuid | unique name substring>` writes
      `.hof/project` (the UUID, one line) in the current directory and prints the
      project name. Resolution order for every other command: `--project`, `HOF_PROJECT`,
      the nearest `.hof/project` walking up from cwd. No binding → exit 2 with a hint.
      `.hof/` is git-ignored by this repository.
- [x] C3: `hof projects` lists projects (id, name, created) and marks the bound one.
      `hof init <manifest.json>` imports a prepared manifest and binds the result.
- [x] C4: Node references accept a UUID prefix of ≥ 8 hex characters, an exact
      `externalKey`, or an exact `path`, matched against the active graph plus archived
      nodes. Zero matches → `NOT_FOUND`; more than one → `VALIDATION_ERROR` listing the
      candidates. Resolution is a pure function over `ContextNode[]`.
- [x] C5: Read commands: `status`, `ls [--type] [--canonical|--inferred] [--archived]
      [--grep]`, `show <node>` (revision fields, relationships as directed sentences,
      source record with the structured excerpt), `log <node>`, `diff <node> [vA] [vB]`
      (defaults to the two latest; reuses `compareRevisions`), `source <sourceId>`.
- [x] C6: `checkout "<task>" [--budget] [--depth] [--start <node>]… [--degraded]`
      calls `compileContext` and writes `contextText` to stdout with nothing else.
      Status, tokens vs budget vs project tokens, and the ranked selection with reasons
      and paths go to stderr. `--explain` writes the explanation to stdout instead and
      suppresses the text; `--json` writes the full `ContextBundle`. Exit 0 also when
      `status` is `degraded`, but the stderr status line says so.
- [x] C7: Review: `pending` lists agent-authored inferred nodes newest first (the
      workbench's `pendingReview`); `accept <node>… [--note]` revises each to canonical
      with confidence 1 using `ACCEPT_DEFAULTS`; `reject <node>… [--note]` archives with
      `REJECT_DEFAULTS`. Both go through `reviseOperatorNode`, so provenance is a fresh
      manual source with actor `local-operator`. Multiple refs are processed in order and
      a failure on one is reported without aborting the rest; exit 1 if any failed.
- [x] C8: Proposal and agent plumbing reuse existing services with identical
      behavior: `propose [file|-] [--task]`, `ingest pr <ref> [--repo]`,
      `ingest docs <path> [files…]`, `serve` (MCP over stdio), `migrate`.
- [x] C9: Output contract. Human-readable tables by default; `--json` on every
      command prints one JSON document to stdout. Exit codes: `0` success, `1` domain
      error (`GraphError`, printed as `CODE: message`), `2` usage or missing binding,
      `3` environment (database unreachable, no proposal model configured). Colors are
      never used on `checkout` stdout and only elsewhere when stdout is a TTY.

Slice two:

- [x] C10: `note <type> "<title>" --content <text|@file|-> [--summary] [--key] [--path]
      [--importance] [--confidence] [--inferred] [--link <node> --edge <EDGE_TYPE> [--incoming]]
      -m "<reason>" --evidence "<note>"` creates a node (canonical unless `--inferred`) with
      an optional single edge via `createOperatorNode`. `--content` accepts literal text,
      `@path` to read a file, or `-` for stdin. `--path` is required for `file` nodes.
- [x] C11: `edit <node> [--title] [--content] [--summary] [--importance] [--confidence]
      [--canonical|--inferred] -m --evidence`, `archive <node>… -m --evidence`, and
      `restore <node>… -m --evidence` go through `reviseOperatorNode` with
      `expectedVersion` = the version just read; a `CONFLICT` is reported with both
      versions and never retried silently. `edit` with no field flags is a usage error.
- [x] C12: `review` steps through pending proposals when stdin is a TTY: shows the
      proposal and its evidence, then prompts `a`ccept / `r`eject / `e`dit-then-accept
      (opens `$EDITOR`/`$VISUAL`, default `vi`, on the content) / `s`kip / `q`uit. `--note`
      applies to every decision. Without a TTY it prints the pending table and exits 2.
- [x] C13: `checkout --copy` writes the exact text to the clipboard through the first of
      `pbcopy`, `wl-copy`, `xclip -selection clipboard` found on `PATH`, still prints to
      stdout, and reports "copied" on stderr; no tool → warning on stderr, exit 0.
- [x] C14: Operator attribution is configurable for shared databases: every workbench
      and CLI write uses actor `{ kind: 'human', label: OPERATOR_LABEL }` where
      `OPERATOR_LABEL` comes from the environment (1–120 characters) and defaults to
      `local-operator`. Labels are attribution, not authentication (project spec §9).
- [x] C15: `bin/hof` is a POSIX shell wrapper that runs `scripts/hof.js` with `node`
      from the repository, so teammates can `export PATH="<repo>/bin:$PATH"` instead of
      `npm link` when their global npm prefix is not writable.

## 7. Data model

### New entities

None in the database. `OPERATOR_LABEL` (C14) changes only the `actor.label` value
stored on new revisions and edges; the schema is unchanged. `.hof/project` is a one-line file in the developer's
working directory containing a project UUID; it is presentation/binding state,
not project knowledge, and is git-ignored.

### Changed entities

None.

### Migration considerations

None.

## 8. API / interface changes

No HTTP changes. New modules:

```ts
// src/cli/refs.ts — pure
export function resolveNodeRef(ref: string, nodes: ContextNode[]): ContextNode; // throws GraphError
export function shortId(id: string): string;                                     // first 8 chars

// src/cli/project.ts
export function findProjectBinding(startDir: string): string | null;              // nearest .hof/project
export async function resolveProject(store, opts: { project?: string; cwd: string; env: NodeJS.ProcessEnv }): Promise<Project>;
export async function resolveProjectRef(store, ref: string): Promise<Project>;    // uuid or unique name substring
export function writeProjectBinding(dir: string, projectId: string): void;

// src/cli/format.ts — pure, no color
export function formatStatus(graph: GraphSnapshot, archived: ContextNode[]): string;
export function formatNodeTable(nodes: ContextNode[]): string;
export function formatNode(node: ContextNode, graph: GraphSnapshot, source: Source | null): string;
export function formatLog(revisions: NodeRevision[]): string;
export function formatDiff(rows: FieldComparison[], a: number, b: number): string;
export function formatBundleExplanation(bundle: ContextBundle): string;
export function formatPending(nodes: ContextNode[]): string;

// src/cli/input.ts — pure apart from file/stdin reads
export async function readContentArg(value: string, readStdin: () => Promise<string>): Promise<string>; // text | @file | -

// src/cli/hof.ts — command table and runner
export const COMMANDS: Record<string, CommandSpec>;
export type Io = { stdout; stderr; cwd; env; readStdin; isTTY: boolean; prompt: (question: string) => Promise<string> };
export type Services = {
  store; compiler(); proposalModel();
  serve?(): Promise<void>;
  editText?(initial: string): Promise<string>;        // $EDITOR round trip (C12)
  copy?(text: string): Promise<boolean>;              // clipboard (C13); false when no tool exists
};
export async function run(argv: string[], io: Io, services: Services): Promise<number>; // exit code

// src/server/workbench/mutations.ts (C14)
export function operatorActor(env = process.env): Actor;  // { kind: 'human', label: env.OPERATOR_LABEL ?? 'local-operator' }
```

`scripts/hof.ts` loads `.env` from the repository root (like `mcp-server.ts`, so
it works from any cwd), calls `run(process.argv.slice(2), …)`, and exits with the
returned code. `package.json` gains `"bin": { "hof": "scripts/hof.js" }` where
`scripts/hof.js` is a two-line shim that execs `tsx` on `hof.ts`, and the script
`"hof": "tsx scripts/hof.ts"`.

Errors: `GraphError` → stderr `CODE: message` (+ `details` when `--json`), exit 1.
Unknown command/flag or missing binding → usage on stderr, exit 2. Pool/model
setup failure → hint on stderr, exit 3.

## 9. Context graph implications

- Reads all node types, edges, revisions, and sources through `GraphStore`.
- Writes only through existing operator mutations: `accept`/`reject` create new
  revisions with fresh manual sources (slice one); `note`/`edit`/`archive`/`restore`
  (slice two) do the same. `propose`/`ingest` create inferred nodes/edges with
  agent sources exactly as today.
- Creates durable context only through those paths; the CLI itself stores nothing.
- Does not touch retrieval, ranking, or token compilation; `checkout` is
  `compileContext` verbatim.

## 10. Retrieval behavior

Delegated entirely to the compiler. `checkout` passes `task`, `tokenBudget`,
`maxDepth`, `startNodeIds` (resolved from node refs), and `allowDegraded`, and
prints the compiler's reasons and paths without re-ranking.

## 11. Edge cases

- No binding and no `--project`: exit 2 with `hof use` hint; `projects` still works.
- Stale `.hof/project` (project deleted): `NOT_FOUND`, exit 1, hint to re-run `use`.
- Ambiguous node ref (two keys sharing an 8-char prefix): list candidates, exit 1.
- `accept` on a node that is already canonical: the store reports `changed: false`;
  the CLI prints "already canonical" and continues.
- `accept`/`reject` racing the workbench: `CONFLICT` for that ref, others proceed.
- `checkout` with `--start` referencing an archived node: compiler `VALIDATION_ERROR`.
- Empty project: `status` shows zeros; `checkout` prints the compiler's
  "no relevant context" text.
- `--json` combined with `checkout --explain`: JSON wins (full bundle).
- Database down: exit 3 before any command runs; the message names `DATABASE_URL`.
- Large graphs: `ls` prints everything (≤ 1,000 nodes by store limit); no paging.

## 12. Security / privacy considerations

Local tool for a single trusted operator, like the existing scripts. It reads
credentials from `.env` and never prints them. `checkout` output may contain
project knowledge; it is written only to the local stdout the user requested.
`.hof/project` holds a UUID only. Actor attribution remains `local-operator`.

## 13. Observability

Domain errors carry the same codes as the API. `checkout` prints the compiler
status, tokenizer, model, and measured tokens on stderr so a degraded or
budget-limited result is visible even when stdout is piped. `--json` exposes the
full bundle including `warnings` and `omissions`.

## 14. Acceptance criteria

- [x] A1: From a fresh shell in a bound directory, `hof status`, `ls`, `show`, `log`,
      and `diff` display the demo project without any UUID typed by the user.
- [x] A2: `hof checkout "Fix duplicate Stripe webhook processing" | wc -c` produces
      only the context text; the explanation appears on stderr; `--json` parses as a
      `ContextBundle`; the text equals the workbench's Copy output for the same request.
- [x] A3: `hof pending` lists the fixture's agent-authored claims; `hof accept <ref>`
      makes the node canonical v2 with a `Workbench operator note` style manual source
      and actor `local-operator`; `hof reject <ref>` archives; both appear in `hof log`.
- [x] A4: Node refs by UUID prefix, external key, and path resolve; ambiguity and
      misses are reported with the documented exit codes.
- [x] A5: `npm run typecheck`, `lint`, `format:check`, `test`, and `test:integration`
      pass; the CLI unit tests cover refs, binding resolution, arg parsing, and formatting.

## 15. Test plan

### Unit tests

- `tests/cli/refs.test.ts` — prefix/key/path resolution, ambiguity, miss, short ids.
- `tests/cli/project.test.ts` — binding lookup walks up directories; env and flag
  precedence; name-substring resolution against a fake project list.
- `tests/cli/format.test.ts` — status/table/diff/explanation formatting on the demo
  fixture shapes; `checkout` stdout equals `contextText` exactly.
- `tests/cli/args.test.ts` — command dispatch, `--help`, unknown command → exit 2.

### Integration tests

- `tests/cli/hof.integration.test.ts` — run `run()` against an isolated PostgreSQL
  store with the demo fixture imported: `status`, `ls --type`, `show`, `log`, `diff`,
  `pending` → `accept` → `log` shows v2 canonical; `reject` → archived; `checkout`
  with the fixed embedding provider returns the compiler bundle and writes text to
  the stdout sink only.

### UI/manual verification

1. `npm link` (or `npx tsx scripts/hof.ts`), `hof use Demo`, run the §5 session.
2. `hof checkout … | pbcopy` and paste into an agent; compare with workbench Copy.
3. Accept a proposal from the CLI, refresh the workbench Review tab and History.

## 16. Implementation plan

- [x] Freeze this spec; add `.hof/` to `.gitignore`.
- [x] `src/cli/refs.ts` + tests (C4).
- [x] `src/cli/project.ts` + tests (C2, C3 resolution).
- [x] `src/cli/format.ts` + tests (C5, C6 explanation, C7 listing).
- [x] `src/cli/hof.ts` runner: parseArgs command table, io abstraction, exit codes,
      shared bootstrap (pool/migrate/store/compiler deps/proposal model) (C1, C9).
- [x] Commands: `projects`, `use`, `init`, `status`, `ls`, `show`, `log`, `diff`,
      `source` (C3, C5).
- [x] `checkout` (C6).
- [x] `pending`, `accept`, `reject` (C7).
- [x] `propose`, `ingest pr|docs`, `serve`, `migrate` delegating to existing code (C8).
- [x] `scripts/hof.ts`, `scripts/hof.js` shim, `package.json` `bin` + script, README
      section (C1).
- [x] Integration test; run all checks; manual session; update §18; commit and push
      `CLI_interface`.

Slice two:

- [x] `OPERATOR_LABEL` in `mutations.ts` (`operatorActor(env)`), `.env.example`, README (C14).
- [x] `src/cli/input.ts`: `readContentArg` (`text | @file | -`) + tests.
- [x] `note`, `edit`, `archive`, `restore` commands + integration tests (C10, C11).
- [x] `Io.isTTY` / `Io.prompt`, `Services.editText`, `review` command + integration test
      with a scripted prompt (C12).
- [x] `Services.copy`, `checkout --copy` (C13); `bin/hof` wrapper (C15); README.
- [x] All checks; update §18; commit and push `CLI_interface`.

## 17. Alternatives considered

### Keep adding `npm run …` scripts

Pros: zero new surface. Cons: every script re-implements parsing and takes raw
UUIDs; no discoverability; nothing composes with pipes.

### A commander/yargs-based CLI

Pros: richer help and completion. Cons: a new dependency for a command table of
~15 verbs; `util.parseArgs` in Node 20 covers flags/positionals adequately.

### Make the MCP server the only agent/CLI interface

Pros: one protocol. Cons: humans do not speak MCP at a shell prompt, and
`$(hof checkout …)` is the simplest possible handoff when an agent has no MCP
client configured.

### Chosen approach

Single `hof` entry with built-in parsing, thin command functions over existing
services, pure formatting/resolution modules for testability, and stdout reserved
for data on `checkout`.

## 18. Durable context created by this feature

- `src/cli/hof.ts` exports `run(argv, io, services)`; it never touches `process`,
  so integration tests drive the exact command table with string sinks, a temp cwd,
  and a fake env. `scripts/hof.ts` is the only place that builds the pool, store,
  compiler deps, proposal model, and MCP transport. Read-only commands never
  construct the embedding provider or LLM client (`Services.compiler` /
  `proposalModel` are lazy), so `hof ls` is fast and needs no model key.
- Node `util.parseArgs` in strict mode is sufficient: unknown flags are usage
  errors (exit 2) and `multiple: true` handles repeated `--start`. Positionals are
  validated per command; there is no sub-command framework.
- Project binding is a one-line `.hof/project` found by walking up from cwd, with
  `--project`/`HOF_PROJECT` taking precedence. It is git-ignored in this repository;
  other repositories that adopt `hof` should ignore `.hof/` too.
- Node refs prefer exact `externalKey`/`path` over UUID prefixes, and prefixes need
  at least eight hex characters. Refs are resolved against active **and archived**
  nodes so `show`/`log`/`diff` work after a `reject`. `checkout --start` resolves
  against active nodes only because the compiler rejects archived starts.
- `checkout` reserves stdout for `contextText` and writes the explanation to stderr;
  `--json` and `--explain` redirect what goes to stdout. The exit code is 0 for a
  `degraded` bundle (the status line on stderr says so) because the compiler already
  gates degradation behind `--degraded`.
- `accept`/`reject` reuse the workbench's `ACCEPT_DEFAULTS`/`REJECT_DEFAULTS` and
  `reviseOperatorNode`, so CLI and UI decisions are indistinguishable in history:
  actor `local-operator`, a fresh `manual` source with the optional `--note`
  appended. A `changed: false` result (already canonical/archived) is reported, not
  treated as failure; a failing ref does not stop the others but forces exit 1.
- The `bin` shim `scripts/hof.js` spawns the repository's `tsx` on `hof.ts`; there
  is no compiled distribution. `npm link` is the intended install for now.
- `.env` is read from the repository root (like the MCP server), not from cwd, so
  `hof` behaves the same from any bound directory.

Findings from slice two:

- The store's `changed: false` path compares the full snapshot **including
  `sourceId`**, and every operator write mints a fresh manual source first, so an
  operator revise can never be a store-level no-op: an unchanged `edit` would record
  a new revision and an orphan source. The CLI therefore compares the proposed
  snapshot (minus `sourceId`) with the current one *before* calling
  `reviseOperatorNode` (`proposedSnapshot`/`sameSnapshot` in `src/cli/hof.ts`). The
  workbench UI has the same latent behavior for identical saves; fixing it in the
  store (compare without `sourceId`) is a small foundation change left for later.
- `accept`, `reject`, `review`, `archive`, and `restore` share `applyDecision` /
  `forEachRef`, so the CLI has exactly one place that decides what a decision writes.
- `review` is driven through `Io.prompt`/`Io.isTTY` and `Services.editText`, so the
  integration test scripts answers (`x a e s q`) and fakes the editor without a PTY.
  Non-TTY invocations print the pending table and exit 2 rather than hanging.
- `--content` values use `@file` / `-` / `@@literal` (`src/cli/input.ts`) instead of a
  second positional, keeping every authoring command's grammar flag-based.
- Clipboard support probes `pbcopy`, `wl-copy`, then `xclip`; failure is a warning, not
  an error, because the text is already on stdout.
- `OPERATOR_LABEL` is read per call (`operatorActor(env)`) rather than at import, so
  tests and long-lived processes see environment changes. A label longer than the
  store's 120-character actor limit falls back to `local-operator` rather than being
  truncated (implemented and tested on `main` in `tests/workbench/http.test.ts`; the
  parallel CLI-branch implementation was dropped in favor of it).
- `bin/hof` resolves the repository from its own path, so it works from any cwd and
  survives `PATH` entries that point at symlinks.
