# TASK-P3-003 — Credential references (sub-phase 3.3)

**Status:** Complete. Non-blocking.

**Branch:** `phase-3-task-3-credential-references`, stacked on `phase-3-task-2-multi-surface-seam`.

## Why this mattered more than its size

ADR-021 made a workflow needing a secret compile but never be approvable — a documented dead end.
Every Phase 3 surface is behind a logon: a mainframe behind TSO, an enterprise API behind a token. So
this is the prerequisite for both surfaces, not a parallel workstream.

## What changed

**A credential is a name in the Agent IR. It is never a value, anywhere.**

- `${credentials.name}` joins the interpolation grammar as a fourth namespace, legal **only where a
  value is typed into a field** — never in an assertion, output, or assignment, because those are
  persisted. Mirrors the rule the SOP Graph already enforces for secret inputs.
- `permissions.credentials.allowedRefs` — the closed list a published version may resolve, the same
  shape `allowedDomains` has. A reference outside it is `CREDENTIAL_NOT_PERMITTED`.
- `CredentialResolver` in `runtime/ports.ts` — one method, the shape `DecisionJudge` already has.
- `@orbit/credentials` — `createEnvCredentialResolver()`, mapping `tsoPassword` to
  `ORBIT_CREDENTIAL_TSO_PASSWORD`. It implements the port **structurally rather than by importing
  it**, so the runtime's boundary property is untouched.
- ADR-021's gate **narrowed, not removed**: a credential reference is resolvable and no longer trips
  it; a secret *input* still does, because Orbit still cannot supply one.

### The three details that carry the security property

**The value never enters the resolution scope.** It is fetched into the local that types it and
exists nowhere else. This is load-bearing rather than stylistic: a scope is a record passed down
every call, inspected in a debugger, one careless spread from an event payload.

**An unresolvable credential fails the step.** Not an empty string, not a placeholder. The failure
ADR-021's gate existed to prevent — a live credential field reached with nothing to give it — has to
stay impossible after the gate opens. An empty environment variable is treated as unset for the same
reason.

**`valueLength` is withheld for a credential.** The fill event already omitted the resolved value by
design; the length survived, and the length of a secret is information about the secret. It is kept
for ordinary values, where it is a useful signal that the right thing was typed.

## Verification

| Check | Result |
|---|---|
| `tsc --noEmit` per package (18) | clean |
| `eslint .` / `prettier --check .` | clean |
| `vitest run` | **1420 passed** (131 files), up from 1414 |
| `test:db` | **331 passed** |

### The test that matters

A run whose fill takes `${credentials.tsoPassword}`, with a resolver returning a known secret:

- the secret **is** typed — `browser.filled()` equals it, because the point is containment, not
  withholding;
- `JSON.stringify` of every event, artifact, output, step summary **and captured log line** does not
  contain it;
- the event records `valueSource: '${credentials.tsoPassword}'` and has **no** `valueLength`.

Plus: an unsuppliable credential fails with `WORKER_FAILURE` rather than typing anything.

## Known limitations

- **Authoring is not built.** Nothing lets a person map a recorded sign-in's secret input to a
  credential reference, so a credential-using workflow must be hand-authored in Agent IR. The
  recorder still declares a `secret` input, and such a workflow still cannot be approved. Contract
  and runtime halves exist; the authoring half is a separate task.
- **Anyone who can read the worker's environment can read every credential.** True of every secret a
  deployment holds, but newly relevant now that credentials will actually be there.
- No rotation, scoping, per-tenant isolation, audit of credential use, or UI. Phase 5, deliberately.
- Credentials are resolvable only in `browser.fill`. `terminal.type` and an API auth header join when
  those surfaces land.
- The recorder's known gap is unchanged: only password *fields* are detected, so a value typed into a
  non-password field is still captured verbatim.
