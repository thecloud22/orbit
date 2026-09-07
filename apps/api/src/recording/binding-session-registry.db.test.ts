import { createRepositories, stepChecksum, type OrbitDatabase } from '@orbit/db';
import { useTestDatabase } from '@orbit/db/testing';
import { escalationReviewGraph } from '@orbit/sop-graph/testing';
import { createSopRevisionService } from '@orbit/sop-service';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createFakeRecordingSessionFactory,
  elementCapture,
  type FakeRecordingSessionFactory,
} from '../testing/fake-recording-session';
import { createBindingSessionRegistry } from './binding-session-registry';

/**
 * Binding a drafted workflow's steps against a real page, with the browser
 * faked.
 *
 * The browser is the one thing substituted: the registry's own behaviour —
 * which steps it will target, what it writes, what it re-reads at save time,
 * and that a browser never outlives its session — is what this proves, and
 * launching Chromium for each case would prove none of it any better.
 */
const GRAPH = escalationReviewGraph();

function scriptedFactory(): FakeRecordingSessionFactory {
  return createFakeRecordingSessionFactory({
    onOpen: (session) => {
      session.push(
        elementCapture({
          type: 'fill',
          order: 1,
          testId: 'request-number-input',
          name: 'Request number',
          typedValue: 'SR-1001',
        }),
      );
    },
  });
}

