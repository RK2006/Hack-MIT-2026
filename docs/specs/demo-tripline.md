# Feature Spec — Demo Project: Tripline

Status: Draft
Owner: Project team
Related issue/task: Hackathon demo preparation; uses [repository scan](repository-scan.md), [prepared project ingestion](prepared-project-ingestion.md), [GitHub PR ingestion](github-pr-ingestion.md), [agent context proposals](agent-context-proposals.md), [`hof` CLI](hof-cli.md), [compiler](task-context-compiler.md); demo criteria from [project spec](../PROJECT_SPEC.md) §14
Last updated: 2026-09-20

---

## 1. Summary

Replace the synthetic payments fixture as the headline demo with a small, real,
purpose-built travel-planning service called **Tripline** that lives in its own
GitHub repository under the team's account. Tripline is sized so a judge can hold
the whole system in their head (≈8 components, 45–70 source files) while carrying
genuinely cross-cutting rules (time zones, money, booking idempotency, provider
caching, soft deletion) whose *definition* lives in a different component than the
*file an engineer would edit*. The context graph is built from Tripline with the
existing tooling: `hof scan` for structure, a committed hand-curated claims fixture
merged into the scan manifest for the reviewed knowledge layer, and `hof ingest pr`
for live inferred proposals. The demo spine is CLI/MCP-first: one task, the
compiled context, its explanations, an agent doing the task with vs. without it,
and the knowledge loop closing with a reviewed revision.

## 2. Problem

The current demo data is a hand-written *synthetic* payments project with 10
components, 7 files, and 12 claims. Selecting 6 of ~30 nodes proves nothing to an
audience; "synthetic" undercuts the durable-knowledge thesis; and the demo stops at
"copy this text", leaving the payoff (an agent doing better) to the imagination. A
prior hackathon demo of a similar idea was unclear for exactly these reasons.

A recognisable large repository (Excalidraw, 868 nodes) was measured and rejected:
nobody in the room can verify whether the selection was right, and the graph view
becomes a hairball. A toy (calculator) was rejected: no relationships, nothing to
leave out. The demo needs a project that is *legible* and still *too big to read*.

## 3. Goals

- A real repository, with real commits and pull requests, that the audience
  understands in one screen.
- Every claim in the graph is verifiable against Tripline's code, ADRs, or PRs.
- The "too much" side is measured in tokens (`metrics.projectContextTokens`), the
  "just enough" side in a ≤ 2,048-token compiled bundle; both are real numbers.
- At least one demo task where the naive fix is plausible-but-wrong and the
  compiled context contains the rule that makes it right, two graph hops from the
  edited file.
- The whole demo database is rebuildable from scratch with one command.
- The five-beat demo is rehearsed and timed under 6 minutes.

## 4. Non-goals

- Tripline is not a product; no deployment, real provider APIs, payments, or auth
  beyond a stub session.
- No changes to the compiler's scoring, the store schema, or the workbench design
  for this feature. If the demo exposes a defect, it is fixed under the owning spec.
- No "re-scan/update existing project" capability; the demo project is rebuilt.
- The synthetic payments fixture is not deleted; it remains for tests.

## 5. User experience

### 5.1 Demo script (five beats)

Setup on screen: terminal (left), workbench in a browser (right) open on the
Tripline project graph, `hof use Tripline` already run, `.env` pointing at the demo
database with `OPERATOR_LABEL` set.

1. **The project is bigger than an agent should read.** `hof status` shows node,
   relationship, canonical/inferred counts. Workbench shows the graph (≈70–90
   nodes). Say the measured project-context token count aloud (printed by
   `hof checkout` on stderr as `project context: N tokens`).
2. **One task, one sentence.** `hof checkout "Trip reminders fire at the wrong local time for stops in another time zone" --budget 2048`.
   Stderr lists the ranked selection with reasons; stdout is the bundle. The
   workbench highlights the same selection. Point out: the reminders scheduler
   file (semantic seed), the itinerary time-zone module and the *constraint* "all
   instants stored UTC; user-facing times use the stop's IANA zone" (graph
   neighbours, two hops), the ADR that decided it, and the soft-delete constraint.
   Pricing, providers, auth, FX are absent.
