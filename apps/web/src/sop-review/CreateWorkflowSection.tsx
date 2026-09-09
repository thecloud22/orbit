import type { ModelUsageView, SopDraftView } from '@orbit/api/views';

import { ApiErrorNotice } from '../shared/ApiErrorNotice';
import type { ApiRequestError } from '../api-client';
import type { View } from '../app/navigation';
import { RecordWorkflowForm } from './RecordWorkflowForm';
import { summarizeModelSpend, type SopDraftFailure } from './sop-draft-view-model';
import { SopDraftForm } from './SopDraftForm';
import { SopDraftPanel } from './SopDraftPanel';

export interface CreateWorkflowSectionProps {
  readonly title?: string;
  readonly onNavigate: (view: View) => void;

  readonly draft: SopDraftView | null;
  readonly draftFailure: SopDraftFailure | null;
  readonly isGeneratingDraft: boolean;
  readonly onGenerate: (sourceText: string) => void;
  readonly modelUsage: ModelUsageView | null;

  readonly isStartingRecording: boolean;
  readonly recordingError: ApiRequestError | null;
  readonly onStartRecording: (title: string, startUrl: string) => void;
}

/**
 * The two ways into a new workflow: record yourself doing it, or describe it.
 *
 * Reachable from both Home and Studio rather than owned by either. It was
 * Home-only at first, which made Studio a read-only list with nowhere to start
 * from — a person landing there to browse workflows had to leave and go back to
 * Home to make a new one. Factored out instead of copied twice: the two pages
 * showing the same two doors is the point, but they must never drift into
 * showing two different sets of doors.
 */
export function CreateWorkflowSection({
  title = 'Create a workflow',
  onNavigate,
  draft,
  draftFailure,
  isGeneratingDraft,
  onGenerate,
  modelUsage,
  isStartingRecording,
  recordingError,
  onStartRecording,
}: CreateWorkflowSectionProps) {
  return (
    <section className="flex flex-col gap-3" data-testid="create-workflow-section">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        <p className="mt-1 text-sm text-slate-600">
          {/*
            Two ways in, named as peers rather than one being the other's
            fallback: one is faster when you can describe the task, the other
            is exact when you would rather just do it once.
          */}
          Two ways in. Neither is the fallback for the other — describing is faster, showing is
          exact.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <article
          className="flex flex-col rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition-colors hover:border-indigo-300"
          data-testid="record-own-card"
        >
          <StepBadge>1st way</StepBadge>
          <h3 className="mt-2 text-sm font-semibold text-slate-900">Record yourself doing it</h3>
          <p className="mt-1 text-sm text-slate-600">
            Do the task once in a real browser. Orbit writes down every step and the exact element
            you acted on, so it knows where as well as what.
          </p>
          <div className="mt-4">
            <RecordWorkflowForm isStarting={isStartingRecording} onStart={onStartRecording} />
          </div>
        </article>

        <article
          className="flex flex-col rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition-colors hover:border-indigo-300"
          data-testid="guided-path-card"
        >
          <StepBadge>2nd way</StepBadge>
          <h3 className="mt-2 text-sm font-semibold text-slate-900">
            Describe it in your own words
          </h3>
          <p className="mt-1 text-sm text-slate-600">
            Write the procedure the way you would explain it to a new colleague. Orbit reads it and
            proposes a structured workflow you can review and correct.
          </p>
          <div className="mt-4">
            <SopDraftForm
              isGenerating={isGeneratingDraft}
              onGenerate={onGenerate}
              spend={summarizeModelSpend(modelUsage)}
            />
          </div>
        </article>
      </div>

      {recordingError !== null && (
        <ApiErrorNotice
          error={recordingError}
          testId="recording-start-error"
          title="The recording could not be started"
        />
      )}

      {draft !== null && (
        <div>
          <button
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium transition-colors hover:border-indigo-400 hover:text-indigo-700"
            data-testid="open-draft-review"
            onClick={() => onNavigate({ kind: 'review', documentId: draft.documentId })}
            type="button"
          >
            Review and edit this draft
          </button>
        </div>
      )}

      <SopDraftPanel draft={draft} failure={draftFailure} />
    </section>
  );
}

function StepBadge({ children }: { readonly children: React.ReactNode }) {
  return (
    <span className="w-fit rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
      {children}
    </span>
  );
}
