# TASK-P3-001 — Surface contract freeze (sub-phase 3.1)

**Status:** Implemented and verified. **Gate B — this is the phase's one blocking review.**

**Branch:** `phase-3-task-1-surface-contract-freeze`, stacked on `phase-3-task-0-test-target-spike`.

## Why this is a gate

`permissions` is embedded in published, immutable Agent Versions. ADR-005 and ADR-014 forbid
migrating one, so the shape below cannot be corrected later — a wrong decision here is permanent for
every version already published under it. Everything else in Phase 3 is reversible; this is not.

**ADR-037 is deliberately still marked _Proposed_.** Flipping it to _Accepted_ is the gate action,
not something this task did on its own authority.

## What changed

Contract only. No runtime behaviour changes, no new surface, no new step type.

### `packages/agent-ir/src/permissions.ts`

- **`permissions.browser` is now optional.** This is the whole point of the task: it is what lets an
  Agent Version exist that never opens a browser. Absence means the surface is not permitted — the
  rule `model` and `recovery` already followed.
- `EXECUTION_SURFACES` / `ExecutionSurface` — one member (`browser`) today. `terminal` and `api`
  join it when the sub-phases that give them an addressing vocabulary and an evidence set land.
- `STEP_TYPE_TO_BROWSER_ACTION` → **`STEP_SURFACE_PERMISSION`**, mapping step type to
  `{ surface, action }`. Typed as a union rather than `{ surface: string; action: string }` so each
  surface keeps its own action vocabulary and a typo cannot typecheck. Still `satisfies`, so a step
  type mapped to an action its surface does not define fails to compile.
- `stepPermissionFor(stepType)` and `grantsSurface(permissions, surface)` — so "absent means denied"
  is stated once instead of re-derived at each call site.

### `packages/agent-ir/src/validate.ts`

New issue code **`SURFACE_NOT_PERMITTED`**, kept distinct from `ACTION_NOT_PERMITTED` because the two
need different fixes: never having been granted the surface is a different mistake from holding the
surface but not that action on it, and a reviewer has to be able to tell which happened.

### Runtime — three call sites, all fail-closed

`permissions.browser` becoming optional forced these. None changes behaviour for an agent that
declares a browser section, which is every agent that exists.

| File | Change | Behaviour when the section is absent |
|---|---|---|
| `runtime/src/evidence.ts` | `browser?.allowedActions ?? []` | No grants, so no browser evidence is captured |
| `runtime/src/interpreter.ts` | `browser?.allowedDomains ?? []` | `assertNavigable` denies every host — an empty allowlist already failed closed |
| `runtime/src/profile.ts` | same, in the pre-flight check | same |

### Documentation

- `docs/contracts/agent-ir.md` — added the "Sections are keyed by surface" rules, the three distinct
  refusal codes, and **a `model.decide` section that was missing entirely**. The document had eight
  step-type sections for a nine-member union since sub-phase 2.9; it now matches the code.
- `CLAUDE.md` — the phase statement said "Phase 1 only", stale against sixteen shipped sub-phases.
  The excluded list said "API/webhook/schedule/email/file/event-bus triggers"; narrowed to
  **triggers**, since an outbound `api.request` step is Phase 3 scope while inbound triggers remain
  excluded. The OCR exclusion was left standing — that work is parked and the instruction is still
  accurate.

## Verification

| Check | Result |
|---|---|
| `tsc --noEmit` per package (17 packages/apps) | clean |
| `eslint .` | clean |
| `prettier --check .` | clean |
| `vitest run` | **1412 passed** (130 files), up from 1408 |
| `test:db` (Postgres) | **331 passed** (27 files) |

**No existing test's expectations were edited.** The +4 are new tests for the new behaviour. Twelve
existing test files needed a `?.` accessor or a narrowing guard — type accommodations to an
optional field, not assertion changes. Where an accessor became `?? []`, the immediately following
assertion still fails if the section were ever absent, so no assertion lost strength.

### New tests

- `fixture.test.ts` — deleting `permissions.browser` from the seeded fixture yields
  `SURFACE_NOT_PERMITTED` and **not** `ACTION_NOT_PERMITTED`. This proves both layers: the schema
  *accepted* a document with no browser section (so `.optional()` works), and the semantic validator
  then caught it.
- `index.test.ts` — `permissionsSchema` parses a declaration granting no browser surface;
  `stepPermissionFor` returns nothing for `complete`, `fail` and `model.decide`; `grantsSurface`
  treats an absent section as denied rather than as a default.

## A note on the verification method

`pnpm -r typecheck` **fails fast**, and a type error in `packages/db` masked three real errors in
`packages/runtime`. Anyone verifying a change with this blast radius should iterate `tsc --noEmit -p`
per package rather than trusting the aggregate command's first failure.

## Known limitations

- `EXECUTION_SURFACES` has one member. Nothing exercises the multi-surface path because no
  non-browser step type exists yet — that is 3.6 and 3.10.
- Evidence grants are still browser-shaped (`EVIDENCE_TO_BROWSER_ACTION`). Generalising them is 3.2's
  work, when there is a second surface with an evidence set to generalise *to*.
- The runtime still opens exactly one executor per run and calls `finishTrace()` unconditionally.
  Untouched deliberately: this task is the contract, 3.2 is the seam.
- ADR-016's static non-executability denylist in `packages/sop-graph` is still browser-term matching.
  It needs extending when a surface actually arrives, as its own ADR predicted.

## What Gate B is being asked to approve

The shape: **optional per-surface permission sections, `{ surface, action }` step mapping, absent
means denied, `Locator` not widened.** If that is right, ADR-037 flips to _Accepted_ and 3.2 starts.
If it is wrong, now is the only cheap moment to say so.
