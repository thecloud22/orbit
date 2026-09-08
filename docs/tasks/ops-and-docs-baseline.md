# Operations and Documentation Baseline

**Status:** Working baseline for the `docs/wiki-and-readme` → `chore/docs-operational-polish` task
sequence. Not an architecture document — `docs/architecture/decisions.md` and
`docs/architecture/phase-1-system-design.md` remain authoritative for design.

**Method:** Every statement below was read out of the repository at `7806d9c` — package manifests,
route files, migrations, Vite configs, test configs, and `.env.example`. Nothing here is inferred
from a document that describes intent.

---

## 1. What Orbit implements today

Phase 1 is complete and Phase 2 sub-phases 2.1–2.14 have landed (`docs/tasks/ACTIVE_TASK.md`,
corroborated by 20 packages, 6 apps, and migrations `0000`–`0010`). The working loop is:

```text
free text or a recorded demonstration
  -> SOP Graph revision (immutable, checksummed)
  -> Execution Bindings per step (demonstrated, approved)
  -> candidate Agent IR (compiled, refused when not fully understood)
  -> published Agent Version (immutable)
  -> run in real Chromium
  -> events, artifacts, evidence
  -> Watchtower
```

Beyond Phase 1's deterministic core, four capabilities exist and each is bounded:

| Capability | Where | Bound |
|---|---|---|
| SOP drafting from free text | `@orbit/sop-generation` | Output re-parsed through `parseSopGraphDocument` before persistence |
| Judged decision at run time | `@orbit/decision-judge`, `model.decide` | Returns an index into a closed branch list; five typed halt reasons (ADR-032) |
| Authoring advice while recording | `@orbit/execution-assist` | Suggestion only; a person demonstrates |
| Recovery from UI drift | `@orbit/drift-recovery` | Deterministic, no model; writes a proposal (ADR-033) |

The drift-recovery model, as implemented and not to be restated any other way: a drifted run
**fails** and is never resumed; a repair is suggested **only** from the approved binding's existing
fallback locator chain; the page is **never** scanned for unapproved lookalikes; a proposal is a
**separate record** from a binding (`binding_recovery_proposals`); a human accepts it through the
ordinary create → submitForReview → approve path; **acceptance does not publish**; the diagnosis is
**deterministic with no model call** (`diagnoseDrift` is synchronous); and the capability is
**granted per document** through `permissions.recovery`.

## 2. Topology

**Apps (6):** `api`, `browser-worker`, `web` (Watchtower + Studio), `demo-portal`,
`library-portal`, `recorder` (CLI only, no `dev` script).

**Packages (20):** `contracts`, `agent-ir`, `agent-ir-compiler`, `sop-graph`, `sop-generation`,
`sop-recording`, `sop-service`, `execution-mapping`, `execution-recorder`, `execution-assist`,
`executor-playwright`, `runtime`, `drift-recovery`, `decision-judge`, `model-provider`,
`model-budget`, `artifacts`, `artifact-service`, `db`.

`pnpm dev` is `pnpm -r --parallel dev` and therefore starts five processes: `api`,
`browser-worker`, `demo-portal`, `library-portal`, `web`. The browser-worker `dev` process only
logs its identity — Phase 1 has no queue or worker loop (ADR-011), the API process executes runs,
and one-off execution is `pnpm agent:run`.

| Port | Bound by | Notes |
|---|---|---|
| 3000 | Watchtower (`apps/web`) | `strictPort`, proxies `/v1` to `ORBIT_API_URL` (default `http://127.0.0.1:3002`) |
| 3001 | demo portal | `strictPort`, dev and preview |
| 3002 | API | `API_PORT` / `API_HOST` |
| 3010 | Watchtower, end-to-end stack | **Reserved.** No app may bind it (`apps/api/src/testing/stack-ports.ts`) |
| 3020 | library portal | `strictPort` |
| 3102 | API, end-to-end stack | **Reserved**, same rule |
| 5432 | PostgreSQL (local server) | 55432 for the optional Docker Compose alternative |

