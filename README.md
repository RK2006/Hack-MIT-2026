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
export DATABASE_URL='postgresql://context_graph:context_graph_local@127.0.0.1:5432/context_graph'
export TEST_DATABASE_URL="$DATABASE_URL"
npm run db:migrate
npm run import:demo        # imports the synthetic payments project once (repeat = conflict, never overwrites)
npm run dev                # workbench on http://127.0.0.1:3000 (loopback only)
```

All configuration lives in a git-ignored `.env` at the repo root (copy
`.env.example`); every `npm run …` script and the Next.js dev server load it.
Shell variables take precedence over `.env`, so `unset` a stale key exported in
your shell profile if it is not the one you want. Never commit real credentials.

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
