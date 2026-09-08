# TASK-P3-009 / 010 — API operation catalog and `api.request` (sub-phases 3.9, 3.10)

**Status:** Complete. Non-blocking. 3.11 (SOP `call` kind and Studio) is **not** done.

**Branch:** `phase-3-task-9-api-catalog`.

## What exists now

A workflow can call an API operation from a contract its owner published. Three packages:
`@orbit/api-catalog` (import, pure), `@orbit/executor-http` (issue), and the `api.request` step with
its permission section.

## The design that everything else follows from

**A step names an `operationId` in a catalog. There is no URL anywhere in the Agent IR.**

This is ADR-018's argument applied to endpoints. A locator vocabulary is closed so no raw CSS
selector — a small program for walking the DOM — can be expressed. A URL template with interpolation
is a small program for constructing a request, and it has the same problem for the same reason. What
an agent may call is therefore bounded by a contract its owner documented, not by what somebody typed
into a box.

Three consequences follow:

- **`permissions.api.allowedHosts` is derived by the compiler from the catalog's declared servers**,
  the pattern ADR-022 set for `allowedDomains`, and re-checked by `assertApiHost` immediately before
  the request leaves the machine.
- **Values fill named slots, never a template.** A path parameter is `encodeURIComponent`-ed into its
  own segment and a query parameter goes through `URLSearchParams`. A test asserts that an argument
  of `../admin?x=1` stays one path segment and contributes no query parameter — a value cannot escape
  into the structure of the request.
- **The catalog is held by the deployment, not embedded in the published version.** A contract is a
  fact about a service that can be re-imported; the *grant* — which operations, which hosts — is what
  was reviewed and is immutable.

## The import refuses rather than approximates

Following ADR-021: an operation that cannot be fully understood is **named** as a refusal rather than
partially imported, because a half-understood operation in a catalog is worse than an absent one — it
looks callable. Refusal reasons: `missing_operation_id`, `unsupported_parameter_type`,
`unresolved_reference`, `not_idempotent`.

`$ref`, non-string parameters and polymorphic bodies are refused rather than approximated. Agent IR
has one value type, so an operation needing more than strings could not be expressed by a step even
if it could be parsed.

**Non-idempotent operations are refused by name.** `POST` and `PATCH` need the idempotency-key design
the vision document defers to Phase 5. Idempotence is derived from the method per the HTTP spec
rather than asserted by a human.

## Response mapping is JSON Pointer, not JSONPath

JSONPath has filters and wildcards and is an expression language, which ADR-007 rules out. A pointer
walks a path and cannot express a filter or a computation.

A non-scalar at the end of a pointer is reported as **absent** rather than stringified — an object
turned into `[object Object]` is not a value a workflow can meaningfully compare, and silently
producing one would be the sort of thing discovered in production.

## Evidence

`api_exchange` — the request and response envelopes. Without it the surface has no evidence and
Watchtower's expected-versus-observed view has nothing to show for the step (ADR-004).

**Sensitive headers are redacted by name**, not by inspecting the value: a bearer token and an
ordinary string are indistinguishable once both are strings. The event payload records the URL,
method and status; the body goes only to the artifact store, so it passes the evidence path once.

## Verification

| Check | Result |
|---|---|
| `tsc --noEmit` per package (23) | clean |
| `eslint .` / `prettier --check .` | clean |
| `vitest run` | **1456 passed** (138 files), up from 1441 |
| `test:db` | **331 passed** |

Fifteen new tests. The ones carrying the design: an argument cannot escape its slot; a `$ref` and a
non-string parameter are refused by name; a document with no absolute server URL is refused because
no host could be permitted; an `authorization` header does not reach the evidence; a non-JSON body is
not treated as a failure.

Migration `0012` adds `api.request.completed` to the `run_events` CHECK constraint. Additive.

## Known limitations

- **3.11 is not done.** There is no SOP Graph `call` intent kind, no binding from a drafted step to a
  catalog operation, and no Studio surface. An `api.request` workflow must be hand-authored in Agent
  IR, exactly as a terminal one must.
- **No request bodies.** Only path, query and header parameters. `POST` being refused as
  non-idempotent means the gap has no consumer yet.
- **No authentication on API calls.** `permissions.credentials` exists (3.3) but `api.request` does
  not yet resolve a credential into a header. This is the obvious next increment and is small.
- Only the first host in a catalog is used to build the URL; a multi-server contract silently prefers
  the first.
- OpenAPI import is deliberately partial — not a general implementation, and it does not read
  response schemas at all, so an `assign` pointer is unvalidated until the call runs.
