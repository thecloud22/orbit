# Using Orbit

Building a workflow of your own, from nothing to a run with evidence.

Watchtower's **Wiki** tab covers the same ground in-app and in shorter form. This
page is the fuller version, with the reasoning and the commands.

---

## The path

```text
record or draft  ->  review  ->  bind  ->  compile  ->  approve  ->  publish  ->  run
```

Each arrow is a deliberate human act. Nothing advances a workflow on its own.

## 1. Get a first draft

### Record yourself doing it

From Watchtower's **Home**: a title, a starting URL, **Start**. A real browser
opens and you do the task in it. The live page lists what has been captured as
you go; **Finish** compiles it and opens the new document in Studio.

From a terminal:

```bash
pnpm record:workflow -- --title "Find a service request" \
  --start-url http://localhost:3001/requests
```

Recording captures the steps **and their bindings together**, because both
describe the same interaction. That is the main practical advantage over
drafting: a recorded workflow arrives already knowing which element each step
acts on.

What it produces is a **linear draft**. One walk through a task takes one path,
so it cannot honestly produce a branch nobody took — decisions are added
afterwards on the review page. An `outcome` step is appended because a recording
ends when you stop, and every path has to reach a terminal.

Two things to know:

- **The browser opens on the machine running the API.** Pointed at a remote API
  from a laptop, no window appears on the laptop.
- **Passwords are never read.** A value typed into a password field does not
  leave the page. The recorder reports the field without it, and the translator
  declares a `secret` input and points the step at it — which the graph validator
  requires anyway, since a sensitive fill holding a literal is rejected.

Recording may target any `http` or `https` URL, including a real website, because
a person is driving. Other protocols — `file:`, `data:`, `javascript:` — are
refused before a browser opens.

> External sites are real systems. Do not record a workflow that performs a
> state-changing action on one, and do not automate a site whose terms forbid it.

### Or describe it in words

From **Home**, write the procedure the way you would explain it to a new
colleague, and press **Generate**. Orbit reads it and proposes a structured
workflow.

Needs a model provider configured — see [configuration.md](./configuration.md).
The output is re-parsed through the same validator that guards every other
document before anything is stored: a model proposes, it never writes into the
graph directly.

A drafted workflow arrives with **no bindings**. It says "the field labelled
Request number" and nothing yet says which element that is.

## 2. Review it

Open the document in **Studio**.

A document holds an ordered history of **revisions**. A revision is immutable and
checksummed: editing a step does not overwrite anything, it produces the next
revision. That is what makes it possible to say later exactly what a run was
compiled from (ADR-016).

On the review page you can:

- Edit a step's wording, insert a step, or reorder the sequence
- Answer the clarifying questions a draft raised
- Add the branches a recording could not take, and the outcomes each path reaches
- See, per step, whether an Execution Binding exists and how far it got

### Outcomes are the workflow's own

A workflow declares the business outcomes it can reach, on its own outcome steps.
An outcome name matches `^[a-z][a-z0-9_]{0,63}$`. The single reserved name is
`none`, meaning a run reached no business conclusion. There is no fixed
vocabulary to choose from (ADR-030).

`request_found` and `request_not_found` are ordinary names under that rule, not a
closed enum — they are simply what the seeded Phase 1 agent happens to declare.

**A business outcome and a run status are different facts** (ADR-006). A run that
correctly establishes that a record does not exist has *succeeded* technically
and reached a *not-found* outcome. Neither answers the other, and Watchtower
shows them separately.

### Approving is not publishing

Approving a revision does not make anything runnable. The SOP Graph is
non-executable by construction. Compiling and publishing are separate acts.

## 3. Bind the steps

An approved step says what to do; an **Execution Binding** says which element to
do it to — an ordered chain of locators plus a fingerprint of the element as it
looked when a person confirmed it.

A recorded workflow is already bound. A drafted one is bound step by step from
the review page, in a sitting that holds one browser open (ADR-027).

For a single step from a terminal:

```bash
pnpm record:binding -- --document sopdoc_...
```

Either way **a person demonstrates the step for real**, and Orbit shows what it
captured — the selector chain, the fingerprint, the value source — before saving
anything. A capture with no candidate that uniquely resolves to the right element
is refused rather than saved.

A `manual_review` step is listed but cannot be bound: it routes to a person, so
there is nothing to automate.