Health check: `GET /health` → `{ "status": "ok" }`, registered in `apps/api/src/server.ts`. It is
the only non-`/v1` route and is not in `docs/contracts/api.md`.

## 3. Commands, exactly as they exist

From the root `package.json`: `dev`, `build`, `typecheck`, `lint`, `lint:fix`, `format`,
`format:check`, `test`, `test:watch`, `test:e2e`, `test:e2e:library`, `test:e2e:watchtower`,
`test:db`, `test:runtime`, `db:migrate`, `db:generate`, `db:seed`, `db:seed:library`,
`db:seed:library:unbound`, `agent:run`, `record:binding`, `record:workflow`, `check:teardown`,
`verify`, `verify:phase1`.

`verify` = typecheck + lint + format:check + test + test:db. `verify:phase1` = `verify` +
test:runtime + test:e2e:watchtower + test:e2e + check:teardown.

Test suites are four Vitest projects plus two Playwright Test projects:

| Suite | Files | Requires |
|---|---|---|
| `pnpm test` | 121 `*.test.ts` | a checkout |
| `pnpm test:db` | 27 `*.db.test.ts` | PostgreSQL + `TEST_DATABASE_URL` (`orbit_test` enforced) |
| `pnpm test:runtime` | 7 `*.runtime.test.ts` | + Chromium + demo/library portal (~18 min) |
| `pnpm test:e2e:watchtower` | 1 `*.e2e.test.ts` | + the whole stack on 3010/3102 |
| `pnpm test:e2e` / `:library` | Playwright specs in `apps/demo-portal`, `apps/library-portal` | Chromium |

## 4. Configuration

Documented in `.env.example`: `NODE_ENV`, `LOG_LEVEL`, `DATABASE_URL`, `TEST_DATABASE_URL`,
`WEB_PORT`, `DEMO_PORTAL_PORT`, `API_PORT`, `API_HOST`, `ARTIFACT_STORAGE_DIR`, `LLM_PROVIDER`,
`LLM_INVOCATION`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `GEMINI_API_KEY`, `GEMINI_MODEL`,
`GOOGLE_API_KEY`, `ORBIT_BEDROCK_REGION`, `AWS_REGION`, `ORBIT_LLM_PROVIDER` (deprecated),
`ORBIT_LLM_MODEL` (deprecated), `ORBIT_LLM_TOKEN_BUDGET_GLOBAL`,
`ORBIT_LLM_TOKEN_BUDGET_PER_AGENT`, `ORBIT_LLM_TOKEN_BUDGET_PER_RUN`,
`ORBIT_LLM_RATES_USD_PER_MTOK`.

**Read by code and absent from `.env.example`** — a gap for the installation and polish tasks:

| Variable | Read in | Meaning |
|---|---|---|
| `ORBIT_LLM_DECISION_MODEL` | `apps/browser-worker/src/cli/judge.ts` | Model for a judged decision |
| `ORBIT_LLM_DECISION_CONFIDENCE_MIN` | same | Confidence floor; a missing confidence fails closed |
| `ORBIT_LLM_TOKEN_BUDGET_PER_AGENT_RUNTIME` | same | Per-agent cap at execution time |
| `ORBIT_LLM_TOKEN_BUDGET_PER_RUN_EXECUTION` | same | Per-run cap at execution time |
| `ORBIT_API_URL` | `apps/web/vite.config.ts` | Proxy target for `/v1` |
| `ORBIT_BROWSER_HEADED` | `apps/browser-worker/src/cli/run-agent.ts`, `apps/api/src/bootstrap.ts` | Show the automation browser |
| `ORBIT_RECORDER_HEADLESS` | `apps/api/src/bootstrap.ts` | Run the recorder headless |
| `ORBIT_ACTOR_ID` | `apps/browser-worker/src/cli/run-agent.ts` | Actor recorded on a CLI run; defaults to `dev-user` |

