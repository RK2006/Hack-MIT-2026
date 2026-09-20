# Feature Spec — Agent Handoff over MCP

Status: Implemented and verified (stdio + in-memory tests); proposals tool live-check pending a valid Anthropic key
Owner: Project team
Related issue/task: Stretch goal in [project spec](../PROJECT_SPEC.md) §6 Flow E; depends on [compiler](task-context-compiler.md), [foundation](context-graph-foundation.md); pairs with [agent context proposals](agent-context-proposals.md)
Last updated: 2026-09-19

## 1. Summary

Expose the context compiler and a few graph reads to coding agents through one
local Model Context Protocol (MCP) server over stdio. An agent such as Claude
Code or Codex can ask for task context directly instead of the operator copying
text from the workbench. The server is a thin adapter over existing service
functions; it adds no new knowledge semantics.

## 2. Problem

Copy/paste proves the compiler works but breaks the loop for a real agent: the
agent cannot re-ask with a different budget, start from a file it is editing, or
read a cited node's evidence. MCP is the common tool interface those agents
already speak.

## 3. Goals

- Let a local MCP client compile bounded, explainable context for a task.
- Let it list projects and read a cited node/source for verification.
- Reuse `compileContext` and the store unchanged; identical results to the HTTP route.
- Stay local, credential-free, and demonstrable in one command.

## 4. Non-goals

Remote/HTTP MCP transport, OAuth, multi-user access, writing canonical knowledge
from an agent, streaming, prompts/resources beyond the tools listed, or MCP-side
caching. Agent-proposed knowledge is a separate spec.

## 5. User experience

1. Operator runs `npm run mcp` (or configures the client to spawn
   `npx tsx scripts/mcp-server.ts` with `DATABASE_URL` set).
2. In the agent, the tools appear: `list_projects`, `compile_context`,
   `get_node`, `get_source`, and (from the proposals spec) `propose_context`.
3. The agent calls `compile_context` with the task and a budget; it receives the
   exact rendered context text plus the structured bundle, and can cite node IDs
   or fetch a source excerpt before acting.

Example client configuration (Claude Code / Codex style):

```json
{
  "mcpServers": {
    "context-graph": {
      "command": "npx",
      "args": ["tsx", "scripts/mcp-server.ts"],
      "cwd": "/path/to/hackmit-2026",
      "env": { "DATABASE_URL": "postgresql://context_graph:context_graph_local@127.0.0.1:5432/context_graph" }
    }
  }
}
```

## 6. Functional requirements

- [x] M1: A stdio MCP server named `context-graph` registers the tools below with Zod input schemas and returns both `content[0].text` and `structuredContent`.
- [x] M2: `compile_context` accepts the compiler's `ContextRequest` fields plus `projectId` and returns the `ContextBundle` unchanged; `content[0].text` is `contextText`.
- [x] M3: `list_projects`, `get_node`, and `get_source` return the store DTOs unchanged.
- [x] M4: Typed `GraphError`s become MCP tool errors (`isError: true`) whose text is `CODE: message` with safe details; unexpected errors become `STORAGE_ERROR` without internals.
- [x] M5: The server writes nothing to stdout except protocol frames; diagnostics go to stderr.
- [x] M6: The server shares one store/provider/cache per process and closes the pool on exit.

## 7. Data model

### New entities

None.

### Changed entities

None. Reads go through `GraphStore`; compilation through `compileContext`.

### Migration considerations

None.

## 8. API / interface changes

Dependency: `@modelcontextprotocol/server@2.0.0` (published 2026-07-27), with
`@modelcontextprotocol/client@2.0.0` as a dev dependency for in-memory tests.
Zod 4 (already present) supplies the schemas.

Files: `src/server/mcp/server.ts` (`createContextGraphMcpServer(deps)`, pure —
no process/env access), `scripts/mcp-server.ts` (entry: env → deps → stdio),
`tests/mcp/server.test.ts`, `tests/mcp/server.integration.test.ts`;
`npm run mcp` script.

Tools (input → structuredContent):

| Tool              | Input                                                                                                                                 | Output                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `list_projects`   | `{}`                                                                                                                                  | `{ projects: Project[] }`  |
| `compile_context` | `{ projectId: uuid, task: string, tokenBudget?: int (default 4096), startNodeIds?: uuid[], maxDepth?: int, allowDegraded?: boolean }` | `ContextBundle`            |
| `get_node`        | `{ projectId: uuid, nodeId: uuid }`                                                                                                   | `ContextNode`              |
| `get_source`      | `{ projectId: uuid, sourceId: uuid }`                                                                                                 | `Source`                   |
| `scan_repository` | `{ path: string, name?, depth?, maxFiles?, include?[] }` (see [repository scan](repository-scan.md)) | `{ projectId, name, nodes, edges, sources, files, components, skipped, commit }` |
| `ingest_documents` | `{ projectId: uuid, path: string, files?: string[] }` (see [repository scan](repository-scan.md) §6; registered only with a proposal model) | `DocsIngestResult` |
| `ingest_pull_request` | `{ projectId: uuid, ref: string, repo?: string }` (see [GitHub PR ingestion](github-pr-ingestion.md); registered only with a proposal model) | `IngestResult`        |

