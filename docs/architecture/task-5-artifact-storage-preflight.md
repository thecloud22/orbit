# Task 5 Preflight — Local Artifact Storage

**Status:** Preflight checklist only. **This document does not implement Task 5** and decides
nothing beyond what the Task 4 schema, repository contracts, and existing ADRs already require.
Where a question below has no existing answer in those sources, it is a decision the Task 5 plan
must propose and get approved before implementation — not something this document settles.

**Purpose:** Give the Task 5 planning pass a single checklist of the decisions it must make
explicit, so none of them get decided implicitly inside the storage adapter's code.

## What already constrains Task 5

These are not open questions. They come from `docs/contracts/events-and-evidence.md`, ADR-004,
ADR-010, and the Task 4 schema/repository as built (see
`docs/tasks/reports/TASK-004-postgres-persistence-report.md`).

- Artifact bytes are stored outside PostgreSQL; only metadata and links are persisted there
  (ADR-004, ADR-010). The `artifacts` table has no binary column, enforced by an integration test.
- The Phase 1 storage interface must be replaceable by an S3/MinIO adapter later without changing
  runtime or evidence contracts (ADR-010). This means the interface Task 5 designs, not just its
  local implementation, is the durable seam.
- Required artifact kinds are fixed by `artifactKindSchema`: `browser_screenshot`, `dom_snapshot`,
  `browser_trace`, `extracted_json`, `error_context`. Task 5 does not add or rename kinds.
- Required link roles are fixed by `artifactLinkRoleSchema`: `screenshot_after_action`,
  `dom_snapshot`, `browser_trace`, `error_context`, `extracted_json`.
