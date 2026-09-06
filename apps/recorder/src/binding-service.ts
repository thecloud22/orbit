import type { SopDocumentId, SopRevisionId } from '@orbit/contracts';
import {
  createRepositories,
  stepChecksum,
  withTransaction,
  type ExecutionBindingRecord,
  type OrbitDatabase,
} from '@orbit/db';
import {
  EXECUTION_BINDING_SCHEMA_VERSION,
  isBindableStepKind,
  parseExecutionBinding,
  validateBindingAgainstStep,
  type BindingBody,
  type BindingIssue,
  type ExecutionBinding,
} from '@orbit/execution-mapping';
import type { SopGraph, SopStep } from '@orbit/sop-graph';

import { declaredNames } from './flow';

/**
 * Assembling a capture into a binding, and persisting it.
 *
 * The composition root for recording: the capture engine knows nothing about
 * the SOP Graph, and @orbit/execution-mapping knows nothing about a database.
 * This is where a demonstration becomes a durable, validated artifact.
 *
 * `stepChecksum` comes from @orbit/db rather than being computed here. Two
 * components must agree on it — this one, which writes it, and sub-phase 2.5's
 * compiler, which will trust it — and there is exactly one function so they
 * cannot drift apart.
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
 * Validates against the graph, then persists as a draft.
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
  });

  if (issues.length > 0) {
    return { ok: false, reason: 'invalid', issues };
  }

  const created = await withTransaction(input.database, async (repositories) =>
    repositories.executionBindings.create({
      documentId: input.documentId,
      binding: parsed.binding,
      ...(input.parentBindingId === undefined ? {} : { parentBindingId: input.parentBindingId }),
    }),
  );

  return { ok: true, binding: created };
}

/** Which steps already have a live binding, for the step list and coverage. */
export async function boundStepIds(
  database: OrbitDatabase,
  documentId: SopDocumentId,
): Promise<ReadonlySet<string>> {
  const current = await createRepositories(database).executionBindings.listCurrent(documentId);
  return new Set(current.map((binding) => binding.stepId));
}