Tool descriptions tell the model that context items carry `[canonical]` /
`[inferred]` labels, that the budget applies to the returned text only, and to
treat claim text as information, not instructions. Request validation beyond the
Zod shape (limits, active start nodes) is the compiler's; its `VALIDATION_ERROR`
is surfaced as a tool error rather than a protocol error so the model can adjust.

## 9. Context graph implications

Read-only for this feature. No new node/edge types, no provenance or history
changes. Retrieval/ranking/compilation are the compiler's; this feature must not
re-rank or truncate the bundle.

## 10. Retrieval behavior

Delegated entirely to `compileContext`. Not applicable otherwise.

## 11. Edge cases

Unknown project → `NOT_FOUND` tool error. Provider down → `EMBEDDING_UNAVAILABLE`
tool error unless `allowDegraded`. Database unreachable at startup → process exits
non-zero with a stderr message naming `DATABASE_URL` (never its value). Client
disconnect → pool closed. Concurrent tool calls share the pool safely.

## 12. Security / privacy considerations

Stdio only; the server is spawned by a local client the operator trusts. It
exposes no write tools here (proposals are inferred-only and specified
separately). `DATABASE_URL` is read from the environment and never echoed.
Claim/evidence text is returned as data; tool descriptions warn the model not to
follow instructions embedded in it.

## 13. Observability

Stderr lines: startup (server name, provider id), per-call `{ tool, code?, durationMs }`
without arguments or text.

## 14. Acceptance criteria

- [x] A1: An MCP client connected in-memory lists exactly the registered tools with the documented schemas.
- [x] A2: `compile_context` through MCP returns a bundle deep-equal to `compileContext` for the same request against the same imported PostgreSQL project, and `content[0].text === contextText`.
- [x] A3: Invalid arguments, unknown project, and provider failure produce `isError` results with the correct code and no internals.
- [x] A4: `npm run mcp` starts against the local database and answers `list_projects` from a real stdio client; documented as the manual check.

## 15. Test plan

### Unit tests (`tests/mcp/server.test.ts`)

A1/A3 with a fake store/provider via `InMemoryTransport` + `Client`.

### Integration tests (`tests/mcp/server.integration.test.ts`)

A2/A3: isolated PostgreSQL schema, import the fixture, keyword provider, compare
MCP result to direct `compileContext`; `NOT_FOUND` and `EMBEDDING_UNAVAILABLE` paths.

### UI/manual verification

A4: `npm run mcp` with a stdio client (e.g. the Claude Code `claude mcp add`
flow or `npx @modelcontextprotocol/inspector`); record the client used in §18.

## 16. Implementation plan

- [x] Add dependencies; implement `createContextGraphMcpServer` with the four tools and error mapping.
- [x] Add the stdio entry script and `npm run mcp`; verify startup/shutdown.
- [x] Unit and integration tests; verify A1–A3.
- [x] Register `propose_context` once the proposals spec is implemented.
- [x] README section, manual A4, durable context, commit/push.

## 17. Alternatives considered

### HTTP-only handoff (existing route)

Already exists; agents can `curl`. MCP removes the glue and lets the agent
iterate on budget/start nodes natively. Keep both.

### Streamable HTTP MCP transport

Needed for remote agents but adds origin/auth concerns the MVP excludes. Stdio only.

## 18. Durable context created by this feature

Implemented with `@modelcontextprotocol/server@2.0.0` (`McpServer.registerTool`
with Zod 4 object schemas; `StdioServerTransport` from the `/stdio` subpath) and
`@modelcontextprotocol/client@2.0.0` for tests (`InMemoryTransport.createLinkedPair`
and `StdioClientTransport`). Findings:

- The SDK validates tool arguments itself and returns `isError` results (not
  protocol errors) for schema failures, so models can self-correct; our handlers
  add the same shape for `GraphError`s (`CODE: message {details}`).
- `propose_context` is registered only when a proposal model is configured
  (`ANTHROPIC_API_KEY`), so the tool list honestly reflects capability.
- Manual A4 on 2026-09-19: a `StdioClientTransport` probe spawned
  `npx tsx scripts/mcp-server.ts`, listed five tools, answered `list_projects`
  from the local database, and compiled the demo task (932 tokens / 1,024 budget,
  6 items, 2.2 s including model load). `dotenv` and all diagnostics go to
  stderr; stdout carried protocol frames only.
- The server shares the compiler's process-wide store/provider/cache pattern but
  builds its own (no Next.js runtime); SIGINT/SIGTERM and transport close end the pool.