- `artifactMetadataSchema` already requires: opaque `id`, `runId`, optional `runStepId`, `kind`,
  non-empty `contentType`, non-empty `storageKey` (documented as "never a caller-supplied
  filesystem path"), non-negative integer `sizeBytes`, a lowercase 64-character hex `sha256`, and
  `createdAt`.
- The database enforces `storage_key` as `NOT NULL` and **globally unique**, and `sha256` matching
  `^[a-f0-9]{64}$`. `ArtifactRepository.create` / `createWithLinks` take these as inputs; they do
  not compute them.
- `ARTIFACT_STORAGE_DIR=./data/artifacts` is already declared in `.env.example`. `/data/` is
  already gitignored at the repository root.
- `packages/artifacts` already exists as a Task 1 scaffold depending only on `@orbit/contracts`;
  it must not depend on `@orbit/db`, and `@orbit/db` must not depend on it. Composition of storage
  writes and metadata writes belongs to a caller (the runtime, Task 6), not to either package.

## Required decisions for the Task 5 plan

Each item below must be an explicit, stated decision in the Task 5 plan — approved before
implementation, per `CLAUDE.md`'s development workflow — not an incidental choice made while
writing the adapter.

### Artifact root

- Confirm the artifact root is read from `ARTIFACT_STORAGE_DIR`, resolved to an absolute path once
  at startup, and never re-derived per call from a relative path or caller input.
- State whether the adapter creates the root directory if missing, or requires it to pre-exist.
- State whether the root is validated as being outside any served/public web asset directory
  (ADR-010: "access-controlled").

### Opaque storage keys

- Define the storage-key grammar precisely (character set, segment structure, maximum length).
  `docs/contracts/events-and-evidence.md`'s artifact metadata example uses
  `runs/<runId>/steps/<agentStepId>/<name>` as an illustration, not a ratified grammar — the plan
  must ratify one.
- State whether keys are generated entirely by the storage adapter, or partly composed by the
  caller (e.g. run/step identifiers) and finalized by the adapter. Either way, a key must never be
  accepted verbatim from outside Orbit's own code.
- State how a key becomes a filesystem path (segment-to-directory mapping, extension handling).

### Path traversal

- State the exact validation applied to every key before it touches the filesystem: rejection of
  `..` segments, absolute paths, drive letters, null bytes, and any segment that would resolve
  outside the artifact root after normalization.
- State whether validation happens once (key construction) or twice (construction and again
  immediately before the filesystem call) — defense in depth versus a single trusted boundary.
- State the typed error raised on a rejected key, and confirm it maps to `ARTIFACT_STORAGE_ERROR`
  (`docs/contracts/events-and-evidence.md`'s error taxonomy) rather than a generic exception.

### Symlink containment

- State whether the adapter resolves symlinks (`realpath`) before writing or reading, and rejects
  a resolved path that falls outside the artifact root.
- State the behavior if the root itself, or an intermediate directory Orbit created, is later
  replaced by a symlink outside Orbit's control — this is a defense-in-depth question, not
  something Task 5 needs to solve for an adversarial multi-tenant deployment, but the plan must say
  explicitly whether it is in or out of scope for Phase 1.

### Atomic writes

- State whether writes go to a temporary path in the same directory (or same filesystem) and are
  renamed into place, so a reader can never observe a partially written file.
- State what happens if the process crashes mid-write: whether a stale temporary file is possible,
  and how it is distinguished from a legitimate artifact on next startup or cleanup.

### Temporary-file cleanup

- State the naming convention for temporary files, so cleanup logic (manual or automated) can
  recognize them unambiguously and never mistake a legitimate artifact for one.
- State whether Task 5 includes any cleanup mechanism at all, or whether cleanup of orphaned
  temporary files is explicitly deferred (retention/cleanup jobs are out of scope per the backlog).

### Overwrite behavior

- State whether writing to an already-occupied storage key is rejected, silently overwritten, or
  made a no-op when content is byte-identical. The database's `storage_key` uniqueness constraint
  means a second `ArtifactRepository.create` call with the same key already fails at the metadata
  layer — the plan must state whether the filesystem adapter enforces the same rule independently
  (so a failure is visible before the database call is even attempted) or relies solely on the
  database constraint as the single source of truth.

### Checksum behavior

- State at what point the sha-256 digest is computed: streamed while writing, or computed in a
  second pass after the write completes. This affects memory use for large traces and whether a
  partially written file could produce a digest that does not match what is eventually persisted.
- State whether the adapter verifies the digest on read (defense against on-disk corruption or
  out-of-band modification) or trusts the metadata row. Compare with the Task 4 precedent: the
  agent-version repository already recomputes and checks a checksum on every read
  (`ir_sha256`) rather than trusting the stored value blindly.

### Database ordering

- Confirm and preserve the write ordering already established in the Task 4 report: derive the
  key, write the bytes, compute size and digest from what was actually written, and only then call
  `ArtifactRepository.create` / `createWithLinks`. A metadata row must never be created for bytes
  that do not yet exist on disk.
- State the failure behavior when the filesystem write succeeds but the subsequent database insert
  fails (orphaned bytes with no metadata row — likely acceptable and cleaned up later) versus when
  the filesystem write fails outright (must surface as `ARTIFACT_STORAGE_ERROR` and must not reach
  the database call at all, per CLAUDE.md's "do not silently swallow errors").
- State whether Task 5 needs a compensating delete of bytes already written if the caller's larger
  transaction (e.g. `createWithLinks`) subsequently fails, or whether that is explicitly deferred.

### Test cleanup containment

- State the fixture/test-root strategy so artifact storage tests never write outside a
  test-specific, disposable directory — analogous to the Task 4 database guard that requires
  `TEST_DATABASE_URL` to name a database ending in `_test` and never fall back to `DATABASE_URL`.
- State whether tests use a temporary directory per test run (e.g. `os.tmpdir()`-based, cleaned up
  after) or a fixed path under the repository's gitignored `data/` directory, and how either choice
  avoids ever writing into `ARTIFACT_STORAGE_DIR` used by a developer's running `pnpm dev`.

## Explicit Task 5 exclusions (unchanged, restated for this checklist)

Per `docs/tasks/phase-1-backlog.md` and `CLAUDE.md`, Task 5 must not include:

- Playwright, browser execution, or any browser worker behavior.
- Runtime interpretation of Agent IR.
- Watchtower or any other UI change.
- API routes.
- S3, MinIO, or any cloud/object storage implementation.
- Redis, BullMQ, or any queue.
- A retention or cleanup worker/job.
- Database schema or migration changes — Task 4's `artifacts` and `artifact_links` tables and the
  `ArtifactRepository` interface are final for this task; Task 5 is a caller of that interface, not
  a modifier of it.
- New dependencies beyond what local filesystem I/O and checksum computation already provide via
  Node's standard library (`node:fs`, `node:crypto`), unless the Task 5 plan proposes and gets
  approval for something specific.

## Required reading before planning Task 5

1. `CLAUDE.md`
2. `docs/engineering/model-routing.md`
3. This document
4. `docs/contracts/events-and-evidence.md` — artifact model and error taxonomy
5. `docs/architecture/decisions.md` — ADR-004, ADR-010 in particular
6. `docs/tasks/reports/TASK-004-postgres-persistence-report.md` — exact prerequisites section
7. `packages/contracts/src/artifacts.ts` — `artifactMetadataSchema`, `artifactLinkRoleSchema`,
   `artifactLinkSchema`
8. `packages/db/src/repositories/artifacts.ts` and `packages/db/src/schema/artifacts.ts` /
   `artifact-links.ts` — the interface and constraints Task 5 must satisfy
9. `packages/artifacts/src/index.ts` — the current scaffold Task 5 replaces
