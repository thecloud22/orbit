# Task P2-011 — Information architecture, a real home page, and model configuration

**Status:** Complete
**Branch:** `phase-2-task-11-ia-and-model-config` (off `master` at `ec32b5f`)
**ADR:** ADR-031 (the Studio rename and the run-view weave, decided together)

Five changes, all driven by a person using the product. Four are execution; two of them share a
premise worth recording, and that is what ADR-031 is.

---

## 1. "Workflows" is now "Studio"

Tabs are **Home · Studio · Agents · Runs**, in the order the work moves through them: arrive,
author, run, observe. Studio moved to second position rather than staying last, because authoring is
what happens between arriving and running.

"Agents vs Workflows" gave two names to one idea and left neither meaning *authoring* — a published
agent came from a workflow, a workflow was on its way to becoming an agent, so "which tab holds the
thing I am about to edit?" was a coin toss. Studio was already this product's word for that surface;
`CLAUDE.md` has named it, opposite Watchtower, since Phase 1.

**The URL value stays `?view=documents`, and this was a decision, not an omission.** Review and
document links were shared before this navigation existed. Renaming a query parameter so it agrees
with a label breaks those links and buys nothing, because nobody reads `?view=`. The label is what a
person sees; the query value is an address, and an address's job is to keep resolving. `navigation.ts`
carries that reasoning inline so the next reader does not "fix" the inconsistency.

Changed: the nav label and order, `nav-workflows` → `nav-studio` (the test id derives from the label),
the e2e references, the Studio page heading (now "Studio", with a subline, rather than "Workflows"),
and App's "← Back to workflows" → "← Back to Studio". The noun *workflow* is unchanged everywhere it
still means one workflow, because it still does.

## 2. A real home page

`apps/web/src/HomePage.tsx` and `home-view-model.ts`, extracted out of `App.tsx`.

- **Hero** stating what Orbit is in terms of input, output and what makes it trustworthy: a written
  procedure in, a versioned agent out, evidence for every run.
- **The two ways in**, as named peers — "Describe it in your own words" and "Record yourself doing
  it" — with `SopDraftForm` and `RecordWorkflowForm` working unchanged. `guided-path-card` and
  `record-own-card` test ids preserved, so the existing e2e assertions still hold.
- **At-a-glance**: published agents, runs recorded, waiting in Studio, plus recent runs with their
  status and the half-finished workflows by name. Every figure links into the tab that owns it
  rather than becoming a fourth place to work.
- **A real empty state** for a fresh install: one instruction, not three zeroes.

Read from `GET /v1/agent-versions`, `GET /v1/runs` and `GET /v1/sop-documents`. **No endpoint was
added.** The three are fetched together and fail together — a dashboard with one blank box reads as
"you have no agents" rather than "this could not be loaded".

Two judgements worth naming, both tested:

- **"Fresh" requires all three to be empty**, not one. A deployment with a published agent and no
  runs is idle, not new, and telling that person to start by describing a procedure would be wrong.
- **An `approved` workflow is not counted as "waiting".** A document summary carries no binding
  state, so `approved` says nothing about whether its steps have been demonstrated. Claiming it is
  ready would be guessing; nagging about it would be nagging about something already done. It is
  counted as neither.

Verified against the user's own running dev server with real data (5 agents, 20 runs, 5 drafts) — not
only against fixtures. No icon library and no new dependency; the library portal's `lucide-react` was
deliberately not copied.

## 3. The binding panel is renamed

Heading: **"What each step does on the page"**. Lead: *the workflow above says what to do; this is
where — someone showed Orbit, in a real browser, the exact box to type in and the exact button to
press for each step.* Neither the heading nor the lead uses the word "binding", and an e2e assertion
now enforces that the lead does not. Per-row detail is unchanged.

## 4. Model configuration

**Default is now the cheapest current Claude model.** Drafting is bounded structured extraction
behind a strict schema and a repair loop — the validator is what makes the output trustworthy, not
model size — so Sonnet was buying judgement this task does not ask for.

| Variable | Default | Effect |
|---|---|---|
| `ORBIT_LLM_PROVIDER` | `anthropic` | `anthropic` or `bedrock`. Anything else **stops the API from starting**. |
| `ORBIT_LLM_MODEL` | `claude-haiku-4-5` / `anthropic.claude-haiku-4-5` | The model, for whichever provider is selected. |
| `ANTHROPIC_API_KEY` | — | Required by the `anthropic` provider. |
| `ORBIT_BEDROCK_REGION`, else `AWS_REGION`, else `AWS_DEFAULT_REGION` | — | Required by the `bedrock` provider. |

**Deviations from the brief, both deliberate:**

1. **The model id is `claude-haiku-4-5`, not `claude-haiku-4-5-20251001`.** The brief specified the
   date-suffixed form. The `claude-api` skill is explicit that current model IDs are complete as-is
   and date suffixes must never be appended — a suffixed id is a stale-training-data artifact. I used
   the real id and am flagging the correction rather than making it silently.
