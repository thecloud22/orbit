import {
  defaultContentTypeForKind,
  extensionForKind,
  ArtifactIntegrityError,
  ArtifactNotFoundError,
  type ArtifactStorage,
  type ArtifactStorageKey,
  type GetArtifactResult,
  type PutArtifactRequest,
  type PutArtifactResult,
} from '@orbit/artifacts';
import { newArtifactId, newRunId, newRunStepId, type ArtifactMetadata } from '@orbit/contracts';
import type { OrbitDatabase } from '@orbit/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit tests for the composition seam.
 *
 * `@orbit/db` is mocked entirely: `createArtifactService` only ever reaches
 * the database through `createRepositories` and `withTransaction`, both
 * imported directly from `@orbit/db` rather than injected, so faking the
 * module is the only way to observe call order without a real database.
 * `@orbit/artifacts` is NOT mocked — its pure helpers (content type
 * defaults, error classes) run for real; only the storage object passed in
 * as a dependency is a fake.
 */
const { createRepositoriesMock, withTransactionMock } = vi.hoisted(() => ({
  createRepositoriesMock: vi.fn(),
  withTransactionMock: vi.fn(),
}));

vi.mock('@orbit/db', () => ({
  createRepositories: createRepositoriesMock,
  withTransaction: withTransactionMock,
}));

// Imported after the mock so the module under test picks up the faked `@orbit/db`.
const { createArtifactService } = await import('./artifact-service');

const fakeDatabase = {} as unknown as OrbitDatabase;

