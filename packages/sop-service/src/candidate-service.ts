import { importOpenApi, type ApiCatalog } from '@orbit/api-catalog';
import { parse as parseYaml } from 'yaml';
import {
  assessSandboxReadiness,
  compileCandidate,
  type CompileRefusal,
} from '@orbit/agent-ir-compiler';
import type { AgentIrCandidateId, SopDocumentId } from '@orbit/contracts';
import {
  CandidateNotValidatedError,
  createRepositories,
  InvalidRunTransitionError,
  RecordNotFoundError,
  type AgentIrCandidateRecord,
  type CandidateSandboxState,
  type OrbitDatabase,
  type SopRevisionState,
} from '@orbit/db';

/**
 * Turning a reviewed workflow into a candidate agent, and persisting it.
 *
 * This is where the pure compiler meets storage. The compiler decides whether a
 * document *can* become an agent; this decides what is recorded about the
 * attempt, and it records a refusal as a refusal rather than as an error — a
 * workflow that cannot be compiled yet is an ordinary state of affairs, not a
 * fault.
 */

export type CompileDocumentResult =
  | { readonly ok: true; readonly candidate: AgentIrCandidateRecord }
  | { readonly ok: false; readonly reason: 'not_found' }
  | { readonly ok: false; readonly reason: 'no_approved_revision' }
  | {
      readonly ok: false;
      readonly reason: 'revision_not_approved';
      readonly state: SopRevisionState;
    }
  | {
      readonly ok: false;
      readonly reason: 'refused';
      readonly refusals: readonly CompileRefusal[];
    };

export interface CompileDocumentInput {
  readonly documentId: SopDocumentId;
}

export type ApproveCandidateResult =
  | { readonly ok: true; readonly candidate: AgentIrCandidateRecord }
  | { readonly ok: false; readonly reason: 'not_found' }
  | {
      readonly ok: false;
      readonly reason: 'not_ready';
      readonly sandboxState: CandidateSandboxState;
    }
  | { readonly ok: false; readonly reason: 'illegal_transition'; readonly state: string };

export type RejectCandidateResult =
  | { readonly ok: true; readonly candidate: AgentIrCandidateRecord }
  | { readonly ok: false; readonly reason: 'not_found' }
  | { readonly ok: false; readonly reason: 'illegal_transition'; readonly state: string };

export interface SopCandidateService {
  compileDocument(input: CompileDocumentInput): Promise<CompileDocumentResult>;
  approve(id: AgentIrCandidateId, note?: string): Promise<ApproveCandidateResult>;
  reject(id: AgentIrCandidateId, note?: string): Promise<RejectCandidateResult>;
  current(documentId: SopDocumentId): Promise<AgentIrCandidateRecord | null>;
}

/**
 * The agent identity a document compiles under.
 *
 * Derived rather than generated, and deliberately stable across recompiles: a
 * person recompiling the same document after fixing a binding must land under
 * the *same* agent, or `publish-service`'s per-agent version numbering and its
 * "already published" check would both silently fragment across what a
 * reviewer experiences as one workflow. Stripping the document's own prefix
 * keeps the mapping a pure function of the document id, with no state of its
 * own to drift — the same reasoning `stepChecksum` and the recording session
 * ids elsewhere in this codebase already follow.
 */
function agentIdForDocument(documentId: SopDocumentId): string {
  return `agent_${documentId.replace(/^sopdoc_/, '')}`;
}

