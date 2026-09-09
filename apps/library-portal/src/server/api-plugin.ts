import type { Connect, Plugin } from 'vite';

import { CATALOG } from '../data/catalog';

/**
 * A small read-only JSON API over the same catalog the pages render.
 *
 * The portal is a Vite app with no server, so this is middleware rather than a
 * service. That is proportionate: its job is to be a *controlled* API for
 * demonstrating the API surface, in the same spirit as the portal itself —
 * a real system Orbit can reach without touching anyone's production.
 *
 * **It answers from `CATALOG`, the module the UI reads.** That is the point of
 * putting it here rather than standing up a separate fake: a workflow can look a
 * book up through the API and then verify the same record on screen, and the two
 * cannot disagree.
 *
 * Read-only by construction. There is no route here that changes anything, so
 * nothing a demo workflow does can leave state behind — which is what makes it
 * safe to run repeatedly and matches the Phase 1 read-only stance.
 */

export const LIBRARY_API_PREFIX = '/api/catalog/';

function send(
  response: Parameters<Connect.NextHandleFunction>[1],
  status: number,
  body: unknown,
): void {
  const text = JSON.stringify(body);
  response.statusCode = status;
  response.setHeader('content-type', 'application/json');
  response.end(text);
}

export function libraryApiPlugin(): Plugin {
  return {
    name: 'orbit-library-api',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = request.url ?? '';

        if (!url.startsWith(LIBRARY_API_PREFIX)) {
          next();
          return;
        }

        // Path parameter, not a query string, so the OpenAPI document has a
        // required path parameter for the binding to map an input onto.
        const isbn = decodeURIComponent(url.slice(LIBRARY_API_PREFIX.length).split('?')[0] ?? '');
        const item = CATALOG.find((candidate) => candidate.isbn === isbn);

        if (item === undefined) {
          // A business fact, reported as one. 404 is the honest status for a
          // record that is not there, and the workflow decides what it means.
          send(response, 404, { error: 'not_found', isbn });
          return;
        }

        send(response, 200, {
          isbn: item.isbn,
          title: item.title,
          author: item.author,
          category: item.category,
          status: item.status,
          dueDate: item.dueDate ?? null,
        });
      });
    },
  };
}