function makeMetadata(overrides: Partial<ArtifactMetadata> = {}): ArtifactMetadata {
  return {
    id: newArtifactId(),
    runId: newRunId(),
    kind: 'browser_screenshot',
    contentType: 'image/png',
    storageKey: `runs/${newRunId()}/${newArtifactId()}.png`,
    sizeBytes: 10,
    sha256: 'a'.repeat(64),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Records call order into `order` and lets each stub's behavior be swapped per test. */
function makeFakeRepositories(order: string[]) {
  const artifactsCreate = vi.fn(async (input: unknown) => {
    order.push('create');
    return makeMetadata(input as Partial<ArtifactMetadata>);
  });
  const artifactsLink = vi.fn(async (input: { role: string }) => {
    order.push('link');
    return {
      id: `artl_${Math.random().toString(36).slice(2)}`,
      artifactId: newArtifactId(),
      role: input.role,
      targetType: 'run' as const,
      targetId: newRunId(),
    };
  });
  const artifactsFindById = vi.fn(async (): Promise<ArtifactMetadata | null> => null);

  return {
    artifacts: {
      create: artifactsCreate,
      link: artifactsLink,
      findById: artifactsFindById,
      createWithLinks: vi.fn(),
      listByRun: vi.fn(),
      listByStep: vi.fn(),
      listLinksForRun: vi.fn(),
      listLinksForStep: vi.fn(),
      listLinksForEvent: vi.fn(),
      listLinksForArtifact: vi.fn(),
    },
  };
}

function makeFakeStorage(
  order: string[],
  overrides: Partial<ArtifactStorage> = {},
): ArtifactStorage {
  return {
    rootDescription: 'fake://root',
    put: vi.fn(async (request: PutArtifactRequest): Promise<PutArtifactResult> => {
      order.push('put');
      return {
        key: request.key,
        contentType: request.contentType,
        sizeBytes: request.bytes.byteLength,
        sha256: 'b'.repeat(64),
      };
    }),
    get: vi.fn(async (key): Promise<GetArtifactResult> => {
      return { key, bytes: new Uint8Array([1, 2, 3]), sizeBytes: 3, sha256: 'b'.repeat(64) };
    }),
    exists: vi.fn(async () => true),
    ...overrides,
  };
}

let order: string[];
let fakeRepositories: ReturnType<typeof makeFakeRepositories>;

beforeEach(() => {
  order = [];
  fakeRepositories = makeFakeRepositories(order);
  createRepositoriesMock.mockReset().mockImplementation(() => fakeRepositories);
  withTransactionMock
    .mockReset()
    .mockImplementation(async (_db: unknown, work: never) =>
      (work as (repositories: unknown) => Promise<unknown>)(fakeRepositories),
    );
});

const bytes = new Uint8Array([1, 2, 3, 4]);

describe('record — ordering', () => {
  it('resolves storage.put before artifacts.create, and artifacts.create before artifacts.link', async () => {
    const storage = makeFakeStorage(order);
    const service = createArtifactService({ storage, database: fakeDatabase });
    const runId = newRunId();

    await service.record({
      runId,
      kind: 'browser_screenshot',
      bytes,
      links: [
        { targetType: 'run', targetId: runId, role: 'screenshot_after_action' },
        { targetType: 'run', targetId: runId, role: 'error_context' },
      ],
    });

    expect(order).toEqual(['put', 'create', 'link', 'link']);
  });

  it('records no link calls when no links are given', async () => {
    const storage = makeFakeStorage(order);
    const service = createArtifactService({ storage, database: fakeDatabase });

    await service.record({ runId: newRunId(), kind: 'browser_screenshot', bytes });

    expect(order).toEqual(['put', 'create']);
  });

  it('never calls artifacts.create or artifacts.link, and propagates the rejection unchanged, when storage.put rejects', async () => {
    const thrown = new Error('disk full');
    const storage = makeFakeStorage(order, { put: vi.fn().mockRejectedValue(thrown) });
    const service = createArtifactService({ storage, database: fakeDatabase });

    await expect(
      service.record({ runId: newRunId(), kind: 'browser_screenshot', bytes }),
    ).rejects.toBe(thrown);

    expect(fakeRepositories.artifacts.create).not.toHaveBeenCalled();
    expect(fakeRepositories.artifacts.link).not.toHaveBeenCalled();
  });

  it('never calls artifacts.link, and propagates the rejection unchanged, when artifacts.create rejects', async () => {
    const thrown = new Error('constraint violation');
    fakeRepositories.artifacts.create.mockRejectedValueOnce(thrown);
    const storage = makeFakeStorage(order);
    const service = createArtifactService({ storage, database: fakeDatabase });

    await expect(
      service.record({
        runId: newRunId(),
        kind: 'browser_screenshot',
        bytes,
        links: [
          {
            targetType: 'run_step',
            targetId: newRunStepId(),
            role: 'screenshot_after_action',
          },
        ],
      }),
    ).rejects.toBe(thrown);

    expect(fakeRepositories.artifacts.link).not.toHaveBeenCalled();
  });
});

describe('record — metadata construction', () => {
  it('uses the size, digest, key and contentType returned by storage.put, not values derived elsewhere', async () => {
    const sentinelResult: PutArtifactResult = {
      key: 'runs/run_sentinel/steps/rstep_sentinel/art_sentinel.png' as ArtifactStorageKey,
      contentType: 'image/x-sentinel',
      sizeBytes: 999,
      sha256: 'c'.repeat(64),
    };
    const storage = makeFakeStorage(order, { put: vi.fn().mockResolvedValue(sentinelResult) });
    const service = createArtifactService({ storage, database: fakeDatabase });

    // Deliberately mismatched from `sentinelResult` so a passing test proves
    // the service reads the put() result, not the request or the raw bytes.
    await service.record({
      runId: newRunId(),
      kind: 'browser_screenshot',
      bytes: new Uint8Array([9, 9]),
    });

    expect(fakeRepositories.artifacts.create).toHaveBeenCalledWith(
      expect.objectContaining({
        storageKey: sentinelResult.key,
        sizeBytes: sentinelResult.sizeBytes,
        sha256: sentinelResult.sha256,
        contentType: sentinelResult.contentType,
      }),
    );
  });

  it('defaults contentType to defaultContentTypeForKind(kind) when omitted', async () => {
    const storage = makeFakeStorage(order);
    const service = createArtifactService({ storage, database: fakeDatabase });

    await service.record({ runId: newRunId(), kind: 'dom_snapshot', bytes });

    const expected = defaultContentTypeForKind('dom_snapshot');
    expect(storage.put).toHaveBeenCalledWith(expect.objectContaining({ contentType: expected }));
    expect(fakeRepositories.artifacts.create).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: expected }),
    );
  });

  it('uses an explicit contentType instead of the kind default when provided', async () => {
    const storage = makeFakeStorage(order);
    const service = createArtifactService({ storage, database: fakeDatabase });

    await service.record({
      runId: newRunId(),
      kind: 'dom_snapshot',
      bytes,
      contentType: 'text/plain',
    });

    expect(defaultContentTypeForKind('dom_snapshot')).not.toBe('text/plain');
    expect(storage.put).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: 'text/plain' }),
    );
    expect(fakeRepositories.artifacts.create).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: 'text/plain' }),
    );
  });
});

