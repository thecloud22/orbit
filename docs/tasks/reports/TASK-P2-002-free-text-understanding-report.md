# Phase 2 Task 2 Report — Free-Text SOP Understanding (sub-phase 2.2)

**Status:** Complete, pending commit approval

**Branch:** `phase-2-task-2-free-text-understanding`

**Scope:** Sub-phase 2.2 only. No review UI, no step editor, no reorder controls, no
clarification-answer workflow, no approval, no Agent IR, no execution.

## Goal

Turn free-form SOP text into a persisted draft SOP Graph revision: call a model, validate what
comes back with the validator sub-phase 2.1 already built, repair once against the real issues,
and persist only if valid.

The order Task 1 established is the whole point. Model output is untrusted input, and it reaches
the database through `parseSopGraphDocument` and nothing else. This task wrote no new validation.

## What this task creates, and what it deliberately does not

It creates a way to *get* a draft. It creates no way to review, edit, reorder, answer, approve, or
run one — those are sub-phase 2.3 and beyond. The reorder logic Task 1 built is untouched and
unexposed. No Agent IR, no Playwright, no evidence, no schema change, no migration.

## The boundary

This task legitimately calls the network, which sub-phase 2.1 never did. That is a real change and
it deserved a precise statement of what did *not* change: **no code path ever contacts a URL that
appears inside a graph.** `urlHint` and `systemHint` are carried into storage and back out to the
UI as text, and are never fetched, navigated, probed, or resolved (ADR-016).

| # | Guard | Result |
|---|---|---|
| 1 | **One file reaches the network** — a test asserts `@langchain/` is imported by exactly `anthropic-provider.ts` | Passing |
| 2 | **Static scan** — every production source in both new packages, asserting no `chromium`, `playwright`, `page.`, `XMLHttpRequest`, `child_process`, `node:net/http/dns`, `node:fs` | Passing |
| 3 | **No `fetch(` anywhere** in either package's own source | Passing |
| 4 | **Runtime proof** — global `fetch` replaced with a throwing spy, then a graph full of `urlHint` values is generated, validated and **persisted to PostgreSQL**. Zero calls | Passing |
| 5 | **ESLint** — `@orbit/db`, the applications, and `node:net/http/https/dns` rejected in `@orbit/sop-generation` | `pnpm lint` clean |

Guard 4 covers the full path including persistence, not just generation, because "nothing fetched
it" has to hold all the way to the row.

## Packages

Two, following the `@orbit/artifacts` → `@orbit/artifact-service` arrangement: neither of the two
existing packages may import the other, and the composition that needs both lives in a third.

**`@orbit/sop-generation`** — the model boundary, the prompt, the pipeline. Dependencies:
`@orbit/sop-graph`, Zod, and the two LangChain packages. It cannot reach persistence.

| Module | Contents |
|---|---|
| `provider.ts` | `LLMProvider`, `SopProviderError`, and the unconfigured null provider |
| `proposal.ts` | `sopGraphSchema` minus `schemaVersion` |
| `prompt.ts` | System prompt, repair message, `SOP_GENERATION_PROMPT_VERSION` |
| `generate.ts` | Assemble, validate, repair once, three-case result |
| `anthropic-provider.ts` | The only file that imports LangChain |
| `testing/` | The deterministic fake provider and its proposals |

**`@orbit/sop-service`** — generation composed with persistence. The only package depending on
both.

### The provider interface

Failure travels by exception, not a second return channel: one condition with two ways to express
it invites a caller to handle one and forget the other.

LangChain is used at the model layer only — `ChatAnthropic` plus `.withStructuredOutput`. No agent,
no chain, no memory, no retrieval, no graph. `includeRaw` is set deliberately so an invalid
proposal comes back as **data** rather than a thrown error; otherwise every schema slip would look
like an outage and no repair would ever be attempted.

`schemaVersion` is omitted from the bound schema because it states which contract a document
claims to satisfy, and that claim is the codebase's to make. A version a model volunteers anyway is
overwritten rather than merged, and a test asserts it.

Default model is `claude-sonnet-5`, overridable by `ORBIT_LLM_MODEL`. A missing `ANTHROPIC_API_KEY`
does not stop the API booting: an unconfigured null provider fails the one route that needs a
model, rather than taking every unrelated evidence route down with it.

### The three outcomes