2. **The provider variable is `ORBIT_LLM_PROVIDER`, not `ORBIT_MODEL_PROVIDER`.** The brief asked for
   a name consistent with existing env naming, and the existing family is `ORBIT_LLM_*`
   (`ORBIT_LLM_MODEL`, `ORBIT_LLM_TOKEN_BUDGET_*`, `ORBIT_LLM_RATES_USD_PER_MTOK`). A new
   `ORBIT_MODEL_*` prefix would leave a reader guessing which of two families a variable belongs to.

**Shape.** `createSopProvider(config)` in `@orbit/sop-generation` is a factory in front of the
existing `LLMProvider` interface — not a new abstraction. It takes configuration; it does not read
`process.env`, because library code never does. `apps/api/src/model-provider-env.ts` is the entry
point's half, sitting beside `model-budget-env.ts` and following the same conventions. Every branch
is testable by passing a value rather than mutating a global.

`unvalidatedArguments` and `usageOf` moved to `structured-response.ts`, shared by both providers. That
is deliberate rather than tidy-minded: both providers must read a response *identically*, or a budget
would mean two different things depending on which was configured. That file imports no LangChain, so
it stays on the near side of the network boundary.

**Bedrock.** `ChatBedrockConverse` from `@langchain/aws@^1.4.5` (same major line as the pinned
`@langchain/anthropic@^1.5.9` and `@langchain/core@^1.2.9`). It satisfies the identical `LLMProvider`
contract including Task 8's token-usage reporting, so the spend ledger and all three budget scopes
behave the same whichever provider is active.

**Credentials are not Orbit's business.** There is no `accessKeyId` option and no Orbit variable for
one. Resolution goes through the AWS SDK's default credential provider chain — env vars, shared
profile, SSO, instance role, IRSA. Inventing a scheme beside it would be a second place a secret
could be typed, which CLAUDE.md forbids. The only thing Orbit must be told is the region, because
Bedrock is region-scoped.

**Rates.** `DEFAULT_MODEL_RATES` gained `anthropic.claude-haiku-4-5`, `anthropic.claude-sonnet-5` and
`anthropic.claude-opus-5`. The table is keyed by `descriptor.model`, and Bedrock reports a different
string for the same model — without these rows every Bedrock call would silently fall to
`FALLBACK_MODEL_RATE`, and the failure would surface as a spend readout three times too high rather
than as anything that looked broken. A new test ties both defaults to the table and fails if either
drifts out of it. The numbers are the first-party rates, which is an approximation stated as one:
Bedrock is partner-operated and prices separately, and a cross-region inference profile
(`us.anthropic.…`) needs its own entry because the id is the key.

**`createUnconfiguredSopProvider` behaviour is preserved.** A missing key, or a Bedrock deployment
with no region, still constructs successfully and fails on the one route that needs a model, naming
the variable. The one thing that now stops the API is an *unrecognised provider name* — on the same
reasoning `readTokenBudget` already used for a mistyped ceiling: a deployment that typed `bedrok`
meant Bedrock, and silently serving it Anthropic over the public internet, possibly from an account
that intended never to leave itself, is not a recovery.

## 5. The run view is one timeline

`RunPage` rendered Steps, Events and Evidence side by side, each complete and each in its own order,
so answering "what happened at the click, and what did the page look like afterwards?" meant joining
three lists by timestamp in the reader's head. The join was never missing from the data —
`RunEventView.runStepId` and `ArtifactView.runStepId` have named their step since Phase 1. Watchtower
was declining to use attribution it was already storing.

Now: one row per step in `sequence` order, with that step's own events and its own evidence inline.
Run-level events keep their own group. The trace, which belongs to no step, gets its own place. A
decision reports **"Took the *request not found* branch, and continued at `complete_not_found`"**
rather than `selectedAlternativeIndex: 1` — the index is an artifact of array ordering and means
nothing to a reader.

**Step rows are deliberately not collapsible.** Collapsing would shorten the page by putting evidence
back behind a click, which is the problem this change exists to solve. Density is managed by keeping
each step's summary to one line and never loading a screenshot until asked.

**The raw event stream is kept verbatim, collapsed, and in the DOM.** The woven view is a reading
aid; the stream is the record. Keeping it rendered rather than conditionally mounted also means an
event naming a step outside the run's step list — which the woven view does *not* place — is still
reachable. That gap is real, is tested for explicitly, and is the reason the stream is kept.

`run-timeline-view-model.ts` (new) holds the join, the branch description and the humanising as pure
functions. `EvidenceList.tsx` no longer exports a page-level list — it exports `EvidenceGroup` and
`EvidenceRow`, which the timeline places under each step; the lazy screenshot fetch through the API
client is unchanged.

**Self-caught defect.** The first working version rendered a `complete` step's output literally, so
the page showed `Outputs {"requestNumber":"SR-1002s"}` — a JSON blob next to a panel that had already
shown the same value properly. Caught by screenshotting a real run rather than by a test. Nested
objects now flatten one level and empty ones render nothing; three tests cover it.

