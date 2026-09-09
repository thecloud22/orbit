import type {
  ApproveCandidateResult,
  CompileDocumentResult,
  RejectCandidateResult,
} from '@orbit/sop-service';
import { describe, expect, it } from 'vitest';

import { buildServer } from '../server';
import { agentIrCandidateRecord } from '../testing/fixtures';
import { createStubContext } from '../testing/stub-context';

/**
 * Compiling and approving with no database.
 *
 * These are the two routes 2.5 never got: without them the Publish action on
 * the review page is reachable only for a candidate created by hand outside
 * Watchtower. What is asserted is the wire contract — the reasons a workflow
 * cannot yet be compiled or approved come back as readable messages, and
 * neither route can be mistaken for one that changes the SOP document.
 */
const DOCUMENT_ID = 'sopdoc_01hzz0000000000000000000';
const CANDIDATE_ID = 'aircand_01hzz0000000000000000000';

function compileServer(compileDocument: (input: unknown) => Promise<CompileDocumentResult>) {
  return buildServer({
    context: createStubContext({
      sopCandidateService: { compileDocument: compileDocument as never },
    }),
    logLevel: 'silent',
  });
}

function approveServer(approve: (id: string, note?: string) => Promise<ApproveCandidateResult>) {
  return buildServer({
    context: createStubContext({ sopCandidateService: { approve: approve as never } }),
    logLevel: 'silent',
  });
}

function rejectServer(reject: (id: string, note?: string) => Promise<RejectCandidateResult>) {
  return buildServer({
    context: createStubContext({ sopCandidateService: { reject: reject as never } }),
    logLevel: 'silent',
  });
}