```ts
| { ok: true;  graph; generation }
| { ok: false; reason: 'invalid_after_repair'; issues; attempts: 2 }
| { ok: false; reason: 'provider_error'; message }
```

A model that produced an unusable graph and a provider that could not be reached are different
events deserving different responses, and collapsing them into "it didn't work" would lose that.
An error that is *not* a declared provider failure propagates rather than being converted — a
defect in this process must not hide behind a message about the model.

## Persistence: the §3 investigation, resolved

**No change to `packages/db` was needed — not even the additive function the brief authorised.**

`Executor` is already `OrbitDatabase | OrbitTransaction`, both SOP repositories are built over it,
and `@orbit/db` already exports `withTransaction(db, work)` handing back an `OrbitRepositories`
scoped to one transaction.

One subtlety was not assumed away. `sopGraphRevisions.create` opens a transaction of its own;
inside an outer one that must become a `SAVEPOINT` rather than a second connection-level
transaction, or a revision could commit independently and an outer rollback would leave a revision
without its document. **A test asserts the behaviour**: an outer transaction that creates a
document, creates a revision, and then throws leaves both tables empty.

Generation runs **before** any transaction is opened. A model call takes seconds and may retry;
holding a transaction across it would pin a connection and keep locks for the whole of it.

### One design decision worth flagging

The brief allowed "optionally an existing `documentId` to add a revision to". Source text has no
update path (ADR-016), so accepting *new* text for an *existing* document would be an edit in
disguise and would quietly make "what did the user originally write?" unanswerable. A new revision
therefore regenerates from the text the document already holds, and the input type is a union, so
the confused case is unrepresentable rather than rejected after the fact. The route returns 400 if
both are sent.

## The test-only API bootstrap

The end-to-end stack launches the API as a child process, so the only thing crossing the boundary
is an environment — there was no injection seam at all. The tempting fix, an
`ORBIT_SOP_PROVIDER=fake` branch inside `index.ts`, was rejected on review as a live path to a test
double in a real deployment, gated by a variable someone could set by accident. That objection was
correct.

Instead, `index.ts` was split:

```text
apps/api/src/bootstrap.ts             production — startApi(options), composition as a function
apps/api/src/index.ts                 production — the real provider, unconditionally
apps/api/src/testing/e2e-server.ts    test-only  — the fake, passed to the same startApi
```

Extracting `startApi` is what stops this costing coverage. Both entry points run identical
composition, routes, persistence, listen and shutdown code; the difference is one constructor
argument, so an end-to-end run still exercises the production path and substitutes only the thing
it must.

Three containment guards, all asserted:

1. **Module graph** — the fake is behind `@orbit/sop-generation/testing`; production has no import
   path to it. ESLint also rejects it outside `src/testing/` and test files.
2. **Transitive scan** — a test walks the module graph from `index.ts`, following relative imports
   to any depth, and asserts no module reaches a test-only subpath. A shallower check would miss an
   import three modules down.
3. **Refuses real data** — `e2e-server.ts` resolves its database name and aborts unless it is
   literally `orbit_test`. Verified by running it by hand:

```text
$ DATABASE_URL=…/orbit_dev pnpm --filter @orbit/api start:e2e
Refusing to start the end-to-end API against database "orbit_dev". This entry point serves a
deterministic fake model provider and must never run against anything but "orbit_test".
exit status 1
```

## API and UI

`POST /v1/sop-drafts` — `{ sourceText }` for a new document, or `{ documentId }` for a new
revision.

| Outcome | Status | Code |
|---|---|---|
| Draft created | 201 | — |
| Invalid after repair | 422 | `VALIDATION_ERROR`, every issue in `details` with its code and path |
| Unknown document | 404 | `VALIDATION_ERROR` |
| Provider failure | 500 | `INTERNAL_ERROR`, generic message |

A provider's own words never reach the wire — they can carry an endpoint, a request id, or an
account identifier. The real message is logged; the response is generic. A test asserts an account
id and an internal hostname are absent from the body.

The UI is a textarea, a button, and a result panel listing the draft's steps, inputs, assumptions,
questions and risks in plain language — never raw JSON, per the requirements document. It carries
the required notice, sent as a server field rather than hard-coded reassurance:

> Draft only — this workflow is not executable and cannot start browser automation.

An end-to-end test asserts no step editor, reorder control, JSON editor, or approve/reject control
exists.

