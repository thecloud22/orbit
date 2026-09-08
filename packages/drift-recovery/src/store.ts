import type { ExecutionBindingId, RunId, AgentVersionId } from '@orbit/contracts';
import {
  createRepositories,
  RecoveryProposalAlreadyOpenError,
  type OrbitDatabase,
} from '@orbit/db';
import type { DriftObservation } from '@orbit/runtime';

import type {
  RecoveryProposalStore,
  RecoveryTarget,
  SaveRecoveryProposalInput,
  SaveRecoveryProposalResult,
} from './proposer';

/**
 * The database behind the store port.
 *
 * Two operations, both narrow by design. `contextFor` is a single lookup by
 * binding id — cheap enough to do inside a run that is already failing, and it
 * needs no traversal through an Agent Version's provenance because the binding
 * row carries its own document and step. `save` inserts one row.
 *
 * What this deliberately cannot do is as important as what it does. There is no
 * update of a binding here, no state transition, no publish, and no reach into
 * `agent_versions`. Writing a proposal is an insert into one table, and that is
 * the whole of what a failing run is permitted to change (ADR-033).
 */
export function createDatabaseRecoveryProposalStore(options: {
  readonly database: OrbitDatabase;
}): RecoveryProposalStore {
  const repositories = createRepositories(options.database);

  return {
    async contextFor(observation: DriftObservation): Promise<RecoveryTarget | null> {
      const binding = await repositories.executionBindings.findById(
        observation.bindingId as ExecutionBindingId,
      );

      if (binding === null) {
        return null;
      }

      return {
        documentId: binding.documentId,
        stepId: binding.stepId,
        binding: binding.binding,
      };
    },

    async save(input: SaveRecoveryProposalInput): Promise<SaveRecoveryProposalResult> {
      try {
        const proposal = await repositories.bindingRecoveryProposals.create({
          documentId: input.target.documentId as never,
          stepId: input.target.stepId,
          proposedForBindingId: input.observation.bindingId as ExecutionBindingId,
          observedInRunId: input.observation.context.runId as RunId,
          observedInAgentVersionId: input.observation.context.agentVersionId as AgentVersionId,
          proposedBinding: input.proposedBinding,
          diagnosis: input.diagnosis,
          // Always true in this version. The column exists so a reader of an old
          // proposal can tell which kind it is without knowing when — or
          // whether — ranking was ever switched on.
          deterministic: true,
        });

        return { saved: true, proposalId: proposal.id };
      } catch (error) {
        if (error instanceof RecoveryProposalAlreadyOpenError) {
          // An expected outcome, not a fault: a drifted agent running on a
          // schedule would otherwise write one identical proposal per run.
          return { saved: false, reason: 'already_proposed' };
        }

        throw error;
      }
    },
  };
}
