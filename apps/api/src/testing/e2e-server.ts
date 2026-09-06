import { databaseNameFromUrl, requireDatabaseUrl } from '@orbit/db';
import type { LLMProvider, SopGraphProposalRequest } from '@orbit/sop-generation';
import {
  createFakeSopProvider,
  failWith,
  invalidSopGraphProposal,
  respondWith,
  validSopGraphProposal,
  type FakeProviderResponse,
} from '@orbit/sop-generation/testing';

import { startApi } from '../bootstrap';

/**
 * The API, started for the end-to-end tests with a deterministic model provider.
 *
 * This is a test-only entry point. It is not `index.ts`, it is not reachable
 * from it, and the shipped entry point has no environment switch that could
 * select it — that was the point of building it this way rather than branching
 * inside the real composition root on a variable a real deployment could set by
 * accident.
 *
 * It calls the same `startApi` the production entry point calls, so an
 * end-to-end run still exercises the real composition, routes, repositories and
 * persistence. Exactly one dependency is substituted: the thing that would
 * otherwise call a model over the network.
 *
 * Three guards keep this contained:
 *
 *   1. The fake is behind `@orbit/sop-generation/testing`, so production code
 *      has no import path to it.
 *   2. A test asserts nothing outside `apps/api/src/testing/` imports that
 *      subpath, transitively included.
 *   3. This process refuses to start against anything but `orbit_test` — see
 *      below. Run by hand against development data, it exits.
 */

const REQUIRED_DATABASE = 'orbit_test';

/**
 * The marker an end-to-end test uses to drive the failure path.
 *
 * The fake needs to produce an invalid graph on demand so the UI's issue list
 * can be exercised, and driving that from the submitted text keeps the decision
 * in the test rather than in a second environment variable here.
 */
const INVALID_DRAFT_MARKER = 'INVALID_DRAFT';
const PROVIDER_FAILURE_MARKER = 'PROVIDER_FAILURE';

function respond(request: SopGraphProposalRequest): FakeProviderResponse {
  if (request.sourceText.includes(PROVIDER_FAILURE_MARKER)) {
    return failWith('The fake provider was asked to simulate a provider failure.');
  }

  // Invalid on both attempts, so the repair loop is exhausted and the route
  // reports validation issues rather than persisting anything.
  return request.sourceText.includes(INVALID_DRAFT_MARKER)
    ? respondWith(invalidSopGraphProposal())
    : respondWith(validSopGraphProposal());
}

function createE2eProvider(): LLMProvider {
  return createFakeSopProvider({
    respond,
    descriptor: { provider: 'fake', model: 'e2e-fake' },
  });
}

const databaseUrl = requireDatabaseUrl('DATABASE_URL');
const databaseName = databaseNameFromUrl(databaseUrl);

if (databaseName !== REQUIRED_DATABASE) {
  process.stderr.write(
    `Refusing to start the end-to-end API against database "${databaseName}". ` +
      `This entry point serves a deterministic fake model provider and must never run against ` +
      `anything but "${REQUIRED_DATABASE}".\n`,
  );
  process.exit(1);
}

const artifactRoot = process.env['ARTIFACT_STORAGE_DIR'];

if (artifactRoot === undefined || artifactRoot.trim() === '') {
  process.stderr.write('ARTIFACT_STORAGE_DIR must be set to a disposable root for the E2E API.\n');
  process.exit(1);
}

try {
  await startApi({
    sopProvider: createE2eProvider(),
    databaseUrl,
    artifactRoot: artifactRoot.trim(),
    port: Number(process.env['API_PORT'] ?? 3102),
    host: process.env['API_HOST'] ?? '127.0.0.1',
    logLevel: process.env['LOG_LEVEL'] ?? 'warn',
  });
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
}
