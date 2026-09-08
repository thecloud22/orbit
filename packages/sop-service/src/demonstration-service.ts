import type { SopDocumentId, SopRevisionId } from '@orbit/contracts';
import {
  createRepositories,
  stepChecksum,
  type BindingRecoveryProposalRecord,
  type OrbitDatabase,
} from '@orbit/db';
import { validateBindingAgainstStep } from '@orbit/execution-mapping';
import {
  alignDemonstration,
  type AlignmentRefusal,
  type DemonstratedEntry,
} from '@orbit/sop-recording';
import { describeStep, type SopGraph, type SopStep } from '@orbit/sop-graph';

import {
  assembleBinding,
  BINDABLE_KINDS,
  bindingBodyFor,
  declaredNames,
  defaultValueSourceFor,
  type BindingCapture,
  type BindingChoice,
} from './binding-service';

/**
 * One walkthrough, turned into proposals a person reviews (ADR-035).
 *
 * The composition root for demonstrating a whole workflow at once, and the
 * mirror of `binding-service.ts`: that one turns *one* demonstrated step into
 * an approved binding, because a person watched themselves do it and confirmed
 * which capture it was. This one turns a whole sitting into *guesses* about
 * which capture was which step, and a guess is not an approval — so nothing
 * here creates a binding. It writes proposals, and `recovery-service.ts`
 * accepts them through the one path a binding is ever made by.
 *
 * The alignment itself is `@orbit/sop-recording`'s `alignDemonstration`, which
 * is pure and synchronous. What is added here is everything that needs a
 * database or a graph: which steps are still waiting, what a fill's value
 * source should be, whether the assembled binding actually validates against
 * the step, and the row.
 *
 * What is deliberately *not* here: any writing to `execution_bindings`. This
 * file cannot make a mapping live, and could not be changed to without the
 * change being obvious.
 */

/** Why a drafted step came out of a walkthrough with no proposal. */
export type ProposalRefusal =
  | AlignmentRefusal
  /**
   * Aligned to a capture, but the binding needs a judgement a walkthrough
   * cannot supply — which of several read fields this step populates, or where
   * a fill's value comes from when the step does not say.
   */
  | 'needs_a_choice'
  /** Aligned, assembled, and refused by the same validator the publish gate uses. */
  | 'did_not_validate'
  /** A proposal for this step was already open, so this walkthrough added none. */
  | 'already_proposed';

/** One drafted step, and what the walkthrough had to say about it. */
export type StepProposal =
  | {
      readonly outcome: 'proposed';
      readonly stepId: string;
      readonly stepKind: string;
      readonly summary: string;
      readonly proposalId: string;
      /**
       * The element, as a sentence. Role and accessible name only.
       *
       * Never what was typed: a proposal is durable and broadly readable, and
       * the value a person entered while demonstrating has no business in one.
       * A fill's value comes from the step's own declaration instead.
       */
      readonly demonstrated: string;
    }
  | {
      readonly outcome: 'refused';
      readonly stepId: string;
      readonly stepKind: string;
      readonly summary: string;
      readonly refusal: ProposalRefusal;
      readonly message: string;
    };

export interface WalkthroughProposalResult {
  /** Every step that was offered, in the workflow's own order. */
  readonly steps: readonly StepProposal[];
  /** Captures the walkthrough contained that no step claimed. */
  readonly unusedCaptures: number;
}

export type ProposeFromWalkthroughResult =
  | { readonly ok: true; readonly result: WalkthroughProposalResult }
  | { readonly ok: false; readonly reason: 'document_not_found' }
  | { readonly ok: false; readonly reason: 'nothing_to_bind' }
  | { readonly ok: false; readonly reason: 'nothing_demonstrated' };

/**
 * The steps a walkthrough is offered to bind.
 *
 * Exactly the compiler's bindable kinds, minus everything already bound, in
 * graph order. Narrowing to unbound steps is what `alignDemonstration`
 * documents its caller as doing, and it is also the honest offer: re-proposing
 * a mapping somebody already demonstrated would ask them to review work they
 * have finished.
 */
