import type { FastifyInstance } from 'fastify';

import type { ApiContext } from '../context';
import { toPlatformView } from '../projections';
import type { DataEnvelope, PlatformView } from '../views';

/**
 * What this deployment is: read, never written.
 *
 * The Admin page needs facts that are decided before the first request —
 * the model family and invocation in force, the artifact root, the address,
 * the migration level — and none of them has an endpoint. This adds one, and
 * it is a `GET` with no parameters on purpose.
 *
 * There is no companion `POST`, and that is the whole design rather than an
 * unfinished half. `routes/model-usage.ts` records the reasoning for budgets —
 * "a cap a client could lift is not a cap" — and every field here is
 * deployment configuration under the same rule: changing one means restarting
 * the process with a different environment, which is a deliberate act by
 * someone with access to the deployment, not a click by anyone who can reach
 * Watchtower. Orbit has no authentication, so "anyone who can reach
 * Watchtower" is the accurate description of who would be clicking, and the
 * view says so in its `authentication` field.
 *
 * Nothing document-scoped belongs here. The recovery grant is per document
 * (`POST /v1/sop-documents/:documentId/recovery`, ADR-033) and must stay that
 * way: turning it into a platform switch would grant a capability to workflows
 * nobody reviewed.
 */
export function registerPlatformRoutes(app: FastifyInstance, context: ApiContext): void {
  app.get('/v1/platform', async () => {
    const payload: DataEnvelope<PlatformView> = {
      data: toPlatformView(await context.platform.describe()),
    };

    return payload;
  });
}
