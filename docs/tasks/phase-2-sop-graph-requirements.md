# Phase 2 Requirements: Natural-Language SOP to Reviewable Workflow Graph

## Status

**Draft product and architecture requirements.**

This document defines the intended Phase 2 direction for Orbit. It is a planning artifact, not an implementation authorization. Individual tasks must still be planned, reviewed, tested, and committed separately.

## Product Goal

Let a business user describe a browser-oriented standard operating procedure (SOP) in normal free-form language. Orbit converts that text into a structured, reviewable, editable SOP Graph and asks clarification questions wherever details are incomplete or ambiguous.

The user must be able to describe steps such as:

- Go to a URL.
- Enter a value into a named field.
- Click or select a named page element.
- Extract a displayed value.
- Make a decision based on what is visible or extracted.
- Open another URL or system.
- Return a structured result.
- Route an exception to a manual-review outcome.

### Worked example: multi-system service request escalation review

The following is the reference example for Phase 2. It is deliberately longer than a toy flow because it exercises login, a date-range filter, several extractions, nested decisions, a second system, a third system lookup that may be unavailable, a validation check, and multiple distinct terminal outcomes.

Example user-authored SOP text:

> Go to the service request portal and sign in with my login ID and password. If the portal shows a password-expired notice, stop and send it to manual review — do not try to reset anything.
>
> Once I'm in, open Advanced Search, enter the request number, set the date range to the reporting start date through the reporting end date, and click Search.
>
> If nothing comes back, return not found. If more than one request comes back, send it to manual review because the request number should be unique.
>
> Otherwise open the request and pull Status, Priority, Assigned Team, Opened Date, and Last Updated Date.
>
> If Status is Closed, just return the request details and stop — no escalation review is needed.
>
> If the request is still open and Priority is P1 or P2, this is an escalation candidate. Compare Last Updated Date to today. If it has gone more than the stale-days threshold without an update, mark it stale.
>
> For escalation candidates, open the team directory in the other system, search for the assigned team, and pull the team manager name and the manager's email. If the team directory has no entry for that team, send it to manual review saying the team is unmapped.
>
> If the request is marked stale and we have a manager, also open the on-call schedule page, look up the assigned team, and pull the current on-call engineer. If the on-call page doesn't list that team, don't fail — just leave on-call blank and note it.
>
> Before finishing, check that the assigned team from the request matches the team name shown in the directory record. If they don't match, send it to manual review saying the team name is inconsistent.
>
> Finally return the request details, the manager name and email, the on-call engineer if we found one, and whether this is a stale escalation.

This single example produces roughly twenty-six steps, five decision points, three terminal outcome types, and three manual-review paths. It is the reference flow used throughout the rest of this document.

#### Expected shape of the proposed graph

```text
1.  navigate       Service request portal sign-in page
2.  fill           Login ID          <- run input: userId
3.  fill           Password          <- run input: password (secret, declaration only)
4.  click          Sign in
5.  decision       Password-expired notice shown?
                     yes -> manual_review: credential_expired
                     no  -> continue
6.  click          Open Advanced Search
7.  fill           Request Number    <- run input: requestNumber
8.  fill           Date From         <- run input: reportingStartDate
9.  fill           Date To           <- run input: reportingEndDate
10. click          Search
11. decision       How many matching requests were returned?
                     none          -> outcome: not_found
                     more than one -> manual_review: ambiguous_request_number
                     exactly one   -> continue
12. click          Open the matching request
13. extract        status, priority, assignedTeam, openedDate, lastUpdatedDate
14. decision       Is the request closed?
                     yes -> outcome: closed_no_review
                     no  -> continue
15. decision       Is priority P1 or P2, and has the request gone longer than the
                   stale threshold without an update?
                     yes -> isStaleEscalation = true,  continue
                     no  -> isStaleEscalation = false, continue
16. navigate       Team directory system
17. fill           Team search field   <- variable: assignedTeam
18. click          Search directory
19. decision       Was a directory entry found for the assigned team?
                     no  -> manual_review: team_unmapped
                     yes -> continue
20. extract        teamManagerName, teamManagerEmail, directoryTeamName
21. decision       Does directoryTeamName match assignedTeam?
                     no  -> manual_review: team_name_mismatch
                     yes -> continue
22. decision       Is this a stale escalation?
                     no  -> go to step 26
                     yes -> continue
23. navigate       On-call schedule page
24. fill           Team lookup field   <- variable: assignedTeam
25. extract        onCallEngineer (optional; absence is not a failure)
26. outcome        completed — return request details, manager name and email,
                   on-call engineer if found, and isStaleEscalation
```