export function stepsAwaitingBinding(
  graph: SopGraph,
  bound: ReadonlySet<string>,
): readonly SopStep[] {
  return graph.steps.filter((step) => BINDABLE_KINDS.has(step.kind) && !bound.has(step.id));
}

/** The element a capture names, as a sentence a reviewer can check at a glance. */
export function describeDemonstrated(entry: DemonstratedEntry): string {
  if (entry.kind === 'navigate') {
    return `Opened ${entry.url}`;
  }

  const named = entry.fingerprint.accessibleName ?? entry.fingerprint.text ?? 'an unnamed element';

  if (entry.kind === 'fill') {
    return `Filled "${named}"${entry.sensitive === true ? ' — password, value not read' : ''}`;
  }

  return entry.kind === 'click' ? `Clicked "${named}"` : `Pointed at "${named}"`;
}

/**
 * Aligns a walkthrough onto a document's unbound steps and proposes a binding
 * for each step it could account for.
 *
 * Every step that was offered comes back, whether or not anything was proposed
 * for it. A step that got nothing is the more interesting half of the result —
 * it is what the review screen has to explain — so it is a value here rather
 * than an absence the caller has to notice.
 */
export async function proposeBindingsFromWalkthrough(input: {
  readonly database: OrbitDatabase;
  readonly documentId: SopDocumentId;
  readonly sequence: readonly DemonstratedEntry[];
}): Promise<ProposeFromWalkthroughResult> {
  const repositories = createRepositories(input.database);
  const revision = await repositories.sopGraphRevisions.findCurrent(input.documentId);

  if (revision === null) {
    return { ok: false, reason: 'document_not_found' };
  }

  const live = await repositories.executionBindings.listCurrent(input.documentId);
  const offered = stepsAwaitingBinding(revision.graph, new Set(live.map((row) => row.stepId)));

  if (offered.length === 0) {
    return { ok: false, reason: 'nothing_to_bind' };
  }

  if (!input.sequence.some((entry) => entry.kind !== 'navigate')) {
    return { ok: false, reason: 'nothing_demonstrated' };
  }

  const alignment = alignDemonstration({
    steps: offered.map((step) => ({ id: step.id, kind: step.kind })),
    sequence: input.sequence,
  });

  const byId = new Map(offered.map((step) => [step.id, step]));
  const steps: StepProposal[] = [];

  for (const aligned of alignment.alignments) {
    const step = byId.get(aligned.stepId);

    if (step === undefined) {
      continue;
    }

    const summary = describeStep(step);

    if (aligned.kind === 'unmatched') {
      steps.push({
        outcome: 'refused',
        stepId: step.id,
        stepKind: step.kind,
        summary,
        refusal: aligned.refusal,
        message: aligned.message,
      });
      continue;
    }

    steps.push(
      await proposeOne({
        database: input.database,
        documentId: input.documentId,
        revisionId: revision.id,
        graph: revision.graph,
        step,
        summary,
        entry: aligned.entry,
      }),
    );
  }

  return { ok: true, result: { steps, unusedCaptures: alignment.unusedCaptures } };
}

/**
 * One aligned step, assembled and stored — or refused with the reason.
 *
 * The refusals here are the ones alignment cannot see, because they are about
 * the step rather than about the walkthrough: a fill whose value the graph does
 * not state, an extract that reads several fields, or a binding the shared
 * validator turns down. Each is reported per step rather than failing the whole
 * walkthrough, because eight good proposals and one explained gap is a far
 * better result than nothing.
 */
