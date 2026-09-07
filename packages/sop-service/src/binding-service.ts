import type { SopDocumentId, SopRevisionId } from '@orbit/contracts';
import {
  createRepositories,
  stepChecksum,
  withTransaction,
  type ExecutionBindingRecord,
  type OrbitDatabase,
} from '@orbit/db';
import {
  comparisonModeFor,
  EXECUTION_BINDING_SCHEMA_VERSION,
  isBindableStepKind,
  parseExecutionBinding,
  validateBindingAgainstStep,
  type BindingBody,
  type BindingIssue,
  type BindingKind,
  type ElementFingerprint,
  type ExecutionBinding,
  type ReadMethod,
  type SelectorChain,
  type ValueSource,
} from '@orbit/execution-mapping';
import { classifyValue, type SopGraph, type SopStep } from '@orbit/sop-graph';

/**
 * The step kinds that must carry a binding, re-exported from the compiler.
 *
 * Callers that decide what to *offer* to bind — the API's binding sessions, the
 * publish gate — need the same set the compiler enforces. Re-exported through
 * the composition root rather than copied, because a copy that falls behind
 * means offering work that changes nothing, or worse, refusing to offer work a
 * publish then demands.
 */
export { BINDABLE_KINDS } from '@orbit/agent-ir-compiler';

/**
 * Assembling a capture into a binding, and persisting it.
 *
 * The composition root for binding: the capture engine knows nothing about the
 * SOP Graph, and @orbit/execution-mapping knows nothing about a database. This
 * is where a demonstration becomes a durable, validated artifact.
 *
 * It lives here rather than in the recorder CLI because there are now two
 * things that turn a demonstration into a binding — the CLI, and the API's
 * binding sessions (ADR-027) — and what a real browser click means must have
 * exactly one definition. That is the same reasoning that put `stepChecksum` in
 * @orbit/db: two components must agree on it, so there is one function and they
 * cannot drift apart.
 *
 * Note what this file does *not* import: @orbit/execution-recorder. A capture
 * arrives as the plain `BindingCapture` shape below, the same trick
 * `RecordedEntry` uses, so the composition root never depends on the package
 * that injects script into a page.
 */

export type CreateBindingResult =
  | { readonly ok: true; readonly binding: ExecutionBindingRecord }
  | { readonly ok: false; readonly reason: 'not_bindable'; readonly stepId: string }
  | { readonly ok: false; readonly reason: 'invalid'; readonly issues: readonly BindingIssue[] };

export interface CreateBindingInput {
  readonly database: OrbitDatabase;
  readonly documentId: SopDocumentId;
  readonly revisionId: SopRevisionId;
  readonly graph: SopGraph;
  readonly step: SopStep;
  readonly body: BindingBody;
  /** The binding this replaces, when re-recording a step. */
  readonly parentBindingId?: ExecutionBindingRecord['id'];
  /**
   * Set when a person has just demonstrated this step against a real page, in
   * which case the binding is driven all the way to `approved`.
   *
   * Not a bypass, and not a shortcut around the state machine: it is created as
   * a draft, submitted, and approved through the repository's own transitions,
   * with the note saying how the approval happened. The approval already took
   * place — with their hands rather than with a button — which is verbatim the
   * reasoning `recording-service.ts` uses for a whole recorded workflow.
   */
  readonly confirmedByDemonstration?: { readonly reviewNote: string };
}

/**
 * One captured element, as this package needs it.
 *
 * Deliberately not @orbit/execution-recorder's `CapturedAction`: the type would
 * drag the capture engine across a boundary it has no business crossing.
 */
export interface BindingCapture {
  readonly selectors: SelectorChain;
  readonly fingerprint: ElementFingerprint;
  /** Where the page was when this happened; a navigate binding records it. */
  readonly url: string;
  /** For a fill: what was typed, to prove the right field was hit. */
  readonly typedValue?: string;
}

/**
 * What the person decided about the capture, per step kind.
 *
 * A click decides nothing, which is why its variant carries no fields. The
 * rest carry exactly the judgements no capture can supply: where a fill's value
 * comes from, and how a read is performed.
 */
export type BindingChoice =
  | { readonly kind: 'navigate' }
  | { readonly kind: 'click' }
  | { readonly kind: 'fill'; readonly valueSource: ValueSource }
  | { readonly kind: 'extract'; readonly readMethod: ReadMethod; readonly variable: string }
  | { readonly kind: 'outcome'; readonly readMethod: ReadMethod; readonly variable: string }
  /**
   * A decision, with every branch already demonstrated.
   *
   * The odd one out: every other choice describes one capture, and this one
   * describes several — one per branch, each with its own captured element. A
   * decision is only bindable once the whole set exists, because the runtime
   * resolves it by racing the branches against each other and a missing one is
   * a state the agent could reach and could not name.
   */
  | {
      readonly kind: 'decision';
      readonly branches: readonly {
        readonly when: string;
        readonly selectors: SelectorChain;
        readonly fingerprint: ElementFingerprint;
      }[];
    };

