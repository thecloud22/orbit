import {
  agentIdSchema,
  agentVersionIdSchema,
  artifactIdSchema,
  artifactLinkIdSchema,
  eventIdSchema,
  requestIdSchema,
  runIdSchema,
  runStepIdSchema,
  sopAnswerIdSchema,
  sopDocumentIdSchema,
  sopRevisionIdSchema,
  type AgentId,
  type AgentVersionId,
  type ArtifactId,
  type ArtifactLinkId,
  type EventId,
  type RequestId,
  type RunId,
  type RunStepId,
  type SopAnswerId,
  type SopDocumentId,
  type SopRevisionId,
} from './ids';

/**
 * Opaque ID generation.
 *
 * Orbit IDs are ULID-shaped: a 48-bit millisecond timestamp followed by 80 bits
 * of randomness, Crockford base32. That buys two properties evidence needs.
 * IDs sort by creation time, so a raw table scan or a log grep reads in the
 * order things happened; and they carry no database sequence, so nothing about
 * Orbit's storage leaks into a public identifier.
 *
 * An ID is never the ordering *authority* — `run_events.sequence` is (see the
 * events contract). Sortability is a convenience for humans reading evidence.
 *
 * No dependency is added for this: @orbit/contracts stays Zod-only, and the
 * randomness comes from the standard `crypto` global rather than `node:crypto`,
 * so the package remains free of Node built-ins.
 */

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ENCODING_LENGTH = 32;
const TIME_LENGTH = 10;
const RANDOM_LENGTH = 16;

function encodeTime(milliseconds: number): string {
  let remaining = milliseconds;
  let encoded = '';

  for (let index = 0; index < TIME_LENGTH; index += 1) {
    encoded = ENCODING[remaining % ENCODING_LENGTH] + encoded;
    remaining = Math.floor(remaining / ENCODING_LENGTH);
  }

  return encoded;
}

function randomSuffix(): string {
  const bytes = new Uint8Array(RANDOM_LENGTH);
  crypto.getRandomValues(bytes);

  // 256 is an exact multiple of 32, so masking the low five bits is uniform.
  let encoded = '';
  for (const byte of bytes) {
    encoded += ENCODING[byte & 31];
  }
  return encoded;
}

/**
 * Increments a base32 suffix, carrying left. Returns undefined when every
 * character is already the maximum, in which case the caller waits for the
 * clock rather than emitting a non-monotonic ID.
 */
function incrementSuffix(suffix: string): string | undefined {
  const characters = [...suffix];

  for (let index = characters.length - 1; index >= 0; index -= 1) {
    const value = ENCODING.indexOf(characters[index] as string);

    if (value < ENCODING_LENGTH - 1) {
      characters[index] = ENCODING[value + 1] as string;
      return characters.join('');
    }

    characters[index] = ENCODING[0] as string;
  }

  return undefined;
}

let lastMilliseconds = -1;
let lastSuffix = '';

/**
 * Two IDs generated in the same millisecond would otherwise sort arbitrarily,
 * which is precisely the case that matters when a run writes several events at
 * once. Within a millisecond the suffix is incremented instead of re-rolled, so
 * generation order and sort order agree.
 */
function monotonicUlid(): string {
  const now = Date.now();

  if (now === lastMilliseconds) {
    const incremented = incrementSuffix(lastSuffix);
    if (incremented !== undefined) {
      lastSuffix = incremented;
      return encodeTime(now) + lastSuffix;
    }
    // Exhausting 80 bits inside one millisecond is not reachable in practice;
    // falling through re-rolls rather than returning a duplicate.
  }

  lastMilliseconds = now;
  lastSuffix = randomSuffix();
  return encodeTime(now) + lastSuffix;
}

/** The raw, unprefixed ULID body. Exported for tests and for composing IDs. */
export function generateUlid(): string {
  return monotonicUlid();
}

export function newAgentId(): AgentId {
  return agentIdSchema.parse(`agent_${monotonicUlid()}`);
}

export function newAgentVersionId(): AgentVersionId {
  return agentVersionIdSchema.parse(`agentv_${monotonicUlid()}`);
}

export function newRunId(): RunId {
  return runIdSchema.parse(`run_${monotonicUlid()}`);
}

export function newRunStepId(): RunStepId {
  return runStepIdSchema.parse(`rstep_${monotonicUlid()}`);
}

export function newEventId(): EventId {
  return eventIdSchema.parse(`evt_${monotonicUlid()}`);
}

export function newArtifactId(): ArtifactId {
  return artifactIdSchema.parse(`art_${monotonicUlid()}`);
}

export function newArtifactLinkId(): ArtifactLinkId {
  return artifactLinkIdSchema.parse(`artl_${monotonicUlid()}`);
}

export function newRequestId(): RequestId {
  return requestIdSchema.parse(`req_${monotonicUlid()}`);
}

export function newSopDocumentId(): SopDocumentId {
  return sopDocumentIdSchema.parse(`sopdoc_${monotonicUlid()}`);
}

export function newSopRevisionId(): SopRevisionId {
  return sopRevisionIdSchema.parse(`soprev_${monotonicUlid()}`);
}

export function newSopAnswerId(): SopAnswerId {
  return sopAnswerIdSchema.parse(`sopans_${monotonicUlid()}`);
}
