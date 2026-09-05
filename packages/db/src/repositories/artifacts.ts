import {
  newArtifactId,
  newArtifactLinkId,
  type ArtifactId,
  type ArtifactKind,
  type ArtifactLink,
  type ArtifactLinkId,
  type ArtifactLinkRole,
  type ArtifactMetadata,
  type EventId,
  type RunId,
  type RunStepId,
} from '@orbit/contracts';
import { asc, eq } from 'drizzle-orm';

import type { Executor } from '../client';
import { toArtifactLink, toArtifactMetadata } from '../mappers';
import { artifactLinks, artifacts, type ARTIFACT_SENSITIVITIES } from '../schema';

export interface CreateArtifactInput {
  readonly runId: RunId;
  readonly kind: ArtifactKind;
  readonly contentType: string;
  /** The key the artifact store wrote the bytes under; never a caller-supplied path. */
  readonly storageKey: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly runStepId?: RunStepId;
  readonly sensitivity?: (typeof ARTIFACT_SENSITIVITIES)[number];
  readonly redactionVersion?: string;
  readonly retentionExpiresAt?: Date;
  readonly id?: ArtifactId;
}

export type ArtifactLinkTarget =
  | { readonly targetType: 'run'; readonly targetId: RunId }
  | { readonly targetType: 'run_step'; readonly targetId: RunStepId }
  | { readonly targetType: 'run_event'; readonly targetId: EventId };

export type CreateArtifactLinkInput = ArtifactLinkTarget & {
  readonly artifactId: ArtifactId;
  readonly role: ArtifactLinkRole;
  readonly id?: ArtifactLinkId;
};

/** The same link without the artifact id, for creating an artifact and its links together. */
export type ArtifactLinkSpec = ArtifactLinkTarget & {
  readonly role: ArtifactLinkRole;
  readonly id?: ArtifactLinkId;
};

/**
 * Artifact metadata and the links that give it evidential meaning.
 *
 * Bytes are never stored here (ADR-004, ADR-010): Task 5's storage adapter
 * writes them and hands this repository the resulting storage key, size, and
 * digest.
 */
export interface ArtifactRepository {
  create(input: CreateArtifactInput): Promise<ArtifactMetadata>;
  /** Creates the artifact and its links atomically, so no artifact is left unattached. */
  createWithLinks(
    input: CreateArtifactInput,
    links: readonly ArtifactLinkSpec[],
  ): Promise<{ readonly artifact: ArtifactMetadata; readonly links: readonly ArtifactLink[] }>;
  link(input: CreateArtifactLinkInput): Promise<ArtifactLink>;
  findById(id: ArtifactId): Promise<ArtifactMetadata | null>;
  listByRun(runId: RunId): Promise<readonly ArtifactMetadata[]>;
  listByStep(runStepId: RunStepId): Promise<readonly ArtifactMetadata[]>;
  listLinksForRun(runId: RunId): Promise<readonly ArtifactLink[]>;
  listLinksForStep(runStepId: RunStepId): Promise<readonly ArtifactLink[]>;
  listLinksForEvent(runEventId: EventId): Promise<readonly ArtifactLink[]>;
  listLinksForArtifact(artifactId: ArtifactId): Promise<readonly ArtifactLink[]>;
}

function linkValues(input: CreateArtifactLinkInput): typeof artifactLinks.$inferInsert {
  return {
    id: input.id ?? newArtifactLinkId(),
    artifactId: input.artifactId,
    role: input.role,
    runId: input.targetType === 'run' ? input.targetId : null,
    runStepId: input.targetType === 'run_step' ? input.targetId : null,
    runEventId: input.targetType === 'run_event' ? input.targetId : null,
  };
}

function artifactValues(input: CreateArtifactInput): typeof artifacts.$inferInsert {
  return {
    id: input.id ?? newArtifactId(),
    runId: input.runId,
    runStepId: input.runStepId ?? null,
    kind: input.kind,
    contentType: input.contentType,
    storageKey: input.storageKey,
    sizeBytes: input.sizeBytes,
    sha256: input.sha256,
    redactionVersion: input.redactionVersion ?? null,
    retentionExpiresAt: input.retentionExpiresAt ?? null,
    ...(input.sensitivity === undefined ? {} : { sensitivity: input.sensitivity }),
  };
}

export function createArtifactRepository(executor: Executor): ArtifactRepository {
  async function insertLinks(inputs: readonly CreateArtifactLinkInput[]): Promise<ArtifactLink[]> {
    if (inputs.length === 0) {
      return [];
    }

    const rows = await executor.insert(artifactLinks).values(inputs.map(linkValues)).returning();
    return rows.map(toArtifactLink);
  }

  return {
    async create(input) {
      const [row] = await executor.insert(artifacts).values(artifactValues(input)).returning();
      return toArtifactMetadata(row!);
    },

    async createWithLinks(input, links) {
      const values = artifactValues(input);
      const [row] = await executor.insert(artifacts).values(values).returning();
      const artifact = toArtifactMetadata(row!);

      const created = await insertLinks(
        links.map((link) => ({ ...link, artifactId: artifact.id })),
      );

      return { artifact, links: created };
    },

    async link(input) {
      const [created] = await insertLinks([input]);
      return created!;
    },

    async findById(id) {
      const [row] = await executor.select().from(artifacts).where(eq(artifacts.id, id)).limit(1);
      return row === undefined ? null : toArtifactMetadata(row);
    },

    async listByRun(runId) {
      const rows = await executor
        .select()
        .from(artifacts)
        .where(eq(artifacts.runId, runId))
        .orderBy(asc(artifacts.createdAt), asc(artifacts.id));

      return rows.map(toArtifactMetadata);
    },

    async listByStep(runStepId) {
      const rows = await executor
        .select()
        .from(artifacts)
        .where(eq(artifacts.runStepId, runStepId))
        .orderBy(asc(artifacts.createdAt), asc(artifacts.id));

      return rows.map(toArtifactMetadata);
    },

    async listLinksForRun(runId) {
      const rows = await executor
        .select()
        .from(artifactLinks)
        .where(eq(artifactLinks.runId, runId))
        .orderBy(asc(artifactLinks.createdAt), asc(artifactLinks.id));

      return rows.map(toArtifactLink);
    },

    async listLinksForStep(runStepId) {
      const rows = await executor
        .select()
        .from(artifactLinks)
        .where(eq(artifactLinks.runStepId, runStepId))
        .orderBy(asc(artifactLinks.createdAt), asc(artifactLinks.id));

      return rows.map(toArtifactLink);
    },

    async listLinksForEvent(runEventId) {
      const rows = await executor
        .select()
        .from(artifactLinks)
        .where(eq(artifactLinks.runEventId, runEventId))
        .orderBy(asc(artifactLinks.createdAt), asc(artifactLinks.id));

      return rows.map(toArtifactLink);
    },

    async listLinksForArtifact(artifactId) {
      const rows = await executor
        .select()
        .from(artifactLinks)
        .where(eq(artifactLinks.artifactId, artifactId))
        .orderBy(asc(artifactLinks.createdAt), asc(artifactLinks.id));

      return rows.map(toArtifactLink);
    },
  };
}
