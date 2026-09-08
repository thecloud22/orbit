# Troubleshooting

Failures that actually happen, organised by symptom. Setup problems first,
because that is where most first sessions end.

---

## Setup and the database

Before working through these by hand, run the diagnostic — it is read-only and
names the failing step:

```bash
pnpm bootstrap --check-only    # prerequisites, configuration, database, readiness
pnpm db:check                  # just the database: reachable? schema current?
```

Neither writes anything, neither prints an environment value, and both are safe
while the stack is running.

**`psql: could not connect to server`**

The local PostgreSQL server is not running. On a Homebrew install:

```bash
brew services start postgresql@18
```

**`password authentication failed for user "orbit_dev"`**

The role is missing or has a different password. Re-run the one-time setup, or
reset just the password:

```bash
psql -d postgres -c "ALTER ROLE orbit_dev PASSWORD 'orbit_local_dev';"
```

**`permission denied for schema public`**

The role does not own the database:

```bash
psql -d postgres -c "ALTER DATABASE orbit_dev OWNER TO orbit_dev;"
```

**`TEST_DATABASE_URL is not set`**

Copy it from `.env.example` into `.env`, and create the database if you have not:

```bash
psql -d postgres -c "CREATE DATABASE orbit_test OWNER orbit_dev;"
```

**`Refusing to modify database "..."`**

A safety guard fired because `TEST_DATABASE_URL` does not point at `orbit_test`.
`pnpm test:db` truncates tables, so it refuses unless the database name ends in
`_test`, differs from `DATABASE_URL`, and answers `orbit_test` to
`select current_database()`. **Fix the URL, not the guard.**

**`ERR_PNPM_IGNORED_BUILDS: esbuild`**

esbuild's postinstall is allow-listed in `pnpm-workspace.yaml`. If pnpm still
blocks it:

```bash
pnpm approve-builds --all
```

**A seed fails after I edited the fixture**

`pnpm db:seed` is idempotent, but re-seeding a *changed* fixture under the same
version number fails on purpose: published Agent Versions are immutable
(ADR-005). Bump the version in the fixture.

## Ports and processes

**A port is already in use**