export type BindingBodyResult =
  | { readonly ok: true; readonly body: BindingBody }
  | { readonly ok: false; readonly reason: string };

/**
 * Builds the binding body a capture and a decision describe.
 *
 * Pure, and with no prompting in it, so the terminal and the web page produce
 * the same body from the same inputs rather than each assembling one its own
 * way.
 */
export function bindingBodyFor(input: {
  readonly step: SopStep;
  /**
   * Absent only for a decision, which carries its elements on the choice.
   *
   * Every other kind binds exactly one element and cannot be assembled without
   * it; a decision binds one per branch, and there is no single capture that
   * would be "the" one.
   */
  readonly capture?: BindingCapture;
  readonly choice: BindingChoice;
}): BindingBodyResult {
  const { step, capture, choice } = input;

  if (!isBindableStepKind(step.kind)) {
    return {
      ok: false,
      reason: 'This step routes to a person, so there is nothing to automate and nothing to bind.',
    };
  }

  if (choice.kind !== step.kind) {
    return {
      ok: false,
      reason: `This describes a "${choice.kind}" action, but the step is a "${step.kind}" step.`,
    };
  }

  if (choice.kind === 'decision') {
    return decisionBodyFor(step, choice);
  }

  if (capture === undefined) {
    return { ok: false, reason: 'This step binds one element, and none was captured.' };
  }

  const target = { selectors: capture.selectors, fingerprint: capture.fingerprint };

  switch (choice.kind) {
    case 'navigate':
      return { ok: true, body: { kind: 'navigate', target, url: capture.url } };
    case 'click':
      return { ok: true, body: { kind: 'click', target } };
    case 'fill':
      return { ok: true, body: { kind: 'fill', target, valueSource: choice.valueSource } };
    case 'extract':
      return {
        ok: true,
        body: {
          kind: 'extract',
          target,
          readMethod: choice.readMethod,
          variable: choice.variable,
        },
      };
    case 'outcome':
      return {
        ok: true,
        body: {
          kind: 'outcome',
          target,
          readMethod: choice.readMethod,
          variable: choice.variable,
        },
      };
  }
}

/**
 * A decision's body: one demonstrated element per declared branch.
 *
 * Refused unless the set is complete. A decision bound for two of its three
 * branches would compile to an `expect_one_of` that cannot name the third
 * state, so the agent would hang on a page it is actually looking at.
 */
function decisionBodyFor(
  step: SopStep,
  choice: Extract<BindingChoice, { kind: 'decision' }>,
): BindingBodyResult {
  if (step.kind !== 'decision') {
    return { ok: false, reason: 'This step is not a decision.' };
  }

  const branches: { when: string; selectors: SelectorChain; fingerprint: ElementFingerprint }[] =
    [];
  const missing: string[] = [];

  // Ordered by the graph, not by the order they happened to be demonstrated, so
  // the compiled alternatives read in the same sequence as the workflow a
  // reviewer is looking at.
  for (const declared of step.branches) {
    const demonstrated = choice.branches.find((branch) => branch.when === declared.when);

    if (demonstrated === undefined) {
      missing.push(declared.when);
      continue;
    }

    branches.push({
      when: declared.when,
      selectors: demonstrated.selectors,
      fingerprint: demonstrated.fingerprint,
    });
  }

  if (missing.length > 0) {
    return {
      ok: false,
      reason: `Each branch of this decision needs its own element. Still to show: ${missing
        .map((when) => `"${when}"`)
        .join(', ')}.`,
    };
  }

  return { ok: true, body: { kind: 'decision', branches } };
}

/**
 * Whether the human demonstrates the step or points at a value to read.
 *
 * A bare string union rather than the recorder's `CaptureMode`, so the capture
 * engine's types stay on the capture engine's side of the boundary.
 */
export function captureModeForStepKind(kind: string): 'action' | 'pick' {
  return comparisonModeFor(kind as BindingKind) === 'action' ? 'action' : 'pick';
}

