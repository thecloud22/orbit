import { newBindingRecoveryProposalId, newSopDocumentId } from '@orbit/contracts';
import { describe, expect, it } from 'vitest';

import { buildServer } from '../server';
import { createStubContext } from '../testing/stub-context';

/**
 * The recovery routes, against stubs.
 *
 * The write path here is the only one in Orbit that turns a proposal into a
 * live mapping, so what these check is mostly what it *refuses*: a stale
 * proposal, an already-resolved one, and a document that does not exist. A
 * proposal is a sentence written at a particular moment, and the right answer
 * to a stale one is to withdraw it, never to adjust it to fit (ADR-033).
 */
const DOCUMENT_ID = newSopDocumentId();
const PROPOSAL_ID = newBindingRecoveryProposalId();

describe('recovery proposal routes', () => {
  it('lists open proposals and whether the document grants recovery at all', async () => {
    const app = buildServer({
      context: createStubContext({
        recoveryProposals: {
          isEnabled: () => Promise.resolve(true),
          listOpen: () => Promise.resolve([]),
        },
      }),
      logLevel: 'silent',
    });

    const response = await app.inject({
      method: 'GET',
      url: `/v1/sop-documents/${DOCUMENT_ID}/recovery-proposals`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: { documentId: DOCUMENT_ID, recoveryEnabled: true, proposals: [] },
    });

    await app.close();
  });

  it('404s for a document that does not exist', async () => {
    const app = buildServer({
      context: createStubContext({ recoveryProposals: { isEnabled: () => Promise.resolve(null) } }),
      logLevel: 'silent',
    });

    const response = await app.inject({
      method: 'GET',
      url: `/v1/sop-documents/${DOCUMENT_ID}/recovery-proposals`,
    });

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('rejects an id that is not an Orbit identifier', async () => {
    const app = buildServer({ context: createStubContext(), logLevel: 'silent' });

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sop-documents/${DOCUMENT_ID}/recovery-proposals/not-an-id/accept`,
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('reports the new binding when a proposal is accepted', async () => {
    const app = buildServer({
      context: createStubContext({
        recoveryProposals: {
          accept: () =>
            Promise.resolve({
              ok: true,
              binding: {
                id: 'execbind_new',
                stepId: 'search_catalog',
                state: 'approved',
              } as never,
            }),
        },
      }),
      logLevel: 'silent',
    });

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sop-documents/${DOCUMENT_ID}/recovery-proposals/${PROPOSAL_ID}/accept`,
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: { bindingId: 'execbind_new', stepId: 'search_catalog', state: 'approved' },
    });

    await app.close();
  });

  it('409s when the step has been re-recorded since the proposal', async () => {
    // Not a 500 and not a silent success: the world moved, and the caller is
    // told so in terms they can act on.
    const app = buildServer({
      context: createStubContext({
        recoveryProposals: {
          accept: () =>
            Promise.resolve({
              ok: false,
              reason: 'superseded',
              message: 'This step has been re-recorded since Orbit proposed a repair for it.',
            }),
        },
      }),
      logLevel: 'silent',
    });

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sop-documents/${DOCUMENT_ID}/recovery-proposals/${PROPOSAL_ID}/accept`,
      payload: {},
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toContain('re-recorded');

    await app.close();
  });

  it('grants and withdraws the capability per document', async () => {
    const app = buildServer({
      context: createStubContext({
        recoveryProposals: {
          isEnabled: () => Promise.resolve(false),
          setEnabled: (_documentId, enabled) => Promise.resolve(enabled),
        },
      }),
      logLevel: 'silent',
    });

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sop-documents/${DOCUMENT_ID}/recovery`,
      payload: { enabled: true },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: { recoveryEnabled: true } });

    const rejected = await app.inject({
      method: 'POST',
      url: `/v1/sop-documents/${DOCUMENT_ID}/recovery`,
      payload: { enabled: 'yes' },
    });

    expect(rejected.statusCode).toBe(400);
    await app.close();
  });
});