Note what this example deliberately forces Orbit to handle:

- A condition that must **not** be auto-remediated (password expiry routes to a human instead of a reset flow).
- A cardinality decision (zero / one / many results) rather than a simple yes-no branch.
- A derived value (`isStaleEscalation`) computed from an extracted date and a run input threshold.
- A conditional sub-path (steps 23-25) that only some runs traverse.
- An **optional** extraction whose absence is tolerated, sitting next to **required** extractions whose absence is not.
- A cross-system consistency check that produces its own manual-review outcome.
- A final outcome whose payload includes a value that is only available on some paths.

#### Clarification questions Orbit should raise for this example

- What visibly indicates "password expired" versus an ordinary failed sign-in?
- Is "nothing comes back" an empty results table, a zero-count label, or a no-results message?
- What counts as "still open" — every status that is not `Closed`, or a specific list of statuses?
- Is the stale threshold fixed, or a run input? (Proposed: run input `staleDaysThreshold`.)
- Is staleness measured from Last Updated Date, or from Opened Date when the request was never updated?
- Should team-name matching be exact, case-insensitive, or whitespace-trimmed?
- Is the team directory part of the same signed-in session, or a separate system requiring separate access?
- If the on-call page loads but the team row is missing, is that blank-and-note or manual review?
- Should the returned payload include manager details when the outcome is `closed_no_review`?

#### Assumptions Orbit should surface for this example

- Every step is read-only; no step modifies the service request, the directory, or the schedule.
- The portal session persists across the directory and on-call navigations unless the user says otherwise.
- "P1 or P2" is a literal match against the extracted priority value.
- The date range applies only to the Advanced Search filter, not to any later lookup.

The user writes ordinary text. The user is never required to author JSON, Agent IR, Playwright code, selectors, a graph DSL, or browser automation code.

## Core Principle

Orbit must separate business/browser intent from executable browser automation:

```text
Free-form SOP text
        ↓
Proposed SOP Graph
        ↓
User review, edits, clarification answers, and approval
        ↓
Later technical execution mapping
        ↓
Later candidate Agent IR
        ↓
Separate publish/run approval
```

An SOP Graph is a structured, editable, reviewable draft. It is not executable.

## Required User Experience

### Free-text SOP authoring

The standard UI must provide a large plain-language text area where a user can type an SOP freely.

The authoring UI should prompt for useful information without requiring a rigid template:

- Starting URL or system name.
- User-provided values required at run time.
- Values to enter.
- Page elements to click/select.
- Values to extract.
- Decision branches and exception paths.
- Additional URLs or systems to visit.
- Expected final outputs/outcomes.

The SOP text may include URLs as draft references. Drafting text must not cause Orbit to navigate, fetch, probe, or otherwise contact a user-supplied URL.

### Generated graph review

Orbit must render the generated workflow in plain language as a readable ordered flow with branches, inputs, outputs, assumptions, risks, and clarification questions.

The standard user experience must not expose raw JSON by default.

The review UI must clearly display a message equivalent to:

> Draft only — this workflow is not executable and cannot start browser automation.

### Step editing

Every SOP Graph step must have a structured JSON representation and be individually editable.

The default editor must be step-specific and form-based. Examples:

