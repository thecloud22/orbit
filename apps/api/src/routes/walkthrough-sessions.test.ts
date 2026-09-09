import { describe, expect, it } from 'vitest';

import type {
  WalkthroughSessionRegistry,
  WalkthroughSessionState,
} from '../recording/walkthrough-session-registry';
import { buildServer } from '../app/server';
import { createStubContext } from '../testing/stub-context';

/**
 * The walkthrough routes with no browser and no database (ADR-035).
 *
 * What is asserted here is the wire contract: that a target is checked before
 * anything could open a browser, that a workflow with nothing left to bind is
 * refused rather than given a window, that a closed browser reads as gone
 * rather than as a server error, and — the one that matters most — that
 * finishing a walkthrough returns *proposals*, never a binding.
 */
const OPEN: WalkthroughSessionState = {
  sessionId: 'walk_abc123',
  documentId: 'sopdoc_1',
  startUrl: 'http://localhost:3020/catalog',
  currentUrl: 'http://localhost:3020/catalog',
  startedAt: '2026-09-07T12:00:00.000Z',
  mode: 'action',
  browserOpen: true,
  awaitingBinding: 9,
  captures: [
    {
      order: 1,
      kind: 'navigate',
      description: 'Opened http://localhost:3020/catalog',
      sensitive: false,
    },
    { order: 2, kind: 'fill', description: 'Filled "Search the catalog"', sensitive: false },
  ],
  failures: [],
  outcome: null,
};

const REVIEWED: WalkthroughSessionState = {
  ...OPEN,
  browserOpen: false,
  outcome: {
    proposed: 1,
    unusedCaptures: 0,
    steps: [
      {
        stepId: 'enter_isbn',
        stepKind: 'fill',
        summary: 'Fill Search the catalog',
        proposalId: 'prop_1',
        state: 'proposed',
        demonstrated: 'Filled "Search the catalog"',
        refusal: null,
        message: null,
      },
      {
        stepId: 'check_availability',
        stepKind: 'decision',
        summary: 'Decide whether the title is available',
        proposalId: null,
        state: null,
        demonstrated: null,
        refusal: 'decision_needs_each_branch',
        message: 'A decision has more than one outcome and a walkthrough follows one path.',
      },
    ],
  },
};

function server(walkthroughSessions: Partial<WalkthroughSessionRegistry>) {
  return buildServer({ logLevel: 'silent', context: createStubContext({ walkthroughSessions }) });
}

describe('POST /v1/walkthrough-sessions', () => {
  it('opens one browser for the whole workflow', async () => {
    const app = server({ start: () => Promise.resolve({ ok: true, state: OPEN }) });
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/walkthrough-sessions',
      payload: { documentId: 'sopdoc_1', startUrl: 'http://localhost:3020/catalog' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data.sessionId).toBe('walk_abc123');
    expect(response.json().data.awaitingBinding).toBe(9);
    expect(response.json().data.outcome).toBeNull();

    await app.close();
  });

  it('refuses a target the browser must never be pointed at', async () => {
    let opened = false;
    const app = server({
      start: () => {
        opened = true;
        return Promise.resolve({ ok: true, state: OPEN });
      },
    });
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/walkthrough-sessions',
      payload: { documentId: 'sopdoc_1', startUrl: 'file:///etc/passwd' },
    });

    expect(response.statusCode).toBe(400);
    // Checked before the registry was reached, not after.
    expect(opened).toBe(false);

    await app.close();
  });

  it('refuses a workflow with nothing left to bind', async () => {
    const app = server({ start: () => Promise.resolve({ ok: false, reason: 'nothing_to_bind' }) });
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/walkthrough-sessions',
      payload: { documentId: 'sopdoc_1', startUrl: 'http://localhost:3020/catalog' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('already has one');

    await app.close();
  });

  it('reports an existing walkthrough as a conflict rather than opening a second window', async () => {
    const app = server({
      start: () =>
        Promise.resolve({ ok: false, reason: 'session_exists', sessionId: 'walk_existing' }),
    });
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/walkthrough-sessions',
      payload: { documentId: 'sopdoc_1', startUrl: 'http://localhost:3020/catalog' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('SESSION_ALREADY_OPEN');
    expect(response.json().error.details).toContainEqual({
      field: 'sessionId',
      message: 'walk_existing',
    });

    await app.close();
  });
});