async function proposeOne(input: {
  readonly database: OrbitDatabase;
  readonly documentId: SopDocumentId;
  readonly revisionId: SopRevisionId;
  readonly graph: SopGraph;
  readonly step: SopStep;
  readonly summary: string;
  readonly entry: DemonstratedEntry;
}): Promise<StepProposal> {
  const { step, summary, entry } = input;

  const refused = (refusal: ProposalRefusal, message: string): StepProposal => ({
    outcome: 'refused',
    stepId: step.id,
    stepKind: step.kind,
    summary,
    refusal,
    message,
  });

  if (entry.kind === 'navigate') {
    // Unreachable through `alignDemonstration`, which never matches a navigate
    // to a step. Stated rather than assumed, because the assumption lives in a
    // different package.
    return refused('nothing_matched', 'A page change does not bind a step.');
  }

  const choice = choiceFor(step);

  if ('refusal' in choice) {
    return refused('needs_a_choice', choice.refusal);
  }

  const capture: BindingCapture = {
    selectors: entry.selectors,
    fingerprint: entry.fingerprint,
    url: entry.url ?? '',
  };

  const body = bindingBodyFor({ step, capture, choice });

  if (!body.ok) {
    return refused('did_not_validate', body.reason);
  }

  const binding = assembleBinding({ step, body: body.body, revisionId: input.revisionId });

  // The same validator the recorder, the read view and the publish gate use.
  // A proposal is not exempt from it because Orbit assembled it — if anything
  // the reverse, since nobody has confirmed this element is the right one.
  const issues = validateBindingAgainstStep(binding, {
    stepId: step.id,
    kind: step.kind,
    declaredNames: declaredNames(input.graph),
    stepSha256: stepChecksum(step),
  });

  if (issues.length > 0) {
    return refused(
      'did_not_validate',
      `What the walkthrough showed does not fit this step: ${issues
        .map((issue) => issue.message)
        .join('; ')}`,
    );
  }

  const repositories = createRepositories(input.database);

  // Checked rather than caught, because "a proposal is already open for this
  // step" is an ordinary outcome of walking the same workflow twice, not a
  // fault. The partial unique index behind it is still the guarantee.
  const open = await repositories.bindingRecoveryProposals.findOpenForStep(
    input.documentId,
    step.id,
  );

  if (open !== null) {
    return refused(
      'already_proposed',
      'A proposal for this step is already waiting to be reviewed, so this walkthrough left it alone. Accept or dismiss that one first.',
    );
  }

  const proposal: BindingRecoveryProposalRecord =
    await repositories.bindingRecoveryProposals.create({
      documentId: input.documentId,
      stepId: step.id,
      origin: 'demonstration',
      proposedBinding: binding,
      diagnosis: {
        summary: `${describeDemonstrated(entry)} while walking through this workflow.`,
        // Not a number, and never one. The alignment is right or it is not, and
        // a score computed from "the kinds matched and the order held" would be
        // false precision somebody would then tune a threshold against — the
        // same reasoning ADR-033 gives for the drift path.
        confidence: 'aligned_by_order',
        demonstrated: describeDemonstrated(entry),
        element: {
          role: entry.fingerprint.role,
          accessibleName: entry.fingerprint.accessibleName,
        },
      },
      // Always true here. Alignment is synchronous and calls no model, so the
      // column says so for the same reason the drift path's does.
      deterministic: true,
    });

  return {
    outcome: 'proposed',
    stepId: step.id,
    stepKind: step.kind,
    summary,
    proposalId: proposal.id,
    demonstrated: describeDemonstrated(entry),
  };
}

/**
 * The judgement a capture cannot supply, taken from the step where it can be.
 *
 * A narrower sibling of the binding session's own `choiceFor`: that one accepts
 * a person's answer and falls back to the step, and this one has no person to
 * ask, so a step that does not answer for itself is refused rather than
 * guessed. `decision` is absent because alignment never reaches here with one.
 */
function choiceFor(step: SopStep): BindingChoice | { readonly refusal: string } {
  if (step.kind === 'click') {
    return { kind: 'click' };
  }

  if (step.kind === 'fill') {
    const valueSource = defaultValueSourceFor(step);

    if (valueSource === null) {
      return {
        refusal:
          'This step does not say where its value comes from, so binding it needs that chosen by hand.',
      };
    }

    return { kind: 'fill', valueSource };
  }

  if (step.kind === 'extract') {
    const only = step.fields.length === 1 ? step.fields[0]?.name : undefined;

    if (only === undefined) {
      return {
        refusal:
          'This step reads more than one value, so binding it needs a person to say which one this element holds.',
      };
    }

    return { kind: 'extract', readMethod: { kind: 'text' }, variable: only };
  }

  return {
    refusal: `A "${step.kind}" step is not something a walkthrough can map to an element.`,
  };
}
