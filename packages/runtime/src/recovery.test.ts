import type { RunTrigger } from '@orbit/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { ExecutionBindingResolver, StepBinding } from './drift';
import { executeAgentVersion } from './interpreter';
import type { DriftObservation, RecoveryProposalOutcome, RecoveryProposer } from './ports';
import { createFakeBrowser, createFakeBrowserFactory, createRecordingStore } from './testing/fakes';
import { loadFixtureAgentIr, SEEDED_AGENT_VERSION_ID } from './testing/fixture';

/**
 * Bounded recovery, from the runtime's side (ADR-033).
 *
 * The property every test here is really defending is one sentence: **recovery
 * never rescues the run that met the drift.** A proposal makes the *next* run
 * possible after a person approves it, and a system that quietly retried with a
 * different element would be doing exactly the thing the drift check exists to
 * prevent — only with a proposal attached to make it look sanctioned.
 */
const TRIGGER: RunTrigger = {
  type: 'watchtower_manual',
  actor: { type: 'development_user', id: 'dev-user' },
  source: { application: 'orbit-browser-worker' },
};

const CLICK_STEP = 'submit_request_search';
const CLICK_TEST_ID = 'search-request-button';

/** The approved element: a button labelled Search. */
const APPROVED = {
  role: 'button',
  accessibleName: 'Search',
  text: 'Search',
  boundingBox: null,
};

/** The fallback the recorder captured beside the test id, as the page still answers it. */
const FALLBACK = { strategy: 'role_and_name' as const, value: 'button', name: 'Search' };

function resolver(bindings: Readonly<Record<string, StepBinding>>): ExecutionBindingResolver {
  return { forStep: (agentStepId) => bindings[agentStepId] ?? null };
}

function clickBinding(): StepBinding {
  return {
    bindingId: 'execbind_click',
    fingerprint: APPROVED,
    mode: 'action',
    selectors: [{ strategy: 'test_id', value: CLICK_TEST_ID }, FALLBACK],
  };
}

function recordingProposer(outcome?: RecoveryProposalOutcome): {
  readonly proposer: RecoveryProposer;
  readonly seen: DriftObservation[];
} {
  const seen: DriftObservation[] = [];

  return {
    seen,
    proposer: {
      async propose(observation) {
        seen.push(observation);
        return (
          outcome ?? {
            proposed: true,
            proposalId: 'recprop_test',
            summary: 'The test id changed; the button did not.',
          }
        );
      },
    },
  };
}

/**
 * Runs the fixture agent with the click step's test id removed from the page —
 * the shape a renamed `data-testid` actually takes.
 */
async function runWithDriftedClick(options: {
  readonly recovery?: RecoveryProposer;
  readonly granted?: boolean;
  readonly fallbackMatches?: boolean;
}) {
  const browser = createFakeBrowser({
    missingTestIds: [CLICK_TEST_ID],
    alsoVisible: [FALLBACK.value],
    describe: {
      [FALLBACK.value]: options.fallbackMatches === false ? { role: 'link' } : APPROVED,
    },
  });

  const base = loadFixtureAgentIr();
  const agentIr = {
    ...base,
    permissions: {
      ...base.permissions,
      ...(options.granted === false ? {} : { recovery: { allowed: true } }),
    },
  };

  const store = createRecordingStore();

  const result = await executeAgentVersion({
    agentVersionId: SEEDED_AGENT_VERSION_ID,
    agentIr,
    inputs: { requestNumber: 'SR-1001' },
    trigger: TRIGGER,
    store,
    executors: { browser: createFakeBrowserFactory(browser) },
    bindings: resolver({ [CLICK_STEP]: clickBinding() }),
    ...(options.recovery === undefined ? {} : { recovery: options.recovery }),
  });

  return { result, store, browser };
}

function eventTypes(store: ReturnType<typeof createRecordingStore>): readonly string[] {
  return store.events.map((event) => event.eventType);
}