3. **Why.** Click one selected node in the workbench (or read the stderr reason):
   "included because `notifications/reminders.ts` IMPLEMENTS Reminders, which
   REQUIRES Time-zone handling". Show its source evidence (the ADR file / PR URL).
4. **The agent does the task.** In the Tripline checkout:
   `claude -p "$(hof checkout '<task>')  Fix it in src/notifications/reminders.ts"`
   (or the same over MCP from Codex). The agent uses the stop's zone. Optionally
   show the naive run first: without context the agent converts to the *user's*
   home zone — plausible and wrong.
5. **Understanding is versioned.** `hof ingest pr <tripline PR that fixed it>` →
   `hof pending` shows inferred proposals with the PR as evidence → `hof accept`
   one (or edit the constraint to mention reminders) → `hof log` / `hof diff` shows
   v1 → v2 with operator provenance → `hof checkout` again cites v2.

Backup task (if beat 4 misbehaves): "Hotel bookings are duplicated when the
provider times out" — idempotency rule lives in `providers/`, edit is in
`bookings/`.

### 5.2 Operator rebuild flow

1. Clone Tripline; `npm run demo:tripline -- /path/to/tripline` in this repo.
2. The script scans the checkout to a manifest, merges
   `fixtures/tripline-claims.json`, imports the result as a new project, and prints
   the project id and counts. Repeat import is a conflict, as for any manifest.
3. `hof use Tripline` in the Tripline checkout (or `-p`), then rehearse §5.1.

## 6. Functional requirements

### 6.1 Tripline application (separate repository)

- [ ] T1: Public GitHub repository `tripline` under the team account; TypeScript,
      Node 20+, npm, single package (no monorepo). Express + `better-sqlite3`,
      Vitest, ESLint, Prettier. `npm test`, `npm run typecheck`, `npm run dev`
      work from a fresh clone with no external credentials.
- [ ] T2: Directory layout (each `src/*` directory becomes a component under
      `hof scan --depth 2`):

      ```
      src/
        server.ts                 # express wiring, error handler
        db/        schema.sql, client.ts, migrate.ts, seed.ts
        auth/      session.ts, middleware.ts          # stub bearer-token sessions
        trips/     routes.ts, service.ts, types.ts    # trip = traveller + home tz + currency
        itinerary/ routes.ts, service.ts, timezone.ts, types.ts
                   # stops with IANA zone; instants stored UTC
        pricing/   money.ts, quote.ts, fx.ts          # minor units; FX locked at quote
        providers/ flights.ts, hotels.ts, cache.ts, rateLimit.ts, retry.ts,
                   fake/flightsFake.ts, fake/hotelsFake.ts   # in-process, deterministic
        bookings/  routes.ts, service.ts, idempotency.ts, types.ts
        notifications/ reminders.ts, scheduler.ts, email.ts # console "email" sink
      tests/       one file per module above (≥ 12 test files)
      docs/adr/    ADR-001 … ADR-005 (see T4)
      README.md, CONTRIBUTING.md
      ```

      Target 45–70 tracked source files; the scan must import without
      `--max-files`/`--include` and yield 8–10 components.
- [ ] T3: Cross-cutting rules, each implemented where stated and consumed
      elsewhere:

      | Rule | Defined in | Bites in |
      | --- | --- | --- |
      | All instants stored as UTC ISO strings; user-facing times rendered and scheduled in the **stop's** IANA zone (`stop.timezone`), never the traveller's home zone | `itinerary/timezone.ts`, ADR-001 | `notifications/reminders.ts` |
      | Money is `{ amountMinor: integer, currency }`; FX rate is captured on the quote (`quote.fxRate`, `quote.quotedAt`) and never re-applied at display or booking time | `pricing/money.ts`, `pricing/quote.ts`, ADR-002 | `bookings/service.ts` |
      | Provider calls are retried (max 3, jittered backoff) and **must** pass the client-generated `bookingRef` as the provider idempotency key; adapters treat a repeated ref as the same reservation | `providers/retry.ts`, `bookings/idempotency.ts`, ADR-003 | `providers/hotels.ts` |
      | Provider search results are cached 10 minutes keyed by `(origin, destination, date, currency)` — currency included because quotes are currency-specific | `providers/cache.ts`, ADR-004 | `pricing/quote.ts` |
      | Itinerary stops are soft-deleted (`deletedAt`); dependent reminders for a deleted stop must be cancelled, not fired | `itinerary/service.ts`, ADR-005 | `notifications/scheduler.ts` |

