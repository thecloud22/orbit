import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createLocalFilesystemArtifactStorage, type ArtifactStorage } from '@orbit/artifacts';
import { createTestArtifactRoot, removeTestArtifactRoot } from '@orbit/artifacts/testing';
import { createArtifactService } from '@orbit/artifact-service';
import { newArtifactId, newSopDocumentId, type AgentVersionId, type RunId } from '@orbit/contracts';
import type { SelectorChain } from '@orbit/execution-mapping';
import { buttonFingerprint, fieldFingerprint } from '@orbit/execution-mapping/testing';
import { createRepositories } from '@orbit/db';
import { seedTestAgentVersion, useTestDatabase } from '@orbit/db/testing';
import { createFakeBrowser, createFakeBrowserFactory } from '@orbit/runtime/testing';
import {
  createFakeSopProvider,
  respondWith,
  validSopGraphProposal,
} from '@orbit/sop-generation/testing';
import type { RecordedEntry } from '@orbit/sop-recording';
import { SOP_GRAPH_SCHEMA_VERSION, type SopGraph } from '@orbit/sop-graph';
import {
  createSopCandidateService,
  createSopDraftService,
  createPublishBoundDocumentService,
  createRecoveryProposalService,
  createPublishRecordingService,
  createSopPublishService,
  createSopRecordingService,
  createSopRevisionService,
} from '@orbit/sop-service';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createInProcessRunDispatcher } from './dispatch';
import { createPlatformFacts } from './platform';
import { createBindingSessionRegistry } from './recording/binding-session-registry';
import { createWalkthroughSessionRegistry } from './recording/walkthrough-session-registry';
import { createRecordingSessionRegistry } from './recording/session-registry';
import {
  createFakeRecordingSessionFactory,
  elementCapture,
  type FakeRecordingSessionFactory,
} from './testing/fake-recording-session';
import { buildServer } from './server';

/**
 * The API against real persistence and real artifact storage.
 *
 * The browser is the one thing faked: these tests are about HTTP behaviour,
 * linkage enforcement, and integrity, and the real-browser proof lives in the
 * Watchtower end-to-end test. The dispatcher itself is the production one, so
 * the run-id observation path is exercised rather than simulated.
 */
