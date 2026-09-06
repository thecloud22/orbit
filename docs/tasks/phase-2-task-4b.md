4a is good. That's exactly the outcome a review question should produce — you didn't just answer around it, you traced the actual code, found it really was the bug I was worried about, fixed it with a proper two-phase structure, pinned the regression with a test, documented the scoping in ADR-018 with the exact sentence that matters, and — this is the part worth calling out — recorded in the defect list that your own earlier draft asserted the opposite of what the code did. That's the right instinct: an inaccurate report is a worse problem than a slow settle window, and you treated it that way. Approved. `d8b43f8` stands as committed.

One sequencing note before the next prompt: 4a isn't merged to master yet, and 4b needs 4a's actual code, not just its design. Recommend stacking — branch `phase-2-task-4b-execution-recorder` directly off `phase-2-task-4a-execution-binding` at `d8b43f8`, same "stacked branches, no merge to master until instructed" pattern used for Tasks 2 and 3, and merge 4a+4b to master together once both land. Say the word if you'd rather merge 4a alone first instead.

Here's the Task 4b prompt:

---

Phase 2 — Task 4b: Execution Recorder, Confirm Screen, and AI-Assist (sub-phase 2.4, part 2)

Branch `phase-2-task-4b-execution-recorder` off `phase-2-task-4a-execution-binding` at `d8b43f8` — 4a is not yet merged to master, this stacks on it directly. Verify preconditions the same way every prior task has: confirm the branch state, confirm `ACTIVE_TASK.md` names this as next, confirm no 4b code exists yet.

Context/goal: 4a delivered the frozen Execution Binding contract, persistence, lifecycle, and the runtime drift check. 4b is the human-facing half: a person demonstrates each step once against a sandbox, and this task turns that demonstration into a durable binding conforming exactly to 4a's schema. Read 4a's actual code first — `@orbit/execution-mapping`'s schema, lifecycle, and `validate.ts`, plus the `describeElement`/drift-check wiring — before proposing a plan. The schema is frozen: if implementing this reveals you need to change it, stop and ask, don't work around it silently.

Scope: §2 recorder tool, §3 confirm screen, §4 AI-assist — one task, one plan, one review, same as before.

Hard constraints, all already resolved in prior discussion, not open questions:
- Recording performs real browser actions. It must only ever target the sandbox — `ALLOWED_HOSTS` is localhost-only per 4a, and that's not changing. State this precondition explicitly in your plan.
- There is no authentication in Phase 1 to reuse (4a's discrepancy #1, confirmed real). The recorder can only target unauthenticated sandbox flows. Do not build session/login handling — state it as a limitation, don't silently assume it away.
- The user can enter a starting URL and resume recording from one.
- Every captured step is real: real clicks, real fills, real navigations in the sandbox — no simulated actions.
- For each captured step, the human chooses whether it's an action (fill/click) or a read (extract/decision/outcome), matching 4a's read-mode enum exactly.
- Value source is an explicit choice per binding: a variable reference to something the SOP Graph already declares, or a literal default. The literal value typed during recording is shown on the confirm screen for verification only, then discarded — unless the human explicitly picks "use this as the literal default," in which case it's kept.
- `manual_review` steps must never receive a binding — 4a's `validate.ts` already refuses this at the schema level; the recorder must not let a human attempt to record against one, and must surface the refusal clearly if attempted.
- `scope` is always recorded as `undefined`. No disambiguation or scoping UI in this task — single-record navigation holds for everything Orbit can execute today, per 4a's decision. Do not build scoping UI on spec for a case that can't occur yet.
- Frames and iframes are explicitly out of scope. Don't add handling for them.
- Selector capture is restricted to 4a's closed set — `test_id`, `role_and_name`, `label`. CSS and XPath must never be offered as options or silently captured; same trust boundary as 4a, no exceptions.

§3 confirm screen: reuse the existing `describeStep` renderer. Show the human what was actually captured — selector chain, fingerprint summary, value source, read mode — before anything is persisted. Only explicit confirmation moves the binding into its lifecycle (`draft` → wherever 4a's transition table sends it next).

§4 AI-assist, folded into one section, one LLM-touching file (mirror Task 2's `anthropic-provider.ts` isolation — one file touches the model, nothing else does):
1. Semantic mismatch check — does the captured selector/fingerprint plausibly match what the step says it does.
2. Selector robustness suggestion — given the captured chain, suggest reordering or adding backups by likely robustness.
3. Drift-recovery hint — when 2.6 later reports a §5 fingerprint failure (`UNEXPECTED_UI_STATE` plus its evidence), surface a suggestion to re-record using that evidence. This is the loop that closes 2.4 back on 2.6's failures.
4. Coverage suggestion — flag SOP steps or branches that have no binding yet.

All four are advisory only. None may auto-apply a change, block a save, or touch the actual drift-check pass/fail logic — that logic is 4a's runtime code and is not part of this task's scope at all.

Known limitations to state, not solve: sandbox-vs-production drift (inherited from 4a's own documented limitation); no authentication support; `navigate` bindings record URL only and stay undriftchecked (4a, unchanged).

Explicit exclusions, same rigor as every prior task: do not modify `@orbit/execution-mapping`'s schema, lifecycle, or fingerprint comparison; do not touch `packages/runtime/src/{interpreter,drift,ports}.ts`; do not touch `describeElement` in `playwright-executor.ts`; do not touch any contract package without separate approval. `@orbit/sop-graph`, `SOP_REVISION_TRANSITIONS`, the SOP Graph revision lifecycle, `@orbit/sop-generation`, and `@orbit/sop-service` remain off-limits.

Tests: recorder captures correctly end-to-end against the real demo portal; confirm screen renders correctly for every read-mode/value-source combination; `manual_review` refusal path; AI-assist file tested in isolation (mocked/deterministic, matching how Task 2 tested its LLM provider); full regression — 4a's gate and Phase 1's gate both stay green.

Opus/Sonnet split: Opus owns the recorder's core capture logic (this is the actual new Playwright trust boundary — script injection and element-picking — and deserves the same care as 4a's runtime touch), the confirm-screen persistence wiring, the single AI-assist file, the final diff review, and the commit. Sonnet may only do narrowly-scoped UI work and tests against an explicit brief naming exact files; may not touch the injected recording script, may not touch anything on 4a's untouched list, may not commit.

Return a plan first, same as every prior task. Wait for go-ahead before writing code.