- [ ] T4: `docs/adr/ADR-00N-*.md` for each rule: context, decision, consequences,
      and the file paths that implement/consume it. These are the primary material
      for `hof ingest docs` and for the curated claims' evidence.
- [ ] T5: Planted primary bug, introduced by a *realistic* PR (see T7):
      `notifications/reminders.ts` computes the reminder instant from the
      traveller's home zone (`trip.homeTimezone`) instead of `stop.timezone`. A
      test in `tests/reminders.test.ts` for a stop in a different zone is present
      but marked `it.skip` with a TODO referencing the issue, so `npm test` passes
      on `main`. The correct fix uses `itinerary/timezone.ts`'s `toZoned(stopInstant, stop.timezone)`.
- [ ] T6: Planted backup bug: `providers/hotels.ts` builds a fresh provider
      request id per retry attempt instead of forwarding `bookingRef`, so a timeout
      followed by a successful retry creates two reservations in the fake provider.
      Same skipped-test convention.
- [ ] T7: Git history of 12–20 commits and 6–8 merged pull requests whose titles
      and bodies read like a real team's (motivation, approach, follow-ups). At
      minimum:
      1. Scaffold: server, db, auth stub, trips.
      2. Itinerary stops with IANA zones (introduces ADR-001).
      3. Pricing and quotes with locked FX (ADR-002).
      4. Provider adapters, retry, cache (ADR-003, ADR-004).
      5. Bookings with idempotency keys.
      6. Trip reminders (introduces the T5 bug; body says "uses the traveller's
         home zone for now").
      7. Soft-delete stops and cancel reminders (ADR-005).
      8. Fix: reminders use the stop's zone — **opened but not merged** before the
         demo (or merged on a branch not yet ingested), so beat 5 has a live PR
         to ingest.
- [ ] T8: `README.md` describes the domain in ≤ 15 lines with a component
      diagram in text; `CONTRIBUTING.md` lists the five rules as a checklist for
      reviewers (this is what `hof ingest docs` will turn into proposals).

### 6.2 Demo pipeline (this repository)

- [ ] D1: `fixtures/tripline-claims.json`: a partial manifest (`sources`,
      `claims`, `edges` only) with 12–20 canonical claims — the five rules as
      `constraint`/`decision` nodes, one `bug` (T5) and one `bug` (T6) recorded as
      *canonical* known issues, and 3–5 `assumption`/`discovery` nodes — each with a
      `manual` source whose `uri` is the GitHub URL of the ADR, PR, or file that
      supports it, and an `excerpt` quoting it. Edges use scan keys
      (`component.src-notifications`, `file.src-notifications-reminders-ts`, …) and
      the foundation's stored directions (e.g. `component.src-notifications REQUIRES constraint.utc-storage-stop-zone-display`, `file.src-notifications-reminders-ts IMPLEMENTS component.src-notifications`, `bug.reminders-home-zone AFFECTS component.src-notifications`, `bug.reminders-home-zone CAUSED_BY constraint.…`).
- [ ] D2: `scripts/demo-tripline.ts` (npm script `demo:tripline -- <checkout>`):
      runs `scanRepository(checkout, { name: 'Tripline', depth: 2 })`, merges the
      claims fixture (append sources/claims/edges; fail with `VALIDATION_ERROR`
      listing any `fromKey`/`toKey`/`sourceKey` absent from the merged manifest),
      writes the merged manifest to `--out` if given, otherwise imports it with
      `importPreparedProject` and prints project id and counts. Reuses existing
      functions; no new store or ingestion behaviour.
- [ ] D3: `hof checkout` prints `project context: N tokens (measured, cl100k_base)`
      on stderr alongside the existing selection summary, so beat 1 has a spoken
      number without opening the JSON. (Small addition to the CLI; recorded in
      [hof-cli.md](hof-cli.md) §18 when done.)
- [ ] D4: `README.md` gains a "Demo: Tripline" section replacing the payments
      walkthrough as the headline; the payments fixture stays documented as the
      test fixture.
- [ ] D5: A rehearsal checklist (§15) is executed on the real UI/CLI and its
      results recorded in §18.

## 7. Data model

### New entities

None in this repository. Tripline's own SQLite schema is internal to Tripline.

### Changed entities

None. The demo project uses existing node/edge/source types.

### Migration considerations

None.

## 8. API / interface changes

### `npm run demo:tripline -- <checkout> [--out file.json]`

Wraps `scanRepository` → merge → `importPreparedProject`. Stdout (human):
`Imported "Tripline" (<uuid>): C components, F files, K claims, E edges`. `--json`
not required. Errors: `SOURCE_UNAVAILABLE` (not a git work tree),
`VALIDATION_ERROR` (unresolved keys in the claims fixture, with the missing keys
listed), `CONFLICT` (project already imported; the message says to drop or rename).

### `fixtures/tripline-claims.json`

Same field types as the manifest schema (`manifest.ts`) restricted to `sources`,
`claims`, `edges`. `schemaVersion: 1`. Keys follow `^[a-z][a-z0-9._-]{0,79}$`.
Claim `changeReason` is e.g. `"Curated from ADR-001 for the demo project"`.

### `hof checkout` stderr

Adds one line after the selection: `project context: <projectContextTokens> tokens · bundle: <tokenCount>/<tokenBudget>`.
Stdout is unchanged (exact `contextText`).

## 9. Context graph implications

- Node types created: `component`, `file` (scan, canonical, repository source);
  `constraint`, `decision`, `bug`, `assumption`, `discovery` (fixture, canonical,
  manual sources with GitHub URLs); inferred claims from `hof ingest pr`/`docs`.
- Edge types: `CONTAINS` (scan); `IMPLEMENTS`, `REQUIRES`, `CONSTRAINS`,
  `AFFECTS`, `CAUSED_BY`, `DEPENDS_ON`, `RELATED_TO` (fixture); inferred edges from
  ingestion.
- Durable context: yes — the fixture is the reviewed knowledge of a real repo.
- Provenance: every fixture source URI is a resolvable GitHub URL; excerpts quote
  the ADR/PR. Curated claims are canonical because a human wrote them from the
  evidence; this matches the foundation rule (manual source ⇒ canonical).
- Revision history: beat 5 creates v2 of a claim with operator attribution.
- Retrieval/ranking/compilation: unchanged code; this feature is an evaluation of
  them on a real graph. If the expected selection (§14 A3) is not produced, the
  defect is filed against the compiler spec, not tuned here.

## 10. Retrieval behavior

- Seed discovery: the task sentence should embed nearest to
  `file.src-notifications-reminders-ts`, `component.src-notifications`, the
  time-zone constraint, and `bug.reminders-home-zone`.
- Graph traversal (depth 2): reminders file → IMPLEMENTS → Notifications →
  REQUIRES → time-zone constraint → (CAUSED_BY reverse) bug; constraint →
  RELATED_TO → ADR-001 decision; Notifications → DEPENDS_ON → Itinerary →
  CONTAINS → `timezone.ts`; soft-delete constraint via CONSTRAINS Notifications.
- Ranking: canonical constraints/decision above the inferred proposals; pricing,
  providers, auth should not appear at depth 2 from these seeds.
- Compression: at 2,048 tokens the constraint, decision, bug, and reminders file
  should be `full`; itinerary files may be `summary`/`title`.
- Explainability: each reason names the path; beat 3 reads one aloud.

## 11. Edge cases

- Scan yields fewer than 8 components or more than 70 files → adjust Tripline's
  tree (T2), not the scanner's flags; the point is that defaults work.
- Fixture references a key that the scan renamed (e.g. slug truncation at 60
  chars) → D2 fails fast listing the key; keep paths short.
- Demo database already contains a Tripline project → `CONFLICT`; the runbook
  says to create a fresh database/schema rather than delete anything.
- LLM key missing or throttled during beat 5 → fall back to `hof edit` of the
  constraint (adds "…including scheduled reminders") to produce v2; `hof ingest pr`
  is shown only if the key is live in rehearsal. `PROPOSAL_MODEL` fallback list
  configured.
- Local embedding model not yet downloaded on the demo machine → run one
  `hof checkout` in rehearsal; never on stage for the first time.
- Agent (beat 4) produces the naive fix even with context → switch to the backup
  task (T6) in rehearsal; the primary task is chosen only if it reliably flips.
- Compiled bundle over budget or omitting a critical node → recorded as a compiler
  finding; demo uses the largest budget that keeps the contrast visible.

## 12. Security / privacy considerations

Tripline contains no secrets, real personal data, or live provider credentials;
fake providers are in-process. Evidence URIs are public GitHub URLs. The shared
demo database follows the README's guidance (private connection string,
`OPERATOR_LABEL` for attribution, no authentication).

