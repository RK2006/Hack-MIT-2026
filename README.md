# Context Graph MVP

A local, versioned project knowledge graph that compiles task-relevant context for humans and coding agents.

The demo data is a clearly labeled **synthetic** payments project; its claims are not observations about this repository.

## Prerequisites

- Node.js 20+ and npm
- Docker with Compose (PostgreSQL 17)
- ~25 MB of disk for the local embedding model (downloaded once on first compile)

## Run the MVP

```bash
npm install
docker compose up -d --wait postgres
cp .env.example .env         # then set DATABASE_URL (the Compose default is already in the example)
npm run db:migrate
npm run import:demo        # imports the synthetic payments project once (repeat = conflict, never overwrites)
npm run dev                # workbench on http://127.0.0.1:3000 (loopback only)
```

All configuration lives in a git-ignored `.env` at the repo root (copy
`.env.example`); every `npm run …` script and the Next.js dev server load it.
Shell variables take precedence over `.env`: if you ever `export DATABASE_URL=…` (or an API key)
in a terminal, that value silently wins — `unset` it or open a new terminal when switching
databases. Never commit real credentials.

### Sharing one graph across a team

Point every teammate's `.env` at the same hosted PostgreSQL (e.g. a Neon connection string with
`sslmode=require`) and set `OPERATOR_LABEL=<your name>` so reviews and edits are attributed to the
person who made them. The store's per-project locking and expected-version conflicts already make
concurrent edits safe; there is no authentication — anyone with the connection string has full
access, so share it privately.

Embeddings default to a local sentence-transformer (`EMBEDDING_PROVIDER=local`,
`Xenova/all-MiniLM-L6-v2` via ONNX, no network after the first model download).
To use OpenAI instead, set `EMBEDDING_PROVIDER=openai` and `OPENAI_API_KEY`
(optionally `OPENAI_EMBEDDING_MODEL`, default `text-embedding-3-small`).

## Demo flow

1. Open the demo project; explore the graph (or the List tab), click nodes to see
   content, directed relationships, canonical/inferred labels, and source evidence.
2. In the task panel, compile "Fix duplicate Stripe webhook processing" with a
   4,096-token budget: the selection highlights the webhook component, handler
   file, idempotency constraint, storage decision, the receipt store (a graph
   neighbor with no task keywords), and the inferred bug; unrelated catalog/email/
   tax/analytics/admin context stays out. Each item shows why it was chosen.
3. Lower the budget to 512 to see bounded text with explicit omissions; copy the text.
4. Edit the inferred assumption "An in-memory seen-event set might be sufficient",
   review it as canonical, then open History and compare v1 with v2.
5. Recompile: the bundle now cites v2 (canonical); v1 remains readable in History.

## `hof` command line

`hof` ("handoff") is a git-shaped CLI over the same store and compiler. Bind a
directory once, then explore, check out task context, and review proposals
without typing UUIDs:

Install one of three ways (all need `npm install` in this checkout first):

```bash
export PATH="$PWD/bin:$PATH"   # simplest: add to ~/.zshrc; no npm permissions involved
npm link                       # or: a global `hof` binary (needs a writable global npm prefix)
npm run hof -- <command>       # or: no install at all
```

Then, from any directory:

```bash
hof use "Demo Payments"     # writes .hof/project (git-ignored); --project/-p or HOF_PROJECT also work
hof scan ~/code/my-service --name "My Service" --docs   # or: scan a real repo into a new project and bind to it
                            # (--out file.json writes the manifest only; --docs needs an LLM key)
hof status                  # counts: nodes, relationships, canonical/inferred, pending review, archived
hof ls --type constraint    # also --inferred, --archived, --grep <text>
hof show component.stripe-webhooks     # node refs: UUID prefix (≥ 8 chars), external key, or path
hof log 3a17141a && hof diff 3a17141a 1 2

hof checkout "Fix duplicate Stripe webhook processing" --budget 2048 --copy
                            # stdout = exact context text; stderr = ranked selection with reasons
claude -p "$(hof checkout 'Fix duplicate Stripe webhook processing')"

hof pending                 # agent proposals not yet reviewed
hof review --note "Batch review"     # interactive: (a)ccept (r)eject (e)dit-in-$EDITOR (s)kip (q)uit
hof accept 3a17141a --note "Confirmed against staging"   # → canonical v2, operator provenance
hof reject 773d49cb         # → archived

hof note decision "Retry webhooks asynchronously" --content @notes.md --summary "Queue retries" \
  --link component.stripe-webhooks --edge AFFECTS -m "Decided in standup" --evidence "See ADR draft"
hof edit decision.async-retries --importance 4 -m "Raised priority" --evidence "Incident 2026-09-19"
hof archive 95176389 -m "Obsolete" --evidence "Admin sessions removed in PR #12"; hof restore 95176389 -m … --evidence …

hof propose notes.md --task "…"; hof ingest pr <url>; hof ingest docs .   # LLM key required
hof serve                   # stdio MCP server (same as `npm run mcp`)
```

`--content` takes literal text, `@file`, or `-` (stdin). Authoring commands require
`-m "<reason>"` and `--evidence "<note>"`, which become the revision's change reason
and its manual source. On a shared database set `OPERATOR_LABEL=<your name>` in
`.env` so revisions say who made them (default `local-operator`).

