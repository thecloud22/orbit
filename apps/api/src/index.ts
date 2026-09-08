import { requireDatabaseUrl } from '@orbit/db';
import { noticeDeprecations } from '@orbit/model-provider';
import { createSopProvider } from '@orbit/sop-generation';

import { startApi } from './bootstrap';
import { loadRootEnv, resolveRepositoryArtifactRoot } from './env';
import { resolveModelBudgets, resolveModelRates } from './model-budget-env';
import { resolveApiModelSelection } from './model-provider-env';
import { summariseModelSelection } from './platform';

/**
 * The API process.
 *
 * It is also the run executor in Phase 1: there is no queue and no worker fleet
 * (ADR-011), so a dispatched run launches a browser in this process and
 * continues after the HTTP response has been sent.
 *
 * Which *real* model to use — which family, reached directly or through
 * Bedrock — is resolved once by @orbit/model-provider from configuration this
 * module reads, exactly as the browser worker and the recorder resolve it
 * (ADR-034). What is deliberately
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
 * A *mistyped* or *impossible* configuration is the one exception, and it does
 * stop the process: an unrecognised `LLM_PROVIDER`, or `gemini` combined with
 * `LLM_INVOCATION=bedrock`, which nothing can satisfy because Bedrock does not
 * serve Gemini. Booting past either would mean quietly calling a model the
 * deployment did not choose.
 */

try {
  const modelSelection = resolveApiModelSelection();

  // Superseded variable names still work; they say so once, on the way past.
  noticeDeprecations(modelSelection.deprecations, (message) => {
    process.stderr.write(`${message}\n`);
  });

  await startApi({
    sopProvider: createSopProvider(modelSelection),
    modelBudgets: resolveModelBudgets(),
    modelRates: resolveModelRates(),
    // The three axes an operator reads on the Admin page, with the credential
    // dropped here rather than anywhere downstream: `summariseModelSelection`
    // is the only thing that sees the resolution, and it does not copy the key.
    modelSelection: summariseModelSelection(modelSelection),
    databaseUrl: requireDatabaseUrl('DATABASE_URL'),
    artifactRoot: resolveRepositoryArtifactRoot(),
    port: Number(process.env['API_PORT'] ?? 3002),
    host: process.env['API_HOST'] ?? '127.0.0.1',
  });
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
}
