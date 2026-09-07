import { requireDatabaseUrl } from '@orbit/db';
import {
  createAnthropicSopProvider,
  createUnconfiguredSopProvider,
  type LLMProvider,
} from '@orbit/sop-generation';

import { startApi } from './bootstrap';
import { loadRootEnv, resolveRepositoryArtifactRoot } from './env';
import { resolveModelBudgets, resolveModelRates } from './model-budget-env';

/**
 * The API process.
 *
 * It is also the run executor in Phase 1: there is no queue and no worker fleet
 * (ADR-011), so a dispatched run launches a browser in this process and
 * continues after the HTTP response has been sent.
 *
 * There is deliberately no switch here for which model provider to use. This
 * module constructs the real one, and has no import path to the deterministic
 * fake — that lives behind `@orbit/sop-generation/testing` and is reachable only
 * from `src/testing/e2e-server.ts`, which refuses to run outside `orbit_test`.
 */
loadRootEnv();

/**
 * A missing key is not a reason to refuse to boot.
 *
 * Every route that does not need a model still works; the one that does fails
 * clearly and says why, instead of an unrelated evidence lookup going down with
 * it.
 */
function resolveSopProvider(): LLMProvider {
  const apiKey = process.env['ANTHROPIC_API_KEY'];

  if (apiKey === undefined || apiKey.trim() === '') {
    return createUnconfiguredSopProvider(
      'ANTHROPIC_API_KEY is not set, so SOP generation is unavailable. See README > SOP drafting.',
    );
  }

  const model = process.env['ORBIT_LLM_MODEL'];

  return createAnthropicSopProvider({
    apiKey,
    ...(model === undefined || model.trim() === '' ? {} : { model: model.trim() }),
  });
}

try {
  await startApi({
    sopProvider: resolveSopProvider(),
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
