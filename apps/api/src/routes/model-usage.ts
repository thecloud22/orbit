import { sopDocumentIdSchema } from '@orbit/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { ApiContext } from '../context';
import { badRequest } from '../errors';
import { toModelUsageView } from '../projections';
import type { DataEnvelope, ModelUsageView } from '../views';

/**
 * What has been spent on models, and how much budget is left.
 *
 * Read-only, and derived entirely by summing the ledger. There is no route that
 * writes a usage row or changes a budget: usage is written by the code that
 * made the call, and a ceiling is deployment configuration rather than
 * something the UI can raise for itself. A cap a client could lift is not a cap.
 *
 * `documentId` narrows to the per-agent scope — which is per *document* before
 * publication, because a document is 1:1 with the agent it will become
 * (ADR-029).
 */
const querySchema = z.strictObject({ documentId: sopDocumentIdSchema.optional() });

export function registerModelUsageRoutes(app: FastifyInstance, context: ApiContext): void {
  app.get('/v1/model-usage', async (request) => {
    const query = querySchema.safeParse(request.query ?? {});

    if (!query.success) {
      throw badRequest('documentId must be an opaque SOP document id.');
    }

    const documentId = query.data.documentId;

    const global = await context.repositories.modelUsage.totals();
    const document =
      documentId === undefined
        ? null
        : await context.repositories.modelUsage.totalsForDocument(documentId);

    const payload: DataEnvelope<ModelUsageView> = {
      data: toModelUsageView({
        budgets: context.modelBudgets,
        global,
        document,
        documentId: documentId ?? null,
      }),
    };

    return payload;
  });
}
