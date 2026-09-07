# Task P2-006D — Archive agents (not delete), and a Tailwind 4.3 professional-SaaS styling pass

**Sub-phase:** 2.6 (surface follow-up)
**Branch:** `fix-home-catalog-stale-fetch` (continuation)
**Status:** Complete

## Why "archive," not "delete"

The request was for an "ability to delete agents." Agent Versions are immutable by design
(ADR-005), and `AgentVersionRepository` deliberately has no update, publish, patch, or delete method
(ADR-014) — a run's evidence is meaningless if the definition it executed can later be reinterpreted
or removed. Literal deletion would either cascade-destroy every run and every piece of evidence ever
recorded against the agent, or fail outright on the foreign key `runs` already holds to it.

This was surfaced to the user before writing any code, per CLAUDE.md's instruction to stop and name
a conflict rather than choose silently. The user confirmed **archive/retire** as the correct
behavior: hide the agent from the active catalog and block new runs against it, while every past run
and its evidence stays fully intact.

## What was built

### Agent archiving (ADR-026)

`agents.archivedAt` (nullable timestamptz, migration `0005_agent_archiving.sql`) retires an agent's
*identity*, never a version. `AgentRepository` gained `archive(id)`/`restore(id)`, both returning
`null` for an unknown id rather than throwing. `agents` was already a mutable table before this task
(`upsert` refreshes display fields); this extends it by one field rather than opening a mutation path
on the immutable `agent_versions` table.

`AgentVersionRepository.listPublished()` now filters against `agents.archivedAt` in application
code — the active catalog is every published version whose agent is not archived — while
`listByAgent`, used internally by publish and revision services for version allocation, stays
unfiltered on purpose. No `agent_versions` row, checksum, or lifecycle status is ever written by
archiving.

Two routes: `POST /v1/agent-versions/:id/archive` and `.../restore`, both resolving the version to
its owning agent and 404ing if either does not exist. Watchtower's Agents page gained an "Archive"
button per card (with a confirmation dialog naming what stays intact) and an inline "Undo" banner
that calls restore — a mistaken archive is one click to reverse, not a support ticket.

### Tailwind CSS 4.3 and a professional-SaaS pass

`tailwindcss` and `@tailwindcss/vite` bumped from `^4.0.0` to `^4.3.0` (already resolving to 4.3.3 in
the lockfile; the declared range now says so explicitly). The visual pass is CSS-only — no
`data-testid`, no component logic, no prop changed to accommodate it:

- Content cards: `rounded` → `rounded-lg`, added `bg-white shadow-sm`, `p-4` → `p-5`.
- Primary buttons: `rounded` → `rounded-md`, added `shadow-sm transition-colors`.
- Secondary buttons and form inputs: `rounded` → `rounded-md` for a consistent, less boxy corner
  radius across every interactive element.
- List rows (Runs list, binding rows): added hover elevation/border-color transitions.
- Header: sticky with a translucent blur (`bg-white/95 backdrop-blur`), tighter title tracking,
  widened from `max-w-4xl` to `max-w-5xl` throughout for more breathing room.
- Global focus-visible ring (`index.css`, `@layer base`) applied once to every interactive element,
  and an `@theme` font-family token — a lean way to raise the whole app's polish without touching
  every file's focus-state markup individually.
- Inline alert/banner boxes (errors, the "draft only" notice) were deliberately left at the sharper
  `rounded` radius — a visual distinction between primary content and an inline warning, not an
  oversight.

## Tests

| Suite | Result |
|---|---|
| `pnpm typecheck` | clean (20 workspace projects) |
| `pnpm lint` | clean |
| `pnpm format:check` | clean |
| `pnpm test` | 844 passed (82 files) |
| `pnpm test:db` | 238 passed (20 files, +5 new) |
| `pnpm test:runtime` | 21 passed |
| `pnpm test:e2e:watchtower` | 35 passed |
| `pnpm test:e2e` (demo portal) | 9 passed |

New coverage: `agents.archive`/`restore` round-trip and their "not found" cases
(`agent-versions.db.test.ts`); `listPublished` excluding an archived agent's version and including it
again once restored, asserting the version row's own content and checksum are untouched throughout;
two API integration tests (`api.db.test.ts`) covering the archive → catalog-empty → version-still-
published → restore → catalog-restored round trip, and 404s for an unknown agent version on both
routes.

`pnpm verify:phase1`'s final `check-teardown` step reported ports 3000-3002 still held — this is the
user's own `pnpm dev` running concurrently for their own use, not a regression: `test:runtime` and
`test:e2e:watchtower` both logged "Reusing the demo portal already listening on port 3001" and every
test in both suites passed. The teardown check does not distinguish a legitimately running dev
session from a leaked test process; it was not re-run against a clean environment to avoid disrupting
the user's active session a second time this engagement.

## No breaking schema change

One nullable column added to `agents`, defaulting to `NULL` for every existing row — no backfill, no
existing agent affected, no `agent_versions` migration.

## Limitations, stated rather than solved

- **Republishing under an archived agent does not implicitly restore it.** A new version compiled
  and published against an archived agent's id would also be hidden from the catalog. Not handled;
  named rather than silently left as a surprise.
- **No "browse archived agents" page.** Undo covers the moment right after archiving; an agent
  archived in a previous session has no UI path back short of a direct API call. Deferred until
  there is a real need beyond the immediate-undo case this task covers.
- **The styling pass is a visual layer only** — no dark mode, no design-token system beyond the one
  `@theme` font entry and the existing indigo accent from the prior task.

## Files

**Created** — `packages/db/drizzle/0005_agent_archiving.sql`; this report.

**Modified** — `packages/db/src/schema/agents.ts`, `packages/db/src/mappers/agent.ts`,
`packages/db/src/repositories/agents.ts`, `packages/db/src/repositories/agent-versions.ts` and its
database test; `apps/api/src/{views,routes/agent-versions}.ts` and `apps/api/src/api.db.test.ts`;
`apps/web/src/{AgentsPage,App,Nav,api-client,index.css}` plus a mechanical class-name pass across
every other `apps/web/src/*.tsx` component; `apps/web/package.json` (tailwind version bump);
`docs/architecture/decisions.md` (ADR-026); `docs/tasks/ACTIVE_TASK.md`.

**Untouched** — `@orbit/agent-ir-compiler`, `@orbit/agent-ir`, `@orbit/execution-mapping`,
`@orbit/sop-graph`, `@orbit/runtime`, `@orbit/sop-service`; every `agent_versions` row and its
checksum; every run, step, event, and artifact table.
