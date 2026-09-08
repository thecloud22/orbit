# Task P2-013 — One provider abstraction, three model families, two invocation paths

**Branch:** `phase-2-task-13-provider-abstraction` (off `master` at `ec4d9c4`)
**Status:** Complete. Not committed, not merged, not pushed.
**ADR:** **ADR-034** — One selection layer for every model call, with family and invocation as separate axes.

## What was asked, and the structural point

The user asked to choose between Anthropic and Gemini with `LLM_PROVIDER`, keep Bedrock, and have
the deployment environment decide direct-versus-Bedrock without application logic changing.

Three packages called a model, not one. Had only the drafting factory learned about Gemini,
`LLM_PROVIDER=gemini` would have moved drafting and silently left judged decisions and authoring
advice on Claude — spending from the same budget, writing into the same ledger, and looking entirely
coherent. That is the failure the requirement is written to prevent, and it drove the shape below.

## What was built

**A new package, `@orbit/model-provider`,** owning exactly four things: which family, reached how,
with which credential, at which model id — plus one reader for token usage. All three call sites
resolve and construct through it.

| File | What it owns |
|---|---|
| `packages/model-provider/src/selection.ts` | The two axes, the env vocabulary, defaults, deprecated aliases, the invalid-combination refusal. Reads no `process.env`. |
| `packages/model-provider/src/chat-model.ts` | The **only** file in the repository that constructs a model client. Anthropic, Gemini, Bedrock. |
| `packages/model-provider/src/usage.ts` | `usageOf`, formerly duplicated in two packages. |
| `packages/model-provider/src/deprecation.ts` | Emits each deprecation notice once per process, to an injectable sink. |

**Two orthogonal axes.** `LLM_PROVIDER` = `anthropic` | `gemini` (family). `LLM_INVOCATION` =
`direct` | `bedrock` (transport), default `direct`. Same build, direct locally and through Bedrock
in production, one environment variable, no code change.

**Domain contracts were deliberately not merged.** `LLMProvider` returns an unvalidated proposal for
a repair loop, `DecisionModel` returns an index, `AssistProvider` returns an advisory verdict — three
different failure meanings, and one interface over them would have had to be the weakest. Each
package keeps its interface and binds its own schema; none keeps a client.

Consumers, all of which lost their provider-specific code entirely:

- `packages/sop-generation/src/chat-provider.ts` replaces `anthropic-provider.ts` **and**
  `bedrock-provider.ts` — which were the same file with a different constructor at the top.
- `packages/decision-judge/src/decision-model.ts` replaces `anthropic-model.ts`, and its private
  copy of `usageOf` is gone.
- `packages/execution-assist/src/chat-assist-provider.ts` replaces `anthropic-assist-provider.ts`.
  This was the call site an earlier task left out of scope; it is in now.

Entry points (`apps/api/src/index.ts`, `apps/browser-worker/src/cli/judge.ts`,
`apps/recorder/src/cli/record-binding.ts`) each resolve once from `process.env` and pass a value.
`apps/api/src/model-provider-env.ts` shrank from ~90 lines to one delegating function.

## Decisions worth naming

**`gemini` + `bedrock` fails at startup resolution**, with a message naming the problem and both ways
out. Bedrock does not serve Google's models, so the configuration cannot be satisfied by anything;
the alternative is an opaque "model not found" from someone else's API on the first request.

**A mistyped value stops the process; an absent one does not.** Unrecognised `LLM_PROVIDER` or
`LLM_INVOCATION` throws — `gemni` meant Gemini, and serving Anthropic instead bills an account
nobody chose. Missing credentials return `unconfigured`, so every `createUnconfigured*` behaviour is
preserved exactly: the API boots, unrelated routes work, and the route that needs a model names the
missing variable *and* the feature it disabled.

**Deprecated aliases translate rather than merely survive.** `ORBIT_LLM_PROVIDER=bedrock` meant
Claude through Bedrock, so it now sets `anthropic` + `bedrock` — the same behaviour under a name
that can express it. New names win when both are set. One warning per process; never a boot failure.

**The ledger keeps its existing vocabulary.** `providerLabel` reports `bedrock` when invocation is
Bedrock and the family otherwise, so `model_usage` still holds `anthropic` and `bedrock` meaning what
they always meant, with `gemini` the only new value. No migration.

**Gemini's default is `gemini-2.5-flash-lite`** — Google's cheapest generally available model that
still supports the function calling structured output is built on, and roughly a tenth of Flash's
output rate. Model availability changes faster than the code does, hence one variable to override.
Rate rows added for `gemini-2.5-flash-lite` (0.10/0.40), `gemini-2.5-flash` (0.30/2.50) and
`gemini-2.5-pro` (1.25/10.00) USD per million tokens, from Google's published list prices for
standard-context prompts.

**The rate/default test now iterates the selection layer** (`DEFAULT_MODEL_IDS`) instead of a
hand-written list, so a new family or default cannot be added without a rate. Without a row a call
silently falls to `FALLBACK_MODEL_RATE` — conservative, so the failure shows up as a spend readout
several times too high rather than as anything that looks broken.

**On the judge's bound under Gemini — stated plainly rather than papered over.** Gemini's structured
output rests on a schema subset that does not carry every JSON Schema keyword, so a numeric range
there is a request rather than an enforcement. This does **not** weaken Task 9, because the bound was
never the provider's to keep: the index is constrained three times, and the third — `@orbit/runtime`
re-validating independently before the index reaches control flow — is the guarantee, and it is
outside every provider. ADR-032's guarantees are unchanged. This is now written in
`decision-model.ts`, in ADR-034, and in the README.

