import type { SopDocumentId } from '@orbit/contracts';
import {
  stepChecksum,
  withTransaction,
  type ExecutionBindingRecord,
  type OrbitDatabase,
  type SopDocumentRecord,
  type SopGraphRevisionRecord,
} from '@orbit/db';
import { EXECUTION_BINDING_SCHEMA_VERSION, type ExecutionBinding } from '@orbit/execution-mapping';
import { translateRecording, type RecordedEntry } from '@orbit/sop-recording';
import type { SopGraphIssue } from '@orbit/sop-graph';

/**
 * A recording becomes a document.
 *
 * The composition root for recorded workflows: translation is
 * @orbit/sop-recording's, persistence is @orbit/db's, and this is the only
 * place they meet — the same arrangement `draft-service.ts` uses for generated
 * ones, and the reason a recorded document is stored identically to a
 * free-text one and needs no special handling in the review page.
 *
 * Bindings land **approved**, and that is not a bypass. They are driven through
 * the real lifecycle — created as drafts, submitted, approved — because a
 * person has just interactively performed and confirmed the whole sequence, so
 * the approval already happened; it happened with their hands rather than with
 * a button. Every transition the repository enforces still applies.
 */

export interface CreateRecordedDocumentInput {
  readonly title: string;
  readonly startUrl: string;
  readonly sequence: readonly RecordedEntry[];
}

export type CreateRecordedDocumentResult =
  | {
      readonly ok: true;
      readonly document: SopDocumentRecord;
      readonly revision: SopGraphRevisionRecord;
      readonly bindings: readonly ExecutionBindingRecord[];
    }
  | {
      readonly ok: false;
      readonly reason: 'invalid_recording';
      readonly issues: readonly SopGraphIssue[];
    };

export interface SopRecordingService {
  createFromRecording(input: CreateRecordedDocumentInput): Promise<CreateRecordedDocumentResult>;
}

export function createSopRecordingService(options: {
  readonly database: OrbitDatabase;
}): SopRecordingService {
  return {
    async createFromRecording(input) {
      const translated = translateRecording({ title: input.title, sequence: input.sequence });

      if (!translated.ok) {
        return { ok: false, reason: 'invalid_recording', issues: translated.issues };
      }

      const { graph, steps } = translated;

      // Document, revision and every binding land together or not at all. A
      // document whose steps exist without their bindings would look mapped and
      // not be.
      return withTransaction(options.database, async (repositories) => {
        const document = await repositories.sopDocuments.create({
          title: graph.title,
          // The recording *is* the source. There is no prose to keep, so this
          // records what was done rather than leaving the field empty.
          sourceText: `Recorded from ${input.startUrl} — ${input.sequence.length} interactions.`,
        });

        const revision = await repositories.sopGraphRevisions.create({
          documentId: document.id,
          graph,
          provenance: {
            kind: 'recorded',
            recordedFromUrl: input.startUrl,
            recordedActionCount: input.sequence.length,
          },
        });

        const bindings: ExecutionBindingRecord[] = [];

        for (const entry of steps) {
          if (entry.binding === undefined) {
            continue;
          }

          const binding: ExecutionBinding = {
            schemaVersion: EXECUTION_BINDING_SCHEMA_VERSION,
            stepId: entry.step.id,
            body: entry.binding,
            capturedAgainstRevisionId: revision.id,
            // The one definition, shared with the compiler that will later
            // trust it (ADR-018).
            stepSha256: stepChecksum(entry.step),
          };

          const created = await repositories.executionBindings.create({
            documentId: document.id,
            binding,
          });

          // Through the lifecycle, never around it: the repository refuses
          // draft -> approved, and writing a state the application cannot
          // otherwise produce would make the state machine advisory.
          await repositories.executionBindings.submitForReview(created.id);

          bindings.push(
            await repositories.executionBindings.approve(created.id, {
              reviewNote: 'Approved by performing the step during recording.',
            }),
          );
        }

        return { ok: true, document, revision, bindings };
      });
    },
  };
}

export type { RecordedEntry, SopDocumentId };