`pnpm dev` binds 3000, 3001, 3002 and 3020 with `strictPort`, so it fails loudly
rather than drifting elsewhere. Find what holds it:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
```

Ports **3010** and **3102** are reserved for the end-to-end stack and no
application may bind them.

**`pnpm dev` started five things and I expected three**

The API, the browser worker, the demo portal, the library portal and Watchtower.
The browser worker's `dev` process only logs its identity — there is no queue and
no worker loop; the API executes runs (ADR-011), and one-off execution is
`pnpm agent:run`.

**Something survived a test run**

```bash
pnpm check:teardown
```

It probes 3000, 3001, 3002, 3010 and 3102 and reports any surviving Orbit service
process. Note it does **not** probe 3020, so a stray library portal is not
reported.

**`pnpm test:runtime` and `pnpm test:e2e:watchtower` interfere**

Run them as separate commands, never concurrently. The end-to-end stack runs a
long-lived API against `orbit_test` while the runtime tests truncate that same
database between their own tests. Sharing one project would pull the seeded Agent
Version out from under a live server.

## Watchtower

**The page shows an API error**

Watchtower talks to the API over `/v1` and surfaces failures rather than hiding
them. Check the API is up:

```bash
curl -s http://localhost:3002/health     # {"status":"ok"}
```

If the API is on a different host or port, set `ORBIT_API_URL` — that is what the
dev server proxies to.

**Nothing appears on Agents after publishing**

The catalog is re-read each time Agents becomes the active view. Navigate away
and back rather than reloading. If it is still missing, the publish did not
complete, and the review page says so.

**A link I saved stopped working**

It should not have. Navigation is query parameters and every view is a URL
(ADR-031): `?runId=`, `?documentId=`, `?view=documents`, `?view=agents`,
`?view=runs`, `?view=wiki&topic=…`. Studio's URL value is deliberately still
`documents`, so review links shared before the rename keep resolving.

## Recording and binding

**No browser window opened when I started a recording**

It opens on the machine running the **API**, not the machine running your web
browser. Against a remote API there is nothing to see locally. Also check
`ORBIT_RECORDER_HEADLESS` is not set to `true`; it defaults to headed for exactly
this reason.

**The recording session will not finish**

If the sequence cannot become a valid workflow, the session **stays open** and
says why. That is deliberate: the browser still holds the work, which is the one
thing in the flow you cannot repeat from memory. Fix what it names and finish
again. An idle session closes after thirty minutes, and any still open when the
API stops go with it.

**A capture was refused**

Selector candidates are verified at capture time to resolve to exactly one
element, and to the right one. A capture with no uniquely-resolving candidate is
refused rather than saved.

**A binding session vanished after a restart**

Binding and walkthrough sessions are held in memory (ADR-027). An API restart
drops them. The bindings already saved are unaffected.

**A step shows as approved but the panel says it is stale**

The step was edited after the binding was recorded. Approved and safe-to-run are
different facts; re-record the step.

## Compiling and publishing

**Compiling a candidate is refused**

The compiler refuses everything it cannot fully resolve rather than guessing
(ADR-021). The refusal names the cause — commonly an unbound step, a stale
binding, or a path that reaches no outcome.

**A `manual_review` step will not bind**

It routes to a person, so there is nothing to automate. That is not a failure.

## Running

**A run stopped and the error mentions drift**

The element a step was bound to no longer matches the fingerprint a person
approved. That is the check working. See
[ui-drift-recovery.md](./ui-drift-recovery.md).

**Bound agents that used to pass now fail**

The drift check went live in sub-phase 2.12. A binding recorded against a page
that has since changed now stops the run instead of acting on whatever it finds.
Re-record the step, or grant the document recovery and answer the proposal.

**An agent refuses to navigate somewhere**

Each Agent Version declares the domains it may open, and the runtime re-checks
before every navigation (ADR-022). A host that was not in the recording is not in
the list. Publish a new version from a recording that visits it.

**A run "succeeded" but did not find the record**

That is a business outcome, not a technical failure, and the two are separate
facts (ADR-006). A run that correctly establishes a record does not exist has
done its job.

**Two runs started when I clicked once**

There is no server-side duplicate suppression. Watchtower disables its button
while a request is in flight, but two tabs can start two runs and the API will
create two.

**I want to stop a running run**

You cannot. A started run runs to completion.

## Models

**Generating a draft is refused**

Either no model provider is configured — the response names the missing
variable — or a token ceiling was reached. Both are deployment configuration; see
[configuration.md](./configuration.md). Neither can be changed from the UI, by
design: a cap a client could raise for itself is not a cap.

**`DECISION_JUDGE_UNAVAILABLE`**

The agent contains a judged decision but no provider is configured, so no judge
was wired. It halts with that reason rather than running the decision unjudged.

**The API will not start after I changed model settings**

Two configurations stop the process on purpose: an unrecognised `LLM_PROVIDER` or
`LLM_INVOCATION`, and `LLM_PROVIDER=gemini` with `LLM_INVOCATION=bedrock` —
Bedrock does not serve Gemini, so nothing can satisfy it. A token ceiling that is
neither a whole number nor the word `unlimited` also stops startup, as does an
`ORBIT_LLM_DECISION_CONFIDENCE_MIN` outside 0–1.

**A deprecation notice about `ORBIT_LLM_PROVIDER`**

It still works. `ORBIT_LLM_PROVIDER=bedrock` sets `LLM_PROVIDER=anthropic` with
`LLM_INVOCATION=bedrock`, because the old variable held both axes at once. Prefer
the new names.

## Recovery

**A run drifted but no proposal appeared**

Three possibilities, in order of likelihood: the document has not been granted
recovery (it is off unless granted, and **there is no UI control for the grant** —
it is `POST /v1/sop-documents/{documentId}/recovery` with `{"enabled": true}`);
the step already has an open proposal; or the diagnosis refused. A diagnosis
refuses when nothing in the approved chain still finds the element, when more than
one locator does, or when the observation cannot support a diagnosis at all.

In every case the answer is to re-record the step.

**I accepted a proposal and the next run still failed the same way**

**Acceptance does not publish.** Accepting creates a binding through the ordinary
review path; a person must publish a new version before any run uses the change.

**Accepting was refused with a conflict**

The world moved under the proposal — the step was re-recorded or edited, or the
proposal was already resolved. A stale proposal is withdrawn, never adjusted to
fit.

## Still stuck

| | |
|---|---|
| Setup from scratch | [installation.md](./installation.md) |
| What a setting does | [configuration.md](./configuration.md) |
| How a feature is meant to work | [usage.md](./usage.md), or Watchtower's **Wiki** tab |
| Why it behaves this way | [`../architecture/decisions.md`](../architecture/decisions.md) |