The binding panel reports two things separately because they are different facts:

- **Status and staleness.** An *approved* binding whose step has since been
  edited is still approved and still not safe to run.
- **Status and history.** `superseded` is never a current status; re-recordings
  show as a count.

The panel is **read-only, permanently**. Recording a binding means a person
demonstrating in a real browser, which a web page cannot witness, so creating one
happens in the recorder and nowhere else.

## 4. Compile, approve, publish

**Compile** turns the approved revision into a candidate Agent IR. It refuses
everything it does not fully understand rather than guessing (ADR-021) — commonly
an unbound step, a stale binding whose step was edited after recording, or a path
that reaches no outcome. The refusal names the cause.

**Approve** the candidate, then **Publish**.

Publishing **mints a version rather than promoting the candidate**. The runtime
executes only `published` documents and the compiler emits `draft`, so the two
can never be byte-identical — and that difference *is* the approval gate, since a
candidate identical to a runnable version would be runnable before anyone
approved it. Exactly two fields differ, and a check verifies that against what
was actually stored, so a widened permission or an added step cannot ride along
(ADR-023).

A recorded workflow can take all three in one **Publish** action from its review
page; the result is checked to be equivalent to what the step-by-step path
produces (ADR-025).

Versions are allocated per agent — `0.1.0`, `0.1.1`, … — rather than supplied,
and a version is immutable once minted (ADR-005). Archiving retires the agent's
identity; it never deletes or edits a version (ADR-026).

### What an agent may open

Each Agent Version declares `permissions.browser.allowedDomains`. The semantic
validator checks it at publish and the runtime re-checks it before every
navigation, so an agent may open the hosts its recording visited and nothing else
(ADR-022). A host that was not in the recording is not in the list; publish a new
version from a recording that visits it.

## 5. Run it

From **Agents**: pick the version, fill in its declared inputs, **Start run**.

From a terminal:

```bash
pnpm agent:run -- --help
```

`ORBIT_BROWSER_HEADED=true`, or `--headed`, shows the automation browser — useful
for diagnosing a step behaving differently than it did when recorded.

### Limitations worth knowing before you rely on it

- **Runs execute inside the API process.** No queue, worker fleet or scheduler
  (ADR-011).
- **No server-side duplicate suppression.** Watchtower disables its button while
  a request is in flight, but two tabs can start two runs and the API will create
  two. That is a UI guard, not a server guarantee.
- **No cancellation.** A started run runs to completion.
- **No authentication.** Every request is the fixed development actor, and any
  caller who can reach the API can read any run and its evidence.

## 6. Read the evidence

Evidence is a product feature, not debug output (ADR-004). Every run persists
enough to reconstruct the execution from stored data alone.

| Recorded | Tells you |
|---|---|
| The exact Agent Version id | Precisely which immutable workflow executed |
| Validated inputs | What it was asked to do |
| Run and step status transitions | Where it got to, and in what order |
| Structured events | Navigation, fill, click, extract, assertion results |
| Screenshots | After navigation, fill, click, and the final state |
| DOM snapshots | After navigation and after a state-changing click |
| A Playwright trace | Every run, always |
| Extracted values | What a successful lookup read off the page |
| Typed error data | For a failure, what kind it was |

Bytes live under `ARTIFACT_STORAGE_DIR` (default `./data/artifacts`, gitignored);
metadata and links live in PostgreSQL.

`data/artifacts` is **never statically served**. Evidence leaves Orbit only
through the run-scoped artifact route, which addresses it by two opaque ids,
proves the artifact belongs to that run, reads through the artifact service using
the *persisted* storage key, and verifies the digest before sending a byte. A
caller never supplies a key or a path, and no response ever contains one.

Screenshots are served `inline`; everything else — a DOM snapshot especially — is
an `attachment` with a locked-down `Content-Security-Policy`, so a captured page
cannot execute on the API's origin.

## When a run stops because the page changed

That is the drift check working. See
[ui-drift-recovery.md](./ui-drift-recovery.md).

## Related

| | |
|---|---|
| Scripted demos | [`../demo/`](../demo/) |
| Configuration | [configuration.md](./configuration.md) |
| Something is broken | [troubleshooting.md](./troubleshooting.md) |
| Why any of this is shaped this way | [`../architecture/decisions.md`](../architecture/decisions.md) |
