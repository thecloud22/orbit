import { describe, expect, it } from 'vitest';

import type {
  RecordingSessionRegistry,
  RecordingSessionState,
} from '../recording/session-registry';
import { buildServer } from '../app/server';
import { createStubContext } from '../testing/stub-context';

/**
 * The recording routes with no browser and no database.
 *
 * What is asserted is the wire contract: that a recording can only ever be
 * pointed at a local sandbox, that finishing reports what it made, and that a
 * failure to compile does not silently discard work the person cannot repeat.
 */
const SESSION: RecordingSessionState = {
  sessionId: 'rec_abc123',
  title: 'Find a service request',
  startUrl: 'http://localhost:3001/requests',
  currentUrl: 'http://localhost:3001/requests',
  startedAt: '2026-09-06T12:00:00.000Z',
  actions: [
    {
      order: 1,
      kind: 'navigate',
      description: 'Opened http://localhost:3001/requests',
      sensitive: false,
    },
    { order: 2, kind: 'click', description: 'Clicked "Search"', sensitive: false },
  ],
};

function server(recordingSessions: Partial<RecordingSessionRegistry>) {
  return buildServer({ logLevel: 'silent', context: createStubContext({ recordingSessions }) });
}

describe('POST /v1/recording-sessions', () => {
  it('starts a session against a local sandbox', async () => {
    const app = server({ start: () => Promise.resolve(SESSION) });
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/recording-sessions',
      payload: { title: 'Find a service request', startUrl: 'http://localhost:3001/requests' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data.sessionId).toBe('rec_abc123');

    await app.close();
  });

  it('records against a real website, not only a local sandbox', async () => {
    // A recording is a person doing their job in a browser they are driving.
    // Containment belongs to the agent compiled from it, which declares the
    // domains it may open; a blanket list here only limited what Orbit is for.
    const app = server({ start: () => Promise.resolve(SESSION) });
    await app.ready();

    for (const startUrl of [
      'http://localhost:3001/requests',
      'https://www.plano.gov/1391/Service-Requests',
      'http://127.0.0.1:8080/',
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/recording-sessions',
        payload: { title: 'Somewhere real', startUrl },
      });

      expect(response.statusCode, `${startUrl} should be permitted`).toBe(201);
    }

    await app.close();
  });

  it('still refuses a protocol that is not a navigation', async () => {
    // Lifting the host restriction does not make `file:`, `data:` or
    // `javascript:` into places a browser goes on somebody's behalf.
    const app = server({
      start: () => {
        throw new Error('A browser must not be opened for a rejected URL.');
      },
    });

    for (const startUrl of [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'data:text/html,<h1>hi</h1>',
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/recording-sessions',
        payload: { title: 'Not a page', startUrl },
      });

      expect(response.statusCode, `${startUrl} must be refused`).toBe(400);
    }

    await app.close();
  });

  it('refuses a protocol Orbit will not open', async () => {
    const app = server({});

    for (const startUrl of ['file:///etc/passwd', 'javascript:alert(1)', 'not a url']) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/recording-sessions',
        payload: { title: 'Nope', startUrl },
      });

      expect(response.statusCode).toBe(400);
    }

    await app.close();
  });

  it('requires a title', async () => {
    const app = server({});

    const response = await app.inject({
      method: 'POST',
      url: '/v1/recording-sessions',
      payload: { startUrl: 'http://localhost:3001/requests' },
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });
});

describe('GET /v1/recording-sessions/:sessionId', () => {
  it('reports what has been captured so far', async () => {
    const app = server({ get: () => SESSION });

    const response = await app.inject({ method: 'GET', url: '/v1/recording-sessions/rec_abc123' });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.actions).toHaveLength(2);

    await app.close();
  });

  it('404s for a session that is not open', async () => {
    const app = server({ get: () => null });
    const response = await app.inject({ method: 'GET', url: '/v1/recording-sessions/rec_gone' });

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('rejects something that is not a session id', async () => {
    const app = server({});
    const response = await app.inject({ method: 'GET', url: '/v1/recording-sessions/nonsense' });

    expect(response.statusCode).toBe(400);
    await app.close();
  });
});

describe('POST /v1/recording-sessions/:sessionId/finish', () => {
  it('returns the document it created', async () => {
    const app = server({
      finish: () =>
        Promise.resolve({ ok: true, documentId: 'sopdoc_1', stepCount: 4, bindingCount: 2 }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/recording-sessions/rec_abc123/finish',
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toEqual({
      documentId: 'sopdoc_1',
      stepCount: 4,
      bindingCount: 2,
    });

    await app.close();
  });

  it('says plainly when nothing was recorded', async () => {
    const app = server({
      finish: () => Promise.resolve({ ok: false, reason: 'nothing_recorded' }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/recording-sessions/rec_abc123/finish',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('Nothing was recorded');

    await app.close();
  });

  it('tells the person their work is still there when compilation fails', async () => {
    const app = server({
      finish: () =>
        Promise.resolve({
          ok: false,
          reason: 'invalid_recording',
          issues: [{ code: 'SCHEMA_ERROR', message: 'Something was wrong.', path: ['steps'] }],
        }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/recording-sessions/rec_abc123/finish',
    });

    expect(response.statusCode).toBe(422);
    // A person cannot repeat a recording from memory, so the one thing this
    // must not imply is that it is gone.
    expect(response.json().error.message).toContain('still open');
    expect(response.json().error.details[0].message).toContain('SCHEMA_ERROR');

    await app.close();
  });

  it('404s for a session that is not open', async () => {
    const app = server({ finish: () => Promise.resolve({ ok: false, reason: 'not_found' }) });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/recording-sessions/rec_gone/finish',
    });

    expect(response.statusCode).toBe(404);
    await app.close();
  });
});

describe('DELETE /v1/recording-sessions/:sessionId', () => {
  it('cancels an open session', async () => {
    const app = server({ cancel: () => Promise.resolve(true) });

    const response = await app.inject({
      method: 'DELETE',
      url: '/v1/recording-sessions/rec_abc123',
    });

    expect(response.statusCode).toBe(204);
    await app.close();
  });

  it('404s for a session that is not open', async () => {
    const app = server({ cancel: () => Promise.resolve(false) });

    const response = await app.inject({ method: 'DELETE', url: '/v1/recording-sessions/rec_gone' });

    expect(response.statusCode).toBe(404);
    await app.close();
  });
});
