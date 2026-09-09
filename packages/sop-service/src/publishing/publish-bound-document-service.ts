import {
  BINDABLE_KINDS as COMPILER_BINDABLE_KINDS,
  type CompileRefusal,
} from '@orbit/agent-ir-compiler';
import type { SopDocumentId } from '@orbit/contracts';
import {
  createRepositories,
  stepChecksum,
  type AgentVersionRecord,
  type OrbitDatabase,
} from '@orbit/db';
import { isBindingUsable } from '@orbit/execution-mapping';
import type { SopGraph } from '@orbit/sop-graph';

import { declaredNames } from '../binding/binding-service';
import { createPublishPipeline } from './publish-pipeline';

/**
 * Publishing a drafted workflow whose every step has been bound.
 *
 * The counterpart to `publish-recording-service.ts`, and the same shape with a
 * different precondition. A recording confirms a workflow against a real page
 * all at once; a binding session confirms it one step at a time (ADR-027).
 * Once every bindable step of a drafted workflow carries an approved,
 * non-stale Execution Binding, the same confirmation exists — assembled
 * differently — so the same one action applies.
 *
 * The gate here is technical, not a review waiver. `compileDocument` already
 * refuses a document with a missing binding (`missing_binding`), so a
 * partially bound draft has no publish path at all; what this adds is checking
 * that precondition *before* driving the revision through approval, so a
 * refusal names the unbound steps instead of leaving a workflow approved and
 * uncompilable.
 *
 * What it does not do is offer a button for an unbound draft. That case still
 * has nothing standing behind it, and ADR-025's line is unchanged.
 */

export type PublishBoundDocumentResult =
  | { readonly ok: true; readonly agentVersion: AgentVersionRecord }
  | { readonly ok: false; readonly reason: 'not_found' }
  | {
      readonly ok: false;
      readonly reason: 'not_fully_bound';
      /** The bindable steps with no approved, usable binding. */
      readonly unboundStepIds: readonly string[];
    }
  | {
      readonly ok: false;
      readonly reason: 'revision_not_publishable';
      readonly state: string;
    }
  | {
      readonly ok: false;
      readonly reason: 'questions_unanswered';
      readonly unansweredQuestionIds: readonly string[];
    }
  | { readonly ok: false; readonly reason: 'refused'; readonly refusals: readonly CompileRefusal[] }
  | { readonly ok: false; readonly reason: 'not_ready'; readonly sandboxState: string }
  | { readonly ok: false; readonly reason: 'already_published'; readonly agentVersionId: string };

export interface PublishBoundDocumentService {
  publish(documentId: SopDocumentId): Promise<PublishBoundDocumentResult>;
}

/**
 * The step kinds the compiler requires a binding for.
 *
 * Imported from the compiler rather than restated here. It used to be a
 * hand-copied literal, and adding `decision` to the compiler while this stayed
 * at three kinds would have let a workflow with an unbound decision reach a
 * publish that the compiler then refused — the exact ordering problem this gate
 * exists to prevent.
 */
const BINDABLE_KINDS = COMPILER_BINDABLE_KINDS;

/** Bindable steps with no approved, usable (non-stale, well-formed) binding. */
export async function unboundStepIdsFor(input: {
  readonly database: OrbitDatabase;
  readonly documentId: SopDocumentId;
  readonly graph: SopGraph;
}): Promise<readonly string[]> {
  const current = await createRepositories(input.database).executionBindings.listCurrent(
    input.documentId,
  );
  const byStep = new Map(current.map((binding) => [binding.stepId, binding]));
  const names = declaredNames(input.graph);

  return input.graph.steps
    .filter((step) => {
      if (!BINDABLE_KINDS.has(step.kind)) {
        return false;
      }

      const binding = byStep.get(step.id);

      if (binding === undefined || binding.state !== 'approved') {
        return true;
      }

      // The same validator the read view and the recorder run, so "usable"
      // means one thing across the three of them — staleness included.
      return !isBindingUsable(binding.binding, {
        stepId: step.id,
        kind: step.kind,
        declaredNames: names,
        stepSha256: stepChecksum(step),
        ...(step.kind === 'decision'
          ? { branchConditions: step.branches.map((branch) => branch.when) }
          : {}),
      });
    })
    .map((step) => step.id);
}

export function createPublishBoundDocumentService(options: {
  readonly database: OrbitDatabase;
}): PublishBoundDocumentService {
  const pipeline = createPublishPipeline(options);
  const repositories = createRepositories(options.database);

  return {
    async publish(documentId) {
      const document = await repositories.sopDocuments.findById(documentId);
      if (document === null) {
        return { ok: false, reason: 'not_found' };
      }

      const revision = await repositories.sopGraphRevisions.findCurrent(documentId);
      if (revision === null) {
        return { ok: false, reason: 'not_found' };
      }

      const unboundStepIds = await unboundStepIdsFor({
        database: options.database,
        documentId,
        graph: revision.graph,
      });

      if (unboundStepIds.length > 0) {
        return { ok: false, reason: 'not_fully_bound', unboundStepIds };
      }

      return pipeline.run({ documentId, revision });
    },
  };
}