## Defects found and fixed

1. **My own containment scan punished documenting the boundary.** The transitive scan checked
   `index.ts` as raw text for the forbidden subpath — and `index.ts`'s doc comment *names* that
   subpath while explaining that it does not import it. A guard that makes explaining the boundary
   fail is a guard that encourages leaving it unexplained. Rewritten to check parsed imports, which
   is both stricter and comment-blind.

2. **A `TRUNCATE`/live-run deadlock I exposed in a Phase 1 test.** `api.db.test.ts`'s
   duplicate-dispatch test starts two runs and never waits for them; execution continues after the
   202 (ADR-011). That was harmless only because the test was last in the file. Adding tests after
   it put a `beforeEach` truncate against two live writers, and PostgreSQL reported a genuine
   deadlock. Fixed at the cause — the test now waits for both runs — rather than by moving my tests
   elsewhere, which would have left the hazard for whoever added the next test.

3. **A test assertion of mine was wrong, not the code.** I asserted the response never echoes the
   submitted source text, using ordinary prose as the input; the fixture graph legitimately
   contains the step summary "Sign in to the portal", so the assertion tripped on a coincidence.
   The view never publishes `sourceText`. Now asserted with a marker that cannot collide.

4. **A dynamic `await import('../errors')`** in the route, left from drafting. Replaced with a
   static import.

5. **The new ESLint ban fired on a legitimate test.** `packages/sop-service`'s database test needs
   both the fake provider and the destructive test harness. Given the same treatment Task 1's
   `sop-graph` block already has: a test carve-out lifting **only** the test-double rule, with
   every boundary that keeps the service out of the applications still applying.

## Commands and exact results

| Command | Result |
|---|---|
| `pnpm install` | 19 packages added: `@langchain/anthropic@1.5.9`, `@langchain/core@1.2.9` and their transitives; lockfile passed supply-chain policy |
| `pnpm typecheck` | Pass, all 15 workspaces |
| `pnpm lint` | Pass |
| `pnpm format:check` | Pass |
| `pnpm test` | **513 passed**, 50 files |
| `pnpm db:generate` | `No schema changes, nothing to migrate` — this task adds no migration |
| `pnpm db:migrate` | Applied to `orbit_dev`; unchanged, 10 tables |
| `pnpm test:db` | **122 passed**, 11 files against `orbit_test` |
| `pnpm verify:phase1` | **Pass** — 513 unit, 122 db, 6 runtime, **15** Watchtower E2E, 9 demo portal, teardown clean |

Counts before this task were 471 unit, 109 db, 11 Watchtower E2E.

| Added | Tests |
|---|---|
| `packages/sop-generation` — pipeline, proposal schema, network boundary | 21 |
| `packages/sop-service` — persistence, transaction, savepoint atomicity (db) | 10 |
| `apps/api/src/routes/sop-drafts.test.ts` | 9 |
| `apps/api/src/sop-provider-boundary.test.ts` — the containment guard | 5 |
| `apps/web/src/sop-draft-view-model.test.ts` | 7 |
| `apps/api/src/api.db.test.ts` — route over real persistence (db) | 3 |
| `apps/web/src/watchtower.e2e.test.ts` — draft flow through the real stack | 4 |

Every one of them runs with **zero network calls**.

### Safety greps

Reported exactly, because two of the four specified forms do **not** return nothing:

```bash
$ grep -rnE "chromium|playwright|page\.|node:(net|http|https|dns)" \
    packages/sop-generation/src packages/sop-service/src --include="*.ts" | grep -v "\.test\.ts:"
(none)

$ grep -rln "@langchain/" packages/sop-generation/src --include="*.ts" | grep -v "\.test\.ts"
packages/sop-generation/src/anthropic-provider.ts

$ grep -rn "@orbit/db" packages/sop-generation/src --include="*.ts" | grep -v "\.test\.ts:"
packages/sop-generation/src/index.ts:8:      * depend on @orbit/db, on the API, …
packages/sop-generation/src/testing/fake-provider.ts:8: * … the same reason `@orbit/db/testing` …

$ grep -rn "sop-generation/testing" apps/api/src --include="*.ts" | grep -v "\.test\.ts:"
apps/api/src/index.ts:20:             * fake — that lives behind `@orbit/sop-generation/testing` …
apps/api/src/testing/e2e-server.ts:10:} from '@orbit/sop-generation/testing';
apps/api/src/testing/e2e-server.ts:30: *   1. The fake is behind `@orbit/sop-generation/testing` …
```

