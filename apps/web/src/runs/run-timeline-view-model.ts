import type { ArtifactView, RunDetailView, RunEventView, RunStepView } from '@orbit/api/views';

import { describeEvidence, humanizeKey, type EvidenceItem } from './run-view-model';

/**
 * One run, joined into a single timeline.
 *
 * Watchtower used to render three parallel lists — steps, events, evidence —
 * side by side, and left the reader to correlate them by timestamp in their
 * head. The information needed to do that join was already in the data:
 * `RunEventView.runStepId` and `ArtifactView.runStepId` both name the step they
 * belong to. Nothing new is fetched or persisted here; this file just stops
 * asking a person to do a join the server already answered.
 *
 * Pure functions, as with `run-view-model.ts` beside it. The components render
 * what these return and decide nothing, so the rules that matter — what counts
 * as run-level rather than step-level, which branch an `expect_one_of` took —
 * are testable without a DOM.
 */

/**
 * Which surface a step ran on, for a run that spans more than one.
 *
 * `null` for `complete`, `fail` and `model.decide`, which touch no surface. A
 * reader following a workflow that looks something up over an API, does the work
 * on a green screen and writes the result back needs to see where each step
 * happened; without it the timeline reads as one undifferentiated list and the
 * expected-versus-observed view loses the context that explains the evidence
 * under each step (ADR-031, ADR-037).
 */
export type StepSurface = 'browser' | 'terminal' | 'api';

export function surfaceOf(stepType: string): StepSurface | null {
  const prefix = stepType.split('.')[0];
  return prefix === 'browser' || prefix === 'terminal' || prefix === 'api' ? prefix : null;
}

export interface TimelineStep {
  readonly step: RunStepView;
  /** The surface this step ran on, or null for a step that touches none. */
  readonly surface: StepSurface | null;
  readonly events: readonly RunEventView[];
  readonly evidence: readonly EvidenceItem[];
  /** Present only for a deterministic step that chose its own successor. */
  readonly branch: BranchChoice | null;
  /** Present only for a judged decision (ADR-032). */
  readonly judged: JudgedChoice | null;
  /** Wall-clock duration, when the step recorded both ends. */
  readonly durationLabel: string | null;
}

export interface RunTimeline {
  readonly steps: readonly TimelineStep[];
  /**
   * Events with no step of their own — `run.queued`, `run.started`,
   * `run.completed`, `run.failed`.
   *
   * Kept as their own group rather than mixed into the step list. They describe
   * the run as a whole, and interleaving them with step activity was one of the
   * things that made the old event list hard to read: `run.started` appeared
   * between two steps as though it were one.
   */
  readonly runEvents: readonly RunEventView[];
  /**
   * Evidence belonging to the run rather than to any step — a Playwright trace,
   * a terminal's captured screens, an API exchange log. One entry per surface
   * the run opened.
   *
   * Never dropped. Attaching it to an arbitrary step would misattribute it, and
   * omitting it would lose it, so it gets its own place.
   */
  readonly runEvidence: readonly EvidenceItem[];
}

/**
 * Which alternative a `browser.expect_one_of` step took.
 *
 * The runtime records `selectedAlternativeIndex`, `matchedLocator` and `next` on
 * the step's output. An index is an implementation detail of the Agent IR's
 * array ordering and means nothing to a reader; the locator that matched and
 * the step that followed are the two facts that describe the decision in the
 * workflow's own terms. Branching is a headline feature now, so a branching run
 * should read as a decision rather than as a number.
 */
export interface BranchChoice {
  /** The matched element, in prose: `test_id=request-not-found` → "request not found". */
  readonly matched: string;
  /** The step the run continued at. */
  readonly next: string;
  readonly index: number;
}

