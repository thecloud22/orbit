import { parseAgentIrYaml } from '@orbit/agent-ir';
import { describe, expect, it } from 'vitest';

import { readFindServiceRequestFixture, seededAgentVersionId } from './find-service-request';

/**
 * Validation of the fixture happens before any database is involved: an Agent
 * Version that would not execute must never reach PostgreSQL in the first place.
 */
describe('find service request seed', () => {
  const fixture = readFindServiceRequestFixture();

  it('reads a fixture that validates as Agent IR', () => {
    const parsed = parseAgentIrYaml(fixture);

    if (!parsed.ok) {
      throw new Error(`fixture is invalid: ${JSON.stringify(parsed.issues, null, 2)}`);
    }

    expect(parsed.agentIr.id).toBe('agent_find_service_request');
    expect(parsed.agentIr.version).toBe('0.1.0');
    expect(parsed.agentIr.lifecycle.status).toBe('published');
  });

  it('derives a deterministic, readable agent version id', () => {
    const parsed = parseAgentIrYaml(fixture);
    if (!parsed.ok) throw new Error('fixture is invalid');

    expect(seededAgentVersionId(parsed.agentIr)).toBe('agentv_find_service_request_0_1_0');
    // Deterministic: seeding twice must not produce two versions of one workflow.
    expect(seededAgentVersionId(parsed.agentIr)).toBe(seededAgentVersionId(parsed.agentIr));
  });
});