describe('Orbit API over real persistence', () => {
  const getDatabase = useTestDatabase();

  let artifactRoot: string;
  let storage: ArtifactStorage;
  let agentVersionId: AgentVersionId;
  let app: FastifyInstance;
  /** Scripted so a binding session has something to bind, with no browser. */
  let bindingFactory: FakeRecordingSessionFactory;

  beforeEach(async () => {
    artifactRoot = await createTestArtifactRoot();
    bindingFactory = createFakeRecordingSessionFactory({
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
    storage = await createLocalFilesystemArtifactStorage({ root: artifactRoot });
    agentVersionId = (await seedTestAgentVersion(getDatabase().db)).id;

    app = buildServer({
      logLevel: 'silent',
      context: {
        repositories: createRepositories(getDatabase().db),
        artifactService: createArtifactService({ database: getDatabase().db, storage }),
        dispatcher: createInProcessRunDispatcher({
          database: getDatabase().db,
          storage,
          logger: { debug: () => undefined, info: () => undefined, warn: () => undefined },
          browser: createFakeBrowserFactory(() => Promise.resolve(createFakeBrowser())),
        }),
        // A deterministic provider, so the draft route is exercised over real
        // persistence with no network call and no model.
        sopDraftService: createSopDraftService({
          database: getDatabase().db,
          provider: createFakeSopProvider({ respond: () => respondWith(validSopGraphProposal()) }),
        }),
        sopRevisionService: createSopRevisionService({ database: getDatabase().db }),
        sopCandidateService: createSopCandidateService({ database: getDatabase().db }),
        sopPublishService: createSopPublishService({ database: getDatabase().db }),
        publishRecordingService: createPublishRecordingService({ database: getDatabase().db }),
        publishBoundDocumentService: createPublishBoundDocumentService({
          database: getDatabase().db,
        }),
        recoveryProposals: createRecoveryProposalService({ database: getDatabase().db }),
        // No browser: these tests never record, and a registry that could open
        // one would be a Chromium per test file for nothing.
        recordingSessions: createRecordingSessionRegistry({
          database: getDatabase().db,
          factory: createFakeRecordingSessionFactory(),
        }),
        bindingSessions: createBindingSessionRegistry({
          database: getDatabase().db,
          factory: bindingFactory,
        }),
        // Present so the context is whole; walkthroughs have their own
        // integration test, where the sequence can be scripted per case.
        walkthroughSessions: createWalkthroughSessionRegistry({
          database: getDatabase().db,
          factory: createFakeRecordingSessionFactory(),
        }),
        // Uncapped: these tests are about routes and persistence, and a ceiling
        // reached mid-suite would fail them for a reason unrelated to what they
        // assert. The budget itself is tested where it lives.
        modelBudgets: {},
        // The real implementation against the real test database, so the
        // migration level the Admin page shows is read from PostgreSQL here
        // rather than only from a stub.
        platform: createPlatformFacts({
          executor: getDatabase().db,
          artifactRoot,
          host: '127.0.0.1',
          port: 3002,
          modelSelection: {
            configured: true,
            family: 'anthropic',
            invocation: 'direct',
            model: 'claude-haiku-4-5',
            reason: null,
          },
          runs: createRepositories(getDatabase().db).runs,
          processStartedAt: new Date(),
        }),
      },
    });

    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await removeTestArtifactRoot(artifactRoot);
  });

  /**
   * Waits for a dispatched run to finish writing.
   *
   * Execution continues after the 202 (ADR-011), so a test that starts a run and
   * returns leaves a writer alive in this process. The next test's `TRUNCATE`
   * then deadlocks against it — the truncate wants an exclusive lock on tables
   * the live run holds row locks on. Every test that starts a run must therefore
   * wait for it, whether or not the test cares about the result.
   */
  async function waitForTerminal(runId: RunId): Promise<RunId> {
    const repositories = createRepositories(getDatabase().db);

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const run = await repositories.runs.findById(runId);
      if (run !== null && (run.status === 'succeeded' || run.status === 'failed')) {
        return waitForQuiescence(runId);
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    throw new Error(`Run ${runId} did not reach a terminal state.`);
  }

  /**
   * Waits until the run has stopped writing, which is not the same moment as
   * reaching a terminal status.
   *
   * Trailing events are appended after the run row is marked terminal, so a
   * test that resumes on status alone can still have rows land underneath it —
   * two reads of the event log straddling one append disagree about its length,
   * and the next test's TRUNCATE races a live writer. Quiescence is the
   * property these tests actually depend on, so it is the one waited for.
   */
  async function waitForQuiescence(runId: RunId): Promise<RunId> {
    const repositories = createRepositories(getDatabase().db);
    let previous = -1;

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const count = (await repositories.runEvents.listByRun(runId)).length;

      if (count === previous) {
        return runId;
      }

      previous = count;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    throw new Error(`Run ${runId} never stopped writing events.`);
  }

  /** Starts a run through the API and waits for it to reach a terminal state. */
  async function runToCompletion(requestNumber: string): Promise<RunId> {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/agent-versions/${agentVersionId}/runs`,
      payload: { inputs: { requestNumber } },
    });

    expect(response.statusCode).toBe(202);

    return waitForTerminal(response.json().data.runId as RunId);
  }

  it('lists the seeded published agent version', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/agent-versions' });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual([
      expect.objectContaining({
        id: agentVersionId,
        name: 'Find Service Request',
        version: '0.1.0',
      }),
    ]);
  });

  it('archiving an agent retires it from the catalog without touching its version', async () => {
    const archiveResponse = await app.inject({
      method: 'POST',
      url: `/v1/agent-versions/${agentVersionId}/archive`,
    });

    expect(archiveResponse.statusCode).toBe(200);
    expect(archiveResponse.json().data.archivedAt).not.toBeNull();

    const listed = await app.inject({ method: 'GET', url: '/v1/agent-versions' });
    expect(listed.json().data).toEqual([]);

    // The version row itself is untouched — archiving retires the agent
    // identity, never a version's own immutable content (ADR-026).
    const repositories = createRepositories(getDatabase().db);
    const stillThere = await repositories.agentVersions.findById(agentVersionId);
    expect(stillThere?.lifecycleStatus).toBe('published');

    const restoreResponse = await app.inject({
      method: 'POST',
      url: `/v1/agent-versions/${agentVersionId}/restore`,
    });

    expect(restoreResponse.statusCode).toBe(200);
    expect(restoreResponse.json().data.archivedAt).toBeNull();

    const listedAgain = await app.inject({ method: 'GET', url: '/v1/agent-versions' });
    expect(listedAgain.json().data).toEqual([
      expect.objectContaining({ id: agentVersionId, name: 'Find Service Request' }),
    ]);
  });

  it('refuses to archive or restore an agent version that does not exist', async () => {
    const missing = 'agentv_missing_00000000000000000' as AgentVersionId;

    const archiveResponse = await app.inject({
      method: 'POST',
      url: `/v1/agent-versions/${missing}/archive`,
    });
    expect(archiveResponse.statusCode).toBe(404);

    const restoreResponse = await app.inject({
      method: 'POST',
      url: `/v1/agent-versions/${missing}/restore`,
    });
    expect(restoreResponse.statusCode).toBe(404);
  });

  it('starts a run and returns its id before execution finishes', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/agent-versions/${agentVersionId}/runs`,
      payload: { inputs: { requestNumber: 'SR-1001' } },
    });

    expect(response.statusCode).toBe(202);
    const runId = response.json().data.runId as RunId;

    // The run is durable the moment the response is sent.
    const run = await createRepositories(getDatabase().db).runs.findById(runId);
    expect(run).not.toBeNull();
    expect(run?.agentVersionId).toBe(agentVersionId);

    await runToCompletion('SR-1001');
  });

  it('serves run detail from persisted state with ordered steps and events', async () => {
    const runId = await runToCompletion('SR-1001');
    const response = await app.inject({ method: 'GET', url: `/v1/runs/${runId}` });
    const run = response.json().data;

    expect(response.statusCode).toBe(200);
    expect(run.status).toBe('succeeded');
    expect(run.businessOutcome).toBe('request_found');
    expect(run.outputs).toEqual({
      requestNumber: 'SR-1001',
      requestStatus: 'In Progress',
      assignedTeam: 'Infrastructure Operations',
    });
    expect(run.error).toBeNull();
    expect(run.agentVersion).toMatchObject({ id: agentVersionId, version: '0.1.0' });

    expect(run.steps.map((step: { agentStepId: string }) => step.agentStepId)).toEqual([
      'open_request_portal',
      'enter_request_number',
      'submit_request_search',
      'detect_request_result',
      'verify_request_number',
      'extract_request_data',
      'complete_found',
    ]);
    expect(run.steps.map((step: { sequence: number }) => step.sequence)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);

    const sequences = run.events.map((event: { sequence: number }) => event.sequence);
    expect(sequences).toEqual([...sequences].sort((a: number, b: number) => a - b));
    expect(run.events.at(0).eventType).toBe('run.queued');
    expect(run.events.at(-1).eventType).toBe('run.completed');
  });

  it('never exposes storage keys or filesystem paths in run detail', async () => {
    const runId = await runToCompletion('SR-1001');
    const body = (await app.inject({ method: 'GET', url: `/v1/runs/${runId}` })).body;

    expect(body).not.toContain('storageKey');
    expect(body).not.toContain(artifactRoot);
    expect(body).not.toContain('/steps/rstep_');
    expect(body).not.toContain('.png"');

    // The artifact.created events still carry their safe detail.
    const run = JSON.parse(body).data;
    const created = run.events.find(
      (event: { eventType: string }) => event.eventType === 'artifact.created',
    );
    expect(created.payload).toHaveProperty('artifactId');
    expect(created.payload).toHaveProperty('sha256');
    expect(created.payload).not.toHaveProperty('storageKey');
  });

  it('exposes artifacts by controlled url with their roles', async () => {
    const runId = await runToCompletion('SR-1001');
    const run = (await app.inject({ method: 'GET', url: `/v1/runs/${runId}` })).json().data;

    expect(run.artifacts.length).toBeGreaterThan(0);

    for (const artifact of run.artifacts) {
      expect(artifact).not.toHaveProperty('storageKey');
      expect(artifact.url).toBe(`/v1/runs/${runId}/artifacts/${artifact.id}`);
      expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(artifact.roles.length).toBeGreaterThan(0);
    }

    expect(run.artifacts.some((a: { kind: string }) => a.kind === 'browser_trace')).toBe(true);
  });

  it('serves artifact bytes with the stored content type and integrity headers', async () => {
    const runId = await runToCompletion('SR-1001');
    const run = (await app.inject({ method: 'GET', url: `/v1/runs/${runId}` })).json().data;

    const screenshot = run.artifacts.find((a: { kind: string }) => a.kind === 'browser_screenshot');
    const trace = run.artifacts.find((a: { kind: string }) => a.kind === 'browser_trace');

    const image = await app.inject({ method: 'GET', url: screenshot.url });
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toBe('image/png');
    expect(image.headers['content-disposition']).toContain('inline');
    expect(image.headers['x-content-type-options']).toBe('nosniff');
    expect(image.headers['x-orbit-sha256']).toBe(screenshot.sha256);
    expect(image.rawPayload.byteLength).toBe(screenshot.sizeBytes);

    // Anything that is not an image is an attachment, so a captured page can
    // never be rendered on the API's own origin.
    const zip = await app.inject({ method: 'GET', url: trace.url });
    expect(zip.statusCode).toBe(200);
    expect(zip.headers['content-type']).toBe('application/zip');
    expect(zip.headers['content-disposition']).toContain('attachment');
    expect(zip.headers['content-security-policy']).toContain("default-src 'none'");
  });

  it('serves a DOM snapshot as an attachment, never inline', async () => {
    const runId = await runToCompletion('SR-1001');
    const run = (await app.inject({ method: 'GET', url: `/v1/runs/${runId}` })).json().data;
    const dom = run.artifacts.find((a: { kind: string }) => a.kind === 'dom_snapshot');

    const response = await app.inject({ method: 'GET', url: dom.url });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(response.headers['content-disposition']).toContain('attachment');
    expect(response.headers['content-security-policy']).toContain('sandbox');
  });

  it('refuses an artifact that belongs to a different run', async () => {
    const firstRunId = await runToCompletion('SR-1001');
    const secondRunId = await runToCompletion('SR-9999');

    const first = (await app.inject({ method: 'GET', url: `/v1/runs/${firstRunId}` })).json().data;
    const artifactId = first.artifacts[0].id;

    const response = await app.inject({
      method: 'GET',
      url: `/v1/runs/${secondRunId}/artifacts/${artifactId}`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain(artifactRoot);
  });

  it('returns the same 404 for an artifact that does not exist', async () => {
    const runId = await runToCompletion('SR-1001');

    const response = await app.inject({
      method: 'GET',
      url: `/v1/runs/${runId}/artifacts/${newArtifactId()}`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.message).toBe('No such artifact for this run.');
  });

  it('refuses to serve evidence whose bytes no longer match their digest', async () => {
    const runId = await runToCompletion('SR-1001');
    const run = (await app.inject({ method: 'GET', url: `/v1/runs/${runId}` })).json().data;
    const dom = run.artifacts.find((a: { kind: string }) => a.kind === 'dom_snapshot');

    // Tamper on disk, which the API cannot do and a caller cannot reach: the
    // storage key comes from the database, not from the API surface.
    const stored = await createRepositories(getDatabase().db).artifacts.findById(dom.id);
    const path = join(artifactRoot, stored!.storageKey);
    const original = await readFile(path);
    await writeFile(path, Buffer.concat([original, Buffer.from('<!-- tampered -->')]));

    const response = await app.inject({ method: 'GET', url: dom.url });

    expect(response.statusCode).toBe(500);
    expect(response.json().error.code).toBe('ARTIFACT_STORAGE_ERROR');
    expect(response.body).not.toContain(artifactRoot);
  });

  it('returns ordered events, and only newer ones when asked', async () => {
    const runId = await runToCompletion('SR-1001');

    const all = (await app.inject({ method: 'GET', url: `/v1/runs/${runId}/events` })).json().data;
    expect(all.length).toBeGreaterThan(5);
    expect(all.at(0).sequence).toBe(1);

    const since = (
      await app.inject({ method: 'GET', url: `/v1/runs/${runId}/events?afterSequence=5` })
    ).json().data;

    expect(since.every((event: { sequence: number }) => event.sequence > 5)).toBe(true);
    expect(since.length).toBe(all.length - 5);
  });

  it('serves a lightweight status summary for polling', async () => {
    const runId = await runToCompletion('SR-1001');
    const response = await app.inject({ method: 'GET', url: `/v1/runs/${runId}/summary` });
    const summary = response.json().data;

    expect(summary.status).toBe('succeeded');
    expect(summary.businessOutcome).toBe('request_found');
    expect(summary).not.toHaveProperty('events');
    expect(summary).not.toHaveProperty('artifacts');
  });

  it('records the not-found path as a business outcome, not an error', async () => {
    const runId = await runToCompletion('SR-9999');
    const run = (await app.inject({ method: 'GET', url: `/v1/runs/${runId}` })).json().data;

    expect(run.status).toBe('succeeded');
    expect(run.businessOutcome).toBe('request_not_found');
    expect(run.error).toBeNull();
    expect(run.outputs).toEqual({ requestNumber: 'SR-9999' });
  });

  /**
   * The documented Phase 1 limitation: nothing server-side prevents a second
   * concurrent dispatch. Watchtower disables its button while a request is in
   * flight, which is a UI guard, not a server guarantee.
   */
  it('creates a separate run per dispatch, with no server-side duplicate suppression', async () => {
    const [first, second] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/v1/agent-versions/${agentVersionId}/runs`,
        payload: { inputs: { requestNumber: 'SR-1001' } },
      }),
      app.inject({
        method: 'POST',
        url: `/v1/agent-versions/${agentVersionId}/runs`,
        payload: { inputs: { requestNumber: 'SR-1001' } },
      }),
    ]);

    expect(first.json().data.runId).not.toBe(second.json().data.runId);
    expect(
      (await createRepositories(getDatabase().db).runs.listByAgentVersion(agentVersionId)).length,
    ).toBe(2);

    // Both runs are left executing by the assertions above. Waiting for them is
    // not tidiness: the next test truncates, and a truncate against a live
    // writer in this process deadlocks.
    await Promise.all([
      waitForTerminal(first.json().data.runId as RunId),
      waitForTerminal(second.json().data.runId as RunId),
    ]);
  });

  describe('POST /v1/sop-drafts', () => {
    const SOURCE_TEXT_MARKER = 'ORBIT-SOURCE-TEXT-MARKER-9f3a';
    const SOURCE_TEXT = `${SOURCE_TEXT_MARKER}: sign in and review the escalation.`;

    it('persists a document and its first revision, and returns neither raw row', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/sop-drafts',
        payload: { sourceText: SOURCE_TEXT },
      });

      expect(response.statusCode).toBe(201);

      const draft = response.json().data;
      expect(draft.revisionNumber).toBe(1);
      expect(draft.state).toBe('draft');
      expect(draft.executable).toBe(false);
      expect(draft.provenance.kind).toBe('generated');

      // The rows exist, together, and the graph came back through the checksum
      // verification the mapper performs on every read.
      const repositories = createRepositories(getDatabase().db);
      const document = await repositories.sopDocuments.findById(draft.documentId);
      const revision = await repositories.sopGraphRevisions.findById(draft.revisionId);

      expect(document?.sourceText).toBe(SOURCE_TEXT);
      expect(revision?.documentId).toBe(draft.documentId);
      expect(revision?.graph.title).toBe(draft.title);

      // The source text is stored but never published back. The marker is
      // deliberately unlike anything in the graph: an earlier version of this
      // assertion used ordinary prose and tripped over a step summary that
      // happened to read the same way.
      expect(response.body).not.toContain(SOURCE_TEXT_MARKER);
      expect(response.body).not.toContain('graphSha256');
    });

    it('creates a second revision for an existing document', async () => {
      const first = await app.inject({
        method: 'POST',
        url: '/v1/sop-drafts',
        payload: { sourceText: SOURCE_TEXT },
      });

      const second = await app.inject({
        method: 'POST',
        url: '/v1/sop-drafts',
        payload: { documentId: first.json().data.documentId },
      });

      expect(second.statusCode).toBe(201);
      expect(second.json().data.documentId).toBe(first.json().data.documentId);
      expect(second.json().data.revisionNumber).toBe(2);
    });

    it('404s for a document that does not exist', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/sop-drafts',
        payload: { documentId: newSopDocumentId() },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('compiling, approving and publishing a workflow over HTTP', () => {
    // Only a recorded document has approved bindings: a free-text draft has
    // none, and every navigate/fill/click step in it would refuse to compile
    // with missing_binding. This is the actual path 2.4f-2 and 2.5 exist to
    // feed, so it is the one that proves the loop this task closes.
    const FIELD = [{ strategy: 'test_id', value: 'request-number-input' }] as SelectorChain;
    const BUTTON = [
      { strategy: 'test_id', value: 'search-request-button' },
      { strategy: 'role_and_name', value: 'button', name: 'Search' },
    ] as SelectorChain;
    const SEQUENCE: readonly RecordedEntry[] = [
      { kind: 'navigate', url: 'http://localhost:3001/requests' },
      { kind: 'fill', selectors: FIELD, fingerprint: fieldFingerprint(), typedValue: 'SR-1001' },
      { kind: 'click', selectors: BUTTON, fingerprint: buttonFingerprint() },
    ];

    async function recordedDocument() {
      const recorded = await createSopRecordingService({
        database: getDatabase().db,
      }).createFromRecording({
        title: 'Find a service request',
        startUrl: 'http://localhost:3001/requests',
        sequence: SEQUENCE,
      });

      if (!recorded.ok) throw new Error('the fixture recording should persist');
      return recorded;
    }

    it('goes from a recorded document to a running agent using only the HTTP surface', async () => {
      const recorded = await recordedDocument();

      // A recorded revision starts in draft, same as a hand-authored one, and
      // compiling one is refused before it has been through review (ADR-017) —
      // checked here, before the revision is moved anywhere.
      const tooEarly = await app.inject({
        method: 'POST',
        url: `/v1/sop-documents/${recorded.document.id}/candidates`,
        payload: {},
      });
      expect(tooEarly.statusCode).toBe(400);
      expect(tooEarly.json().error.message).toContain('draft');

      const submitted = await app.inject({
        method: 'POST',
        url: `/v1/sop-revisions/${recorded.revision.id}/transitions`,
        payload: { action: 'submit_for_review' },
      });
      expect(submitted.statusCode).toBe(200);

      const approvedRevision = await app.inject({
        method: 'POST',
        url: `/v1/sop-revisions/${recorded.revision.id}/transitions`,
        payload: { action: 'approve' },
      });
      expect(approvedRevision.statusCode).toBe(200);
      expect(approvedRevision.json().data.state).toBe('approved');

      const compiled = await app.inject({
        method: 'POST',
        url: `/v1/sop-documents/${recorded.document.id}/candidates`,
        payload: {},
      });
      expect(compiled.statusCode).toBe(201);
      expect(compiled.json().data.sandboxState).toBe('ready');
      const candidateId = compiled.json().data.candidateId as string;

      // Approving twice is refused; the second call names why.
      const approved = await app.inject({
        method: 'POST',
        url: `/v1/agent-ir-candidates/${candidateId}/approve`,
        payload: { note: 'Checked the selectors by hand.' },
      });
      expect(approved.statusCode).toBe(200);
      expect(approved.json().data.state).toBe('approved');

      const approvedTwice = await app.inject({
        method: 'POST',
        url: `/v1/agent-ir-candidates/${candidateId}/approve`,
      });
      expect(approvedTwice.statusCode).toBe(400);

      const published = await app.inject({
        method: 'POST',
        url: `/v1/agent-ir-candidates/${candidateId}/publish`,
      });
      expect(published.statusCode).toBe(201);
      const publishedAgentVersionId = published.json().data.agentVersionId as string;

      // The whole reason this exists: the published agent is reachable the
      // same way the seeded one is, with no candidate-shaped special case.
      const listed = await app.inject({ method: 'GET', url: '/v1/agent-versions' });
      expect(listed.statusCode).toBe(200);
      const ids = (listed.json().data as { id: string }[]).map((version) => version.id);
      expect(ids).toContain(publishedAgentVersionId);

      // And the SOP document's own claim about itself never moved.
      const document = await app.inject({
        method: 'GET',
        url: `/v1/sop-documents/${recorded.document.id}`,
      });
      expect(document.json().data.executable).toBe(false);
      expect(document.json().data.publication.agentVersionId).toBe(publishedAgentVersionId);
    });

    it('reports the declared outcomes a reviewer needs to map before compiling', async () => {
      const recorded = await recordedDocument();

      const document = await app.inject({
        method: 'GET',
        url: `/v1/sop-documents/${recorded.document.id}`,
      });

      const outcomes = document.json().data.declaredOutcomes as { name: string; message: string }[];
      expect(outcomes.map((outcome) => outcome.name)).toContain('completed');
    });
  });

  /**
   * Binding a drafted workflow's steps, then publishing it — the gap this
   * closes.
   *
   * A drafted workflow reached the compiler with no bindings at all and was
   * refused. What is proven here over HTTP is the whole way out of that: bind
   * each step against a page, and the same one-action publish a recorded
   * workflow gets applies (ADR-027).
   */
  describe('binding a drafted workflow over HTTP', () => {
    function draftedGraph() {
      return {
        schemaVersion: SOP_GRAPH_SCHEMA_VERSION,
        title: 'Find a service request',
        entryStepId: 'open_portal',
        inputs: [
          {
            id: 'requestNumber',
            label: 'Request number',
            type: 'string',
            required: true,
            minLength: 1,
          },
        ],
        outputs: [{ name: 'requestStatus', label: 'Status' }],
        steps: [
          {
            id: 'open_portal',
            kind: 'navigate',
            urlHint: 'http://localhost:3001/requests',
            purpose: 'Open the service request portal',
          },
          {
            id: 'enter_request_number',
            kind: 'fill',
            fieldHint: 'Request number',
            value: '${inputs.requestNumber}',
            purpose: 'Provide the request number',
          },
          { id: 'search', kind: 'click', targetHint: 'Search', purpose: 'Run the search' },
          {
            id: 'read_status',
            kind: 'extract',
            fields: [{ name: 'requestStatus', labelHint: 'Status', required: true }],
            purpose: 'Read the current status',
          },
          { id: 'found', kind: 'outcome', outcome: 'completed', message: 'The request was found' },
        ],
        assumptions: [],
        clarificationQuestions: [],
        risks: [],
      } as SopGraph;
    }

    async function draftedDocument() {
      const repositories = createRepositories(getDatabase().db);
      const document = await repositories.sopDocuments.create({
        title: 'Find a service request',
        sourceText: 'Search the portal for a request and read its status.',
      });

      await repositories.sopGraphRevisions.create({
        documentId: document.id,
        graph: draftedGraph(),
        provenance: { kind: 'generated', model: 'fake', provider: 'test', promptVersion: 'v1' },
      });

      return document;
    }

    /** One sitting per step, since the fake browser scripts one capture per open. */
    async function bindStep(documentId: string, stepId: string, variable?: string) {
      const started = await app.inject({
        method: 'POST',
        url: '/v1/binding-sessions',
        payload: { documentId, stepId, startUrl: 'http://localhost:3001/requests' },
      });

      expect(started.statusCode).toBe(201);

      const sessionId = started.json().data.sessionId as string;
      const captureId = started.json().data.captures[0].captureId as string;

      const bound = await app.inject({
        method: 'POST',
        url: `/v1/binding-sessions/${sessionId}/binding`,
        payload: { captureId, ...(variable === undefined ? {} : { variable }) },
      });

      expect(bound.statusCode).toBe(201);
      expect(bound.json().data.state).toBe('approved');

      // Saving leaves the browser open on purpose, so the sitting is ended
      // explicitly rather than by having saved.
      const closed = await app.inject({
        method: 'DELETE',
        url: `/v1/binding-sessions/${sessionId}`,
      });
      expect(closed.statusCode).toBe(204);
    }

    it('binds each step and publishes the workflow, using only the HTTP surface', async () => {
      const document = await draftedDocument();

      // Nothing is bound yet, so there is nothing to publish.
      const tooEarly = await app.inject({
        method: 'POST',
        url: `/v1/sop-documents/${document.id}/publish-bound`,
        payload: {},
      });
      expect(tooEarly.statusCode).toBe(422);
      expect(
        (tooEarly.json().error.details as { field: string }[]).map((detail) => detail.field),
      ).toEqual(['enter_request_number', 'search', 'read_status']);

      await bindStep(document.id, 'enter_request_number');
      await bindStep(document.id, 'search');
      await bindStep(document.id, 'read_status', 'requestStatus');

      const bindings = await app.inject({
        method: 'GET',
        url: `/v1/sop-documents/${document.id}/bindings`,
      });

      expect(bindings.statusCode).toBe(200);
      expect(bindings.json().data.summary).toMatchObject({ approved: 3, stale: 0 });

      const published = await app.inject({
        method: 'POST',
        url: `/v1/sop-documents/${document.id}/publish-bound`,
        payload: {},
      });

      expect(published.statusCode).toBe(201);

      // The workflow's own claim about itself never moved (ADR-016).
      const review = await app.inject({
        method: 'GET',
        url: `/v1/sop-documents/${document.id}`,
      });
      expect(review.json().data.executable).toBe(false);
      expect(review.json().data.publication.agentVersionId).toBe(
        published.json().data.agentVersionId,
      );
    });

    it('refuses to bind a step the compiler needs no binding for', async () => {
      const document = await draftedDocument();

      const started = await app.inject({
        method: 'POST',
        url: '/v1/binding-sessions',
        payload: {
          documentId: document.id,
          stepId: 'open_portal',
          startUrl: 'http://localhost:3001/requests',
        },
      });

      expect(started.statusCode).toBe(400);
    });
  });

  describe('GET /v1/platform', () => {
    it('reads the migration level from the database it is attached to', async () => {
      // The test database is migrated by the harness, so a checkout in step
      // with it must report current. This is the half `platform.test.ts` cannot
      // cover: there, the migration level comes from a stub.
      const response = await app.inject({ method: 'GET', url: '/v1/platform' });

      expect(response.statusCode).toBe(200);

      const platform = (response.json() as { data: Record<string, never> }).data;
      const database = platform['database'] as unknown as {
        readonly name: string;
        readonly current: boolean;
        readonly pending: readonly string[];
        readonly migrationsApplied: number;
        readonly latestApplied: string | null;
      };

      expect(database.current).toBe(true);
      expect(database.pending).toEqual([]);
      expect(database.migrationsApplied).toBeGreaterThan(0);
      expect(database.latestApplied).not.toBeNull();
      expect(database.name).toBe('orbit_test');
    });

    it('never puts a connection URL or a credential on the wire', async () => {
      // `@orbit/db` returns a database name and never a URL, because a URL
      // carries a password. Asserted on the raw body so a nested field cannot
      // smuggle one past a field-by-field check.
      const raw = (await app.inject({ method: 'GET', url: '/v1/platform' })).body;

      expect(raw).not.toContain('postgres://');
      expect(raw).not.toContain('postgresql://');
      expect(raw).toContain('orbit_test');
    });
  });
});