There is no `LIBRARY_PORTAL_PORT`; 3020 is hard-coded in `apps/library-portal/vite.config.ts`.
`scripts/check-teardown.mjs` probes 3000, 3001, 3002, 3010 and 3102 — **not** 3020.

## 5. Data and demo state

11 committed migrations, `packages/db/drizzle/0000_phase_1_evidence_schema.sql` through
`0010_proposals_from_demonstration.sql`, applied by `pnpm db:migrate` (Drizzle Kit generates;
`drizzle-kit push` is deliberately unused). Seeds: `pnpm db:seed` (Find Service Request 0.1.0 from
`fixtures/find-service-request.agent.yaml`, idempotent, refuses a changed fixture under the same
version), `pnpm db:seed:library` (branching library workflow, bound), `pnpm db:seed:library:unbound`
(same workflow with no bindings, for the walkthrough demo).

Artifact bytes live under `./data/artifacts` (`ARTIFACT_STORAGE_DIR`, resolved against the
repository root, gitignored as `/data/`). Metadata and links are in PostgreSQL.

## 6. Documentation: what exists and where it has fallen behind

`README.md` (1051 lines) and `CLAUDE.md` are current to 2026-09-07; `docs/architecture/decisions.md`
and `docs/tasks/ACTIVE_TASK.md` to 2026-09-08. **Every other document under `docs/` was last
modified 2026-09-05**, before sub-phases 2.5–2.14 landed. Concrete, checkable gaps:

- `docs/contracts/api.md` documents **6 endpoints**. The API serves **43 `/v1` routes plus
  `/health`** — candidates, publishing, recording/binding/walkthrough sessions, recovery, model
  usage, SOP drafts and revisions are all undocumented.
- `README.md`'s own "Phase 1 scope" section still lists "Runtime LLM decisions or recovery",
  "External websites", and the closed outcome pair `request_found` / `request_not_found` as *not
  included*. All three are contradicted by ADR-022, ADR-030, ADR-032 and ADR-033 and by shipped
  code. `README.md`'s body above that section is accurate; the scope list at the end is stale.
- `docs/orbit_repository_supporting_markdown_files.md` is scaffolding from repository setup and
  contains an outdated copy of `README.md` inside a fenced block. It is a duplicate source of truth.
- No installation script exists. Setup is a documented manual sequence (three `psql` statements,
  `pnpm install`, `cp .env.example .env`, `db:migrate`, `db:seed`, a Playwright browser install).
- No upgrade guide exists. `pnpm db:migrate` is the only forward path and nothing states what a
  person with an older checkout must do — notably that turning the drift check on in Task 12 makes
  previously-passing bound agents stop until re-demonstrated.
- There is no in-app help of any kind.

## 7. Recommendation: how the `Wiki` link should work

**Add an internal view, `?view=wiki`, rendered by the existing query-parameter navigation.**

`apps/web` has no router by deliberate decision (`apps/web/src/navigation.ts`, ADR-031): the URL is
the source of truth, `viewFromSearch` parses it, `searchForView` writes it, and `NAV_ITEMS` lists
the tabs. Adding a wiki means one member on the `View` union, one `NAV_ITEMS` entry, one case in
`searchForView` (the exhaustive `switch` makes the compiler find any omission), and one
`WikiPage.tsx` in `App.tsx`'s render chain. No dependency, no router, no build configuration, no API
route, no static-asset pipeline. Deep links to a topic follow the pattern already in use:
`?view=wiki&topic=…`.

Two consequences to plan for, both cheap: `apps/web/src/navigation.test.ts:126` asserts the exact
nav label list and must be updated, and `watchtower.e2e.test.ts` should gain a `nav-wiki`
assertion alongside the existing `nav-home` / `nav-studio` / `nav-agents` / `nav-runs` ones.

Content should be authored as TypeScript data in `apps/web/src` and be **task-oriented help** —
how to record, bind, publish, run, read evidence, respond to a proposal — linking out to `docs/` for
contracts. That is what the request asks for, and it keeps the wiki from becoming a second copy of
the architecture documents that can silently drift.

Alternatives, and why not:

- **Static HTML under `apps/web/public/wiki/`.** Vite serves `publicDir` at `/wiki/` in dev,
  preview and build with no configuration, so it genuinely works. But it is a second document
  system outside React and Tailwind, a full page load leaves the SPA, and `Nav.tsx` intercepts every
  unmodified click with `preventDefault()` — an external-style link needs `NavLink` to carry
  something other than a `View`. Keep as the fallback if the wiki must be authored as files.
- **Markdown rendered at runtime from `docs/`.** Needs a markdown renderer dependency and a glob
  import coupling the web bundle to the docs tree. Strictly more machinery than option one.
- **External link to GitHub.** The remote is `git@github.com:thecloud22/orbit.git`. This depends on
  repository visibility and on network access from wherever Watchtower runs, hardcodes a host into
  the UI, and cannot be in-app FAQ content. Rejected.

## 8. Admin page vs document settings vs version lifecycle vs preferences

The boundary is already decided by code, not open for the Admin task to redraw.

**Platform Admin — read-only operations.** `routes/model-usage.ts` states the rule plainly: usage is
written by the code that made the call, "a ceiling is deployment configuration rather than something
the UI can raise for itself. A cap a client could lift is not a cap." Provider selection and budgets
are resolved once at process start in `apps/api/src/index.ts`. So Admin **displays** and does not
edit: service health (`GET /health`), global model spend and the three budget ceilings
(`GET /v1/model-usage`, already served and currently only surfaced on Home), the model family and
invocation in force, the artifact storage root, the applied migration level, and the port map. Only
the first two have endpoints today; the rest need new read-only endpoints. Making any of them
writable would reverse a recorded decision and needs an ADR first.

**Per-document / per-SOP settings.** The recovery grant is per document:
`POST /v1/sop-documents/:documentId/recovery` with `{ enabled }`. Per-agent spend is per document
before publication (`GET /v1/model-usage?documentId=…`, ADR-029). Review lifecycle, step insert,
edit and reorder, clarification answers, bindings, binding and walkthrough sessions, and recovery
proposals are all document-scoped.

**Agent / version lifecycle — not settings at all.** `permissions.browser.allowedDomains`,
`permissions.model` and `permissions.recovery` are compiled into a published Agent Version and are
immutable (ADR-005). Withdrawing a document's recovery grant affects *future* versions only; the
route says so in its own comment. Archive and restore act on the mutable `agents` identity row, never
on a version (ADR-026).

**User preferences — none exist.** There is no authentication, no user table, and no session.
`ORBIT_ACTOR_ID` (browser-worker CLI, default `dev-user`) is the only notion of an actor. The Admin
task must not invent per-user settings; anything preference-shaped would have to be browser-local.

## 9. ADR survey (ADR-001 – ADR-035)

Every ADR carries `**Status:** Accepted`; supersession is recorded only inline in prose. Nothing is
obsolete and nothing is purely speculative. What the cleanup task should record is which clauses have
been amended and which halves are still forward-looking.