function stringField(output: Record<string, unknown> | null, key: string): string | null {
  const value = output?.[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * A locator as a phrase.
 *
 * `test_id=request-not-found` is a machine address; "request not found" is what
 * the person who wrote the workflow was looking at. The raw locator is still
 * shown beside this — the plain form is a label, never a replacement for the
 * evidence.
 */
export function humanizeLocator(locator: string): string {
  const value = locator.includes('=') ? locator.slice(locator.indexOf('=') + 1) : locator;
  return value.replaceAll(/[-_]+/g, ' ').trim();
}

export function describeBranch(step: RunStepView): BranchChoice | null {
  const index = step.output?.['selectedAlternativeIndex'];
  const next = stringField(step.output, 'next');
  const matchedLocator = stringField(step.output, 'matchedLocator');

  if (typeof index !== 'number' || next === null || matchedLocator === null) {
    return null;
  }

  return { matched: humanizeLocator(matchedLocator), next, index };
}

/**
 * How a judged decision resolved (ADR-032).
 *
 * A deterministic branch is described by the element that matched; a judged one
 * has no matching element, so the facts that describe it are the conclusion it
 * reached, how sure it was, and the bar it had to clear. Confidence is shown
 * beside the threshold rather than alone: 0.86 means nothing on its own and
 * everything next to the 0.8 it had to beat.
 *
 * The rationale is displayed as what it is — the model's own account, evidence
 * for a reader — and it never determined anything. The chosen index did.
 */
export interface JudgedChoice {
  readonly outcome: string;
  readonly next: string;
  readonly index: number;
  readonly confidence: number;
  readonly threshold: number;
  readonly rationale: string | null;
  readonly model: string | null;
}

function numberField(output: Record<string, unknown> | null, key: string): number | null {
  const value = output?.[key];
  return typeof value === 'number' ? value : null;
}

export function describeJudgedDecision(step: RunStepView): JudgedChoice | null {
  if (step.stepType !== 'model.decide') {
    return null;
  }

  const outcome = stringField(step.output, 'chosenOutcome');
  const next = stringField(step.output, 'next');
  const index = numberField(step.output, 'chosenIndex');
  const confidence = numberField(step.output, 'confidence');
  const threshold = numberField(step.output, 'confidenceThreshold');

  if (
    outcome === null ||
    next === null ||
    index === null ||
    confidence === null ||
    threshold === null
  ) {
    return null;
  }

  return {
    outcome,
    next,
    index,
    confidence,
    threshold,
    rationale: stringField(step.output, 'rationale'),
    model: stringField(step.output, 'model'),
  };
}

/** `1_512` ms as "1.5s"; anything under a second stays in milliseconds. */
export function formatDuration(startedAt: string | null, finishedAt: string | null): string | null {
  if (startedAt === null || finishedAt === null) {
    return null;
  }

  const elapsed = Date.parse(finishedAt) - Date.parse(startedAt);

  if (!Number.isFinite(elapsed) || elapsed < 0) {
    return null;
  }

  return elapsed < 1000 ? `${String(elapsed)}ms` : `${(elapsed / 1000).toFixed(1)}s`;
}

/**
 * An event type as a sentence.
 *
 * `browser.navigation.completed` reads "navigation completed". The `browser.`
 * prefix carries nothing for a reader looking at a browser automation tool, and
 * the raw type is still available in the raw event stream for anyone debugging.
 */
export function humanizeEventType(eventType: string): string {
  // Only the browser prefix is dropped. A run that spans surfaces should say
  // which one each line belongs to, and "typed" alone is ambiguous where
  // "terminal typed" is not. Browser stays bare because it is the implicit
  // surface for every agent published before Phase 3.
  const withoutPrefix = eventType.startsWith('browser.')
    ? eventType.slice('browser.'.length)
    : eventType;
  return withoutPrefix.replaceAll('.', ' ').replaceAll('_', ' ');
}

/** A step's type as a phrase: `browser.expect_one_of` reads "expect one of". */
export function humanizeStepType(stepType: string): string {
  return humanizeEventType(stepType);
}

/**
 * A step's own extracted values, for the steps that produce them.
 *
 * Deliberately excludes the keys the timeline already renders in its own right
 * — a branch choice is shown as a branch, not repeated as three raw fields
 * underneath it.
 */
const BRANCH_OUTPUT_KEYS = [
  'selectedAlternativeIndex',
  'matchedLocator',
  'next',
  // A judged decision's own keys, rendered as a decision rather than repeated
  // as raw fields underneath it.
  'chosenOutcome',
  'chosenIndex',
  'confidence',
  'confidenceThreshold',
  'rationale',
];

export interface StepDetailRow {
  readonly key: string;
  readonly label: string;
  readonly value: string;
}

/** A plain object, as opposed to null or an array. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * One value, as a row or as several.
 *
 * A nested object is flattened one level rather than printed as JSON. A
 * `complete` step carries `{outcome, outputs: {requestNumber: 'SR-1002'}}`, and
 * rendering that literally put `{"requestNumber":"SR-1002"}` on the page — a
 * blob a reader has to parse in their head, next to a panel that had already
 * shown the same value properly. An empty object contributes nothing at all,
 * because "Outputs {}" is a row that says less than no row.
 *
 * Only one level. Deeper nesting is not something these outputs do, and
 * inventing a general renderer for a shape that does not occur would be
 * speculative; anything deeper still falls back to JSON, which is at least
 * honest about being raw.
 */
function asText(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function detailRows(key: string, value: unknown): readonly StepDetailRow[] {
  if (isRecord(value)) {
    return Object.entries(value).map(([innerKey, innerValue]) => ({
      key: `${key}.${innerKey}`,
      label: humanizeKey(innerKey),
      value: asText(innerValue),
    }));
  }

  return [{ key, label: humanizeKey(key), value: asText(value) }];
}

export function stepDetails(step: RunStepView): readonly StepDetailRow[] {
  if (step.output === null) {
    return [];
  }

  return Object.entries(step.output)
    .filter(([key]) => !BRANCH_OUTPUT_KEYS.includes(key))
    .flatMap(([key, value]) => detailRows(key, value));
}

/**
 * Joins a run's steps, events and evidence into one ordered timeline.
 *
 * Steps keep their persisted `sequence` order and events keep theirs, because
 * sequence is the ordering authority in the evidence contract — not a
 * timestamp, which can tie.
 */
export function buildRunTimeline(run: RunDetailView): RunTimeline {
  const eventsByStep = new Map<string, RunEventView[]>();
  const runEvents: RunEventView[] = [];

  for (const event of [...run.events].sort((a, b) => a.sequence - b.sequence)) {
    if (event.runStepId === null) {
      runEvents.push(event);
      continue;
    }

    const existing = eventsByStep.get(event.runStepId);

    if (existing === undefined) {
      eventsByStep.set(event.runStepId, [event]);
    } else {
      existing.push(event);
    }
  }

  const artifactsByStep = new Map<string, ArtifactView[]>();
  const runArtifacts: ArtifactView[] = [];

  for (const artifact of run.artifacts) {
    if (artifact.runStepId === null) {
      runArtifacts.push(artifact);
      continue;
    }

    const existing = artifactsByStep.get(artifact.runStepId);

    if (existing === undefined) {
      artifactsByStep.set(artifact.runStepId, [artifact]);
    } else {
      existing.push(artifact);
    }
  }

  const steps = [...run.steps]
    .sort((a, b) => a.sequence - b.sequence)
    .map((step) => ({
      step,
      events: eventsByStep.get(step.id) ?? [],
      surface: surfaceOf(step.stepType),
      evidence: describeEvidence(artifactsByStep.get(step.id) ?? []),
      branch: describeBranch(step),
      judged: describeJudgedDecision(step),
      durationLabel: formatDuration(step.startedAt, step.finishedAt),
    }));

  return {
    steps,
    runEvents,
    runEvidence: describeEvidence(runArtifacts),
  };
}
