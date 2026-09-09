import { sopDocumentIdSchema } from '@orbit/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { ApiContext } from '../app/context';
import { badRequest, notFound } from '../errors';
import { toSopBindingsView } from '../views/projections';
import type { DataEnvelope, SopBindingsView } from '../views/views';

/**
 * Execution Binding visibility, read-only.
 *
 * Sub-phase 2.4b's own report flagged the gap this closes: bindings are
 * confirmed in a terminal, so a person reviewing a SOP Graph in Watchtower
 * could not see whether its steps had been mapped at all.
 *
 * There is deliberately no write path here, and that is a property of the file
 * rather than a promise about it — the only repository methods it names are
 * reads. Creating a binding, confirming it, and moving it through its lifecycle
 * happen in the recorder CLI and nowhere else (ADR-019), because those require a
 * human demonstrating a step against a real page, which a web page cannot
 * witness.
 */

/** Every input and variable the graph declares, for validating a binding. */
function declaredNames(graph: Parameters<typeof toSopBindingsView>[0]['graph']): readonly string[] {
  const names = new Set<string>();

  for (const input of graph.inputs) {
    names.add(input.id);
  }

  for (const step of graph.steps) {
    if (step.kind === 'extract') {
      for (const field of step.fields) {
        names.add(field.name);
      }
    }
    if (step.kind === 'decision') {
      for (const produced of step.produces ?? []) {
        names.add(produced.name);
      }
    }
  }

  return [...names].sort();
}

export function registerSopBindingRoutes(app: FastifyInstance, context: ApiContext): void {
  app.get<{ Params: { documentId: string } }>(
    '/v1/sop-documents/:documentId/bindings',
    async (request) => {
      const parsed = z.object({ documentId: sopDocumentIdSchema }).safeParse(request.params);

      if (!parsed.success) {
        throw badRequest('The document id is not a valid Orbit identifier.');
      }

      const { documentId } = parsed.data;
      const revision = await context.repositories.sopGraphRevisions.findCurrent(documentId);

      if (revision === null) {
        throw notFound(`SOP document "${documentId}" does not exist.`);
      }

      // Two reads, both already built in 4a. `listCurrent` gives each step's
      // live binding; `listByDocument` is what makes superseded predecessors
      // countable, since a superseded binding is never the current one.
      const [current, all] = await Promise.all([
        context.repositories.executionBindings.listCurrent(documentId),
        context.repositories.executionBindings.listByDocument(documentId),
      ]);

      const payload: DataEnvelope<SopBindingsView> = {
        data: toSopBindingsView({
          documentId,
          revisionId: revision.id,
          graph: revision.graph,
          current,
          all,
          declaredNames: declaredNames(revision.graph),
        }),
      };

      return payload;
    },
  );
}
