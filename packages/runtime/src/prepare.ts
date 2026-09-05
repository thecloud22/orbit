import type { AgentIr } from '@orbit/agent-ir';
import type { AgentVersionId, RunInputs } from '@orbit/contracts';

import { validateRunInputs } from './inputs';
import { assertExecutableProfile } from './profile';

/**
 * Everything that must hold before a run may exist.
 *
 * Kept as one function so the CLI today and the API in Task 7 apply the same
 * gate in the same order, and so a refusal always happens before a run row is
 * created rather than halfway through one.
 */
export interface PrepareExecutionInput {
  readonly agentVersionId: AgentVersionId;
  readonly agentIr: AgentIr;
  readonly rawInputs: Readonly<Record<string, unknown>>;
}

export interface PreparedExecution {
  readonly agentVersionId: AgentVersionId;
  readonly agentIr: AgentIr;
  readonly inputs: RunInputs;
}

export function prepareExecution(input: PrepareExecutionInput): PreparedExecution {
  assertExecutableProfile(input.agentIr);

  return {
    agentVersionId: input.agentVersionId,
    agentIr: input.agentIr,
    inputs: validateRunInputs(input.agentIr.inputs, input.rawInputs),
  };
}
