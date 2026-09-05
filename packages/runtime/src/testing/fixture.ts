import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseAgentIrDocument, parseAgentIrYaml, type AgentIr } from '@orbit/agent-ir';
import { agentIdSchema, agentVersionIdSchema, type AgentVersionId } from '@orbit/contracts';

/**
 * The seeded fixture, and the deliberately broken variants tests execute.
 *
 * A variant is always re-validated through @orbit/agent-ir, so a test can never
 * execute a document that Orbit itself would refuse to publish — the failure
 * under test stays a *runtime* failure rather than an invalid fixture.
 */

export const FIXTURE_PATH = fileURLToPath(
  new URL('../../../../fixtures/find-service-request.agent.yaml', import.meta.url),
);

export const SEEDED_AGENT_VERSION_ID: AgentVersionId = agentVersionIdSchema.parse(
  'agentv_find_service_request_0_1_0',
);

export function loadFixtureAgentIr(): AgentIr {
  const parsed = parseAgentIrYaml(readFileSync(FIXTURE_PATH, 'utf8'));

  if (!parsed.ok) {
    throw new Error(`The seeded fixture no longer validates: ${JSON.stringify(parsed.issues)}`);
  }

  return parsed.agentIr;
}

function reparse(document: unknown, description: string): AgentIr {
  const parsed = parseAgentIrDocument(document);

  if (!parsed.ok) {
    throw new Error(`${description} is not valid Agent IR: ${JSON.stringify(parsed.issues)}`);
  }

  return parsed.agentIr;
}

/**
 * The controlled failure: one extraction locator points at a test id the portal
 * does not render.
 *
 * Published under its own agent id and version so it can never be mistaken for,
 * or collide with, the seeded Agent Version. The demo portal is untouched — the
 * broken thing is the agent, which is the only side of the pair a test is
 * allowed to break.
 */
export function brokenExtractLocatorAgentIr(
  missingTestId = 'request-status-does-not-exist',
): AgentIr {
  const document = JSON.parse(JSON.stringify(loadFixtureAgentIr())) as {
    id: string;
    version: string;
    name: string;
    steps: { id: string; type: string; fields?: Record<string, { locator: { value: string } }> }[];
  };

  document.id = agentIdSchema.parse('agent_find_service_request_broken_locator');
  document.version = '9.9.9';
  document.name = 'Find Service Request (broken locator fixture)';

  const extract = document.steps.find((step) => step.id === 'extract_request_data');
  const field = extract?.fields?.['requestStatus'];

  if (field === undefined) {
    throw new Error('The fixture no longer has an extract_request_data.requestStatus field.');
  }

  field.locator.value = missingTestId;

  return reparse(document, 'The broken-locator variant');
}