## 13. Observability

- D2 prints counts and the project id; `hof status` confirms them.
- `hof checkout` stderr lists seeds, selection with reasons, omissions, and the
  new token line; `--json` gives the full `ContextBundle` for post-mortem.
- Compiler stage logs (`similarity`, `retrieval`) already exist via `CompilerDeps.log`.
- Rehearsal results (selected node list, token counts, agent outcome with/without
  context) are recorded in §18 with the Tripline commit hash used.

## 14. Acceptance criteria

- [ ] A1: From a fresh Tripline clone, `npm run demo:tripline -- <checkout>`
      succeeds with defaults and reports 8–10 components, 45–70 files, all fixture
      claims and edges; `hof status` shows 0 pending, all canonical.
- [ ] A2: `hof checkout` on the Tripline project prints a measured
      `project context` token count ≥ 10× the compiled `tokenCount` at budget 2,048.
- [ ] A3: `hof checkout "<primary task>" --budget 2048 --json` selects
      `file.src-notifications-reminders-ts`, `component.src-notifications`, the
      UTC/stop-zone constraint, ADR-001 decision, and `bug.reminders-home-zone`;
      it selects no node under `component.src-pricing`, `component.src-providers`,
      or `component.src-auth`; status is `ok` (semantic).
- [ ] A4: Every selected item in A3 has ≥ 1 reason; the constraint's reason is a
      `graph_neighbor` path of length ≤ 2 from a seed.
