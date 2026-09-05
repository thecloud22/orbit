# Model Routing Policy

## Purpose

This policy defines how Orbit work is divided between Opus and Sonnet when both models are available.

The objective is to use the strongest reasoning model for architectural, security-sensitive, contract-sensitive, and persistence-sensitive work, while using the faster model for bounded verification and mechanical repair work.

This is an engineering control, not a substitute for code review, tests, repository conventions, or human approval.

## Default Model

Use Opus by default.

Opus owns repository understanding, system design, implementation decisions, security boundaries, persistence boundaries, public contracts, and final review.

Do not delegate work to Sonnet until Opus has established the intended behavior and explicitly bounded the task.

## Opus Responsibilities

Use Opus for work involving judgment, ambiguity, architecture, security, durability, or cross-package behavior.

Opus is required for:

- Reading and synthesizing repository context.
- Interpreting `CLAUDE.md`, ADRs, contracts, task documents, reports, schemas, repositories, and test strategy.
- Planning work and defining acceptance criteria.
- Determining scope and explicit exclusions.
- Designing modules, interfaces, types, error taxonomy, and public APIs.
- Deciding dependency additions or removals.
- Deciding database schema, migrations, indexes, constraints, retention, and transaction boundaries.
- Designing write ordering between filesystem, database, queue, worker, API, or other side effects.
- Designing idempotency, retry, compensation, rollback, and failure behavior.
- Defining storage-key construction, directory layouts, file naming, collision behavior, and overwrite behavior.
- Designing path traversal protections, absolute-path handling, symlink handling, cleanup boundaries, access controls, and integrity verification.
- Modifying Agent IR contracts, event contracts, domain contracts, or public API contracts.
- Making decisions affecting immutability, append-only behavior, auditability, evidence integrity, or versioning.
- Implementing or reviewing production code that crosses package boundaries.
- Handling unclear, conflicting, incomplete, security-sensitive, or data-integrity-sensitive failures.
- Reviewing the complete diff before a commit.
- Creating commits.

## Sonnet Responsibilities

Sonnet may be used only for bounded, well-specified work after Opus has defined the intended behavior.

Appropriate Sonnet tasks include:

- Running focused tests and accurately reporting output.
- Writing narrowly specified unit tests.
- Updating a test assertion when expected behavior is already decided.
- Fixing TypeScript compiler errors.
- Fixing ESLint errors.
- Fixing formatting errors.
- Fixing straightforward import, export, type, mock, or fixture issues.
- Making small mechanical refactors that do not change behavior.
- Re-running targeted checks after a bounded change.
- Producing a concise failure report with commands, output, and affected files.

## Sonnet Restrictions

Sonnet must not independently:

- Change task scope, acceptance criteria, or exclusions.
- Create architecture or choose between architectural alternatives.
- Add, remove, or upgrade dependencies.
- Change database schema, migrations, indexes, constraints, or transaction boundaries.
- Change public contracts, error taxonomy, API shapes, Agent IR semantics, or event semantics.
- Change filesystem root policy, storage-key grammar, path traversal protections, symlink handling, atomic-write behavior, checksum behavior, overwrite behavior, or cleanup boundaries.
- Change persistence ordering across filesystem, database, API, queue, or worker boundaries.
- Make security, authentication, authorization, policy, approval, tenancy, or retention decisions.
- Modify production behavior outside the files explicitly authorized by Opus.
- Make commits.
- Suppress, weaken, skip, or delete tests to make a check pass.

If a Sonnet task reveals a need for a restricted action, Sonnet must stop and return the issue to Opus.

## Required Delegation Brief

Before delegating work to Sonnet, Opus must give a brief that includes:

1. The exact files Sonnet may modify.
2. The specific behavior, error, test assertion, or lint/type issue to address.
3. The intended result.
4. The exact commands Sonnet should run.
5. The files and behavior Sonnet must not change.
6. Whether Sonnet is allowed to edit tests, production code, or both.
7. A requirement to stop and escalate if a change crosses the stated boundary.

A valid delegation example:

```text
Only modify packages/artifact-storage/src/local-filesystem-storage.test.ts.

Add tests for these already-decided behaviors:
- Reject an absolute storage key.
- Reject a storage key containing `..`.
- Return ArtifactNotFoundError for a missing key.

Do not modify production code, error classes, path validation policy, repository code,
database schema, dependencies, or any other test file.

Run:
pnpm --filter @orbit/artifact-storage test -- local-filesystem-storage.test.ts
pnpm typecheck
```

An invalid delegation example:

```text
Make artifact storage secure and fix any tests.
```

That request is too broad and crosses architecture and security boundaries.

## Escalation Format

When Sonnet must stop and return work to Opus, it must report:

- The exact command run.
- The complete relevant error output.
- The affected files.
- The smallest reproducible case.
- The expected behavior from the approved plan, if known.
- Why the needed change appears to cross a Sonnet restriction.

Example:

```text
Escalation required.

Command:
pnpm --filter @orbit/artifact-storage test -- local-filesystem-storage.test.ts

Failure:
Expected symlink escape to be rejected, but the current implementation follows the
symlink and reads a file outside the configured root.

Affected files:
- packages/artifact-storage/src/local-filesystem-storage.ts
- packages/artifact-storage/src/local-filesystem-storage.test.ts

Why this requires Opus:
The fix requires defining the repository-wide symlink containment policy and may
change filesystem security behavior.
```

## Review and Commit Gate

Before committing implementation work:

1. Opus reviews all changed files.
2. Opus verifies the work remains within approved scope.
3. Opus confirms no forbidden dependency, schema, migration, contract, or security-policy change occurred.
4. Required checks are run.
5. Opus summarizes changed files, test results, limitations, and any follow-up work.
6. Opus creates the commit.

Sonnet may help run checks and report results, but it does not approve the final diff or create commits.

## Exception Process

A task may use Sonnet more broadly only with explicit human approval recorded in the task plan or task report.

The approval must state:

- Why broader Sonnet use is acceptable.
- Which responsibilities are delegated.
- Which restrictions remain in force.
- The review/commit process.

Without that explicit approval, this policy applies.