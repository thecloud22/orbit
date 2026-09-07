import { describe, expect, it } from 'vitest';

import type {
  BindingSessionRegistry,
  BindingSessionState,
} from '../recording/binding-session-registry';
import { buildServer } from '../server';
import { createStubContext } from '../testing/stub-context';

/**
 * The binding-session routes with no browser and no database.
 *
 * What is asserted is the wire contract: that a target is checked before
 * anything could open a browser, that a refused binding says why without
 * closing the session, and that a second sitting on one workflow is refused
 * rather than silently opening a second window.
 */
const SESSION: BindingSessionState = {
  sessionId: 'bind_abc123',
  documentId: 'sopdoc_1',
  startUrl: 'http://localhost:3001/requests',
  currentUrl: 'http://localhost:3001/requests',
  startedAt: '2026-09-07T12:00:00.000Z',
  step: {
    stepId: 'enter_request_number',
    kind: 'fill',
    summary: 'Fill Request Number',
    mode: 'action',
    declaredValue: '${inputs.requestNumber}',
    sensitive: false,
    fields: [],
  },
  captures: [
    {
      captureId: 'capture-1',
      kind: 'fill',
      description: 'Filled "Request number"',
      sensitive: false,
    },
  ],
  failures: [],
};

function server(bindingSessions: Partial<BindingSessionRegistry>) {
  return buildServer({ logLevel: 'silent', context: createStubContext({ bindingSessions }) });
}

describe('POST /v1/binding-sessions', () => {
  it('starts a sitting aimed at one step', async () => {
    const app = server({ start: () => Promise.resolve({ ok: true, state: SESSION }) });
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/binding-sessions',
      payload: {
        documentId: 'sopdoc_1',
        stepId: 'enter_request_number',
        startUrl: 'http://localhost:3001/requests',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data.sessionId).toBe('bind_abc123');
    expect(response.json().data.step.stepId).toBe('enter_request_number');

    await app.close();
  });

  it('binds against a real website, not only a local sandbox', async () => {
    // Same reasoning as recording (ADR-022): a person is driving this browser.
    // Containment belongs to the agent compiled from it.
    const app = server({ start: () => Promise.resolve({ ok: true, state: SESSION }) });
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/binding-sessions',
      payload: {
        documentId: 'sopdoc_1',
        stepId: 'enter_request_number',
        startUrl: 'https://portal.example.com/requests',
      },
    });

    expect(response.statusCode).toBe(201);

    await app.close();
  });

  it('refuses a protocol Orbit will not open, before any browser could exist', async () => {
    // The registry is not stubbed at all: reaching it would throw, so this
    // proves the refusal happens before anything could launch Chromium.
    const app = server({});
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/binding-sessions',
      payload: {
        documentId: 'sopdoc_1',
        stepId: 'enter_request_number',
        startUrl: 'file:///etc/passwd',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('file:');

    await app.close();
  });

  it('rejects a body missing the workflow or the step', async () => {
    const app = server({});
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/binding-sessions',
      payload: { startUrl: 'http://localhost:3001/requests' },
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });

  it('refuses a step a browser cannot perform', async () => {
    const app = server({
      start: () =>
        Promise.resolve({ ok: false, reason: 'not_bindable', stepId: 'escalate_to_person' }),
    });
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/binding-sessions',
      payload: {
        documentId: 'sopdoc_1',
        stepId: 'escalate_to_person',
        startUrl: 'http://localhost:3001/requests',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('escalate_to_person');

    await app.close();
  });

  it('reports the session already open rather than opening a second window', async () => {
    const app = server({
      start: () =>
        Promise.resolve({ ok: false, reason: 'session_exists', sessionId: 'bind_existing' }),
    });
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/binding-sessions',
      payload: {
        documentId: 'sopdoc_1',
        stepId: 'enter_request_number',
        startUrl: 'http://localhost:3001/requests',
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().data.sessionId).toBe('bind_existing');

    await app.close();
  });
});

