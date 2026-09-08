import { requireDatabaseUrl } from '@orbit/db';
import { createSopProvider } from '@orbit/sop-generation';

import { startApi } from './bootstrap';
import { loadRootEnv, resolveRepositoryArtifactRoot } from './env';
import { resolveModelBudgets, resolveModelRates } from './model-budget-env';
import { resolveSopProviderConfig } from './model-provider-env';

/**
 * The API process.
 *
 * It is also the run executor in Phase 1: there is no queue and no worker fleet
 * (ADR-011), so a dispatched run launches a browser in this process and
 * continues after the HTTP response has been sent.
 *
 * Which *real* model provider to use — Anthropic or Bedrock — is chosen by
 * `createSopProvider` from configuration this module reads. What is deliberately
 * absent is any path to the deterministic fake: that lives behind
 * `@orbit/sop-generation/testing` and is reachable only from
 * `src/testing/e2e-server.ts`, which refuses to run outside `orbit_test`.
 * Choosing between two real providers is configuration; choosing a test double
 * in a real deployment is the hazard, and this entry point cannot do it.
 */
loadRootEnv();

/**
 * A missing key is not a reason to refuse to boot.
 *
 * Every route that does not need a model still works; the one that does fails
 * clearly and says why, instead of an unrelated evidence lookup going down with
 * it. That behaviour lives in `createSopProvider` now and is unchanged — a
 * missing key, or a Bedrock deployment with no region, still fails on the one
 * route that needs a model rather than at boot.
 *
 * A *mistyped provider name* is the one exception, and it does stop the process:
 * see `resolveSopProviderConfig`.
 */

try {
  await startApi({
    sopProvider: createSopProvider(resolveSopProviderConfig()),
    modelBudgets: resolveModelBudgets(),
    modelRates: resolveModelRates(),
    databaseUrl: requireDatabaseUrl('DATABASE_URL'),
    artifactRoot: resolveRepositoryArtifactRoot(),
    port: Number(process.env['API_PORT'] ?? 3002),
    host: process.env['API_HOST'] ?? '127.0.0.1',
  });
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
}