- [ ] A5: With the A3 bundle prepended, a coding agent (Claude Code or Codex)
      edits `src/notifications/reminders.ts` to use `stop.timezone` via
      `itinerary/timezone.ts`, and un-skipping the T5 test passes. Without the
      bundle, in ≥ 2 of 3 rehearsal runs the agent does something else (uses
      `trip.homeTimezone`, asks a question, or edits elsewhere). Outcomes recorded.
- [ ] A6: `hof ingest pr <fix PR>` (with a live key) creates ≥ 1 inferred proposal
      whose evidence URI is the PR; `hof accept` produces v2 with operator
      attribution; `hof diff <ref> 1 2` shows the change; a subsequent
      `hof checkout` cites version 2. Fallback via `hof edit` documented and tested.
- [ ] A7: The workbench renders the Tripline graph and highlights the A3 selection
      legibly at the demo viewport; node titles are readable without zooming.
- [ ] A8: Full five-beat run rehearsed end-to-end in ≤ 6 minutes, twice, on the
      demo machine, with the rebuild (A1) performed first.

## 15. Test plan

### Unit tests

- `tests/demo/merge-manifest.test.ts`: merging the fixture into a scan manifest
  appends sources/claims/edges; an unresolved key fails with `VALIDATION_ERROR`
  listing it; output validates with `parseManifestBytes`.
- `tests/cli/format.test.ts` (extend): `hof checkout` stderr includes the
  `project context` line with the bundle's numbers.