describe('binding sessions', () => {
  const getDatabase = useTestDatabase();

  let documentId: string;
  let revisionId: string;
  let factory: FakeRecordingSessionFactory;

  function registry(database: OrbitDatabase = getDatabase().db) {
    return createBindingSessionRegistry({ database, factory });
  }

  beforeEach(async () => {
    factory = scriptedFactory();

    const repositories = createRepositories(getDatabase().db);
    const document = await repositories.sopDocuments.create({
      title: 'Escalation review',
      sourceText: 'Sign in and review the escalation.',
    });
    const revision = await repositories.sopGraphRevisions.create({
      documentId: document.id,
      graph: GRAPH,
      // Generated, not recorded: this is exactly the workflow kind that reached
      // the compiler with no bindings at all before ADR-027.
      provenance: { kind: 'generated', model: 'fake', provider: 'test', promptVersion: 'v1' },
    });

    documentId = document.id;
    revisionId = revision.id;
  });

  async function start(stepId = 'enter_request_number') {
    const started = await registry().start({
      documentId: documentId as never,
      stepId,
      startUrl: 'http://localhost:3001/requests',
    });

    if (!started.ok) {
      throw new Error(`the fixture session should start: ${JSON.stringify(started)}`);
    }

    return started.state;
  }

  it('opens a browser aimed at one step and reports what it captured', async () => {
    const state = await start();

    expect(state.sessionId.startsWith('bind_')).toBe(true);
    expect(state.step.stepId).toBe('enter_request_number');
    expect(state.step.mode).toBe('action');
    expect(state.captures).toHaveLength(1);
    expect(state.captures[0]?.description).toContain('Request number');
  });

  it('never reports back what was typed into the field', async () => {
    // The typed value proves the right field was hit and goes no further.
    const state = await start();
    expect(JSON.stringify(state)).not.toContain('SR-1001');
  });

  it('refuses a step no browser can perform', async () => {
    const manual = GRAPH.steps.find((step) => step.kind === 'manual_review');

    const result = await registry().start({
      documentId: documentId as never,
      stepId: manual!.id,
      startUrl: 'http://localhost:3001/requests',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not_bindable');
    expect(factory.opened).toHaveLength(0);
  });

  it('refuses a step kind the compiler does not require a binding for', async () => {
    // A navigate step compiles from the workflow's own URL hint, so offering
    // to bind one would be offering work that changes nothing.
    const result = await registry().start({
      documentId: documentId as never,
      stepId: 'open_portal',
      startUrl: 'http://localhost:3001/requests',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not_bindable');
    expect(factory.opened).toHaveLength(0);
  });

  it('refuses a second sitting on the same workflow', async () => {
    const registered = registry();

    const first = await registered.start({
      documentId: documentId as never,
      stepId: 'enter_request_number',
      startUrl: 'http://localhost:3001/requests',
    });

    const second = await registered.start({
      documentId: documentId as never,
      stepId: 'sign_in',
      startUrl: 'http://localhost:3001/requests',
    });

    expect(second.ok).toBe(false);
    if (second.ok || !first.ok) return;
    expect(second.reason).toBe('session_exists');
    if (second.reason !== 'session_exists') return;
    expect(second.sessionId).toBe(first.state.sessionId);
    expect(factory.opened).toHaveLength(1);

    await registered.closeAll();
  });

  it('switches step without closing the browser, and forgets the old captures', async () => {
    const registered = registry();
    const started = await registered.start({
      documentId: documentId as never,
      stepId: 'enter_request_number',
      startUrl: 'http://localhost:3001/requests',
    });

    if (!started.ok) throw new Error('the fixture session should start');

    const targeted = await registered.target(started.state.sessionId, 'extract_request_details');

    expect(targeted.ok).toBe(true);
    if (!targeted.ok) return;

    expect(targeted.state.step.stepId).toBe('extract_request_details');
    // A read step, so the person points at a value rather than acting.
    expect(targeted.state.step.mode).toBe('pick');
    expect(targeted.state.step.fields.length).toBeGreaterThan(1);
    // Captures from the previous step must not be offered for this one.
    expect(targeted.state.captures).toEqual([]);
    expect(factory.opened[0]?.closed()).toBe(false);

    await registered.closeAll();
  });

  it('saves an approved binding and leaves the browser open', async () => {
    const registered = registry();
    const started = await registered.start({
      documentId: documentId as never,
      stepId: 'enter_request_number',
      startUrl: 'http://localhost:3001/requests',
    });

    if (!started.ok) throw new Error('the fixture session should start');

    const captureId = started.state.captures[0]?.captureId;
    const result = await registered.bind(started.state.sessionId, { captureId: captureId! });

    expect(result.ok).toBe(true);
    if (!result.ok || result.binding === null) return;

    expect(result.binding.state).toBe('approved');
    expect(result.binding.stepId).toBe('enter_request_number');
    expect(result.binding.binding.capturedAgainstRevisionId).toBe(revisionId);
    // The value source came from what the step already declares — the whole
    // point of confirming a drafted step rather than re-authoring it.
    expect(result.binding.binding.body).toMatchObject({
      kind: 'fill',
      valueSource: { kind: 'sop_variable', name: 'requestNumber' },
    });
    // Still open: binding a workflow means binding several steps in sequence.
    expect(factory.opened[0]?.closed()).toBe(false);
    expect(result.state.captures).toEqual([]);

    await registered.closeAll();
  });

  it('records the checksum in force at save time, not at session start', async () => {
    const database = getDatabase().db;
    const registered = registry(database);
    const started = await registered.start({
      documentId: documentId as never,
      stepId: 'enter_request_number',
      startUrl: 'http://localhost:3001/requests',
    });

    if (!started.ok) throw new Error('the fixture session should start');

    // The step is edited while the browser is open. A binding that recorded
    // the checksum from session start would be born stale and not know it.
    const edited = await createSopRevisionService({ database }).editStep({
      revisionId: revisionId as never,
      stepId: 'enter_request_number',
      step: {
        id: 'enter_request_number',
        kind: 'fill',
        fieldHint: 'Service request number',
        value: '${inputs.requestNumber}',
        purpose: 'Provide the request number for advanced search',
      },
    });

    expect(edited.ok).toBe(true);
    if (!edited.ok) return;

    const captureId = started.state.captures[0]?.captureId;
    const result = await registered.bind(started.state.sessionId, { captureId: captureId! });

    expect(result.ok).toBe(true);
    if (!result.ok || result.binding === null) return;

    const current = await createRepositories(database).sopGraphRevisions.findCurrent(
      documentId as never,
    );
    const step = current?.graph.steps.find((entry) => entry.id === 'enter_request_number');

    expect(result.binding.binding.capturedAgainstRevisionId).toBe(current?.id);
    expect(result.binding.binding.stepSha256).toBe(stepChecksum(step!));

    await registered.closeAll();
  });

  it('refuses a capture the session never recorded', async () => {
    const registered = registry();
    const started = await registered.start({
      documentId: documentId as never,
      stepId: 'enter_request_number',
      startUrl: 'http://localhost:3001/requests',
    });

    if (!started.ok) throw new Error('the fixture session should start');

    const result = await registered.bind(started.state.sessionId, {
      captureId: 'nothing-like-this',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unknown_capture');

    await registered.closeAll();
  });

  it('is not found for a session that was never opened', async () => {
    const result = await registry().bind('bind_nothing', { captureId: 'capture-1' });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('not_found');
  });

  it('refuses to guess which value a multi-field extract step reads', async () => {
    const registered = registry();
    const started = await registered.start({
      documentId: documentId as never,
      stepId: 'extract_request_details',
      startUrl: 'http://localhost:3001/requests',
    });

    if (!started.ok) throw new Error('the fixture session should start');

    const captureId = started.state.captures[0]?.captureId;
    const result = await registered.bind(started.state.sessionId, { captureId: captureId! });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('refused');
    if (result.reason !== 'refused') return;
    expect(result.message).toContain('more than one value');

    await registered.closeAll();
  });

  it('binds the value a person chose for a multi-field extract step', async () => {
    const registered = registry();
    const started = await registered.start({
      documentId: documentId as never,
      stepId: 'extract_request_details',
      startUrl: 'http://localhost:3001/requests',
    });

    if (!started.ok) throw new Error('the fixture session should start');

    const captureId = started.state.captures[0]?.captureId;
    const result = await registered.bind(started.state.sessionId, {
      captureId: captureId!,
      variable: 'status',
    });

    expect(result.ok).toBe(true);
    if (!result.ok || result.binding === null) return;
    expect(result.binding.binding.body).toMatchObject({
      kind: 'extract',
      variable: 'status',
      readMethod: { kind: 'text' },
    });

    await registered.closeAll();
  });

  it('closes the browser when a session is discarded', async () => {
    const registered = registry();
    const started = await registered.start({
      documentId: documentId as never,
      stepId: 'enter_request_number',
      startUrl: 'http://localhost:3001/requests',
    });

    if (!started.ok) throw new Error('the fixture session should start');

    expect(await registered.cancel(started.state.sessionId)).toBe(true);
    expect(factory.opened[0]?.closed()).toBe(true);
    expect(registered.get(started.state.sessionId)).toBeNull();
    // Discarding frees the workflow for another sitting.
    expect(await registered.cancel(started.state.sessionId)).toBe(false);
  });

  it('closes a browser nobody has touched, rather than holding it until restart', async () => {
    let clock = new Date('2026-09-07T12:00:00.000Z');

    const registered = createBindingSessionRegistry({
      database: getDatabase().db,
      factory,
      idleTimeoutMs: 1_000,
      sweepIntervalMs: 60_000,
      now: () => clock,
    });

    const started = await registered.start({
      documentId: documentId as never,
      stepId: 'enter_request_number',
      startUrl: 'http://localhost:3001/requests',
    });

    if (!started.ok) throw new Error('the fixture session should start');

    clock = new Date('2026-09-07T12:05:00.000Z');

    // The next start sweeps, which is also what the unreferenced timer does.
    const next = await registered.start({
      documentId: documentId as never,
      stepId: 'sign_in',
      startUrl: 'http://localhost:3001/requests',
    });

    expect(next.ok).toBe(true);
    expect(factory.opened[0]?.closed()).toBe(true);
    expect(registered.get(started.state.sessionId)).toBeNull();

    await registered.closeAll();
  });

  it('closes every browser it holds when the process shuts down', async () => {
    const registered = registry();

    await registered.start({
      documentId: documentId as never,
      stepId: 'enter_request_number',
      startUrl: 'http://localhost:3001/requests',
    });

    await registered.closeAll();

    expect(factory.opened.every((session) => session.closed())).toBe(true);
  });
});