describe('bounded recovery from UI drift', () => {
  it('treats an approved locator that finds nothing as drift, not as a raw timeout', async () => {
    // The most ordinary way a page changes: the test id is renamed and the
    // button is untouched. Before ADR-033 this escaped the drift path entirely
    // and surfaced as an executor failure with none of the evidence ADR-018
    // promises.
    const { result } = await runWithDriftedClick({ granted: false });

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('UNEXPECTED_UI_STATE');
    expect(result.error?.message).toContain(CLICK_TEST_ID);
    expect(result.error?.details?.some((detail) => detail.field === 'drift.failure')).toBe(true);
  });

  it('still fails the run when it has proposed a repair', async () => {
    // The line that must not be crossed. A proposal is about the *next* run.
    const { proposer, seen } = recordingProposer();
    const { result, store, browser } = await runWithDriftedClick({ recovery: proposer });

    expect(seen).toHaveLength(1);
    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('UNEXPECTED_UI_STATE');

    // And it did not act. No click reached the page through the fallback, or
    // through anything else.
    expect(browser.calls.some((call) => call.startsWith('click:'))).toBe(false);
    expect(eventTypes(store)).toContain('recovery.proposed');
    expect(eventTypes(store)).toContain('run.failed');
    expect(eventTypes(store)).not.toContain('run.completed');
  });

  it('gives the proposer the binding chain probed against the live page', async () => {
    const { proposer, seen } = recordingProposer();
    await runWithDriftedClick({ recovery: proposer });

    const observation = seen[0]!;
    expect(observation.failure).toBe('unresolved');
    expect(observation.bindingId).toBe('execbind_click');
    expect(observation.expected).toEqual(APPROVED);
    // The failing locator is not re-probed as a candidate for itself.
    expect(observation.candidates).toHaveLength(1);
    expect(observation.candidates[0]?.locator).toEqual(FALLBACK);
    expect(observation.candidates[0]?.resolved).toBe(true);
    expect(observation.candidates[0]?.fingerprint).toMatchObject({ role: 'button' });
  });

  it('does not consult the proposer at all for an agent without the grant', async () => {
    // The trust-tier gate (ADR-013). Not "proposes and hides it" — never looks.
    const propose = vi.fn();
    const { result, store } = await runWithDriftedClick({
      granted: false,
      recovery: { propose },
    });

    expect(propose).not.toHaveBeenCalled();
    expect(result.status).toBe('failed');
    expect(eventTypes(store)).not.toContain('recovery.proposed');
    expect(eventTypes(store)).not.toContain('recovery.declined');
  });

  it('records a declined recovery as carefully as a proposed one', async () => {
    const { proposer } = recordingProposer({
      proposed: false,
      reason: 'ambiguous',
      summary: 'Two elements still match; Orbit will not choose.',
    });
    const { result, store } = await runWithDriftedClick({ recovery: proposer });

    expect(result.status).toBe('failed');

    const declined = store.events.find((event) => event.eventType === 'recovery.declined');
    expect(declined?.payload).toMatchObject({ reason: 'ambiguous' });
  });

  it('lets the drift error survive a proposer that throws', async () => {
    // An evidence failure never replaces the failure being recorded.
    const { result, store } = await runWithDriftedClick({
      recovery: {
        propose: () => Promise.reject(new Error('the proposal store is unreachable')),
      },
    });

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('UNEXPECTED_UI_STATE');

    const declined = store.events.find((event) => event.eventType === 'recovery.declined');
    expect(declined?.payload).toMatchObject({ reason: 'store_failed' });
  });

  it('records only locator names in its events, never page content', async () => {
    const { proposer } = recordingProposer();
    const { store } = await runWithDriftedClick({ recovery: proposer });

    const proposed = store.events.find((event) => event.eventType === 'recovery.proposed');
    const payload = JSON.stringify(proposed?.payload ?? {});

    // The event names which locators were tried and whether each resolved. It
    // carries no fingerprint text and no page content, because a run event is
    // durable and broadly readable and a page is neither.
    expect(payload).toContain('role_and_name=button');
    expect(payload).not.toContain('SR-1001');
  });
});