- Navigate: URL and purpose.
- Fill: field description and value source.
- Click: target description and purpose.
- Extract: list of fields to collect.
- Decision: question and branches.
- Outcome: outcome type and message.
- Manual review: reason and handoff description.

An optional advanced JSON editor may be provided for technical reviewers. It must be clearly labeled as advanced and must never be required for ordinary users.

Every JSON edit must pass JSON syntax validation, step-schema validation, and graph-level validation before it can be saved.

### Step reordering

Users must be able to reorder steps using accessible move-up/move-down controls. Drag-and-drop may be added if it is accessible and does not replace keyboard-accessible controls.

Reordering is not a blind array operation. After every proposed reorder, Orbit must validate:

- Reachability and valid branch targets.
- That all paths terminate in an outcome.
- That no required input, extracted value, or variable is used before it is available.
- That a move does not break decision-branch structure.
- That the initial supported graph version has no unsupported cycles or loops.

If a move would invalidate the graph, Orbit must reject it or explain the dependency conflict in plain language.

Example:

> Cannot move “Search the team directory for the assigned team” before “Extract request details” because the moved step uses Assigned Team, which is produced later in the workflow.

A second example, from the same flow:

> Cannot move “Look up the on-call engineer” above “Decide whether this is a stale escalation” because the on-call lookup is only reachable on the stale-escalation branch. Moving it would place it on paths where that decision has not been made.

### Clarification questions

Orbit must generate focused clarification questions instead of silently inventing missing business or browser details.

Questions may concern:

- What URL/system is intended.
- What visible condition means a record was found or not found.
- What field/page description identifies a value to enter or extract.
- What should happen when a value is missing.
- Whether a step is read-only or causes an external change.
- What final outputs should be returned.
- Whether a later system requires separate access.
- Whether an ambiguity should route to manual review.

Users answer questions using plain-language text, selection controls, or simple form fields. Answers become part of a revisioned draft; they must not execute external actions.

### Approval

The user must be able to approve, reject, or revise a graph.

For this Phase 2 scope, approval means only:

> The reviewed SOP Graph accurately represents the intended process.

Approval must not:

- Create an Agent Version.
- Publish an Agent Version.
- Invoke Playwright.
- Start a run.
- Navigate to URLs.
- Fetch external resources.
- Send notifications.
- Change external systems.

## SOP Graph Requirements

### Intent-level, non-executable model

The SOP Graph is browser-oriented but implementation-neutral. It describes what the user intends to do, not how Playwright will execute it.

The first graph version should support a small vocabulary:

- `navigate`
- `fill`
- `click`
- `extract`
- `decision`
- `outcome`
- `manual_review`

It may also use graph-level concepts:

- Inputs.
- Variables/values produced by extraction.
- Outputs.
- Assumptions.
- Clarification questions.
- Risks/limitations.
- Revision/provenance metadata.

The SOP Graph must not contain:

- CSS selectors.
- XPath.
- Playwright locators.
- `data-testid` values.
- Browser `page` or `Browser` handles.
- `page.evaluate` or arbitrary JavaScript.
- Arbitrary code expressions.
- Credentials or secret values.
- Approved-domain permissions.
- Runtime dispatch data.
- Artifact keys or filesystem paths.
- Database IDs that leak implementation details.
- A published/executable Agent IR payload.

### Illustrative step JSON

The following is illustrative only; final schemas must be designed and validated in the Phase 2.1 plan. These fragments come from the escalation-review example above.

Navigate:

```json
{
  "id": "step_open_portal",
  "kind": "navigate",
  "urlHint": "https://service-portal.example.com/login",
  "purpose": "Open the service request portal sign-in page"
}
```

Fill from a run input:

```json
{
  "id": "step_enter_request_number",
  "kind": "fill",
  "fieldHint": "Request Number",
  "value": "${inputs.requestNumber}",
  "purpose": "Provide the request number for advanced search"
}
```

Fill from a secret declaration (declaration only in this scope):

