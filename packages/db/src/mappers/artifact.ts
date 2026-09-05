import {
  artifactLinkSchema,
  artifactMetadataSchema,
  type ArtifactLink,
  type ArtifactMetadata,
} from '@orbit/contracts';

import { DatabaseIntegrityError } from '../errors';
import type { ArtifactLinkRow, ArtifactRow } from '../schema';

export function toArtifactMetadata(row: ArtifactRow): ArtifactMetadata {
  const metadata = {
    id: row.id,
    runId: row.runId,
    ...(row.runStepId === null ? {} : { runStepId: row.runStepId }),
    kind: row.kind,
    contentType: row.contentType,
    storageKey: row.storageKey,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    createdAt: row.createdAt.toISOString(),
  };

  const parsed = artifactMetadataSchema.safeParse(metadata);

  if (!parsed.success) {
    throw new DatabaseIntegrityError(
      `artifacts row ${row.id} does not satisfy the artifact metadata contract: ${JSON.stringify(parsed.error.issues)}`,
    );
  }

  return parsed.data;
}

/**
 * Collapses the three nullable target columns back into the contract's
 * discriminated union. The database check guarantees exactly one is set, so a
 * row that reaches here with none or several is a corrupted link, not a case to
 * paper over.
 */
export function toArtifactLink(row: ArtifactLinkRow): ArtifactLink {
  const target =
    row.runId !== null
      ? { targetType: 'run' as const, targetId: row.runId }
      : row.runStepId !== null
        ? { targetType: 'run_step' as const, targetId: row.runStepId }
        : row.runEventId !== null
          ? { targetType: 'run_event' as const, targetId: row.runEventId }
          : undefined;

  if (target === undefined) {
    throw new DatabaseIntegrityError(
      `artifact_links row ${row.id} has no target; exactly one of run, run step, or run event is required.`,
    );
  }

  const parsed = artifactLinkSchema.safeParse({
    id: row.id,
    artifactId: row.artifactId,
    role: row.role,
    ...target,
  });

  if (!parsed.success) {
    throw new DatabaseIntegrityError(
      `artifact_links row ${row.id} does not satisfy the artifact link contract: ${JSON.stringify(parsed.error.issues)}`,
    );
  }

  return parsed.data;
}