describe('GET /v1/binding-sessions/:sessionId', () => {
  it('reports what has been captured so far', async () => {
    const app = server({ get: () => SESSION });
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/v1/binding-sessions/bind_abc123' });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.captures).toHaveLength(1);

    await app.close();
  });

  it('is a 404 for a session that is not open', async () => {
    const app = server({ get: () => null });
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/v1/binding-sessions/bind_missing' });

    expect(response.statusCode).toBe(404);

    await app.close();
  });

  it('refuses an id from the other session kind', async () => {
    // Two id spaces exist precisely so a recording session can never be
    // addressed as a binding session.
    const app = server({});
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/v1/binding-sessions/rec_abc123' });

    expect(response.statusCode).toBe(400);

    await app.close();
  });
});

describe('POST /v1/binding-sessions/:sessionId/target', () => {
  it('points the open browser at another step', async () => {
    const app = server({
      target: () =>
        Promise.resolve({
          ok: true,
          state: { ...SESSION, step: { ...SESSION.step, stepId: 'sign_in', kind: 'click' } },
        }),
    });
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/binding-sessions/bind_abc123/target',
      payload: { stepId: 'sign_in' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.step.stepId).toBe('sign_in');

    await app.close();
  });

  it('is a 404 for a step the workflow does not have', async () => {
    const app = server({
      target: () => Promise.resolve({ ok: false, reason: 'unknown_step', stepId: 'nope' }),
    });
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/binding-sessions/bind_abc123/target',
      payload: { stepId: 'nope' },
    });

    expect(response.statusCode).toBe(404);

    await app.close();
  });
});

describe('POST /v1/binding-sessions/:sessionId/binding', () => {
  it('reports what was written, and that the session is still open', async () => {
    const app = server({
      bind: () =>
        Promise.resolve({
          ok: true,
          binding: {
            id: 'bind_row_1',
            stepId: 'enter_request_number',
            state: 'approved',
          } as never,
          state: { ...SESSION, captures: [] },
        }),
    });
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/binding-sessions/bind_abc123/binding',
      payload: { captureId: 'capture-1' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({
      bindingId: 'bind_row_1',
      stepId: 'enter_request_number',
      state: 'approved',
    });
    expect(response.json().data.session.sessionId).toBe('bind_abc123');

    await app.close();
  });

  it('carries the issues when a binding is refused, and says the session survived', async () => {
    const app = server({
      bind: () =>
        Promise.resolve({
          ok: false,
          reason: 'invalid',
          issues: [
            {
              code: 'STALE_BINDING',
              message: 'Step "enter_request_number" has changed.',
              path: ['stepSha256'],
            },
          ],
        }),
    });
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/binding-sessions/bind_abc123/binding',
      payload: { captureId: 'capture-1' },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.message).toContain('still open');
    expect(response.json().error.details[0].message).toContain('STALE_BINDING');

    await app.close();
  });

  it('refuses a capture the session never recorded', async () => {
    const app = server({
      bind: () => Promise.resolve({ ok: false, reason: 'unknown_capture', captureId: 'nope' }),
    });
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/binding-sessions/bind_abc123/binding',
      payload: { captureId: 'nope' },
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });

  it('rejects a body with no capture at all', async () => {
    const app = server({});
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/binding-sessions/bind_abc123/binding',
      payload: {},
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });
});

describe('DELETE /v1/binding-sessions/:sessionId', () => {
  it('closes the browser and reports nothing back', async () => {
    const app = server({ cancel: () => Promise.resolve(true) });
    await app.ready();

    const response = await app.inject({
      method: 'DELETE',
      url: '/v1/binding-sessions/bind_abc123',
    });

    expect(response.statusCode).toBe(204);

    await app.close();
  });

  it('is a 404 for a session that is already gone', async () => {
    const app = server({ cancel: () => Promise.resolve(false) });
    await app.ready();

    const response = await app.inject({
      method: 'DELETE',
      url: '/v1/binding-sessions/bind_gone',
    });

    expect(response.statusCode).toBe(404);

    await app.close();
  });
});