Every match in the last two is **prose in a doc comment**, plus the one legitimate import in the
test-only entry point. Restricted to actual imports in production code, both are empty:

```bash
$ grep -rnE "from '@orbit/db" packages/sop-generation/src --include="*.ts" | grep -v "\.test\.ts:"
$ grep -rn "from '@orbit/sop-generation/testing'" apps/api/src --include="*.ts" \
    | grep -v "\.test\.ts:" | grep -v "^apps/api/src/testing/"
```

Both empty. This is the same distinction Task 1 had to draw, and it is why guard 2 checks parsed
imports rather than raw text.

## Changed files

**Created** — `packages/sop-generation/` (package.json, tsconfig, 6 source modules, 3 test files,
`testing/{fake-provider,proposals,index}.ts`), `packages/sop-service/` (package.json, tsconfig,
`draft-service.ts`, `index.ts`, `draft-service.db.test.ts`), `apps/api/src/bootstrap.ts`,
`apps/api/src/routes/sop-drafts.ts` + test, `apps/api/src/sop-provider-boundary.test.ts`,
`apps/api/src/testing/e2e-server.ts`, `apps/web/src/{SopDraftForm.tsx,SopDraftPanel.tsx,sop-draft-view-model.ts}`
+ test, and this report.

**Modified** — `apps/api/src/{index,context,server,views,projections}.ts`,
`apps/api/src/testing/{stub-context,stack-global-setup}.ts`, `apps/api/src/api.db.test.ts`,
`apps/api/package.json`, `apps/web/src/{App.tsx,api-client.ts,watchtower.e2e.test.ts}`,
`eslint.config.js`, `.env.example`, `README.md`, `docs/tasks/ACTIVE_TASK.md`, `pnpm-lock.yaml`.

**Untouched** — `@orbit/sop-graph` (this task is a consumer, not a contributor), every Phase 1
package, **every database table and migration**, `fixtures/`, and all Phase 1 runtime, evidence and
Watchtower behaviour.

**Dependencies:** `@langchain/anthropic@^1.5.9` and `@langchain/core@^1.2.9`, in
`@orbit/sop-generation` only.

## Known limitations

- **The real provider path has no automated test.** Every test uses the fake, by design — nothing
  here calls Anthropic. The gap that leaves is the Zod-to-JSON-Schema conversion
  `withStructuredOutput` performs, whose only symptom would be a live-API failure. A unit test
  converts the proposal schema explicitly to catch that much without a network call; the request
  and response handling around it is still unexercised.
- **One repair attempt, no budget beyond it.** No multi-provider fallback, no rate-limit or cost
  handling, no streaming. Flagged as later concerns per the brief, not solved.
- **No `NOT_FOUND` or provider-failure code in the error taxonomy**, so 404 and 502-class outcomes
  reuse `VALIDATION_ERROR` and `INTERNAL_ERROR`. This is the Phase 1-era gap; widening
  `@orbit/contracts` was deferred deliberately.
- **A generated draft cannot be revised toward a target.** Regeneration reruns the same source text
  and produces a fresh graph; incorporating a reviewer's answers is sub-phase 2.3.
- **`clarificationQuestions` are generated but unanswerable.** The UI says so rather than showing
  an inert form.
- **The prompt is unversioned in the sense that matters.** `SOP_GENERATION_PROMPT_VERSION` is
  recorded in provenance, but nothing enforces bumping it when the text changes.
- **No concurrency control on a document.** Two simultaneous regenerations of one document would
  both read the same current revision and race on `revision_number`; the unique constraint makes
  one fail rather than corrupt, but nothing coordinates them.

## For sub-phase 2.3

`SopDraftView` is deliberately read-only and lossy — it renders a draft, and cannot round-trip one.
The review UI will need the graph itself, and the natural place is a `GET` route beside this one
rather than widening this response.

`validateReorder` and `applyReorder` are already built, tested, and produce plain-language
explanations; 2.3 exposes them rather than writing them. Every user edit must go back through
`parseSopGraphDocument` before it is saved — a human edit is no more trusted than a model's, and
`SopGraphRevisionRepository.create` already refuses anything that fails it.
