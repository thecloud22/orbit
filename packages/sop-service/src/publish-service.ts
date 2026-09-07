import type { AgentIr } from '@orbit/agent-ir';
import type { AgentId, AgentIrCandidateId } from '@orbit/contracts';
import {
  createRepositories,
  withTransaction,
  type AgentVersionRecord,
  type OrbitDatabase,
} from '@orbit/db';

/**
 * Publishing an approved candidate as a runnable Agent Version.
 *
 * The one thing worth understanding here is why the published document is not
 * byte-identical to the approved one.
 *
 * The compiler emits `lifecycle.status: 'draft'`, and the runtime executes only
 * `published` (`SUPPORTED_LIFECYCLE_STATUSES`). That difference is not an
 * inconvenience to engineer around — it *is* the approval gate. A candidate
 * byte-identical to a runnable version would be a candidate that could be run
 * before anybody approved it, which inverts the thing 2.5 built.
 *
 * So publishing mints a new artifact rather than mutating one. ADR-014 already
 * requires that: `AgentVersionRepository` deliberately exposes no update,
 * publish, patch or delete method, so there is no row to flip a status on. The
 * version is created already-published, and its `irSha256` covers the bytes
 * that will actually execute.
 *
 * What is preserved instead of byte-identity is something checkable: two named
 * fields change and nothing else, the link back to the candidate is recorded,
 * and both checksums keep covering exactly what they claim — the candidate's
 * over the approved draft, the version's over the bytes that will execute. See
 * `publishedDocumentFor` and `assertOnlyPublicationFieldsChanged` below.
 */

/**
 * The whole transformation, in one place.
 *
 * Two fields change, and both are forced rather than chosen. `lifecycle.status`
 * because the runtime executes only `published`. `version` because
 * `agent_versions` is unique on `(agent_id, version)` and the number is
 * allocated per agent at publish time, so it cannot be known when the candidate
 * is compiled.
 *
 * Deliberately one named function rather than an inline spread at the call
 * site: "what does publishing change?" should have a single answer a reader can
 * check, and `assertOnlyPublicationFieldsChanged` can only be honest if there
 * is a fixed, short list of things it has to allow for.
 */
export const PUBLICATION_FIELDS = ['lifecycle.status', 'version'] as const;

export function publishedDocumentFor(candidate: AgentIr, version: string): AgentIr {
  return { ...candidate, version, lifecycle: { ...candidate.lifecycle, status: 'published' } };
}

/**
 * Proves the transformation did what it claims, rather than trusting it.
 *
 * Traceability that means "there is a foreign key" is weaker than traceability
 * that means "you can re-derive these bytes from those bytes". This is what
 * makes the second one true: inverting the two publication fields must
 * reproduce the approved document exactly, so nothing else can be smuggled into
 * a version on its way to becoming executable — not an extra step, not a
 * widened `allowedDomains`, not a different trust tier.
 *
 * It runs against the document that is actually stored, not an intermediate
 * one. An earlier draft of this file asserted before the version was applied,
 * which would have left the one field most likely to carry a mistake outside
 * the thing checking for mistakes.
 */
export class PublishTransformationError extends Error {}

export function assertOnlyPublicationFieldsChanged(candidate: AgentIr, published: AgentIr): void {
  const inverted = {
    ...published,
    version: candidate.version,
    lifecycle: { ...published.lifecycle, status: candidate.lifecycle.status },
  };

  if (JSON.stringify(canonical(inverted)) !== JSON.stringify(canonical(candidate))) {
    throw new PublishTransformationError(
      `Publishing changed more than ${PUBLICATION_FIELDS.join(' and ')}. The published Agent IR ` +
        'must differ from the approved candidate in exactly those fields.',
    );
  }
}

/** Key order is not meaning; compare documents, not their serialisation. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }

  return value;
}

/**
 * The next version for an agent.
 *
 * Allocated here rather than taken from the candidate, which carries whatever
 * version the compile call happened to pass. `agent_versions` is unique on
 * `(agent_id, version)`, so a caller-supplied string turns republishing after
 * an edit into a collision somebody has to resolve by inventing a number. The
 * version answers "which publication of this workflow is this", and that is a
 * question the system can answer for itself.
 */
export function nextVersionAfter(existing: readonly string[]): string {
  const patches = existing.flatMap((version) => {
    const match = /^0\.1\.(\d+)$/.exec(version);
    return match?.[1] === undefined ? [] : [Number(match[1])];
  });

  return `0.1.${String(patches.length === 0 ? 0 : Math.max(...patches) + 1)}`;
}

export type PublishResult =
  | { readonly ok: true; readonly agentVersion: AgentVersionRecord }
  | { readonly ok: false; readonly reason: 'not_found' }
  | { readonly ok: false; readonly reason: 'not_approved'; readonly state: string }
  | { readonly ok: false; readonly reason: 'already_published'; readonly agentVersionId: string };

export interface SopPublishService {
  publish(candidateId: AgentIrCandidateId): Promise<PublishResult>;
}

export function createSopPublishService(options: {
  readonly database: OrbitDatabase;
}): SopPublishService {
  return {
    async publish(candidateId) {
      const candidate = await createRepositories(options.database).agentIrCandidates.findById(
        candidateId,
      );

      if (candidate === null) {
        return { ok: false, reason: 'not_found' };
      }

      // Only an approved candidate is publishable. A candidate that could not
      // be checked never reaches `approved` at all (ADR-021), so the secret
      // barrier is enforced here by construction rather than re-checked.
      if (candidate.state !== 'approved') {
        return { ok: false, reason: 'not_approved', state: candidate.state };
      }

      const agentId = candidate.agentIr.id as AgentId;

      return withTransaction(options.database, async (repositories) => {
        const existing = await repositories.agentVersions.listByAgent(agentId);
        const alreadyPublished = existing.find(
          (version) => version.publishedFromCandidateId === candidateId,
        );

        // Publishing twice would mint a second, identical version under a new
        // number, which reads as two decisions where a person made one.
        if (alreadyPublished !== undefined) {
          return {
            ok: false as const,
            reason: 'already_published' as const,
            agentVersionId: alreadyPublished.id,
          };
        }

        const published = publishedDocumentFor(
          candidate.agentIr,
          nextVersionAfter(existing.map((version) => version.version)),
        );

        // Checked on the exact document about to be written.
        assertOnlyPublicationFieldsChanged(candidate.agentIr, published);

        // The agent row must exist for the version's foreign key. `upsert`
        // rather than `create`: publishing a second version of the same
        // workflow must not fail on a row that is already there.
        await repositories.agents.upsert({
          id: agentId,
          name: candidate.agentIr.name,
          ...(candidate.agentIr.description === undefined
            ? {}
            : { description: candidate.agentIr.description }),
        });

        const agentVersion = await repositories.agentVersions.create({
          agentIr: published,
          publishedFromCandidateId: candidateId,
        });

        return { ok: true as const, agentVersion };
      });
    },
  };
}
