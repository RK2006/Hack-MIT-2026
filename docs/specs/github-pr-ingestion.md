# Feature Spec — GitHub Pull Request Ingestion

Status: Implemented and verified, including a live run against this repository's PR #2
Owner: Project team
Related issue/task: [project spec](../PROJECT_SPEC.md) §6 Flow F and §7 stretch "automated context updates from completed PRs"; builds on [agent context proposals](agent-context-proposals.md); exposed via [agent handoff MCP](agent-handoff-mcp.md)
Last updated: 2026-09-20

## 1. Summary

Turn a merged (or open) GitHub pull request into proposed project knowledge. Fetch
the PR's title, description, commit messages, changed files, and a bounded diff
excerpt through the authenticated `gh` CLI, run it through the existing proposal
pipeline, and store the results as inferred nodes whose source links to the PR.
Also import a small manifest describing this repository so the live test and demo
have a real, non-synthetic project to attach PR knowledge to.

## 2. Problem

Proposals currently need someone (or some agent) to type notes. Most durable
engineering knowledge is already written down in pull requests — why a change
was made, what constraint it introduced, what bug it fixed — and then forgotten.
The graph should pick that up from the PR itself, with a link back.

## 3. Goals

- One command / one MCP tool turns a PR URL or number into reviewable knowledge.
- Every resulting node cites the PR URL as its evidence locator (clickable in the workbench).
- Reuse `proposeContext` unchanged except for a source override; no new authority rules.
- Provide a real project (this repository) for the live check.

## 4. Non-goals

GitHub OAuth or webhooks, polling/background sync, ingesting issues or review
comments (follow-up), cloning repositories, arbitrary repository scanning,
writing back to GitHub, or accepting proposals automatically.

## 5. User experience

1. Operator (or agent via MCP) runs `npm run ingest:pr -- <projectId> <pr-url | number> [--repo owner/name]`.
2. The tool fetches the PR with `gh`, builds a bounded text digest, and calls the
   proposal model. Output lists created nodes/edges, dropped items, and the PR URL.
3. In the workbench **Review** tab the new proposals appear; **Show evidence** shows
   the PR digest with a clickable link to the PR; the operator accepts or rejects.
4. `npm run import:manifest -- fixtures/context-graph-self.json` creates the
   "Context Graph (this repository)" project once, so PRs of this repo have a home.

## 6. Functional requirements

- [x] G1: `parsePullRequestRef(ref, defaultRepo?)` accepts `https://github.com/<owner>/<repo>/pull/<n>`, `<owner>/<repo>#<n>`, or a bare number with `--repo`; anything else is `VALIDATION_ERROR`.
- [x] G2: `fetchPullRequest` runs `gh pr view <n> --repo <owner/repo> --json number,title,body,url,state,mergedAt,author,files,commits` and `gh pr diff <n> --repo <owner/repo>` via `execFile` (no shell), with a 60 s timeout; a non-zero exit is `SOURCE_UNAVAILABLE` carrying the safe stderr category (`not_found`, `auth`, `network`, `other`).
- [x] G3: `buildPullRequestText` renders title, state/merge date, author, body, commit subjects, changed files (path + additions/deletions), and a diff excerpt, truncated so the whole text is ≤ 20,000 code points (the proposal limit); truncation is marked in the text.
- [x] G4: `proposeContext` accepts an optional `source: { uri, label }` override; the source kind stays `agent`, the excerpt stays the digest prefix, and `uri` must satisfy the foundation's URI rules (`https:` here).
- [x] G5: `ingestPullRequest(deps, projectId, ref)` returns `{ pullRequest: { url, number, title, state }, proposal: ProposalResult }` and writes nothing when the model proposes nothing.
- [x] G6: CLI `npm run ingest:pr` and MCP tool `ingest_pull_request { projectId, ref, repo? }` expose the same behavior; the MCP tool is registered only when a proposal model is configured.
- [x] G7: `fixtures/context-graph-self.json` describes this repository (components, key files, and decisions lifted from the specs) and imports through the existing manifest importer via `npm run import:manifest -- <file>`.

## 7. Data model

### New entities

None. PR knowledge is ordinary inferred nodes/edges with an `agent` source whose
`uri` is the PR URL and whose `label` is `GitHub PR #<n>: <title>`.

### Changed entities

`GraphErrorCode` gains `SOURCE_UNAVAILABLE` (HTTP 502) for failures fetching
external material (here: `gh`). Distinct from `MODEL_UNAVAILABLE`.

### Migration considerations

None.

## 8. API / interface changes

```ts
type PullRequestRef = { owner: string; repo: string; number: number };
type PullRequestData = {
  number: number; title: string; body: string; url: string; state: string;
  mergedAt: string | null; author: string;
  files: Array<{ path: string; additions: number; deletions: number }>;
  commits: Array<{ messageHeadline: string }>;
  diff: string;
};
type GhRunner = (args: string[]) => Promise<{ stdout: string; stderr: string; code: number }>;
// parsePullRequestRef(ref: string, defaultRepo?: string): PullRequestRef
// fetchPullRequest(ref: PullRequestRef, run?: GhRunner): Promise<PullRequestData>
// buildPullRequestText(pr: PullRequestData): string
// ingestPullRequest({ store, model, run? }, projectId, ref: string, options?: { repo?: string }): Promise<IngestResult>
```