describe('POST /v1/walkthrough-sessions/:sessionId/mode', () => {
  it('switches to pointing at a value to be read', async () => {
    const app = server({
      setMode: (_id, mode) => Promise.resolve({ ok: true, state: { ...OPEN, mode } }),
    });
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/walkthrough-sessions/walk_abc123/mode',
      payload: { mode: 'pick' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.mode).toBe('pick');

    await app.close();
  });

  it('reports a closed browser as gone, not as a server error', async () => {
    const app = server({ setMode: () => Promise.resolve({ ok: false, reason: 'browser_closed' }) });
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/walkthrough-sessions/walk_abc123/mode',
      payload: { mode: 'pick' },
    });

    expect(response.statusCode).toBe(410);

    await app.close();
  });

  it('rejects a mode nobody can capture in', async () => {
    const app = server({});
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/walkthrough-sessions/walk_abc123/mode',
      payload: { mode: 'whatever' },
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });
});

describe('POST /v1/walkthrough-sessions/:sessionId/proposals', () => {
  it('returns proposals and the steps that got nothing, with the reason', async () => {
    const app = server({ propose: () => Promise.resolve({ ok: true, state: REVIEWED }) });
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/walkthrough-sessions/walk_abc123/proposals',
    });

    expect(response.statusCode).toBe(201);

    const outcome = response.json().data.outcome;

    expect(outcome.proposed).toBe(1);
    expect(outcome.steps[0]).toMatchObject({ proposalId: 'prop_1', state: 'proposed' });
    // The refused step carries its reason, because that is the half of the
    // result a person has to act on.
    expect(outcome.steps[1]).toMatchObject({
      proposalId: null,
      refusal: 'decision_needs_each_branch',
    });
    // Nothing about a binding: this route cannot create one.
    expect(response.json().data).not.toHaveProperty('bindingId');

    await app.close();
  });

  it('says so when the walkthrough demonstrated nothing', async () => {
    const app = server({
      propose: () => Promise.resolve({ ok: false, reason: 'nothing_demonstrated' }),
    });
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/walkthrough-sessions/walk_abc123/proposals',
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.message).toContain('only pages were opened');

    await app.close();
  });

  it('rejects an id that belongs to a different kind of session', async () => {
    let reached = false;
    const app = server({
      propose: () => {
        reached = true;
        return Promise.resolve({ ok: true, state: REVIEWED });
      },
    });
    await app.ready();

    // A binding session's id, which must never resolve here.
    const response = await app.inject({
      method: 'POST',
      url: '/v1/walkthrough-sessions/bind_abc123/proposals',
    });

    expect(response.statusCode).toBe(400);
    expect(reached).toBe(false);

    await app.close();
  });
});

describe('GET and DELETE /v1/walkthrough-sessions/:sessionId', () => {
  it('reads a walkthrough that is open', async () => {
    const app = server({ get: () => Promise.resolve(OPEN) });
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/v1/walkthrough-sessions/walk_abc123',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.captures).toHaveLength(2);

    await app.close();
  });

  it('reports a walkthrough that is not open as missing', async () => {
    const app = server({ get: () => Promise.resolve(null) });
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/v1/walkthrough-sessions/walk_abc123',
    });

    expect(response.statusCode).toBe(404);

    await app.close();
  });

  it('cancels one, closing its browser', async () => {
    const app = server({ cancel: () => Promise.resolve(true) });
    await app.ready();

    const response = await app.inject({
      method: 'DELETE',
      url: '/v1/walkthrough-sessions/walk_abc123',
    });

    expect(response.statusCode).toBe(204);

    await app.close();
  });
});