```json
{
  "id": "step_enter_password",
  "kind": "fill",
  "fieldHint": "Password",
  "value": "${inputs.password}",
  "sensitive": true,
  "purpose": "Provide the portal password at run time"
}
```

Multi-branch decision on result cardinality:

```json
{
  "id": "step_search_result_count",
  "kind": "decision",
  "question": "How many matching service requests were returned?",
  "branches": [
    {
      "when": "no results",
      "nextStepId": "step_not_found"
    },
    {
      "when": "more than one result",
      "nextStepId": "step_ambiguous_request"
    },
    {
      "when": "exactly one result",
      "nextStepId": "step_open_request"
    }
  ]
}
```

Extraction producing several variables:

```json
{
  "id": "step_extract_request",
  "kind": "extract",
  "fields": [
    { "name": "status", "labelHint": "Status", "required": true },
    { "name": "priority", "labelHint": "Priority", "required": true },
    { "name": "assignedTeam", "labelHint": "Assigned Team", "required": true },
    { "name": "openedDate", "labelHint": "Opened Date", "required": true },
    { "name": "lastUpdatedDate", "labelHint": "Last Updated Date", "required": true }
  ],
  "purpose": "Collect the request details needed for escalation review"
}
```

Optional extraction whose absence is tolerated:

```json
{
  "id": "step_extract_on_call",
  "kind": "extract",
  "fields": [
    { "name": "onCallEngineer", "labelHint": "Current on-call", "required": false }
  ],
  "onMissing": "continue_with_note",
  "purpose": "Collect the on-call engineer if the team is listed"
}
```

Decision that derives a value from an extracted variable and a run input:

```json
{
  "id": "step_is_stale_escalation",
  "kind": "decision",
  "question": "Is this a P1/P2 request with no update within the stale threshold?",
  "usesInputs": ["staleDaysThreshold"],
  "usesVariables": ["priority", "lastUpdatedDate"],
  "produces": [
    { "name": "isStaleEscalation", "type": "boolean" }
  ],
  "branches": [
    { "when": "stale escalation", "nextStepId": "step_open_team_directory" },
    { "when": "not a stale escalation", "nextStepId": "step_open_team_directory" }
  ]
}
```

Cross-system consistency check routing to manual review:

```json
{
  "id": "step_team_name_consistent",
  "kind": "decision",
  "question": "Does the directory team name match the assigned team on the request?",
  "usesVariables": ["assignedTeam", "directoryTeamName"],
  "branches": [
    { "when": "names match", "nextStepId": "step_stale_gate" },
    { "when": "names do not match", "nextStepId": "step_team_mismatch" }
  ]
}
```

Manual review terminal:

```json
{
  "id": "step_team_mismatch",
  "kind": "manual_review",
  "reason": "team_name_inconsistent",
  "message": "The assigned team on the request does not match the team directory record",
  "handoff": "Route to the service desk lead for team mapping confirmation"
}
```

Outcome terminals:

```json
{
  "id": "step_not_found",
  "kind": "outcome",
  "outcome": "not_found",
  "message": "No matching service request was found in the reporting date range"
}
```

```json
{
  "id": "step_completed",
  "kind": "outcome",
  "outcome": "completed",
  "message": "Escalation review complete",
  "returns": [
    "status",
    "priority",
    "assignedTeam",
    "openedDate",
    "lastUpdatedDate",
    "teamManagerName",
    "teamManagerEmail",
    "onCallEngineer",
    "isStaleEscalation"
  ]
}
```

Because `onCallEngineer` is produced only on the stale sub-path, the graph validator must either require it to be declared optional in the outcome payload or reject the outcome. Silently returning an undefined variable is not acceptable.

## Dynamic Run Inputs

A workflow definition declares typed inputs. A future run supplies values for those inputs.

```text
Definition: “This workflow needs user ID, password, request number,
             reporting start date, reporting end date, and a stale-days threshold.”
Step: “Fill Login ID using user ID.”
Step: “Fill Password using password.”
Step: “Fill Request Number using request number.”
Step: “Fill Date From using reporting start date.”
Step: “Fill Date To using reporting end date.”
Step: “Decide staleness using stale-days threshold.”
Run: The user supplies values when the workflow is eventually executed.
```