describe('record — storage key shape', () => {
  it('builds a run-scoped key when no runStepId is given', async () => {
    const storage = makeFakeStorage(order);
    const service = createArtifactService({ storage, database: fakeDatabase });
    const runId = newRunId();

    await service.record({ runId, kind: 'browser_trace', bytes });

    const ext = extensionForKind('browser_trace');
    const [{ key }] = (storage.put as ReturnType<typeof vi.fn>).mock.calls[0] as [
      PutArtifactRequest,
    ];
    expect(key).toMatch(new RegExp(`^runs/${runId}/[A-Za-z0-9_-]+\\.${ext}$`));
  });

  it('builds a step-scoped key when runStepId is given', async () => {
    const storage = makeFakeStorage(order);
    const service = createArtifactService({ storage, database: fakeDatabase });
    const runId = newRunId();
    const runStepId = newRunStepId();

    await service.record({ runId, runStepId, kind: 'extracted_json', bytes });

    const ext = extensionForKind('extracted_json');
    const [{ key }] = (storage.put as ReturnType<typeof vi.fn>).mock.calls[0] as [
      PutArtifactRequest,
    ];
    expect(key).toMatch(new RegExp(`^runs/${runId}/steps/${runStepId}/[A-Za-z0-9_-]+\\.${ext}$`));
  });
});

describe('record — request validation', () => {
  async function expectRejectedBeforeStorage(request: unknown): Promise<void> {
    const storage = makeFakeStorage(order);
    const service = createArtifactService({ storage, database: fakeDatabase });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(service.record(request as any)).rejects.toBeDefined();
    expect(storage.put).not.toHaveBeenCalled();
  }

  it('rejects a malformed runId', async () => {
    await expectRejectedBeforeStorage({
      runId: 'not-a-run-id',
      kind: 'browser_screenshot',
      bytes,
    });
  });

  it('rejects a malformed runStepId', async () => {
    await expectRejectedBeforeStorage({
      runId: newRunId(),
      runStepId: 'not-a-run-step-id',
      kind: 'browser_screenshot',
      bytes,
    });
  });

  it('rejects an unknown kind', async () => {
    await expectRejectedBeforeStorage({
      runId: newRunId(),
      kind: 'not_a_real_kind',
      bytes,
    });
  });

  it('rejects bytes that are not a Uint8Array', async () => {
    await expectRejectedBeforeStorage({
      runId: newRunId(),
      kind: 'browser_screenshot',
      bytes: [1, 2, 3],
    });
  });

  it('rejects an empty-string contentType', async () => {
    await expectRejectedBeforeStorage({
      runId: newRunId(),
      kind: 'browser_screenshot',
      bytes,
      contentType: '',
    });
  });

  it('rejects an unknown extra property', async () => {
    await expectRejectedBeforeStorage({
      runId: newRunId(),
      kind: 'browser_screenshot',
      bytes,
      unexpectedField: 'nope',
    });
  });
});

describe('read', () => {
  it('returns the bytes and metadata when the digest matches', async () => {
    const runId = newRunId();
    const artifactId = newArtifactId();
    const storageKey = `runs/${runId}/${artifactId}.png`;
    const metadata = makeMetadata({ id: artifactId, runId, storageKey, sha256: 'd'.repeat(64) });

    fakeRepositories.artifacts.findById.mockResolvedValueOnce(metadata);
    const storedBytes = new Uint8Array([5, 6, 7]);
    const storage = makeFakeStorage(order, {
      get: vi.fn(async (key) => ({
        key,
        bytes: storedBytes,
        sizeBytes: storedBytes.byteLength,
        sha256: 'd'.repeat(64),
      })),
    });
    const service = createArtifactService({ storage, database: fakeDatabase });

    const result = await service.read(artifactId);

    expect(result.artifact).toEqual(metadata);
    expect(result.bytes).toBe(storedBytes);
  });

  it('throws ArtifactNotFoundError when no metadata row exists for the id', async () => {
    fakeRepositories.artifacts.findById.mockResolvedValueOnce(null);
    const storage = makeFakeStorage(order);
    const service = createArtifactService({ storage, database: fakeDatabase });

    await expect(service.read(newArtifactId())).rejects.toThrow(ArtifactNotFoundError);
  });

  it('throws ArtifactIntegrityError when the computed digest differs from the recorded one', async () => {
    const runId = newRunId();
    const artifactId = newArtifactId();
    const storageKey = `runs/${runId}/${artifactId}.png`;
    const metadata = makeMetadata({
      id: artifactId,
      runId,
      storageKey,
      sha256: 'e'.repeat(64),
    });

    fakeRepositories.artifacts.findById.mockResolvedValueOnce(metadata);
    const storage = makeFakeStorage(order, {
      get: vi.fn(async (key) => ({
        key,
        bytes: new Uint8Array([1]),
        sizeBytes: 1,
        sha256: 'f'.repeat(64),
      })),
    });
    const service = createArtifactService({ storage, database: fakeDatabase });

    await expect(service.read(artifactId)).rejects.toThrow(ArtifactIntegrityError);
  });
});
