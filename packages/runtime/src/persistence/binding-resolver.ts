import type { AgentVersionId } from '@orbit/contracts';
import { createRepositories, type OrbitDatabase } from '@orbit/db';
import { comparisonModeFor } from '@orbit/execution-mapping';

import type { ExecutionBindingResolver, StepBinding } from '../recovery/drift';

/**
 * The approved bindings a run should be checked against.
 *
 * The drift check has existed since sub-phase 2.4 and, until now, nothing in
 * production ever handed it a binding: `executeAgentVersion` takes an optional
 * resolver and every real entry point left it out, so the check was live in
 * tests and inert everywhere else. This is what connects it.
 *
 * The bindings come from the **candidate the version was published from**, not
 * from whatever the document currently says. That distinction is the whole
 * point of ADR-005: a run executes an immutable Agent Version, and the
 * fingerprints it is checked against must be the ones that were compiled into
 * that version — not ones edited afterwards. Reading the document's current
 * bindings would mean a published agent silently changing what it verifies when
 * someone re-records an unrelated step.
 *
 * A version with no candidate — every Phase 1 agent, and anything published
 * from a fixture — resolves to no bindings at all and executes exactly as it
 * did before, which is what makes turning this on a change no existing agent
 * can observe.
 */
export async function createDatabaseExecutionBindingResolver(options: {
  readonly database: OrbitDatabase;
  readonly agentVersionId: AgentVersionId;
}): Promise<ExecutionBindingResolver | undefined> {
  const repositories = createRepositories(options.database);
  const version = await repositories.agentVersions.findById(options.agentVersionId);

  if (version === null || version.publishedFromCandidateId === null) {
    return undefined;
  }

  const candidate = await repositories.agentIrCandidates.findById(version.publishedFromCandidateId);

  if (candidate === null) {
    return undefined;
  }

  const byStep = new Map<string, StepBinding>();

  for (const bindingId of candidate.compiledFromBindingIds) {
    const record = await repositories.executionBindings.findById(bindingId as never);

    if (record === null) {
      continue;
    }

    // Deliberately *not* filtered by `isExecutable`. A binding that has since
    // been superseded is still the one this version was compiled from, and so
    // is still what this version's runs must be checked against — filtering it
    // out would quietly stop verifying a step because somebody re-recorded it
    // for a future version. Compilation already refused anything but an
    // approved binding; that check belongs there, not here.

    // A decision binding carries one element per branch and no single target,
    // and the runtime never drift-checks a decision step, so there is nothing
    // to resolve for one. A call binding names no element at all: there is no
    // page to drift against, which is the same reason an API step has no drift
    // detection to speak of.
    if (record.binding.body.kind === 'decision' || record.binding.body.kind === 'call') {
      continue;
    }

    byStep.set(record.stepId, {
      bindingId: record.id,
      fingerprint: record.binding.body.target.fingerprint,
      mode: comparisonModeFor(record.binding.body.kind),
      selectors: record.binding.body.target.selectors,
    });
  }

  return byStep.size === 0
    ? undefined
    : {
        forStep(agentStepId: string): StepBinding | null {
          // Agent IR step ids are the graph's own step ids — the compiler emits
          // `id: step.id` — so this is a direct lookup rather than a mapping.
          return byStep.get(agentStepId) ?? null;
        },
      };
}