Steps must reference input identifiers rather than embed per-run values.

Illustrative declaration:

```json
{
  "id": "requestNumber",
  "label": "Request number",
  "type": "string",
  "required": true,
  "minLength": 1,
  "example": "SR-1001",
  "sensitive": false
}
```

```json
{
  "id": "reportingStartDate",
  "label": "Reporting start date",
  "type": "date",
  "required": true,
  "example": "2026-01-01",
  "sensitive": false
}
```

```json
{
  "id": "staleDaysThreshold",
  "label": "Days without update before a request is considered stale",
  "type": "number",
  "required": true,
  "default": 5,
  "min": 1,
  "max": 90,
  "sensitive": false
}
```

Illustrative secret declaration:

```json
{
  "id": "password",
  "label": "Password",
  "type": "secret",
  "required": true,
  "sensitive": true
}
```

The initial supported input types should remain small:

- `string`
- `number`
- `boolean`
- `enum`
- `date`
- `secret`

Do not add arbitrary JSON inputs, files, nested objects, arbitrary expressions, or complex type systems in the first version.

### Dynamic values and extracted variables

A step may consume:

- A fixed non-sensitive literal.
- A declared run input.
- A value extracted by an earlier step on every reachable path.

The ordinary UI should provide a value-source selector rather than requiring interpolation syntax:

```text
Value source
○ Fixed text
○ Run input
○ Value extracted by an earlier step
```

The internal representation may use a constrained reference syntax such as:

```text
${inputs.requestNumber}
${variables.assignedTeam}
```

The graph validator must reject references to missing inputs or variables not proven available on every reachable path.

## Secret Input Rules

For Phase 2, treat a secret as nothing more than an ordinary declared run input with one extra marker. This is intentionally simple — no vault, encryption-at-rest, rotation, masking-in-logs, or audit design is required yet.

The convention:

- In SOP text, the user flags a secret with a `$` prefix instead of describing it in plain language, e.g. "Fill Password using $password."
- Orbit declares it as a run input with `"type": "secret"`, the same shape as any other input declaration.
- At run time, Watchtower renders a normal masked form field (`type="password"`) for it, exactly like every other input field on the run-start form — just visually obscured.
- Steps reference it by input id (`${inputs.password}`), the same reference syntax used for every other input. The step must never contain the literal typed value.

Illustrative declaration:

```json
{
  "id": "password",
  "label": "Password",
  "type": "secret",
  "required": true
}
```

Illustrative reference from a fill step:

```json
{
  "id": "step_fill_password",
  "kind": "fill",
  "fieldHint": "Password",
  "value": "${inputs.password}"
}
```

That is the entire rule for this phase: never write the literal secret value into the SOP Graph JSON — reference the input id instead, same as `requestNumber` or any other input. Whether that value is encrypted in the database, masked in evidence artifacts, rotated, or access-audited is a separate design question for when execution (2.4+) actually needs to type it into a real browser session. Nothing in Phase 2.1–2.3 blocks on that design existing yet.

Normal non-sensitive inputs may later be persisted according to an explicitly reviewed run-data policy.

## URL and Target Safety

Users may write URLs in SOP text and editable navigate steps, but URLs remain untrusted draft references until a later execution-mapping review.

During SOP drafting/review:

- Do not navigate to URLs.
- Do not fetch URLs.
- Do not probe URLs.
- Do not resolve DNS.
- Do not create domain permissions.

A later execution-mapping phase must define:

- Standard URL parsing.
- Allowed scheme policy.
- Explicit reviewed domain allowlists.
- Redirect policy.
- Local-development exceptions.
- Read-only versus side-effecting action classification.
- Credential/access policy.

## Validation Requirements

Every graph revision must pass:

1. JSON syntax validation where JSON editing is used.
2. Per-step schema validation.
3. Graph-level semantic validation.

