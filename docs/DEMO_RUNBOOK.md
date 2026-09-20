# Handoff demo — runbook

Subject repository: [Tripline](https://github.com/AnmolKaran/hackmit-demo-2026)
(project id `7b963391-57b3-52ae-bd8b-db896ffd8ddc`, same on every machine).
Design, acceptance criteria, and measured numbers: [specs/demo-tripline.md](specs/demo-tripline.md).

## 0. Setup (before you go on)

```bash
# ── Terminal A — hackmit-2026 (workbench) ──────────────────────────────
cd ~/Documents/hackmit-2026
unset DATABASE_URL TEST_DATABASE_URL          # ALWAYS: shell vars override .env (Neon)
echo "${DATABASE_URL:-ok: unset}"             # must print "ok: unset"
export PATH="$PWD/bin:$PATH"
npm run dev                                   # → http://127.0.0.1:3000

# ── Terminal B — Tripline (hof + codex) ────────────────────────────────
cd ~/Documents/hackmit-demo-2026
unset DATABASE_URL TEST_DATABASE_URL
echo "${DATABASE_URL:-ok: unset}"
export PATH="$HOME/Documents/hackmit-2026/bin:$PATH"
git checkout -- . && git status               # clean except .hof/  ← the bug must be present
npm test                                      # all pass, 2 skipped
hof status                                    # Tripline · 88 active nodes · 0 pending
hof checkout "Trip reminders fire at the wrong local time for stops in another time zone" --budget 2048 >/dev/null
                                              # warms the embedding model
codex mcp list                                # context-graph listed
```

First time on a machine: `cp .env.example .env` (Neon URL, `GEMINI_API_KEY`,
`OPERATOR_LABEL=<your name>`), `npm install`, and if `hof use Tripline` says the
project is missing, `npm run demo:tripline -- ~/Documents/hackmit-demo-2026`.

Browser: `http://127.0.0.1:3000/projects` → **Tripline** → Graph tab.
Screen: browser left, Terminal B right.

Sanity check that all three processes see the same database: the workbench lists
Tripline, `hof status` says 88 nodes, Codex "list projects via context-graph"
includes Tripline.

---

## 1. "This project knows more than an agent should read" — 45 s

**Do:** gesture at the graph. Click `notifications` (component), `reminders.ts`
(file), then the constraint _"Instants are stored as UTC; user-facing times use the
stop's IANA zone"_ → its Source → hover the GitHub link to the real ADR.

**Say:** "Tripline is a small travel service — 8 modules, 59 files. What makes it
correct isn't in any one file: five rules that cross module boundaries, two known
bugs, five architecture decisions. Every one has provenance. Eighty-eight nodes,
all reviewed."

**Terminal B:** `hof status`

## 2. One task — 45 s

**Terminal B:**

```bash
hof checkout "Trip reminders fire at the wrong local time for stops in another time zone" --budget 2048
```

**Point at** the first line: `2000 / 2048 tokens (project total 9369)` and
`selected 10 of 88`.

**Browser:** paste the same sentence in the task panel, budget 2048, Compile → the
10 nodes light up in one corner.

**Say:** "One sentence. Ten things out of eighty-eight — two thousand tokens out of
nine thousand. The reminders code, the time-zone rule, the ADR behind it, the known
bug. Nothing about pricing, providers, or auth."

## 3. Why — 45 s (the moment)

**Do:** scroll Terminal B to item **5**, or click that node in the browser:

> **A soft-deleted stop cancels everything scheduled against it**
> two hops from the bug → AFFECTS → notifications ← CONSTRAINS ← soft-delete rule

**Say:** "This rule lives in the itinerary module. The file we're about to edit
never mentions it. grep won't find it; a vector search won't find it. It's here
because of a _relationship_ — and the tool shows the exact path. Every item
explains itself."

## 4. Hand it to the agent — 90 s

**Terminal B:** `codex`, then paste:

> Call the context-graph MCP tool `compile_context` with projectId
> `7b963391-57b3-52ae-bd8b-db896ffd8ddc`, task "Trip reminders fire at the wrong
> local time for stops in another time zone", tokenBudget 2048. Read the context,
> then fix the bug in `src/notifications/reminders.ts`, un-skip the Tokyo test in
> `tests/reminders.test.ts`, and run `npm test`.

**Narrate:** tool call appears → it reads the rule → edits `reminders.ts` to use
`stop.timezone` via `timezone.ts` → tests green.

**Say:** "The agent asked for exactly what it needed, over MCP. It used the stop's
zone — not the traveller's home zone, which is the obvious wrong fix — because the
rule told it to."

Fallback if MCP hiccups (same result, one command):

```bash
codex exec "$(hof checkout 'Trip reminders fire at the wrong local time for stops in another time zone' --budget 2048 2>/dev/null)

Task: fix the bug above in src/notifications/reminders.ts, un-skip the Tokyo test in tests/reminders.test.ts, run npm test."
```

## 5. Understanding is versioned — 90 s

**Say:** "The code changed. The graph still says the bug exists — the team's
understanding hasn't caught up. Let's close the loop."

**Terminal B** (exit Codex first):

```bash
hof ingest pr https://github.com/AnmolKaran/hackmit-demo-2026/pull/10
hof pending                                    # inferred proposals: an agent's claim, not truth yet
hof accept <id> --note "Verified against ADR-001"
hof log <id>                                   # v1 inferred (agent) → v2 canonical (you)
hof diff <id> 1 2
```

**Browser:** Review tab shows the proposal before accept; History on the node shows
v1 → v2 after.

**Say:** "Agents propose. Humans accept. Every version is kept, with who and why.
Git manages versions of code — this manages versions of what the team knows."

Fallback if Gemini is throttled:

```bash
echo "Applies to scheduled reminders too — see PR #10." | hof edit constraint.utc-storage-stop-zone-display -m "Clarify reminders" --evidence "PR #10" --content -
```

---

## Reset between runs

```bash
cd ~/Documents/hackmit-demo-2026 && git checkout -- . && git clean -fd -e .hof
```

Beat 5's writes stay in the database (revisions are immutable); re-running ingest
creates fresh proposals. For a pristine graph, rehearse against local Docker and do
Neon once.

## Don'ts

- Don't say "10×" — the measured ratio is ~4.7×. The story is precision, not compression.
- Don't put the word "bookings" in a task sentence (it becomes an explicit
  reference to the Bookings component). Backup task: _"Fix the hotel adapter
  creating duplicate reservations on retry after a provider timeout."_
- Don't launch `codex` or `npm run dev` from a terminal that hasn't run the `unset`.
- Don't merge PR #10 in the Tripline repository.