/**
 * The value source a drafted fill step already implies.
 *
 * A drafted step declares its own `value` — `${inputs.requestNumber}` or a
 * literal — so the answer the recorder CLI has to ask for is, for a drafted
 * workflow, already written down. Deriving it rather than asking again is the
 * difference between confirming a step and re-authoring it.
 *
 * A sensitive field is the exception: its declared value resolves at run time
 * from a secret input, and nothing captured or entered at binding time belongs
 * in a durable artifact, so it gets an empty literal placeholder instead of
 * anything read off the page.
 */
export function defaultValueSourceFor(step: SopStep): ValueSource | null {
  if (step.kind !== 'fill') {
    return null;
  }

  if (step.sensitive === true) {
    return { kind: 'literal', value: '' };
  }

  const classified = classifyValue(step.value);

  if (classified.kind === 'reference') {
    return { kind: 'sop_variable', name: classified.reference.name };
  }

  // A malformed value is a graph defect rather than a binding decision; saying
  // so is the caller's job, and guessing a source for it would hide it.
  return classified.kind === 'literal' ? { kind: 'literal', value: classified.value } : null;
}

/**
 * Builds the binding a capture describes.
 *
 * `scope` is deliberately absent rather than set to anything: single-record
 * navigation holds for every workflow Orbit can execute, and building a
 * disambiguation UI for a case that cannot occur yet would be guessing at its
 * shape (ADR-018).
 */
export function assembleBinding(input: {
  readonly step: SopStep;
  readonly body: BindingBody;
  readonly revisionId: SopRevisionId;
}): ExecutionBinding {
  return {
    schemaVersion: EXECUTION_BINDING_SCHEMA_VERSION,
    stepId: input.step.id,
    body: input.body,
    capturedAgainstRevisionId: input.revisionId,
    stepSha256: stepChecksum(input.step),
  };
}

/**
 * Validates against the graph, then persists.
 *
 * The refusal for a `manual_review` step is checked here as well as by
 * `validateBindingAgainstStep`, because the two refusals answer different
 * questions. The schema cannot express such a binding at all; this one catches
 * the attempt earlier and says why in a sentence a person can act on, rather
 * than as a schema error about a discriminated union.
 */
export async function createBinding(input: CreateBindingInput): Promise<CreateBindingResult> {
  if (!isBindableStepKind(input.step.kind)) {
    return { ok: false, reason: 'not_bindable', stepId: input.step.id };
  }

  const binding = assembleBinding({
    step: input.step,
    body: input.body,
    revisionId: input.revisionId,
  });

  const parsed = parseExecutionBinding(binding);

  if (!parsed.ok) {
    return { ok: false, reason: 'invalid', issues: parsed.issues };
  }

  const issues = validateBindingAgainstStep(parsed.binding, {
    stepId: input.step.id,
    kind: input.step.kind,
    declaredNames: declaredNames(input.graph),
    stepSha256: stepChecksum(input.step),
    ...(input.step.kind === 'decision'
      ? { branchConditions: input.step.branches.map((branch) => branch.when) }
      : {}),
  });

  if (issues.length > 0) {
    return { ok: false, reason: 'invalid', issues };
  }

  const created = await withTransaction(input.database, async (repositories) => {
    const draft = await repositories.executionBindings.create({
      documentId: input.documentId,
      binding: parsed.binding,
      ...(input.parentBindingId === undefined ? {} : { parentBindingId: input.parentBindingId }),
    });

    if (input.confirmedByDemonstration === undefined) {
      return draft;
    }

    // Through the lifecycle, never around it: the repository refuses
    // draft -> approved, and writing a state the application cannot otherwise
    // produce would make the state machine advisory.
    await repositories.executionBindings.submitForReview(draft.id);

    return repositories.executionBindings.approve(draft.id, {
      reviewNote: input.confirmedByDemonstration.reviewNote,
    });
  });

  return { ok: true, binding: created };
}

/** Names a fill may reference: the graph's declared inputs and produced variables. */
export function declaredNames(graph: SopGraph): readonly string[] {
  const names = new Set<string>();

  for (const input of graph.inputs) {
    names.add(input.id);
  }

  for (const step of graph.steps) {
    if (step.kind === 'extract') {
      for (const field of step.fields) {
        names.add(field.name);
      }
    }
    if (step.kind === 'decision') {
      for (const produced of step.produces ?? []) {
        names.add(produced.name);
      }
    }
  }

  return [...names].sort();
}

/** Which steps already have a live binding, for the step list and coverage. */
export async function boundStepIds(
  database: OrbitDatabase,
  documentId: SopDocumentId,
): Promise<ReadonlySet<string>> {
  const current = await createRepositories(database).executionBindings.listCurrent(documentId);
  return new Set(current.map((binding) => binding.stepId));
}