Minimum graph-level validation:

- Stable unique step IDs.
- Valid supported step kinds.
- Every branch targets an existing step.
- A defined entry step.
- Reachability for all non-draft steps.
- Every reachable path reaches a supported terminal outcome.
- No unsupported cycles/loops in the first version.
- No duplicate output/input identifiers.
- Input references resolve to declared inputs.
- Variable references resolve to values produced on every reachable earlier path.
- No secret value/literal is embedded.
- Secret references are permitted only in later explicitly allowed input/action positions.
- Step reorder preserves graph and dependency validity.
- URLs are syntactically valid draft references when present.

Malformed or invalid model output must never be persisted as an approved graph revision.

## Provenance, Revisions, and Reviewability

Orbit must retain enough information to answer:

- What did the user originally write?
- Which generated graph revision is being reviewed?
- Which assumptions were generated?
- Which questions were asked and how were they answered?
- Which user edits were made?
- Which revision was approved/rejected?
- Which model/provider/configuration/prompt version generated a proposal?
- When was each proposal or edit created?

The exact database schema and lifecycle state names are a Phase 2.1 design decision. The minimum conceptual states are:

```text
draft
needs_clarification
in_review
approved
rejected
superseded
```

No approved SOP Graph becomes executable in the scope defined by this document.

## LLM Generation Requirements

Natural-language interpretation must use a provider abstraction so tests can use deterministic fake responses rather than live model calls.

Generated model output must be treated as untrusted:

```text
Model response
→ parse structured response
→ Zod/schema validation
→ graph semantic validation
→ persist proposed draft revision only if valid
→ render assumptions and clarification questions
```

The system must reject malformed output, unsupported step types, invalid references, fabricated credentials, raw executable code, and unvalidated URLs/target details.

The model must be instructed to:

- Produce only the allowed SOP Graph schema.
- Preserve uncertainty as assumptions/questions.
- Avoid inventing selectors, credentials, permissions, or system access.
- Mark unclear or risky actions as requiring clarification/manual review.
- Keep browser intent distinct from executable implementation.

## Non-Goals for This Scope

This Phase 2 requirements document does not authorize:

- Browser execution of generated SOPs.
- Playwright invocation from SOP drafting/review.
- Agent IR generation, publishing, or execution.
- Automatic selector discovery.
- Automatic URL visiting, web crawling, or page probing.
- Credential collection or secret storage/injection.
- Authentication, authorization, tenancy, or collaboration.
- External integrations.
- Notifications.
- Side-effecting automation.
- Generic BPMN/workflow-engine features.
- Loops, parallel execution, timers, retries, compensation, or arbitrary expressions.
- Cloud deployment or production hardening.

## Suggested Delivery Sequence

### Phase 2.1 — SOP Graph foundation

- SOP Graph contracts and Zod schemas.
- Draft/revision/provenance model.
- Persistence and repositories.
- Graph semantic validation.
- Typed input declarations.
- Step reorder/dependency validation.
- Non-executable safety boundary.
- No LLM and no user-facing generation required yet.

### Phase 2.2 — Free-text SOP understanding

- Plain-language SOP input UI.
- LLM provider abstraction.
- Proposed graph generation.
- Assumptions and clarification question generation.
- Strict schema/semantic validation of generated output.
- Deterministic fake provider for tests.
- No execution or Agent IR creation.

### Phase 2.3 — Review and editing

- Plain-language graph review UI.
- Step-specific form editor.
- Accessible reordering controls.
- Optional advanced per-step JSON editor.
- Clarification-answer workflow.
- Revisions and approval/rejection.
- Approval remains non-executable.

### Phase 2.4 — Reviewed execution mapping

- Separate technical mapping from approved SOP steps to approved target systems/actions.
- Domain/URL review and allowlisting design.
- Read-only versus side-effect classification.
- Explicit browser target/element discovery workflow.
- Separate secrets-management design before credential-based execution.

### Phase 2.5 — Candidate Agent IR

