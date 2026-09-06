import { createRepositories, type OrbitDatabase } from '@orbit/db';
import { useTestDatabase } from '@orbit/db/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createFakeRecordingSessionFactory,
  elementCapture,
  navigation,
  type FakeRecordingSessionFactory,
} from '../testing/fake-recording-session';
import { createRecordingSessionRegistry, type RecordingSessionRegistry } from './session-registry';

/**
 * The session registry, with no browser.
 *
 * Ids, polling, finishing, cancelling and timing out are all behaviour worth
 * pinning down, and launching Chromium for each case would make that slow
 * enough that it would not get pinned down. The real browser path is covered
 * once, end to end, elsewhere.
 */
const START_URL = 'http://localhost:3001/requests';

describe('recording sessions', () => {
  const getDatabase = useTestDatabase();

  let factory: FakeRecordingSessionFactory;
  let registry: RecordingSessionRegistry;
  let clock: Date;

  function build(database: OrbitDatabase, idleTimeoutMs?: number, sweepIntervalMs?: number) {
    factory = createFakeRecordingSessionFactory();
    return createRecordingSessionRegistry({
      database,
      factory,
      now: () => clock,
      ...(idleTimeoutMs === undefined ? {} : { idleTimeoutMs }),
      ...(sweepIntervalMs === undefined ? {} : { sweepIntervalMs }),
    });
  }

  beforeEach(() => {
    clock = new Date('2026-09-06T12:00:00.000Z');
    registry = build(getDatabase().db);
  });

  async function startAndPerform() {
    const state = await registry.start({ title: 'Find a service request', startUrl: START_URL });
    const session = factory.opened[0]!;

    session.push(navigation(START_URL, 1));
    session.push(
      elementCapture({
        type: 'fill',
        order: 2,
        testId: 'request-number-input',
        name: 'Service request number',
        typedValue: 'SR-1001',
      }),
    );
    session.push(
      elementCapture({ type: 'click', order: 3, testId: 'search-request-button', name: 'Search' }),
    );

    return state;
  }

  it('starts a session and reports what has been captured so far', async () => {
    const started = await startAndPerform();

    expect(started.sessionId).toMatch(/^rec_/);
    expect(started.title).toBe('Find a service request');

    const state = registry.get(started.sessionId);

    expect(state?.actions.map((action) => action.kind)).toEqual(['navigate', 'fill', 'click']);
    expect(state?.actions[1]?.description).toBe('Filled "Service request number"');
    expect(state?.actions[2]?.description).toBe('Clicked "Search"');
  });

  it('says when a password was touched and its value not read', async () => {
    const started = await registry.start({ title: 'Sign in', startUrl: START_URL });
    factory.opened[0]!.push(
      elementCapture({
        type: 'fill',
        order: 1,
        testId: 'password',
        name: 'Password',
        sensitive: true,
      }),
    );

    const action = registry.get(started.sessionId)?.actions[0];

    expect(action?.sensitive).toBe(true);
    expect(action?.description).toContain('value not read');
  });

  it('finishing compiles the recording into a document and closes the browser', async () => {
    const started = await startAndPerform();
    const result = await registry.finish(started.sessionId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.stepCount).toBe(4);
    expect(result.bindingCount).toBe(2);
    expect(factory.opened[0]?.closed()).toBe(true);

    const documents = await createRepositories(getDatabase().db).sopDocuments.list();
    expect(documents.map((document) => document.title)).toEqual(['Find a service request']);

    // The session is gone, so it cannot be finished twice into two documents.
    expect(registry.get(started.sessionId)).toBeNull();
  });

  it('refuses to finish a session in which nothing happened', async () => {
    const started = await registry.start({ title: 'Nothing', startUrl: START_URL });
    const result = await registry.finish(started.sessionId);

    expect(result.ok === false && result.reason).toBe('nothing_recorded');

    // Still open: there is nothing to lose, but nothing to gain by closing it
    // out from under someone who has not started yet either.
    expect(registry.get(started.sessionId)).not.toBeNull();
  });

  it('keeps the session open when a recording cannot become a workflow', async () => {
    const started = await registry.start({ title: 'Odd', startUrl: START_URL });
    // A pick alone translates to nothing, so the graph has no steps.
    factory.opened[0]!.push({
      ...elementCapture({ type: 'click', order: 1, testId: 'x', name: 'X' }),
      type: 'pick',
    } as never);

    const result = await registry.finish(started.sessionId);

    expect(result.ok).toBe(false);
    // The browser still holds work the person cannot repeat; closing it would
    // throw that away.
    expect(factory.opened[0]?.closed()).toBe(false);
    expect(registry.get(started.sessionId)).not.toBeNull();
  });

  it('cancelling closes the browser and forgets the session', async () => {
    const started = await startAndPerform();

    expect(await registry.cancel(started.sessionId)).toBe(true);
    expect(factory.opened[0]?.closed()).toBe(true);
    expect(registry.get(started.sessionId)).toBeNull();

    // Nothing was written.
    const documents = await createRepositories(getDatabase().db).sopDocuments.list();
    expect(documents).toEqual([]);
  });

  it('reports an unknown session rather than pretending', async () => {
    expect(registry.get('rec_nope')).toBeNull();
    expect(await registry.cancel('rec_nope')).toBe(false);
    expect((await registry.finish('rec_nope')).ok).toBe(false);
  });

  it('closes a session nobody has touched for too long', async () => {
    registry = build(getDatabase().db, 60_000);

    const abandoned = await registry.start({ title: 'Walked away', startUrl: START_URL });

    // A recording holds a real browser process; someone who leaves should not
    // strand one until the API restarts.
    clock = new Date(clock.getTime() + 120_000);
    await registry.start({ title: 'Someone else', startUrl: START_URL });

    expect(registry.get(abandoned.sessionId)).toBeNull();
    expect(factory.opened[0]?.closed()).toBe(true);
  });

  it('closes an abandoned session without waiting for someone else to record', async () => {
    // The test above sweeps as a side effect of a second `start`. That is the
    // easy half: the person the timeout exists for is the one who walks away
    // and never comes back, and for them no next `start` ever happens. So the
    // sweep has to run on its own.
    registry = build(getDatabase().db, 60_000, 10);

    const abandoned = await registry.start({ title: 'Walked away', startUrl: START_URL });
    clock = new Date(clock.getTime() + 120_000);

    // Observed through the browser, not through `get`: polling counts as
    // activity, so asking the registry whether the session is gone is itself
    // enough to keep it alive. The first draft did that and never reaped.
    await vi.waitFor(() => {
      expect(factory.opened[0]?.closed()).toBe(true);
    });

    expect(registry.get(abandoned.sessionId)).toBeNull();

    await registry.closeAll();
  });

  it('counts polling as activity, so watching a list does not time it out', async () => {
    registry = build(getDatabase().db, 60_000);

    const started = await registry.start({ title: 'Slow but watched', startUrl: START_URL });

    clock = new Date(clock.getTime() + 45_000);
    expect(registry.get(started.sessionId)).not.toBeNull();

    clock = new Date(clock.getTime() + 45_000);
    await registry.start({ title: 'Another', startUrl: START_URL });

    expect(registry.get(started.sessionId)).not.toBeNull();
  });

  it('stops sweeping once the process shuts down', async () => {
    registry = build(getDatabase().db, 60_000, 10);

    await registry.start({ title: 'One', startUrl: START_URL });
    await registry.closeAll();

    // A timer outliving the thing it swept is the leak in miniature.
    await registry.start({ title: 'After shutdown', startUrl: START_URL });
    clock = new Date(clock.getTime() + 120_000);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(factory.opened.at(-1)?.closed()).toBe(false);

    await registry.closeAll();
  });

  it('closes every browser when the process shuts down', async () => {
    await registry.start({ title: 'One', startUrl: START_URL });
    await registry.start({ title: 'Two', startUrl: START_URL });

    await registry.closeAll();

    expect(factory.opened.every((session) => session.closed())).toBe(true);
  });
});
