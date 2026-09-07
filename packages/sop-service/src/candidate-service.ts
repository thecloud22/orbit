import { ALLOWED_HOSTS_FOR_COMPILATION } from './allowed-hosts';
import {
  assessSandboxReadiness,
  compileCandidate,
  type CompileRefusal,
  type OutcomeMapping,
} from '@orbit/agent-ir-compiler';
import type { AgentIrCandidateId, SopDocumentId } from '@orbit/contracts';
import { createRepositories, type AgentIrCandidateRecord, type OrbitDatabase } from '@orbit/db';

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
      readonly reason: 'refused';
      readonly refusals: readonly CompileRefusal[];
    };

export interface CompileDocumentInput {
  readonly documentId: SopDocumentId;
  readonly outcomeMapping: OutcomeMapping;
  readonly agentId: string;
  readonly version: string;
}

export interface SopCandidateService {
  compileDocument(input: CompileDocumentInput): Promise<CompileDocumentResult>;
  approve(id: AgentIrCandidateId, note?: string): Promise<AgentIrCandidateRecord>;
  reject(id: AgentIrCandidateId, note?: string): Promise<AgentIrCandidateRecord>;
  current(documentId: SopDocumentId): Promise<AgentIrCandidateRecord | null>;
}

export function createSopCandidateService(options: {
  readonly database: OrbitDatabase;
}): SopCandidateService {
  const repositories = createRepositories(options.database);

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

      // Only approved mappings are compiled. A draft binding is somebody's work
      // in progress, and compiling one would put an unreviewed claim about a
      // real page into the document 2.6 publishes.
      const bindings = (await repositories.executionBindings.listCurrent(input.documentId)).filter(
        (record) => record.state === 'approved',
      );

      const compiled = compileCandidate({
        graph: revision.graph,
        bindings: bindings.map((record) => record.binding),
        outcomeMapping: input.outcomeMapping,
        allowedHosts: ALLOWED_HOSTS_FOR_COMPILATION,
        agentId: input.agentId,
        version: input.version,
        sopId: input.documentId,
        sopVersion: String(revision.revisionNumber),
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
        outcomeMapping: input.outcomeMapping,
        compiledFromBindingIds: bindings.map((record) => record.id),
        secretInputIds: compiled.secretInputIds,
        sandboxState: readiness.ok ? 'ready' : 'cannot_validate',
        ...(readiness.ok ? {} : { sandboxNote: readiness.message }),
      });

      return { ok: true, candidate };
    },

    approve(id, note) {
      return repositories.agentIrCandidates.approve(
        id,
        note === undefined ? undefined : { reviewNote: note },
      );
    },

    reject(id, note) {
      return repositories.agentIrCandidates.reject(
        id,
        note === undefined ? undefined : { reviewNote: note },
      );
    },

    current(documentId) {
      return repositories.agentIrCandidates.findCurrent(documentId);
    },
  };
}