| ADR | State | Evidence / caveat |
|---|---|---|
| 001 monolith | Implemented | 6 apps, 20 packages, browser worker its own process |
| 002 graph vs IR | Implemented | `@orbit/sop-graph`, `@orbit/agent-ir`, compiler between |
| 003 deterministic execution | Implemented, **amended** | ADR-032 permits one bounded model call at run time |
| 004 evidence first-class | Implemented | events, artifacts, links |
| 005 immutable versions | Implemented | mint at publication; archive touches the identity row only |
| 006 status vs outcome | Implemented, **amended** | outcome vocabulary widened by ADR-030 |
| 007 restricted interpolation | Implemented | no `eval`/`Function` anywhere |
| 008 executor boundary | Implemented | `@orbit/executor-playwright` behind `BrowserExecutor` |
| 009 Watchtower as trigger UI | Implemented, **amended** | its "Studio later" clause is satisfied by ADR-031 |
| 010 local FS, S3 later | **Half implemented** | filesystem behind the interface; S3 exists only as a comment in `storage.ts` |
| 011 no durable queue | Implemented | API executes runs; worker process is informational |
| 012 bounded LLM services | Implemented | three call sites, all schema-validated |
| 013 trust tiers | **Partial** | `trust_tier` column and schema exist; Tier 1 reached via `permissions.recovery`; no tier-gated policy engine |
| 014 immutability in the repository layer | Implemented **as decided**; deferred half still open | no database triggers in any migration |
| 015 artifact key grammar | Implemented | `storage-key.ts`, `local-filesystem-storage.ts` |
| 016 non-executable checksummed revisions | Implemented | |
| 017 review rules in the service layer | Implemented | |
| 018 fingerprint before every action | Implemented | live in production since Task 12; `expect_one_of` does **not** drift-check |
| 019 recorder CLI, injection confined | Implemented, **partly superseded** | narrowed by ADR-020; action mode replaced by ADR-028 |
| 020 record from Watchtower | Implemented, **partly superseded** | its localhost clause superseded by ADR-022 |
| 021 refuse-what-is-not-understood + sandbox gate | Implemented | |
| 022 per-agent domains | Implemented | validator at publish, runtime before every navigation |
| 023 mint at publication | Implemented | |
| 024 compile/approve from Watchtower | Implemented | Reject has a route and a service, no UI |
| 025 one-click publish for a recording | Implemented | equivalence test against the manual path |
| 026 archive by retiring identity | Implemented | symmetric restore |
| 027 per-step binding sitting | Implemented | sessions are in-memory; an API restart drops them |
| 028 hold interaction until derived | Implemented | |
| 029 branch bindings + three-scope cap | Implemented | |
| 030 own outcomes, insert a step | Implemented | `agent_ir_candidates.outcome_mapping` kept but no longer written |
| 031 Studio naming, one timeline | Implemented | URL value stays `?view=documents` |
| 032 judged decision as an index | Implemented | five typed halt reasons, no default branch |
| 033 recovery by proposal | Implemented | deterministic, proposal-only, per-document grant |
| 034 one selection layer | Implemented; **two paths unexercised** | Gemini and Bedrock structurally correct, never called against a real service |
| 035 walkthrough alignment | Implemented | a second walkthrough over a partly-bound branching workflow misaligns, by design |

## 10. Scope and dependencies for the remaining tasks

| Task | Scope this baseline supports | Depends on |
|---|---|---|
| 1 `docs/wiki-and-readme` | In-app wiki at `?view=wiki` per §7; fix `README.md`'s stale Phase 1 scope list; document `/health` and the port map | — |
| 2 `docs/vision-architecture-adrs` | Mark amended/superseded clauses per §9; split ADR-010's S3 half and ADR-013's tier ambitions as forward-looking; refresh the vision and system-design documents frozen at 2026-09-05 | §9 |
| 3 `feat/installation-bootstrap` | Script the documented sequence in §5 and README "Local setup"; add the eight undocumented variables in §4 to `.env.example` | §4, §5 |
| 4 `test/installation-smoke` | Assert the bootstrap against a clean checkout; do not add it to `verify:phase1` without accounting for its runtime | 3 |
| 5 `feat/admin-platform-operations` | Read-only Admin per §8; new read-only endpoints for storage root, migration level and model selection; **no** writable budgets or provider switch without an ADR | §8, 1 (nav pattern) |
| 6 `docs/upgrade-guide` | Migration path `0000`→`0010`, the drift-check behaviour change from Task 12, and the deprecated `ORBIT_LLM_*` names | §5, §9 |
| 7 `chore/docs-operational-polish` | Add 3020 to `scripts/check-teardown.mjs`; resolve `docs/orbit_repository_supporting_markdown_files.md` as a duplicate source of truth; refresh `docs/contracts/api.md` | 1, 2, 6 |

Two standing constraints for all seven: `docs/tasks/Todo/` is the user's scratch directory and is
never committed, moved or modified; and the drift-recovery model in §1 is restated verbatim wherever
it appears, never paraphrased into something weaker.
