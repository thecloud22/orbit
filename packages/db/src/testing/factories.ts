import type { AgentVersionId, RunInputs, RunTrigger } from '@orbit/contracts';

import type { OrbitDatabase } from '../client';
import type { AgentVersionRecord, RunRecord } from '../mappers';
import { createRepositories } from '../repositories';
import { seedFindServiceRequest } from '../seed';

/** The Phase 1 development actor. No authentication exists yet (see api.md). */
export const TEST_TRIGGER: RunTrigger = {
  type: 'watchtower_manual',
  actor: { type: 'development_user', id: 'dev-user' },
  source: { application: 'orbit-watchtower' },
};

export const FOUND_INPUTS: RunInputs = { requestNumber: 'SR-1001' };
export const NOT_FOUND_INPUTS: RunInputs = { requestNumber: 'SR-9999' };

export const FOUND_OUTPUTS = {
  requestNumber: 'SR-1001',
  requestStatus: 'In Progress',
  assignedTeam: 'Infrastructure Operations',
};

export async function seedTestAgentVersion(db: OrbitDatabase): Promise<AgentVersionRecord> {
  const { agentVersion } = await seedFindServiceRequest(db);
  return agentVersion;
}

export async function createTestRun(
  db: OrbitDatabase,
  agentVersionId: AgentVersionId,
  inputs: RunInputs = FOUND_INPUTS,
): Promise<RunRecord> {
  return createRepositories(db).runs.create({ agentVersionId, trigger: TEST_TRIGGER, inputs });
}