- Compile only supported, reviewed mappings into candidate Agent IR.
- Validate candidate IR.
- Simulation/sandbox design.
- Separate technical approval before publishing.

### Phase 2.6 — Controlled publication and execution

- Explicit approved candidate becomes a runnable Agent Version.
- Reuse Phase 1 evidence, persistence, and runtime protections.
- No automatic publish/run from SOP Graph approval.

## Task Execution Plan

This document is a planning artifact, not an implementation authorization. Following the same discipline used in Phase 1, Phase 2 is executed one task at a time — one branch, one review, one commit per task — never as a single combined prompt.

The working default is **one task per sub-phase** (2.1 through 2.6 below). A sub-phase is split into more than one task only if it turns out too large or insufficiently vertical once work is actually underway — mirroring how Phase 1's Task 7 and Task 8 were combined into one task because they shared the same run-id/status/output contract, while other Phase 1 line items each stayed a single task.

| Task | Sub-phase | Scope | Split risk |
|---|---|---|---|
| 1 | 2.1 SOP Graph foundation | Schemas, persistence, draft/revision/provenance model, graph-level validation, typed inputs, reorder-dependency validation. No LLM, no UI. | Low — self-contained plumbing, same shape as Phase 1 Task 4/5. |
| 2 | 2.2 Free-text understanding | LLM provider abstraction, deterministic fake provider, prompt-to-proposed-graph generation, assumptions/clarification generation, strict schema/semantic validation of output. | Low-medium — provider abstraction and generation could split if the fake-provider test harness gets heavy. |
| 3 | 2.3 Review and editing | Plain-language graph review UI, step-specific form editor, accessible reorder controls, optional advanced JSON editor, clarification-answer workflow, revisions/approval. | High — largest UI surface in the phase; likely candidate to split into "review + step editor" and "clarification + approval" if the diff becomes unreviewable. |
| 4 | 2.4 Execution mapping | Domain/URL allowlist review design, read-only vs. side-effect classification, element-discovery workflow. Secrets remain declarations only, per the simplified Secret Input Rules above. | High — element discovery is the hardest unsolved technical problem in this document; may need a design spike before it is even one task. |
| 5 | 2.5 Candidate Agent IR | Compile reviewed mappings into candidate Agent IR, validate, sandbox/simulation design. | Low-medium. |
| 6 | 2.6 Publish and execute | Explicit approval turns a candidate into a runnable Agent Version, reuse Phase 1 evidence/runtime, Watchtower shows it alongside the seeded agent. | Low — mostly wiring into runtime/evidence/Watchtower behavior Phase 1 Tasks 6 and 7–8 already proved. |

Sequencing rules:

- Work one task prompt at a time. Review and commit before starting the next.
- Do not pre-write a later task's brief before the prior task is merged — the actual schema/contract shape produced by an earlier task determines what a later task needs to build against.
- If a task's diff grows unreviewable mid-flight, stop and split it rather than forcing it through as one commit.

## Acceptance Criteria for Phase 2.1

Phase 2.1 should be considered complete when:

- A generic non-executable SOP Graph schema exists and is validated with Zod.
- Each step has structured JSON and an allowed step type.
- Graphs can declare typed dynamic inputs.
- Sensitive inputs can be declared but secret values cannot be embedded.
- Graph validation catches invalid references, branches, IDs, terminal paths, cycles, and reorder dependency violations.
- Draft/revision/provenance concepts are persisted or otherwise durably represented according to an approved design.
- No SOP Graph can create an Agent Version, start a run, invoke a browser, fetch a URL, or cause an external side effect.
- Tests demonstrate the non-executable boundary and graph validation behavior.
- Existing Phase 1 behavior remains unchanged.

## Decision Rule

When requirements are unclear, preserve this priority order:

```text
Human-readable free-text authoring
→ structured editable draft
→ explicit clarification and review
→ strong validation and provenance
→ non-executable safety boundary
→ later controlled mapping and execution
```