## Also

`docs/demo/branching-library-demo.md` gained **"Draft it with AI instead"** — a ready-to-paste prompt
written in the register a real person would use (no step numbers, no selectors, decisions stated as
conditions somebody would check), which should produce the borrow-or-hold workflow including its
decision step. It states plainly that the draft is not runnable until its steps are demonstrated, and
that outcome names are now the workflow's own words (ADR-030).

---

## Verification

Every command run, with real output.

| Command | Result |
|---|---|
| `pnpm typecheck` | pass — all 22 workspace projects |
| `pnpm lint` | pass, clean |
| `pnpm format:check` | pass |
| `pnpm test` | **1075 passed**, 101 files (before the last two web additions; 220 web tests pass after) |
| `pnpm test:db` | **289 passed**, 23 files |
| `pnpm test:runtime` | **28 passed**, 5 files — includes the branching library demo |
| `pnpm test:e2e:watchtower` | **38 passed**, 38.5s |
| `pnpm test:e2e` | **9 passed** |
| `pnpm check:teardown` | ports 3000/3001/3002 held — **the user's own `pnpm dev`**, not a leak; nothing of the user's was killed |

**Manual verification against the live dev server**, since two of the five changes are visual and
tests do not judge design: the home page rendered with real data (5 agents, 20 runs, 5 drafts, nav
reading Home/Studio/Agents/Runs), and a real branching run rendered with 4 run-level events, 21 step
events, 8 evidence rows attributed to their steps, 25 raw events, and the branch callout reading
"Took the request not found branch, and continued at complete_not_found."

### Tests changed, and why

Three existing tests were updated deliberately rather than worked around:

1. **`packages/sop-generation/src/network-boundary.test.ts`** — the list of files permitted to import
   `@langchain/` is now two, not one. Still exhaustive, so a third provider must be added
   deliberately. The shared response reader is on the near side and imports no client.
2. **`apps/api/src/sop-provider-boundary.test.ts`** — asserted the entry point contains
   `createAnthropicSopProvider`; now asserts `createSopProvider`. **Every assertion about the fake
   provider is unchanged.** That guard exists to prevent a live path to a *test double* in a real
   deployment; selecting between two providers that both call a real model is not that hazard, and
   the file now says so.
3. **`apps/web/src/watchtower.e2e.test.ts`** — asserted the exact sentence I rewrote in the binding
   panel. Updated to the new wording, and *strengthened*: it now also asserts the heading and that
   the lead paragraph does not contain the word "binding", which is the actual requirement.

### On the reported e2e flakiness

The brief noted an undiagnosed ~340s run against a ~37s baseline. **Not reproduced.** Two full
watchtower runs this session: 37.0s (one failure, my own copy change) and 38.5s (38/38 pass). Both at
baseline. No evidence to add.

---

## Limitations, honestly

- **Bedrock is wired but untested against real AWS.** There are no AWS credentials in this
  environment. What *is* verified: the provider constructs, reports the right descriptor, is
  selected correctly from every environment shape, satisfies the `LLMProvider` type, wraps errors as
  `SopProviderError`, and has rate-table entries. What is **not** verified: that a real
  `ChatBedrockConverse` call returns a response whose `usage_metadata` this reads correctly, that
  `withStructuredOutput` + `includeRaw` behaves on Bedrock as it does on Anthropic, that the default
  model id is one any given account can actually invoke, and that the credential chain resolves as
  expected. **The correctness is structural, not demonstrated. Treat the first real call as the
  test.** Stated in the same terms in the README and `.env.example`.
- **The default model change is untested against a real model too** — every automated test uses the
  deterministic fake provider, by design. Whether `claude-haiku-4-5` needs the repair pass more often
  than Sonnet did on real SOP text is not something this repository can answer; the repair loop and
  the validator are unchanged, so a worse first attempt is corrected rather than trusted, but the
  *cost* of that (a second call) is a real possibility a deployment should watch.
- **An event whose `runStepId` names a step outside the run's step list appears only in the raw
  stream.** Tested for explicitly; it is why the stream is kept.
- **The home page fetches three lists and shows counts, not health.** "20 runs recorded" does not
  distinguish 20 successes from 20 failures; recent runs show status individually, but the stat card
  does not. Aggregating a success rate is a judgement about someone else's business outcomes, and
  ADR-030 is the reason not to make one casually.
- **`packages/execution-assist/src/anthropic-assist-provider.ts` still defaults to
  `claude-sonnet-5`** and was left alone. It is a separate provider with its own default, outside
  this task's scope; changing it would have been unrequested scope creep. Flagging it because "the
  code defaults to the cheapest model" is now true of drafting and not of assist.
- **No visual regression testing exists**, so the home page and run view are verified by e2e
  assertions on structure plus my own screenshots. A future change could degrade the layout without
  failing anything.
