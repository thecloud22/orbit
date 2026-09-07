import type { SopPublicationView } from '@orbit/api/views';

import {
  canPublish,
  publicationStage,
  publicationSummary,
  type PublishFailure,
} from './publication-view-model';

/**
 * Publishing, on the review page.
 *
 * The panel offers one action and then shows a link. What it deliberately does
 * not do is change the page's own claim about the document: the "draft only"
 * notice above stays exactly where it is, because publishing does not make a
 * SOP Graph executable — it produces a separate artifact that is (ADR-016).
 */
export function SopPublishPanel(props: {
  readonly publication: SopPublicationView;
  readonly isPublishing: boolean;
  readonly failure: PublishFailure | null;
  readonly onPublish: (candidateId: string) => void;
  readonly onOpenAgent: (agentVersionId: string) => void;
}): React.JSX.Element {
  const stage = publicationStage(props.publication);

  return (
    <section className="rounded border border-slate-200 p-4" data-testid="sop-publish-panel">
      <h3 className="text-sm font-semibold text-slate-900">Running this workflow</h3>
      <p className="mt-1 text-sm text-slate-600" data-testid="sop-publish-summary">
        {publicationSummary(stage)}
      </p>

      {canPublish(stage) && stage.kind === 'publishable' ? (
        <button
          className="mt-3 rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:bg-slate-400"
          data-testid="publish-agent-button"
          disabled={props.isPublishing}
          onClick={() => {
            props.onPublish(stage.candidateId);
          }}
          type="button"
        >
          {props.isPublishing ? 'Publishing…' : 'Publish as an agent'}
        </button>
      ) : null}

      {stage.kind === 'published' ? (
        <button
          className="mt-3 rounded border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-900"
          data-testid="open-published-agent"
          onClick={() => {
            props.onOpenAgent(stage.agentVersionId);
          }}
          type="button"
        >
          Open the published agent →
        </button>
      ) : null}

      {props.failure === null ? null : (
        <p
          className="mt-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900"
          data-testid="publish-failure"
        >
          {props.failure.message}
        </p>
      )}
    </section>
  );
}