## Boundaries

`packages/runtime/src/decision-judge-boundary.test.ts` still bites, and now names
`@orbit/model-provider` on its forbidden list — for the strongest reason on that list: the shared
package is a single, convenient, reasonable-looking import that would hand the process executing
approved steps the ability to call any model for any reason. **Verified it still fails when it
should**: the test walks the whole workspace dependency closure, and `@orbit/runtime`'s closure was
re-walked after every package manifest in this change.

Each package's containment test was tightened rather than relaxed. `@orbit/sop-generation` counts
files that can *construct* a client (`createChatModel`) rather than files that name the package, so
`provider-factory.ts` taking a resolved selection as a **type** and `structured-response.ts`
re-exporting a pure function are correctly not counted; a second assertion proves no file imports
`@langchain/*` directly any more. Equivalent assertions added to the judge and assist packages.

## Verification — actual output

| Command | Result |
|---|---|
| `pnpm typecheck` | pass (no output) |
| `pnpm lint` | pass, 0 problems |
| `pnpm format:check` | pass, all files |
| `pnpm test` | **117 files, 1230 tests passed** |
| `pnpm test:db` | **25 files, 303 tests passed** |
| `pnpm test:runtime` | **7 files, 36 tests passed** |
| `pnpm test:e2e:watchtower` | **1 file, 38 tests passed** |
| `pnpm test:e2e` | **9 passed** |
| `pnpm verify:phase1` | every stage passed; `check:teardown` failed — see below |

`check:teardown` reported ports 3000 and 3001 held. **This is not a leak from this work.** The
holders are two Vite dev servers under `apps/web` and `apps/demo-portal`, started at 17:27, hours
before this run began — the user's own `pnpm dev`. **Nothing was killed.** Every suite above ran
against them, and `test:runtime` and `test:e2e:watchtower` both reported "Reusing the demo portal
already listening on port 3001".

## Self-caught defect

While reviewing before writing this report: `readModel` honoured the deprecated `ORBIT_LLM_MODEL` for
whichever family was selected. That variable predates a second family, so every value anyone has ever
put in it is a Claude or Bedrock id — a deployment setting `LLM_PROVIDER=gemini` while an old
`ORBIT_LLM_MODEL` sat in `.env` would have sent `claude-haiku-4-5` to Google's API and got a
"model not found" for a variable it thought it had left behind. It is now ignored for the Gemini
family, with a notice saying so, and pinned by a test.

## Limitations, stated precisely

**Gemini and Bedrock are structurally verified and never exercised.** There are no Google or AWS
credentials in this environment.

*Demonstrated by test:* the selection resolves on every axis combination; the client constructs on
all three routes; a schema binds on each; the descriptor and ledger label are right; token usage is
read from LangChain's normalised shape; the rate table prices every default; the invalid combination
refuses; the unconfigured paths degrade correctly; no package boundary is crossed.

*Not demonstrated:* that a real Gemini or Bedrock endpoint replies the way this code expects — in
particular that Gemini's structured-output conversion of these specific zod schemas produces what
`parsed`/`raw` reading assumes, and that its `usage_metadata` arrives in the shape `usageOf` reads.
Treat the first real call on either as the test.

**No test in this repository calls a model, on any provider, including Anthropic.** The user's real
`ANTHROPIC_API_KEY` was never read, printed, logged, or committed; the Anthropic path is exercised
only by constructing clients, which opens no connection.

**Authoring advice changed model.** It defaulted to Sonnet and now takes the deployment-wide default
(Haiku or Flash-Lite). Reading a role, an accessible name and some text and saying whether they look
related does not need a larger model, and this assist runs on every step a person records. A
deployment that disagrees sets one variable. Real behaviour change, worth a line in a changelog.

**LangChain major versions differ across the client packages.** `@langchain/google-genai@2.3.0`
sits beside `@langchain/anthropic@1.x` and `@langchain/aws@1.x`. It peer-depends on
`@langchain/core ^1.2.9` — the exact pin already in use — so they are consistent on the thing that
matters, but the version numbers do not line up and a reader should not expect them to.

**`apps/api/src/model-provider-env.test.ts` was deleted rather than rewritten.** Its subject moved
wholesale into `packages/model-provider/src/selection.test.ts`, which covers strictly more; the file
that remains is a one-line delegation with nothing left to assert independently.

## Files

New: `packages/model-provider/**` (package manifest, tsconfig, 4 sources, 4 test files);
`packages/sop-generation/src/chat-provider.ts`; `packages/decision-judge/src/decision-model.ts` and
its test; `packages/execution-assist/src/chat-assist-provider.ts` and its test.

Deleted: `packages/sop-generation/src/anthropic-provider.ts`, `bedrock-provider.ts`;
`packages/decision-judge/src/anthropic-model.ts`;
`packages/execution-assist/src/anthropic-assist-provider.ts`;
`apps/api/src/model-provider-env.test.ts`.

Modified: the three consumer packages' manifests, indexes and boundary tests;
`packages/model-budget/src/rates.ts`; `packages/runtime/src/decision-judge-boundary.test.ts`; the
three entry points and their manifests; `apps/api/src/model-budget-env.test.ts`; `.env.example`;
`README.md`; `docs/architecture/decisions.md`; `docs/tasks/ACTIVE_TASK.md`.

Net: **578 insertions, 1042 deletions** across 32 tracked files, plus the new package.