describe('POST /v1/sop-documents/:documentId/candidates', () => {
  it('compiles and describes the candidate it made', async () => {
    const candidate = agentIrCandidateRecord();
    const app = compileServer(() => Promise.resolve({ ok: true, candidate }));
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sop-documents/${DOCUMENT_ID}/candidates`,
      payload: {},
    });

    expect(response.statusCode).toBe(201);
    const body = response.json().data as Record<string, unknown>;
    expect(body['candidateId']).toBe(candidate.id);
    expect(body['sandboxState']).toBe('ready');

    // Nothing here claims the document changed.
    expect(body).not.toHaveProperty('executable');
    expect(body).not.toHaveProperty('documentId');

    await app.close();
  });

  it('names the revision state when the current revision is not approved', async () => {
    const app = compileServer(() =>
      Promise.resolve({ ok: false, reason: 'revision_not_approved', state: 'draft' }),
    );

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sop-documents/${DOCUMENT_ID}/candidates`,
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('draft');

    await app.close();
  });

  it('reports every refusal, naming the step and the reason', async () => {
    const app = compileServer(() =>
      Promise.resolve({
        ok: false,
        reason: 'refused',
        refusals: [
          { code: 'missing_binding', stepId: 'search', message: 'not mapped yet' },
          { code: 'unusable_outcome_name', message: '"none" is reserved' },
        ],
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sop-documents/${DOCUMENT_ID}/candidates`,
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    const details = response.json().error.details as { field: string; message: string }[];
    expect(details).toHaveLength(2);
    expect(details[0]?.field).toBe('search');
    expect(details[1]?.message).toContain('unusable_outcome_name');

    await app.close();
  });

  it('reports an unknown document as missing', async () => {
    const app = compileServer(() => Promise.resolve({ ok: false, reason: 'not_found' }));

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sop-documents/${DOCUMENT_ID}/candidates`,
      payload: {},
    });

    expect(response.statusCode).toBe(404);

    await app.close();
  });

  it('rejects a body whose mapping value is not a business outcome, before reaching the service', async () => {
    const app = compileServer(() => {
      throw new Error('the service must not be called for an invalid body');
    });

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sop-documents/${DOCUMENT_ID}/candidates`,
      // Publishing takes no body now (ADR-030). A caller still sending the
      // retired field is told, rather than having it silently ignored.
      payload: { outcomeMapping: { completed: 'something_else' } },
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });

  it('rejects a document id that is not an Orbit identifier', async () => {
    const app = compileServer(() => {
      throw new Error('the service must not be called for a malformed id');
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/sop-documents/not-an-orbit-id/candidates',
      payload: {},
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });
});

describe('POST /v1/agent-ir-candidates/:candidateId/approve', () => {
  it('approves and describes the resulting candidate', async () => {
    const candidate = agentIrCandidateRecord({ state: 'approved' });
    const app = approveServer(() => Promise.resolve({ ok: true, candidate }));

    const response = await app.inject({
      method: 'POST',
      url: `/v1/agent-ir-candidates/${CANDIDATE_ID}/approve`,
      payload: { note: 'Checked by hand.' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.state).toBe('approved');

    await app.close();
  });

  it('refuses a workflow that could never be checked, naming why', async () => {
    const app = approveServer(() =>
      Promise.resolve({ ok: false, reason: 'not_ready', sandboxState: 'cannot_validate' }),
    );

    const response = await app.inject({
      method: 'POST',
      url: `/v1/agent-ir-candidates/${CANDIDATE_ID}/approve`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('cannot_validate');

    await app.close();
  });

  it('refuses to approve a candidate twice', async () => {
    const app = approveServer(() =>
      Promise.resolve({ ok: false, reason: 'illegal_transition', state: 'approved' }),
    );

    const response = await app.inject({
      method: 'POST',
      url: `/v1/agent-ir-candidates/${CANDIDATE_ID}/approve`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('approved');

    await app.close();
  });

  it('reports an unknown candidate as missing', async () => {
    const app = approveServer(() => Promise.resolve({ ok: false, reason: 'not_found' }));

    const response = await app.inject({
      method: 'POST',
      url: `/v1/agent-ir-candidates/${CANDIDATE_ID}/approve`,
    });

    expect(response.statusCode).toBe(404);

    await app.close();
  });

  it('rejects a candidate id that is not an Orbit identifier', async () => {
    const app = approveServer(() => {
      throw new Error('the service must not be called for a malformed id');
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/agent-ir-candidates/not-an-orbit-id/approve',
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });
});

describe('POST /v1/agent-ir-candidates/:candidateId/reject', () => {
  it('rejects and describes the resulting candidate', async () => {
    const candidate = agentIrCandidateRecord({ state: 'rejected' });
    const app = rejectServer(() => Promise.resolve({ ok: true, candidate }));

    const response = await app.inject({
      method: 'POST',
      url: `/v1/agent-ir-candidates/${CANDIDATE_ID}/reject`,
      payload: { note: 'Needs a sign-in Orbit cannot supply.' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.state).toBe('rejected');

    await app.close();
  });

  // Unlike approval, rejection asks nothing of the sandbox: a candidate that
  // could never be checked is exactly the case a reviewer needs to be able to
  // reject.
  it('accepts a rejection with no note', async () => {
    const candidate = agentIrCandidateRecord({ state: 'rejected' });
    const app = rejectServer(() => Promise.resolve({ ok: true, candidate }));

    const response = await app.inject({
      method: 'POST',
      url: `/v1/agent-ir-candidates/${CANDIDATE_ID}/reject`,
    });

    expect(response.statusCode).toBe(200);

    await app.close();
  });

  it('refuses to reject a candidate that is not in a rejectable state', async () => {
    const app = rejectServer(() =>
      Promise.resolve({ ok: false, reason: 'illegal_transition', state: 'approved' }),
    );

    const response = await app.inject({
      method: 'POST',
      url: `/v1/agent-ir-candidates/${CANDIDATE_ID}/reject`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('approved');

    await app.close();
  });

  it('reports an unknown candidate as missing', async () => {
    const app = rejectServer(() => Promise.resolve({ ok: false, reason: 'not_found' }));

    const response = await app.inject({
      method: 'POST',
      url: `/v1/agent-ir-candidates/${CANDIDATE_ID}/reject`,
    });

    expect(response.statusCode).toBe(404);

    await app.close();
  });

  it('rejects a candidate id that is not an Orbit identifier', async () => {
    const app = rejectServer(() => {
      throw new Error('the service must not be called for a malformed id');
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/agent-ir-candidates/not-an-orbit-id/reject',
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });
});
