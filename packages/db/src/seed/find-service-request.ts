import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseAgentIrYaml, type AgentIr } from '@orbit/agent-ir';
import { agentVersionIdSchema, type AgentVersionId } from '@orbit/contracts';

import { sha256Of } from '../checksum';
import type { OrbitDatabase } from '../client';
import { ImmutableAgentVersionError, OrbitDatabaseError } from '../errors';
import type { AgentVersionRecord } from '../mappers';
import { withTransaction } from '../repositories';

/** The seeded Phase 1 agent. Reading it from disk is the caller's job, not @orbit/agent-ir's. */
export const FIND_SERVICE_REQUEST_FIXTURE_PATH = fileURLToPath(
  new URL('../../../../fixtures/find-service-request.agent.yaml', import.meta.url),
);

export class SeedValidationError extends OrbitDatabaseError {}

export function readFindServiceRequestFixture(): string {
  return readFileSync(FIND_SERVICE_REQUEST_FIXTURE_PATH, 'utf8');
}

/**
 * A deterministic, readable Agent Version ID for seeded versions.
 *
 * Seeding must be idempotent, and a random ID would create a second version of
 * the same workflow on every run. Deriving the ID from the agent and version
 * means re-seeding either finds the existing row or fails loudly.
 */
export function seededAgentVersionId(agentIr: AgentIr): AgentVersionId {
  const agentSlug = agentIr.id.replace(/^agent_/, '');
  const versionSlug = agentIr.version.replaceAll('.', '_');
  return agentVersionIdSchema.parse(`agentv_${agentSlug}_${versionSlug}`);
}

export interface SeedResult {
  readonly agentVersion: AgentVersionRecord;
  /** False when the version was already present and unchanged. */
  readonly created: boolean;
}

/**
 * Seeds the Find Service Request Agent Version.
 *
 * The fixture is validated through @orbit/agent-ir before anything is written:
 * the database never holds Agent IR that the runtime would refuse to execute.
 *
 * Re-seeding an unchanged fixture is a no-op. Re-seeding a *changed* fixture
 * under the same version number raises rather than overwriting — a published
 * version is immutable (ADR-005), and quietly rewriting it would invalidate the
 * evidence of every run that already referenced it. Publishing a change means
 * bumping the version.
 */
export async function seedFindServiceRequest(
  db: OrbitDatabase,
  options: { readonly fixtureYaml?: string } = {},
): Promise<SeedResult> {
  const yaml = options.fixtureYaml ?? readFindServiceRequestFixture();
  const parsed = parseAgentIrYaml(yaml);

  if (!parsed.ok) {
    throw new SeedValidationError(
      `Refusing to seed invalid Agent IR: ${JSON.stringify(parsed.issues, null, 2)}`,
    );
  }

  const { agentIr } = parsed;
  const checksum = sha256Of({ ...agentIr });

  return withTransaction(db, async (repositories) => {
    await repositories.agents.upsert({
      id: agentIr.id,
      name: agentIr.name,
      ...(agentIr.description === undefined ? {} : { description: agentIr.description }),
    });

    const existing = await repositories.agentVersions.findByAgentAndVersion(
      agentIr.id,
      agentIr.version,
    );

    if (existing !== null) {
      if (existing.irSha256 !== checksum) {
        throw new ImmutableAgentVersionError(
          `Agent version ${existing.id} (${agentIr.id} ${agentIr.version}) is already published with different Agent IR. Published versions are immutable: publish a new version instead of editing this one.`,
        );
      }

      return { agentVersion: existing, created: false };
    }

    const agentVersion = await repositories.agentVersions.create({
      agentIr,
      id: seededAgentVersionId(agentIr),
    });

    return { agentVersion, created: true };
  });
}
