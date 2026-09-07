# Task P2-006 — Publish and execute

**Sub-phase:** 2.6
**Branch:** `phase-2-task-6-publish-and-execute` (off `0a0f478`)
**Status:** Complete, awaiting review

## What this delivers

An approved 2.5 candidate becomes a runnable **Agent Version** — versioned, persisted, traceable
back to the candidate and through it to the SOP revision — and runs through the runtime that already
existed. Watchtower gained a Publish action on the review page and now lists every published agent.

## The lead decision, settled by reading the code

The compiler emits `lifecycle.status: 'draft'`; the runtime executes only `published`. Three findings
turned that from a problem into the design:

1. **ADR-014 already forbids the alternative.** `AgentVersionRepository` deliberately exposes "no
   update, publish, patch, or delete method", so there is no row to flip a status on.
2. **The repository never transforms — it checksums what it is handed.** `create()` derives the
   `lifecycle_status` column from the document and computes `irSha256` over that same document.
3. **Byte-identity would invert the approval gate.** A candidate identical to a runnable version
   would be runnable before anyone approved it. The status difference *is* the gate.

**So publishing mints a new artifact rather than promoting one**, and "traceable back to the
candidate" was made to mean something checkable rather than a pointer:

- `published_from_candidate_id` records the link.
- Exactly two fields differ — `lifecycle.status` (the runtime requires it) and `version` (allocated
  per agent, since `agent_versions` is unique on `(agent_id, version)`).
- `assertOnlyPublicationFieldsChanged` verifies that against **the document actually stored**, so a
  widened `allowedDomains`, an added step or a changed trust tier cannot ride along. Two tests prove
  it catches exactly those, and disabling the check makes both fail.

Both checksums keep covering what they claim: the candidate's the approved draft, the version's the
executed document.

## Phase 1 boundary — everything touched

| Touch | Kind |
|---|---|
| `agent_versions` — one nullable column | **Additive.** Single `ADD COLUMN`, no `NOT NULL`, no default, no backfill. |
| `agents` — first non-seed writer | **Additive insert** via the existing `upsert`. |
| `agent_versions` repository | **One optional input field.** No update/publish/delete method added — ADR-014 intact. |
| Watchtower Home | Renders every published agent instead of `versions[0]`. |
| Phase 1 e2e helpers | Scoped to the seeded agent's card (see defects). |

**No existing row was modified.** A test seeds the Phase 1 fixture and asserts its
`published_from_candidate_id` is `NULL`, its `allowedDomains` is still `['localhost']`, and its
`irSha256` reads back unchanged — the new column did not disturb the checksum over the immutable
document.

## Execute — confirmed, not assumed

`assertNavigable` already reads `permissions.browser.allowedDomains` off the document, and the run
route already loads any version by id and calls `prepareExecution`. Neither the interpreter nor the
dispatcher mentions the fixture. **No runtime code changed.**

Tests assert a published, non-seeded agent passes `prepareExecution` — the same gate the CLI and the
API both apply — that its candidate is *refused* by that gate before publishing (`lifecycle.status`
in the details), and that ADR-022 containment holds: `['www.plano.gov']` derived from the recording,
`internal.plano.gov` and `evil.example` both refused.

## Defects found and fixed during the work

1. **My own transformation check did not cover the document being stored.** The first version
   asserted before the allocated version was applied, leaving `version` — the field most likely to
   carry a mistake — outside the thing checking for mistakes. Found while writing the code, fixed by
   asserting on the final document and naming both publication fields.
2. **Listing all agents broke five Phase 1 e2e tests.** The stack seeds *two* published versions —
   the real agent and a deliberately broken fixture — so `getByTestId('agent-name')` became
   ambiguous. Fixed by scoping the helpers to the seeded agent's card, which is what those tests
   always meant.
3. **A test that could pass vacuously.** The seeded-agent check returned early if the fixture was
   absent, and the tables are truncated between tests. It now seeds the fixture itself.
4. **A leftover dependency.** `@orbit/sop-service` still declared `@orbit/runtime` from the allowlist
   re-export deleted in ADR-022. Removed — a package that can import the runtime for no reason is a
   boundary waiting to erode.

## Tests

| Suite | Result |
|---|---|
| `pnpm typecheck` / `lint` / `format:check` | clean |
| `pnpm test` | 843 passed (85 files) |
| `pnpm db:generate` | "No schema changes, nothing to migrate" |
| `pnpm test:db` | 219 passed (19 files) |
| `pnpm test:runtime` | 21 passed |
| `pnpm test:e2e:watchtower` | 32 passed |
| **`pnpm verify:phase1`** | **exit 0**, teardown clean |

New coverage: 15 publish-service cases against a real database, 5 route cases, 4 publish-and-execute
integration cases, 12 view-model cases, and 2 end-to-end cases.

## Schema

One migration, `0004_agent_version_provenance.sql` — a single nullable `ADD COLUMN` plus its foreign
key, renamed from Drizzle's generated name to match convention, journal updated.

**`pnpm db:migrate` must be run against the development database.** `reset.db.test.ts` deliberately
connects there and fails until it is; that was the only surprise in the gate and it is the documented
step for any schema change.

## Limitations, stated rather than solved

- **Compiling and approving a candidate have no Watchtower surface.** 2.5 shipped them service-level
  only, so the Publish action is reachable only for candidates created through the services. This is
  the honest gap in the loop and the obvious next task.
- **The broken-locator fixture agent is now visible on Home**, because Home lists every published
  agent. Correct — it is published — but it was previously hidden by `versions[0]`.
- **Republishing after an edit produces a new version**, which is right, but nothing yet supersedes
  or retires the previous one; both remain listed and runnable.
- **No approval identity.** `reviewNote` records why, not who, because Phase 1 has no authentication.
- **No UI for the outcome mapping**, so the mapping a candidate carries is whatever the compile call
  supplied.

## Files

**Created** — `packages/sop-service/src/publish-service.ts` and its database test;
`packages/db/src/schema/agent-ir-candidates.ts` provenance column and
`packages/db/drizzle/0004_agent_version_provenance.sql`; `apps/api/src/routes/publishing.ts` and its
test; `apps/api/src/publish-execute.db.test.ts`; `apps/web/src/SopPublishPanel.tsx`,
`publication-view-model.ts` and its test; ADR-023; this report.

**Modified** — `packages/db/src/{schema,mappers,repositories}` for `agent_versions`;
`packages/sop-service/src/{revision-service,index}.ts` and `package.json`;
`apps/api/src/{context,bootstrap,server,views,projections}.ts` and testing fixtures;
`apps/web/src/{App,SopReviewPage,api-client,navigation}.ts(x)` and their tests;
`docs/architecture/decisions.md`, `README.md`, `docs/tasks/ACTIVE_TASK.md`.

**Untouched** — `packages/runtime` entirely; `@orbit/agent-ir`; `@orbit/execution-mapping`;
`@orbit/sop-graph`; `@orbit/agent-ir-compiler`; the seeded fixture; every Phase 1 row.
