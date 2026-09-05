import {
  ArtifactIntegrityError,
  ArtifactNotFoundError,
  buildArtifactStorageKey,
  defaultContentTypeForKind,
  parseArtifactStorageKey,
  type ArtifactStorage,
} from '@orbit/artifacts';
import {
  artifactIdSchema,
  artifactKindSchema,
  artifactLinkRoleSchema,
  eventIdSchema,
  newArtifactId,
  runIdSchema,
  runStepIdSchema,
  type ArtifactId,
  type ArtifactKind,
  type ArtifactLink,
  type ArtifactMetadata,
  type RunId,
  type RunStepId,
} from '@orbit/contracts';
import { createRepositories, withTransaction, type OrbitDatabase } from '@orbit/db';
import { z } from 'zod';

/**
 * The composition root for artifact evidence.
 *
 * @orbit/artifacts owns bytes and knows nothing about PostgreSQL; @orbit/db owns
 * metadata and knows nothing about the filesystem. This package is the only
 * place the two meet, which is what keeps either one replaceable.
 *
 * Its whole reason for existing is the ordering below. Getting it wrong in one
 * caller would produce evidence that claims bytes exist when they do not.
 */

/**
 * A link this service will create.
 *
 * Deliberately narrower than @orbit/db's `ArtifactLinkSpec`: it carries no link
 * id. The artifact id has to be generated up front because the storage key is
 * built from it, but a link id has no such constraint, so the repository
 * generates it and callers cannot pre-assign one.
 */
export const recordArtifactLinkSpecSchema = z.discriminatedUnion('targetType', [
  z.strictObject({
    targetType: z.literal('run'),
    targetId: runIdSchema,
    role: artifactLinkRoleSchema,
  }),
  z.strictObject({
    targetType: z.literal('run_step'),
    targetId: runStepIdSchema,
    role: artifactLinkRoleSchema,
  }),
  z.strictObject({
    targetType: z.literal('run_event'),
    targetId: eventIdSchema,
    role: artifactLinkRoleSchema,
  }),
]);

export type RecordArtifactLinkSpec = z.infer<typeof recordArtifactLinkSpecSchema>;

export const recordArtifactRequestSchema = z.strictObject({
  runId: runIdSchema,
  kind: artifactKindSchema,
  bytes: z.instanceof(Uint8Array),
  runStepId: runStepIdSchema.optional(),
  contentType: z.string().min(1).optional(),
  links: z.array(recordArtifactLinkSpecSchema).optional(),
});

export interface RecordArtifactRequest {
  readonly runId: RunId;
  readonly kind: ArtifactKind;
  readonly bytes: Uint8Array;
  readonly runStepId?: RunStepId;
  /** Defaults to the content type declared for the artifact kind. */
  readonly contentType?: string;
  /** Links are explicit: nothing is inferred about why an artifact is evidence. */
  readonly links?: readonly RecordArtifactLinkSpec[];
}

export interface RecordArtifactResult {
  readonly artifact: ArtifactMetadata;
  readonly links: readonly ArtifactLink[];
}

export interface ReadArtifactResult {
  readonly artifact: ArtifactMetadata;
  readonly bytes: Uint8Array;
}

export interface ArtifactService {
  /** Writes bytes, then persists metadata, then persists links — in that order. */
  record(request: RecordArtifactRequest): Promise<RecordArtifactResult>;
  /** Reads bytes back and verifies them against the persisted digest. */
  read(artifactId: ArtifactId): Promise<ReadArtifactResult>;
}

export interface ArtifactServiceDependencies {
  readonly storage: ArtifactStorage;
  readonly database: OrbitDatabase;
}

export function createArtifactService(deps: ArtifactServiceDependencies): ArtifactService {
  const { storage, database } = deps;

  return {
    async record(request: RecordArtifactRequest): Promise<RecordArtifactResult> {
      // 1. Validate before anything touches the disk or the database.
      const validated = recordArtifactRequestSchema.parse(request);

      // 2. The id is generated first because the storage key is built from it,
      //    which is what makes keys unique by construction.
      const artifactId = newArtifactId();
      const contentType = validated.contentType ?? defaultContentTypeForKind(validated.kind);

      const storageKey = buildArtifactStorageKey({
        runId: validated.runId,
        artifactId,
        kind: validated.kind,
        ...(validated.runStepId === undefined ? {} : { runStepId: validated.runStepId }),
      });

      // 3. Write the bytes. A failure here throws, and no database row is ever
      //    created for evidence that does not exist on disk.
      const stored = await storage.put({
        key: storageKey,
        bytes: validated.bytes,
        contentType,
      });

      // 4. Metadata, then links, in one transaction. Separate repository calls
      //    rather than createWithLinks so the ordering is observable at this
      //    seam; the transaction is what makes a link unable to outlive a
      //    missing artifact row.
      return withTransaction(database, async (repositories) => {
        const artifact = await repositories.artifacts.create({
          id: artifactId,
          runId: validated.runId,
          kind: validated.kind,
          contentType: stored.contentType,
          storageKey: stored.key,
          sizeBytes: stored.sizeBytes,
          sha256: stored.sha256,
          ...(validated.runStepId === undefined ? {} : { runStepId: validated.runStepId }),
        });

        const links: ArtifactLink[] = [];

        for (const spec of validated.links ?? []) {
          links.push(await repositories.artifacts.link({ ...spec, artifactId: artifact.id }));
        }

        return { artifact, links };
      });
    },

    async read(artifactId: ArtifactId): Promise<ReadArtifactResult> {
      const id = artifactIdSchema.parse(artifactId);
      const artifact = await createRepositories(database).artifacts.findById(id);

      if (artifact === null) {
        throw new ArtifactNotFoundError(`No artifact metadata exists for id "${id}".`);
      }

      const stored = await storage.get(parseArtifactStorageKey(artifact.storageKey));

      // Verify rather than trust, matching how the agent version repository
      // treats its own checksum. Bytes altered on disk are a corrupted
      // evidence trail, not something to hand back as if it were intact.
      if (stored.sha256 !== artifact.sha256) {
        throw new ArtifactIntegrityError(
          `Artifact ${id} failed integrity verification: stored digest ${artifact.sha256}, computed ${stored.sha256}.`,
        );
      }

      return { artifact, bytes: stored.bytes };
    },
  };
}
