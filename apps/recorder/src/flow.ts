import {
  comparisonModeFor,
  isBindableStepKind,
  type BindingBody,
  type ReadMethod,
  type ValueSource,
} from '@orbit/execution-mapping';
import { describeStep, type SopGraph, type SopStep } from '@orbit/sop-graph';

/**
 * Every decision the recorder makes, as pure functions.
 *
 * The CLI around this is a thin shell over a TTY, and a thin shell is not
 * something worth testing. The branching *is*: which steps may be recorded,
 * what a fill's value may come from, whether a typed value survives, whether a
 * URL is allowed. Keeping that here means it is testable without a terminal and
 * without a browser.
 */

export interface StepChoice {
  readonly step: SopStep;
  /** `describeStep`, so the terminal names a step the way the review view does. */
  readonly label: string;
  readonly bindable: boolean;
  /** Why it cannot be recorded, when it cannot. */
  readonly reason: string | undefined;
  readonly hasBinding: boolean;
}

/**
 * The steps a person may choose from, and the ones they may not.
 *
 * A `manual_review` step is listed rather than hidden. Hiding it would leave
 * someone hunting for a step they can see in the review view and cannot find
 * here; saying why it is absent answers the question before it is asked.
 */
export function stepChoices(
  graph: SopGraph,
  boundStepIds: ReadonlySet<string>,
): readonly StepChoice[] {
  return graph.steps.map((step) => {
    const bindable = isBindableStepKind(step.kind);

    return {
      step,
      label: describeStep(step),
      bindable,
      reason: bindable
        ? undefined
        : 'This step routes to a person, so there is nothing to automate and nothing to record.',
      hasBinding: boundStepIds.has(step.id),
    };
  });
}

export type StartUrlDecision =
  { readonly ok: true; readonly url: string } | { readonly ok: false; readonly reason: string };

/**
 * Recording performs real actions, so the target is checked before a browser
 * opens.
 *
 * The allowlist is `@orbit/runtime`'s, not a second copy: the recorder must
 * refuse exactly what the runtime refuses, and two lists would eventually
 * disagree about which one that is.
 */
export function decideStartUrl(candidate: string): StartUrlDecision {
  let url: URL;

  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, reason: `"${candidate}" is not a URL.` };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: `${url.protocol} is not a protocol Orbit will open.` };
  }

  // Any http or https target. A recording is a person doing their job; what an
  // agent may later open unattended is constrained per agent instead.
  return { ok: true, url: url.toString() };
}

/** A navigate step's `urlHint` is a starting suggestion, never followed blindly. */
export function suggestedStartUrl(step: SopStep): string | undefined {
  return step.kind === 'navigate' ? step.urlHint : undefined;
}

/** Whether the human demonstrates the step or points at a value to read. */
export function captureModeForStep(step: SopStep): 'action' | 'pick' {
  return comparisonModeFor(step.kind as BindingBody['kind']) === 'action' ? 'action' : 'pick';
}

export type ValueSourceChoice =
  | { readonly kind: 'variable'; readonly name: string }
  | { readonly kind: 'keep_typed_value' }
  | { readonly kind: 'literal'; readonly value: string };

/**
 * What a fill actually puts in the field.
 *
 * The value typed during recording exists to prove the right field was hit. It
 * is discarded unless the person explicitly says to keep it — a real typed
 * value could be anything, and a durable artifact that quietly retains whatever
 * someone entered is not one this phase is built to protect.
 */
export function resolveValueSource(
  choice: ValueSourceChoice,
  typedValue: string | undefined,
): ValueSource {
  if (choice.kind === 'variable') {
    return { kind: 'sop_variable', name: choice.name };
  }

  if (choice.kind === 'literal') {
    return { kind: 'literal', value: choice.value };
  }

  return { kind: 'literal', value: typedValue ?? '' };
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

export const READ_METHODS: readonly ReadMethod['kind'][] = ['text', 'attribute', 'checked'];

export function readMethodFor(kind: ReadMethod['kind'], attribute?: string): ReadMethod {
  if (kind === 'attribute') {
    return { kind: 'attribute', attribute: attribute ?? 'value' };
  }
  return kind === 'checked' ? { kind: 'checked' } : { kind: 'text' };
}
