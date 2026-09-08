# Demo: recovering from a renamed test id

What this shows: an agent that worked yesterday stops today because someone renamed a
`data-testid`, Orbit works out what replaced it **without a model**, and proposes a repair a
person accepts in Studio. The run that hit the drift still fails, and stays failed — recovery is
about the next run (ADR-033).

## Why the drift is opt-in

Recovery is only demonstrable against a page that really changed, and the way not to pay for that
forever is to make the change opt-in per page load. `apps/library-portal` renames the catalog
Search button's test id **only** when the URL carries `?drift=1`:

```text
http://localhost:3020/catalog          catalog-search-button   (normal)
http://localhost:3020/catalog?drift=1  catalog-search-submit   (drifted)
```

Only the attribute moves. The role stays `button`, the accessible name stays "Search", the
visible label stays "Search" — which is what makes a confident, deterministic diagnosis possible
at all. There is nothing to revert: the portal in this repository is never a drifted portal.
The switch lives in `apps/library-portal/src/demo-drift.ts` and is pinned by three tests in
`apps/library-portal/tests/library.spec.ts`.

## Run it

```bash
docker compose up -d
pnpm db:migrate
pnpm db:seed:library          # grants recovery for this document (permissions.recovery)
pnpm dev                      # API :3100, Watchtower :3000, library portal :3020
```

1. Open the seeded workflow in Studio — the seed prints its URL.
2. Publish it. Every step already has an approved binding.
3. Edit the workflow's first step so its URL is `http://localhost:3020/catalog?drift=1`, then
   publish again. (A new Agent Version; the old one is untouched, as always.)
4. Start a run from Watchtower.

## What you should see

**The run fails.** Status `failed`, error `UNEXPECTED_UI_STATE`, on the step that clicks Search:

```text
Step "search_catalog" was stopped because nothing on the page matches
test_id=catalog-search-button any more. The workflow needs re-mapping before it can run again.
```

Its evidence carries a `recovery.proposed` event naming which locators were probed and whether
each resolved. It does **not** carry a click: Orbit did not act through the fallback.

**Studio shows a proposal.** In "What each step does on the page", inside the Search step:

> This step's element changed. Orbit thinks this is what replaced it.
>
> `test_id=catalog-search-button` no longer finds this element, but `role_and_name=button "Search"`
> still finds one whose role, name and label are exactly what was approved. That reads as the page
> renaming the element rather than replacing it.
>
> **Was** `test_id=catalog-search-button` · **Now** `role_and_name=button "Search"` · **Still** button "Search"
>
> Worked out by comparing what the page shows against what was approved. No model was involved.

**Accepting changes one thing.** It creates a new approved binding through the ordinary lifecycle
and supersedes the drifted one. It does not publish, does not touch the Agent Version that failed,
and does not start a run. Publish again and the next run passes.

## What to try next, to see the refusals

- **Dismiss instead.** Nothing changes. The approved binding is exactly as it was.
- **Re-record the step first, then accept.** Refused with a 409: the proposal is about a mapping
  that is no longer live, and accepting would supersede work newer than the proposal.
- **Turn the grant off** (`POST /v1/sop-documents/:id/recovery` with `{"enabled": false}`),
  publish again, and run. The run fails identically and there is no proposal and no
  `recovery.*` event — the page is not even probed on the agent's behalf.

## The automated version

`apps/browser-worker/src/drift-recovery.runtime.test.ts` does all of the above against a real
browser and a real database, and asserts the three claims that matter: the run fails, a proposal
is written, and the approved binding is untouched until a person accepts. It runs in
`pnpm test:runtime`.
