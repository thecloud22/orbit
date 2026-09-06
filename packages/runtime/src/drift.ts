import type { Locator } from '@orbit/agent-ir';
import {
  compareFingerprint,
  type ComparisonMode,
  type ElementFingerprint,
  type FingerprintMismatch,
} from '@orbit/execution-mapping';

import { RuntimeError } from './errors';
import type { RuntimeLogger } from './logger';
import type { BrowserExecutor } from './ports';

/**
 * The drift check: does the page still show what a human approved?
 *
 * A locator resolving is not the same as a locator resolving to the right
 * thing. A page that has been redesigned can still have an element matching the
 * recorded selector while that element now means something else entirely, and
 * clicking it would be a real action on a real system that nobody reviewed.
 * This is the check that stands between those two situations.
 *
 * Three properties matter, and they are why this lives in the runtime rather
 * than in the executor (ADR-008, ADR-018):
 *
 *   - It is **deterministic**. No model is consulted. The comparison is a field
 *     equality test in @orbit/execution-mapping, unit-testable with no browser.
 *   - It **fails safe**. A mismatch stops the run and captures evidence. The
 *     executor is never asked to find a substitute element, because choosing a
 *     different element than the one a human approved is precisely the decision
 *     no automated system here is permitted to make.
 *   - It **does not mistake slowness for change**. The check polls until the
 *     step's own deadline before declaring drift, so a page that is still
 *     settling is given the same benefit of the doubt every other wait in this
 *     runtime gives it.
 */

const DRIFT_POLL_INTERVAL_MS = 100;

/**
 * How long an element that is already visible is given to settle before a
 * mismatch counts as drift.
 *
 * This bounds only the *second* phase. Waiting for the element to appear at all
 * is the first `describeElement` call, which is given the step's whole budget,
 * so a slow page is tolerated exactly as tolerantly here as by every other step
 * in this runtime. Only once the element is on screen does this shorter window
 * apply, and it covers a narrower problem: the gap between an element rendering
 * and its accessible name settling, which is hydration-shaped and measured in
 * hundreds of milliseconds.
 *
 * Spending the whole step budget on that second phase would make every
 * genuinely drifted step take fifteen seconds to fail — turning a fail-safe
 * into a stall, and pushing a run that should stop quickly towards its own
 * deadline instead.
 */
const DRIFT_SETTLE_WINDOW_MS = 2_000;

/** The approved binding for one step, as the runtime needs it. */
export interface StepBinding {
  readonly bindingId: string;
  readonly fingerprint: ElementFingerprint;
  /** `action` compares text; `read` does not — the text is the value. */
  readonly mode: ComparisonMode;
}

/**
 * Supplies the approved binding for a step, if it has one.
 *
 * Optional throughout: an Agent Version with no bindings — every Phase 1 agent —
 * resolves to `null` and executes exactly as it did before this check existed.
 * That is what makes adding a safety gate to the runtime a change no existing
 * run can observe.
 */
export interface ExecutionBindingResolver {
  forStep(agentStepId: string): StepBinding | null;
}

export interface VerifyBindingInput {
  readonly executor: BrowserExecutor;
  readonly bindings: ExecutionBindingResolver | undefined;
  readonly locator: Locator;
  readonly agentStepId: string;
  readonly timeoutMs: number;
  readonly logger: RuntimeLogger;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function describeMismatches(mismatches: readonly FingerprintMismatch[]): string {
  return mismatches
    .map(
      (mismatch) =>
        `${mismatch.field} was "${mismatch.expected ?? ''}" when this step was approved but is "${mismatch.observed ?? ''}" now`,
    )
    .join('; ');
}

/**
 * Verifies the element about to be acted on, or refuses to act.
 *
 * Returns quietly when there is no binding to check, which is the Phase 1 path.
 */
export async function verifyBinding(input: VerifyBindingInput): Promise<void> {
  const binding = input.bindings?.forStep(input.agentStepId) ?? null;

  if (binding === null) {
    return;
  }

  // Phase one: wait for the element to exist at all, on the step's own budget.
  // `describeElement` waits for visibility, so this is exactly as tolerant of a
  // slow page as `fill` or `click` would have been on their own. Capping it at
  // the settle window would make the drift check *less* patient than the action
  // it guards, and a page that simply took a while to render would fail as
  // though it had changed.
  const first = compareFingerprint(
    binding.fingerprint,
    await input.executor.describeElement({ locator: input.locator, timeoutMs: input.timeoutMs }),
    binding.mode,
  );

  if (first.matches) {
    return;
  }

  // Phase two: the element is on screen but does not match yet. Only this part
  // is bounded by the settle window, and only the step's own budget can cut it
  // shorter.
  let mismatches = first.mismatches;
  const deadline = Date.now() + Math.min(input.timeoutMs, DRIFT_SETTLE_WINDOW_MS);

  while (Date.now() < deadline) {
    await delay(Math.min(DRIFT_POLL_INTERVAL_MS, Math.max(deadline - Date.now(), 0)));

    const comparison = compareFingerprint(
      binding.fingerprint,
      // Already visible by now; this only needs to read it again.
      await input.executor.describeElement({
        locator: input.locator,
        timeoutMs: DRIFT_POLL_INTERVAL_MS,
      }),
      binding.mode,
    );

    if (comparison.matches) {
      return;
    }

    mismatches = comparison.mismatches;
  }

  throw driftDetected(input, binding.bindingId, mismatches);
}

/** The fail-safe stop, and the evidence a person needs to re-map the step. */
function driftDetected(
  input: VerifyBindingInput,
  bindingId: string,
  mismatches: readonly FingerprintMismatch[],
): RuntimeError {
  input.logger.warn(
    { agentStepId: input.agentStepId, bindingId },
    'Stopping: the page no longer matches the approved binding.',
  );

  return new RuntimeError({
    code: 'UNEXPECTED_UI_STATE',
    message:
      `Step "${input.agentStepId}" was stopped because the page no longer matches what was approved: ` +
      `${describeMismatches(mismatches)}. The workflow needs re-mapping before it can run again.`,
    details: [
      { field: 'bindingId', message: bindingId },
      ...mismatches.map((mismatch) => ({
        field: `fingerprint.${mismatch.field}`,
        message: `approved "${mismatch.expected ?? ''}", observed "${mismatch.observed ?? ''}"`,
      })),
    ],
  });
}
