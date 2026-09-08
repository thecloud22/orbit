import { borrowOrHoldBindings, borrowOrHoldGraph } from '@orbit/agent-ir-compiler/testing';
import { createDatabase, requireDatabaseUrl, withTransaction } from '@orbit/db';

import { loadRootEnv } from '../env';

/**
 * `pnpm db:seed:library` — puts the branching demo where a person can see it.
 *
 * The borrow-or-hold workflow exists as a fixture and a real-browser test
 * (ADR-029, `docs/demo/branching-library-demo.md`), which proves it runs but
 * shows nobody anything: nothing appears in Watchtower unless a row exists in
 * the database somebody is looking at. This seeds the workflow and its
 * bindings — the decision's two branches included — into the development
 * database, so the demo can be opened, published and run from the browser.
 *
 * Development tooling, deliberately: it lives under `src/testing/` beside
 * `e2e-server.ts` rather than in a production path, and it is the only reason
 * this app reaches a `/testing` subpath at all. Nothing in the running API
 * imports it.
 *
 * Idempotent by title: running it twice reports the workflow already present
 * rather than seeding a second copy.
 */

const DEMO_TITLE = 'Borrow a title, or place a hold';

/**
 * `--unbound`: seed the workflow with no Execution Bindings at all.
 *
 * The default seeds the bindings too, which is right for the branching and
 * drift demos — both need a workflow that already runs. It is exactly wrong for
 * demonstrating a walkthrough (ADR-035), whose whole subject is a drafted
 * workflow with nine unbound steps: with bindings present there is nothing to
 * propose and the walkthrough is refused before a browser opens.
 *
 * A flag rather than a second seed script, because the workflow is the same
 * workflow. The title is suffixed so both can exist side by side and neither
 * idempotence check trips on the other.
 */
const unbound = process.argv.includes('--unbound');
const title = unbound ? `${DEMO_TITLE} (unbound)` : DEMO_TITLE;

loadRootEnv();

const url = requireDatabaseUrl('DATABASE_URL');
const handle = createDatabase({ url, maxConnections: 1 });

try {
  const graph = borrowOrHoldGraph();

  const result = await withTransaction(handle.db, async (repositories) => {
    const existing = await repositories.sopDocuments.list();
    const already = existing.find((document) => document.title === title);

    if (already !== undefined) {
      return { created: false as const, documentId: already.id };
    }

    const document = await repositories.sopDocuments.create({
      // Granted here so the drift demo works out of the box (ADR-033). It is
      // off by default for every other document, and it grants one thing: that
      // Orbit may *propose* a repair. Nothing applies one.
      recoveryEnabled: true,
      title,
      sourceText:
        'Open the library catalog and search for a title by ISBN. If the title is available, ' +
        'borrow it with a member ID. If it is on loan, place a hold instead.',
    });

    const revision = await repositories.sopGraphRevisions.create({
      documentId: document.id,
      graph,
      // Authored, not recorded: this graph came from a fixture rather than from
      // anyone demonstrating it. That is also what routes it through the
      // fully-bound publish path (ADR-027) rather than the recorded one, which
      // is the path worth demonstrating here — every branch has to be bound
      // before the button appears.
      provenance: { kind: 'authored' },
    });

    // The bindings are captured against whichever revision they are stored
    // with, so the fixture's placeholder revision id is replaced by the real
    // one. A binding pointing at a revision that does not exist would read as
    // stale the moment the page loaded.
    for (const binding of unbound ? [] : borrowOrHoldBindings()) {
      const created = await repositories.executionBindings.create({
        documentId: document.id,
        binding: { ...binding, capturedAgainstRevisionId: revision.id },
      });

      // Through the lifecycle, never around it — the repository refuses
      // draft -> approved, and writing a state the application cannot
      // otherwise produce would make the state machine advisory.
      await repositories.executionBindings.submitForReview(created.id);
      await repositories.executionBindings.approve(created.id, {
        reviewNote: 'Seeded demonstration binding (pnpm db:seed:library).',
      });
    }

    return { created: true as const, documentId: document.id };
  });

  process.stdout.write(
    `${result.created ? 'Seeded' : 'Already present'}: "${title}" (${result.documentId}).\n` +
      `Open it at http://localhost:3000/?documentId=${result.documentId}\n` +
      `Start the library portal with: pnpm --filter @orbit/library-portal dev\n` +
      (unbound
        ? `No bindings were seeded. Bind all nine steps in one sitting — ` +
          `see docs/demo/walkthrough-binding-demo.md\n`
        : `Drift demo: publish, then run against http://localhost:3020/catalog?drift=1 — ` +
          `see docs/demo/drift-recovery-demo.md\n`),
  );
} finally {
  await handle.close();
}