`ProposalRequest` gains `source?: { uri: string; label: string }`. Files:
`src/server/ingestion/github-pr.ts`, `scripts/ingest-pr.ts`,
`scripts/import-manifest.ts`, `fixtures/context-graph-self.json`,
`tests/ingestion/github-pr.test.ts`, `tests/ingestion/github-pr.integration.test.ts`.
MCP tool added in `src/server/mcp/server.ts`.

## 9. Context graph implications

Creates inferred `decision`/`constraint`/`assumption`/`discovery`/`bug` nodes and
non-`CONTAINS` edges, all with agent provenance pointing at the PR. No canonical
writes, no history changes. Retrieval treats them as any inferred node.

## 10. Retrieval behavior

Not applicable.

## 11. Edge cases

PR not found / private without access → `SOURCE_UNAVAILABLE`. Empty body →
digest still has title, commits, files. Huge diffs → truncated with a marker;
the model sees the file list in full. Re-running on the same PR → duplicate
claims are still possible if the model rewords them (the `already exists` check
is by key); the source label makes them easy to spot and reject. Draft/open PRs
are allowed and labeled by state. `gh` not installed → `SOURCE_UNAVAILABLE` with
category `other` and a message naming `gh`.

## 12. Security / privacy considerations

`gh` runs with the operator's existing login; no tokens are read or stored by
this code. Only the PR text/diff is sent to the proposal model — for the live
demo that is this public repository. Output never includes tokens. Diff content
is treated as untrusted text and stored only as a source excerpt (bounded).

## 13. Observability

CLI prints the PR URL, model, created/dropped counts; failures carry the
category. Existing proposal logging applies.

## 14. Acceptance criteria

- [x] A1: Reference parsing accepts the three forms and rejects others; digest building respects the 20k bound and marks truncation (unit).
- [x] A2: With a fake `gh` runner and fixed model, `ingestPullRequest` writes inferred nodes whose source `uri` is the PR URL and `label` names the PR; `gh` failure yields `SOURCE_UNAVAILABLE` with no writes (integration, PostgreSQL).
- [x] A3: The self manifest imports and passes the manifest validator (integration).
- [x] A4: Live: `npm run ingest:pr -- <self project> 2` against this repository's PR #2 creates proposals visible in the Review tab with a clickable PR link (manual, recorded in §18).

## 15. Test plan

Unit: `tests/ingestion/github-pr.test.ts` (A1). Integration:
`tests/ingestion/github-pr.integration.test.ts` (A2, A3) using `isolatedDatabase`,
a fake runner returning recorded `gh` JSON, and `fixedProposalModel`. Manual: A4.

## 16. Implementation plan

- [x] `SOURCE_UNAVAILABLE`; `source` override in `proposeContext`; unit-tested ref parsing and digest.
- [x] `fetchPullRequest` + `ingestPullRequest`; CLI; MCP tool; integration tests.
- [x] Self manifest + `import:manifest`; live A4 against PR #2; docs; commit/push.

## 17. Alternatives considered

**GitHub REST API with a token** — avoids the `gh` dependency but adds token
handling to the app; `gh` is already authenticated on the operator's machine and
keeps credentials out of this code. **Webhook-driven ingestion** — the real
long-term design, but needs a public endpoint; explicitly out of MVP scope.

## 18. Durable context created by this feature

Implemented decisions and findings:

- PR ingestion is a thin adapter over `proposeContext`: fetch → bounded digest →
  proposal. The only pipeline change is the `source` override, so every future
  text source (issues, chat exports) can reuse the same path. The source kind is
  `agent` because an LLM extracted the claims; the `https:` PR URL makes the
  evidence a clickable link in the workbench.
- `gh` is invoked with `execFile` (no shell) and the operator's existing login;
  failures map to `SOURCE_UNAVAILABLE` (502) with a coarse category derived from
  stderr. The diff is fetched separately and is optional (a diff failure still
  ingests metadata, commits, and files).
- The digest keeps metadata and the full file list and truncates only the diff
  (≤ 12k code points, marked), so the whole text stays within the proposal limit.
- `fixtures/context-graph-self.json` describes this repository (25 nodes, 31
  edges) and imports as a second project via `npm run import:manifest`; its
  source excerpts note that only the payments fixture is a "synthetic prepared
  example" (the phrase is required by the manifest validator).
- Live A4 on 2026-09-20 against `AnmolKaran/hackmit-2026#2` with
  `gemini:gemini-3.8-flash`: two accurate decisions (accept ⇒ canonical with
  confidence 1; reject ⇒ archive preserving history) and four edges to the real
  `PendingReviewList.tsx` file node and existing canonical claims, nothing dropped.
- A CLI bug found during the live run: filtering positional args with
  `index !== flagIndex + 1` drops the first argument when the flag is absent
  (`flagIndex` is -1). Fixed in both `ingest-pr.ts` and `propose.ts`.