export function createSopCandidateService(options: {
  readonly database: OrbitDatabase;
}): SopCandidateService {
  const repositories = createRepositories(options.database);

  /**
   * The registered API contracts, imported fresh.
   *
   * A system whose document no longer imports is skipped rather than throwing:
   * one broken registration must not stop every other workflow compiling, and
   * the step that needed it refuses by name anyway.
   */
  async function loadRegisteredCatalogs(): Promise<Record<string, ApiCatalog>> {
    const catalogs: Record<string, ApiCatalog> = {};

    for (const system of await repositories.apiSystems.list()) {
      let document: unknown;

      try {
        document = parseYaml(system.specText);
      } catch {
        continue;
      }

      const imported = importOpenApi(system.catalogId, document);

      if (imported.ok) {
        catalogs[system.catalogId] = imported.catalog;
      }
    }

    return catalogs;
  }

  /**
   * The race-condition fallback shared by `approve` and `reject`.
   *
   * Both pre-check the candidate's state so the ordinary case never throws,
   * but a pre-check alone leaves a window between the read and the write for a
   * second concurrent request. This is what closes it: the repository's own
   * transition guard still runs, and whatever it throws is turned into the
   * same typed result the pre-check would have returned had it seen the race.
   */
  function asTransitionResult(
    error: unknown,
  ):
    | { readonly ok: false; readonly reason: 'not_found' }
    | { readonly ok: false; readonly reason: 'illegal_transition'; readonly state: string } {
    if (error instanceof RecordNotFoundError) {
      return { ok: false, reason: 'not_found' };
    }

    if (error instanceof InvalidRunTransitionError) {
      return { ok: false, reason: 'illegal_transition', state: error.message };
    }

    throw error;
  }

  return {
    async compileDocument(input) {
      const document = await repositories.sopDocuments.findById(input.documentId);

      if (document === null) {
        return { ok: false, reason: 'not_found' };
      }

      const revision = await repositories.sopGraphRevisions.findCurrent(input.documentId);

      if (revision === null) {
        return { ok: false, reason: 'no_approved_revision' };
      }

      // A workflow is compiled from what a reviewer actually approved, never
      // from a draft in progress. `findCurrent` returns the newest revision in
      // any state short of superseded — this is the check that was missing:
      // without it, an in-review or rejected graph could become a candidate,
      // which is the SOP review lifecycle (ADR-017) being bypassed by the one
      // caller positioned to bypass it silently.
      if (revision.state !== 'approved') {
        return { ok: false, reason: 'revision_not_approved', state: revision.state };
      }

      // Only approved mappings are compiled. A draft binding is somebody's work
      // in progress, and compiling one would put an unreviewed claim about a
      // real page into the document 2.6 publishes.
      const bindings = (await repositories.executionBindings.listCurrent(input.documentId)).filter(
        (record) => record.state === 'approved',
      );

      const compiled = compileCandidate({
        graph: revision.graph,
        bindings: bindings.map((record) => record.binding),
        agentId: agentIdForDocument(input.documentId),
        // Thrown away entirely at publish, which allocates the real number per
        // agent (ADR-023) — never shown to a reviewer and never meant to be.
        version: '0.0.0',
        sopId: input.documentId,
        sopVersion: String(revision.revisionNumber),
        // The document's grant, frozen into the version at compile time. A
        // document whose grant is later withdrawn cannot retract it from
        // versions already published, which is why it is expressed in the IR
        // rather than consulted at run time (ADR-005, ADR-033).
        recoveryAllowed: document.recoveryEnabled,
        // Read at compile time rather than at boot: registering a system in
        // Admin has to take effect without restarting the API, and a contract
        // re-registered after a version was published must not disturb it --
        // the version's grant is compiled in and immutable (ADR-005, ADR-037).
        catalogs: await loadRegisteredCatalogs(),
      });

      if (!compiled.ok) {
        return { ok: false, reason: 'refused', refusals: compiled.refusals };
      }

      // Assessed before anything is stored, so the record says from the outset
      // whether this could ever have been checked.
      const readiness = assessSandboxReadiness(compiled.agentIr, compiled.secretInputIds);

      const candidate = await repositories.agentIrCandidates.create({
        documentId: input.documentId,
        revisionId: revision.id,
        agentIr: compiled.agentIr,
        compiledFromBindingIds: bindings.map((record) => record.id),
        secretInputIds: compiled.secretInputIds,
        sandboxState: readiness.ok ? 'ready' : 'cannot_validate',
        ...(readiness.ok ? {} : { sandboxNote: readiness.message }),
      });

      return { ok: true, candidate };
    },

    async approve(id, note) {
      // Read first so the ordinary failures come back as typed results rather
      // than a caught exception: this is now reached over HTTP (previously
      // only from tests), and a route translating a thrown DatabaseError into
      // an HTTP response is exactly the seam that produces an ugly 500 for an
      // ordinary "not ready yet".
      const existing = await repositories.agentIrCandidates.findById(id);

      if (existing === null) {
        return { ok: false, reason: 'not_found' };
      }

      if (existing.state !== 'compiled') {
        return { ok: false, reason: 'illegal_transition', state: existing.state };
      }

      if (existing.sandboxState !== 'ready') {
        return { ok: false, reason: 'not_ready', sandboxState: existing.sandboxState };
      }

      try {
        const candidate = await repositories.agentIrCandidates.approve(
          id,
          note === undefined ? undefined : { reviewNote: note },
        );
        return { ok: true, candidate };
      } catch (error) {
        // Sandbox state never changes after a candidate is created, so this
        // pre-check's outcome and the repository's own re-check cannot
        // disagree in practice — but "cannot happen" is not the same claim as
        // "cannot throw", and an uncaught error here would surface as a raw
        // 500 for what is still an ordinary refusal.
        if (error instanceof CandidateNotValidatedError) {
          return { ok: false, reason: 'not_ready', sandboxState: existing.sandboxState };
        }
        return asTransitionResult(error);
      }
    },

    async reject(id, note) {
      const existing = await repositories.agentIrCandidates.findById(id);

      if (existing === null) {
        return { ok: false, reason: 'not_found' };
      }

      // Rejection has no readiness precondition: refusing something nobody
      // could check is exactly what a reviewer should be able to do.
      if (existing.state !== 'compiled') {
        return { ok: false, reason: 'illegal_transition', state: existing.state };
      }

      try {
        const candidate = await repositories.agentIrCandidates.reject(
          id,
          note === undefined ? undefined : { reviewNote: note },
        );
        return { ok: true, candidate };
      } catch (error) {
        return asTransitionResult(error);
      }
    },

    current(documentId) {
      return repositories.agentIrCandidates.findCurrent(documentId);
    },
  };
}
