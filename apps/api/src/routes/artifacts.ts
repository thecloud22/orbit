import { ArtifactIntegrityError, ArtifactNotFoundError, extensionForKind } from '@orbit/artifacts';
import { artifactIdSchema } from '@orbit/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import { loadArtifactForRun } from '../views/artifact-access';
import type { ApiContext } from '../app/context';
import { artifactStorageError, badRequest } from '../errors';
import { parseRunId } from './runs';

/**
 * Controlled evidence retrieval.
 *
 * `data/artifacts` is never statically served. Bytes leave Orbit only through
 * this route, which addresses evidence by two opaque ids, proves the artifact
 * belongs to the run, reads through the Task 5 service using the *persisted*
 * storage key, and verifies the digest before a single byte is sent.
 */

/**
 * Only an image is ever rendered inline.
 *
 * A stored DOM snapshot is a captured copy of a third-party page. Serving it
 * inline would execute that page's markup and scripts on the API's own origin,
 * so every non-image artifact is an attachment, is marked `nosniff`, and carries
 * a CSP that permits nothing.
 */
const INLINE_CONTENT_TYPES = new Set(['image/png']);

export function registerArtifactRoutes(app: FastifyInstance, context: ApiContext): void {
  app.get('/v1/runs/:runId/artifacts/:artifactId', async (request, reply) => {
    const runId = parseRunId(request.params);
    const artifactId = parseArtifactId(request.params);

    const { artifact } = await loadArtifactForRun(context, runId, artifactId);

    let bytes: Uint8Array;
    try {
      // Reads by the persisted storage key, never by anything from the request,
      // and recomputes the digest — a mismatch raises instead of being served.
      ({ bytes } = await context.artifactService.read(artifactId));
    } catch (error) {
      if (error instanceof ArtifactIntegrityError) {
        throw artifactStorageError(
          'The stored evidence failed integrity verification and was not served.',
          error,
        );
      }

      if (error instanceof ArtifactNotFoundError) {
        // Metadata exists but the bytes do not. Reported as a storage failure,
        // not a 404: the evidence trail is broken and that must be visible.
        throw artifactStorageError('The stored evidence could not be read.', error);
      }

      throw error;
    }

    if (bytes.byteLength !== artifact.sizeBytes) {
      throw artifactStorageError('The stored evidence does not match its recorded size.');
    }

    return sendArtifact(reply, {
      bytes,
      contentType: artifact.contentType,
      filename: `${artifact.id}.${extensionForKind(artifact.kind)}`,
      sha256: artifact.sha256,
    });
  });
}

function sendArtifact(
  reply: FastifyReply,
  artifact: {
    readonly bytes: Uint8Array;
    readonly contentType: string;
    readonly filename: string;
    readonly sha256: string;
  },
): FastifyReply {
  const inline = INLINE_CONTENT_TYPES.has(artifact.contentType);

  return (
    reply
      .header('content-type', artifact.contentType)
      .header('content-length', artifact.bytes.byteLength)
      .header(
        'content-disposition',
        `${inline ? 'inline' : 'attachment'}; filename="${artifact.filename}"`,
      )
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; sandbox")
      // The digest the caller can check the bytes against, matching what the
      // database records.
      .header('x-orbit-sha256', artifact.sha256)
      .header('cache-control', 'private, no-store')
      .send(Buffer.from(artifact.bytes))
  );
}

function parseArtifactId(params: unknown) {
  const parsed = z.object({ artifactId: artifactIdSchema }).safeParse(params);

  if (!parsed.success) {
    // Malformed ids never reach storage, and the message names no path.
    throw badRequest('The artifact id is not a valid Orbit identifier.');
  }

  return parsed.data.artifactId;
}