- Fixture lint: `fixtures/tripline-claims.json` parses; every source `uri` is
  `https://github.com/<account>/tripline/…`; every claim has a source; keys are
  unique.

### Integration tests

- `tests/demo/tripline.integration.test.ts` (skipped unless `TRIPLINE_PATH` is
  set): scan + merge + import against the test database; asserts A1 counts and
  that A3's expected node keys exist. Compiler expectations (A3/A4) run here with
  the local provider when `TRIPLINE_PATH` is set — they are the semantic gate for
  the demo, analogous to `semantic:smoke`.

### UI/manual verification

- A5, A6 (live key path), A7, A8 are manual; record each in §18 with date,
  Tripline commit, and outcome. The naive-vs-context agent runs are captured as
  short transcripts kept out of the repo (or as a gist link).

## 16. Implementation plan

Tripline (separate repo; can be built in parallel with D1–D3 once T2's layout and
T3's rule table are fixed, since the fixture keys derive from the paths):

- [ ] T1–T2: scaffold repo, layout, tooling, tests green.
- [ ] T3–T4: implement the five rules and ADRs; tests for each rule.
- [ ] T5–T6: introduce the planted bugs via their PRs with skipped tests.
- [ ] T7–T8: shape the PR history; write README/CONTRIBUTING; open the fix PR.

This repository:

- [ ] D1: write `fixtures/tripline-claims.json` from the ADRs/PRs (real URLs).
- [ ] D2: `scripts/demo-tripline.ts` + npm script + unit test.
- [ ] D3: `hof checkout` project-context token line + test.
- [ ] Integration test gated on `TRIPLINE_PATH`; run it; adjust fixture edges
      until A3/A4 pass (adjusting the *graph*, never the compiler).
- [ ] D4: README demo section.
- [ ] Rehearse A5 with both agents; choose primary/backup task; record results.
- [ ] Rehearse A6 with a live key and the `hof edit` fallback.
- [ ] A7 check in the workbench; file any rendering defect against
      graph-workbench.md.
- [ ] A8 two timed full runs; update §18; commit and push.

## 17. Alternatives considered

### Option A — Scan a large well-known OSS repository (Excalidraw)

Pros: instant recognition; real PR stream; "not our code" credibility; it is the
only measured candidate (of Excalidraw, Dub, Umami, Papermark, OpenStatus,
Documenso) that fits the 1,000-node bound whole (843 files → 868 nodes).

Cons: nobody can verify a selection against a codebase they cannot hold in their
head; 868-node SVG becomes a hairball; the knowledge layer would be LLM proposals
over docs we cannot fully vet; the demo asks for trust rather than showing proof.

### Option B — Tiny app (calculator, to-do)

Pros: trivially legible; minutes to build.

Cons: one component and no cross-cutting rules; the compiler would select nearly
everything; no "constraint lives elsewhere" moment; nothing meaningful to version.

### Option C — Existing small OSS travel planner

Pros: not written by us.

Cons: surveyed candidates are tutorials without design decisions or PR discussion
to ingest; rules would have to be invented, which is less honest than authoring a
repo whose rules are real.

### Option D — Knowledge layer entirely via `hof note`

Pros: no new script.

Cons: `hof note` creates one edge per node; the demo graph needs several edges per
claim; a chain of 40 CLI calls is not a reproducible one-command rebuild.

### Chosen approach

Build Tripline (this spec) and layer knowledge as: scan (canonical structure) +
committed curated claims fixture merged into the manifest (canonical, evidenced)
+ live PR/doc ingestion (inferred, reviewed on stage). This keeps every beat
verifiable by the audience and every rebuild deterministic.

## 18. Durable context created by this feature

To be filled after implementation and rehearsal:

- Tripline repository URL and the commit hash used for the demo.
- Final primary/backup demo task sentences and the measured token numbers.
- Recorded A5 outcomes (with/without context, per agent).
- Any compiler or workbench findings filed against their specs.
- Known limitations of the demo pipeline (e.g. rebuild requires a fresh database).