Every command takes `--json`. Exit codes: `0` ok, `1` domain error (`CODE: message`),
`2` usage / no project bound, `3` environment (database or model key). See
[the CLI spec](docs/specs/hof-cli.md).

## Agent handoff (MCP)

Expose the compiler to a coding agent over stdio MCP:

```bash
npm run mcp     # tools: list_projects, compile_context, get_node, get_source (+ propose_context with ANTHROPIC_API_KEY)
```

Client configuration (Claude Code / Codex style):

```json
{
  "mcpServers": {
    "context-graph": {
      "command": "npx",
      "args": ["tsx", "scripts/mcp-server.ts"],
      "cwd": "/path/to/hackmit-2026",
      "env": {
        "DATABASE_URL": "postgresql://context_graph:context_graph_local@127.0.0.1:5432/context_graph"
      }
    }
  }
}
```

## Agent proposals

With an LLM key in `.env` (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY`;
optional `PROPOSAL_PROVIDER=anthropic|openai|gemini` and `PROPOSAL_MODEL`; defaults
`claude-sonnet-4-5` / `gpt-4.1-mini` / `gemini-flash-latest,gemini-flash-lite-latest`; `PROPOSAL_MODEL` accepts a
comma-separated fallback list, tried in order when a model is throttled), an agent or operator can turn
notes/diff summaries into _inferred_ knowledge for review:

```bash
npm run propose -- 7f63f0c8-9a4e-4e2a-8ebd-a8f2b3f8c101 notes.md --task "Fix duplicate Stripe webhook processing"
```

Proposals appear in the workbench with the inferred badge and agent evidence; review them
canonical or archive them. Agents can never write canonical knowledge.

## Scan a real repository

Import the structure of any local git checkout as a new canonical project (directories → components,
tracked source files → File nodes; nothing is executed or analyzed):

```bash
npm run scan:repo -- /path/to/repo --import            # or --out scan.json to inspect first
npm run scan:repo -- /path/to/repo --import --docs     # also read README/AGENTS/CONTRIBUTING/CHANGELOG/docs into proposals
npm run ingest:docs -- <projectId> /path/to/repo       # docs only, e.g. later or for chosen files
```

Structure is canonical; documentation claims arrive inferred in the **Review** tab with each file's
GitHub URL as evidence. Also available to agents as the MCP tools `scan_repository` (with
`includeDocs`) and `ingest_documents`. Knowledge is then layered on with PR ingestion, agent
proposals, and human review.

## Demo: Tripline (real repository + curated knowledge)

The headline demo runs against [Tripline](docs/specs/demo-tripline.md), a small real
travel-planning service in its own repository. Structure comes from a scan; the reviewed
knowledge layer (time-zone, money, idempotency, cache, and soft-delete rules, plus two
known bugs) is a committed overlay whose evidence links to the repository's ADRs and PRs:

```bash
npm run demo:tripline -- /path/to/tripline            # scan + merge fixtures/tripline-claims.json + import
npm run demo:tripline -- /path/to/tripline --out merged.json   # inspect the merged manifest instead
cd /path/to/tripline && hof use Tripline
hof checkout "Trip reminders fire at the wrong local time for stops in another time zone" --budget 2048
```

The overlay references the scanner's keys (`file.src-notifications-reminders-ts`, …); if
the repository's paths change, the merge fails listing every missing key. Re-importing
into a database that already holds Tripline is a conflict — use a fresh database rather
than deleting data.

## GitHub pull requests → knowledge

With `gh` logged in and an LLM key in `.env`, turn a PR into proposals whose evidence links to the PR:

```bash
npm run import:manifest -- fixtures/context-graph-self.json   # once: a project describing this repo
npm run ingest:pr -- 3c1d7a2e-5b8f-4c0a-9e6d-2f4b8a1c9d02 https://github.com/AnmolKaran/hackmit-2026/pull/2
```

Also available to agents as the MCP tool `ingest_pull_request`. Review the results in the
workbench's **Review** tab.

## Verification

```bash
npm test                   # unit tests (fixed embeddings, real tokenizer)
npm run test:integration   # real PostgreSQL: store, ingestion, compiler, routes
npm run typecheck
npm run lint
npm run format:check
npm run build              # Next.js production build
npm run context:smoke      # foundation smoke: create/reload/revise a test project
npm run semantic:smoke     # real-provider semantic gate against the imported demo project
```

Integration tests use a real PostgreSQL database and create a unique schema per
test. They drop only those test-owned schemas. The smoke commands create labeled
synthetic data; they do not reset or delete existing projects.

## Layout

- `docs/` — project spec, MVP plan, and feature specs (source of truth)
- `src/server/context/` — graph store, validation, and the compiler (`compiler/`)
- `src/server/ingestion/` — prepared manifest import; `fixtures/demo-payments.json`
- `src/server/workbench/` + `src/app/api/` — HTTP handlers and routes
- `src/app/`, `src/components/workbench/`, `src/lib/` — Next.js workbench UI
- `tests/` — Vitest unit and `*.integration.test.ts` PostgreSQL tests
