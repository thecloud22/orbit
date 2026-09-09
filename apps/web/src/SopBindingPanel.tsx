import type { RecoveryProposalView, SopBindingsView, SopReviewStepView } from '@orbit/api/views';

import { suggestedStartUrl } from './binding-session-view-model';
import {
  bindActionLabel,
  bindingRows,
  canBindStep,
  describeProposal,
  isFullyApproved,
  needsHumanReview,
  proposalForStep,
  summarizeBindings,
  type BindingRow,
  type BindingTone,
} from './sop-binding-view-model';

export interface SopBindingPanelProps {
  readonly steps: readonly SopReviewStepView[];
  readonly bindings: SopBindingsView | null;
  /** Opens a browser aimed at this step, or points an open one at it. */
  readonly onBind: (stepId: string) => void;
  readonly isStarting: boolean;
  /** Where a new browser would open. Null while a session is already open. */
  readonly startUrl: string | null;
  readonly onStartUrlChange: (startUrl: string) => void;
  /**
   * Whether the workflow's own `navigate` step can still be changed.
   *
   * False once the revision is no longer editable (ADR-017) — approving a
   * revision freezes its content, the same as every other field, and this one
   * is not an exception. The field itself stays usable either way; only
   * saving is gated, so a person can still aim a session at a different page
   * without that being mistaken for editing the workflow.
   */
  readonly startUrlEditable: boolean;
  readonly onSaveStartUrl: () => void;
  /**
   * Open recovery proposals for this document (ADR-033).
   *
   * Rendered inside the step each one is about rather than in a list of their
   * own: a proposal is only meaningful next to the mapping it would replace,
   * and a separate panel would make accepting one a decision taken away from
   * the thing being changed.
   */
  readonly proposals: readonly RecoveryProposalView[];
  readonly onAcceptProposal: (proposalId: string) => void;
  readonly onDismissProposal: (proposalId: string) => void;
  readonly resolvingProposalId: string | null;
  /**
   * Approving or rejecting a binding nobody has confirmed yet -- one
   * demonstrated or proposed by someone other than the person now reviewing
   * it. Every binding demonstrated through this panel is approved in the
   * same sitting, so this only ever offers on a `draft` or `needs_review`
   * row (`needsHumanReview`).
   */
  readonly onApproveBinding: (bindingId: string) => void;
  readonly onRejectBinding: (bindingId: string) => void;
  readonly reviewingBindingId: string | null;
  /**
   * The offer to demonstrate every step in one pass (ADR-035).
   *
   * Rendered inside this panel rather than above it, because a walkthrough *is*
   * a way of doing what this panel is about. As a top-level section it competed
   * with "What each step does on the page" for the same job, and a person had
   * to work out that the two were the fast and the slow route to one outcome
   * rather than two separate pieces of work.
   *
   * Passed as a node rather than as five props, so the decision this panel does
   * not own — whether there is anything left worth demonstrating, and where a
   * browser would open — stays with the page that already knows about sessions.
   */
  readonly walkthrough?: React.ReactNode;
}

const TONE_CLASSES: Readonly<Record<BindingTone, string>> = {
  neutral: 'bg-slate-100 text-slate-700',
  progress: 'bg-sky-50 text-sky-900',
  success: 'bg-emerald-50 text-emerald-900',
  attention: 'bg-amber-50 text-amber-900',
  muted: 'bg-slate-50 text-slate-500',
};

/**
 * Which steps have been mapped to a real page, how far each one got, and how
 * to map one that has not been.
 *
 * Binding a step means a person demonstrating it in a real browser. There are
 * two ways to do that and neither is the other's fallback: the recorder CLI
 * (ADR-019), and a binding session started from here, which opens the browser
 * on the machine running Orbit (ADR-027).
 *
 * What this panel still offers no way to do is bind a step that routes to a
 * person -- not a thing a browser can perform. Approving or rejecting
 * somebody else's binding it does offer: every binding demonstrated through
 * this panel is approved in the same sitting, so a `draft` or `needs_review`
 * row is exactly the one a different person or a proposal left behind.
 */
export function SopBindingPanel({
  steps,
  bindings,
  onBind,
  isStarting,
  startUrl,
  onStartUrlChange,
  startUrlEditable,
  onSaveStartUrl,
  proposals,
  onAcceptProposal,
  onDismissProposal,
  resolvingProposalId,
  onApproveBinding,
  onRejectBinding,
  reviewingBindingId,
  walkthrough,
}: SopBindingPanelProps) {
  const rows = bindingRows(steps, bindings);

  // With no rows there is no panel to draw, but the offer must not disappear
  // with it: rows are empty exactly when the bindings could not be fetched,
  // which is when a person is most likely to want to demonstrate the workflow.
  if (rows.length === 0) {
    return walkthrough === undefined ? null : <>{walkthrough}</>;
  }

  const summary = summarizeBindings(bindings);

  return (
    <section
      className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
      data-testid="sop-bindings"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">What each step does on the page</h3>
        {isFullyApproved(bindings) && (
          <span
            className="rounded bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-900"
            data-testid="sop-bindings-complete"
          >
            Every step approved
          </span>
        )}
      </div>

      {summary !== null && (
        <p className="mt-1 text-xs text-slate-600" data-testid="sop-bindings-summary">
          {summary}
        </p>
      )}

      <p className="mt-2 text-sm text-slate-700" data-testid="sop-bindings-lead">
        The workflow above says <em>what</em> to do. This is <em>where</em> — someone showed Orbit,
        in a real browser, the exact box to type in and the exact button to press for each step.
        Until a step has been shown, Orbit does not know how to perform it and will not run it.
      </p>

      <p className="mt-1 text-xs text-slate-500">
        Show a step here, or from a terminal with{' '}
        <span className="font-mono">pnpm record:binding</span>. Either way a person does it once,
        for real. A binding someone else demonstrated waits below for you to approve or reject it.
      </p>

      {walkthrough}

      {startUrl !== null &&
        (() => {
          // Dirty against the graph's own urlHint, not against whatever the
          // field happened to hold last render — the thing worth offering to
          // save is a difference from what the workflow currently says.
          const isDirty = startUrl !== suggestedStartUrl(steps);
          const canSave = startUrlEditable && isDirty;

          // The field itself never disables — overriding where a session
          // opens is real and useful whether or not it can be saved, and a
          // disabled input would remove that. What changes is everything
          // *around* it: the label names what an edit actually does, so the
          // temporary case does not read the same as the saved one at a
          // glance, before anyone reaches the caption underneath.
          return (
            <div className="mt-3 flex flex-col gap-1 text-xs text-slate-700">
              <label className="flex flex-col gap-1" htmlFor="binding-start-url">
                <span>
                  {startUrlEditable ? 'Where the browser opens' : 'Where the next session opens'}
                </span>
                <div className="flex max-w-lg gap-2">
                  <input
                    className={
                      startUrlEditable
                        ? 'w-full rounded-md border border-slate-300 px-2 py-1 text-sm'
                        : 'w-full rounded-md border border-dashed border-slate-300 bg-slate-50 px-2 py-1 text-sm'
                    }
                    data-testid="binding-start-url"
                    id="binding-start-url"
                    onChange={(event) => {
                      onStartUrlChange(event.target.value);
                    }}
                    value={startUrl}
                  />
                  {canSave && (
                    <button
                      className="shrink-0 rounded-md border border-indigo-300 px-3 py-1 text-xs font-medium text-indigo-700 transition-colors hover:border-indigo-400 hover:bg-indigo-50"
                      data-testid="binding-start-url-save"
                      onClick={onSaveStartUrl}
                      type="button"
                    >
                      Save
                    </button>
                  )}
                </div>
              </label>
              {canSave && (
                <p className="text-slate-500">
                  Saves into the workflow&apos;s own first step, as a new revision.
                </p>
              )}
              {!startUrlEditable && (
                <p className="text-slate-500" data-testid="binding-start-url-locked-note">
                  This session only — it is not saved. The workflow&apos;s own first step can no
                  longer be edited to match; it has already been approved.
                </p>
              )}
            </div>
          );
        })()}

      <ul className="mt-3 flex flex-col gap-2">
        {rows.map((row) => (
          <BindingRowItem
            isStarting={isStarting}
            key={row.stepId}
            onApproveBinding={onApproveBinding}
            onBind={onBind}
            onAcceptProposal={onAcceptProposal}
            onDismissProposal={onDismissProposal}
            onRejectBinding={onRejectBinding}
            proposal={proposalForStep(proposals, row.stepId)}
            resolvingProposalId={resolvingProposalId}
            reviewingBindingId={reviewingBindingId}
            row={row}
          />
        ))}
      </ul>
    </section>
  );
}

function BindingRowItem({
  row,
  onBind,
  isStarting,
  proposal,
  onAcceptProposal,
  onDismissProposal,
  resolvingProposalId,
  onApproveBinding,
  onRejectBinding,
  reviewingBindingId,
}: {
  readonly row: BindingRow;
  readonly onBind: (stepId: string) => void;
  readonly isStarting: boolean;
  readonly proposal: RecoveryProposalView | null;
  readonly onAcceptProposal: (proposalId: string) => void;
  readonly onDismissProposal: (proposalId: string) => void;
  readonly resolvingProposalId: string | null;
  readonly onApproveBinding: (bindingId: string) => void;
  readonly onRejectBinding: (bindingId: string) => void;
  readonly reviewingBindingId: string | null;
}) {
  // Open when the detail is the answer to a question the reader has: a stale
  // binding, a rejected one, or one the server raised issues about.
  const detailOpen = row.binding.stale || row.binding.issues.length > 0;

  return (
    <li
      className="rounded-md border border-slate-200 p-3 transition-colors hover:border-slate-300"
      data-testid="sop-binding-row"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm text-slate-900">
          <span className="mr-2 text-xs text-slate-500">{row.position}.</span>
          <span className="mr-2 font-mono text-xs text-slate-500">{row.kind}</span>
          <span data-testid="sop-binding-step">{row.label}</span>
        </p>
        <span
          className={`rounded px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[row.status.tone]}`}
          data-testid={`sop-binding-status-${row.stepId}`}
        >
          {row.status.label}
        </span>
      </div>

      <p className="mt-1 text-xs text-slate-600" data-testid="sop-binding-detail">
        {row.status.detail}
      </p>

      {canBindStep(row) ? (
        <button
          className="mt-2 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-900 transition-colors hover:border-slate-400 disabled:text-slate-400"
          data-testid={`sop-binding-bind-${row.stepId}`}
          disabled={isStarting}
          onClick={() => {
            onBind(row.stepId);
          }}
          type="button"
        >
          {isStarting ? 'Opening a browser…' : bindActionLabel(row)}
        </button>
      ) : null}

      {needsHumanReview(row) && row.binding.bindingId !== null ? (
        <div className="mt-2 flex gap-2">
          <button
            className="rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-indigo-500 disabled:bg-slate-300"
            data-testid={`sop-binding-approve-${row.stepId}`}
            disabled={reviewingBindingId !== null}
            onClick={() => {
              onApproveBinding(row.binding.bindingId!);
            }}
            type="button"
          >
            {reviewingBindingId === row.binding.bindingId ? 'Working…' : 'Approve'}
          </button>
          <button
            className="rounded-md border border-rose-300 px-2 py-1 text-xs font-medium text-rose-700 transition-colors hover:bg-rose-50 disabled:border-slate-200 disabled:text-slate-400"
            data-testid={`sop-binding-reject-${row.stepId}`}
            disabled={reviewingBindingId !== null}
            onClick={() => {
              onRejectBinding(row.binding.bindingId!);
            }}
            type="button"
          >
            Reject
          </button>
        </div>
      ) : null}

      {row.binding.supersededCount > 0 && (
        <p className="mt-1 text-xs text-slate-500" data-testid="sop-binding-history">
          Re-recorded {row.binding.supersededCount}{' '}
          {row.binding.supersededCount === 1 ? 'time' : 'times'}.
        </p>
      )}

      {/*
        Folded away unless something is actually wrong with this binding.
        Selector chains and fingerprints are how the runtime finds an element —
        real, and worth being able to read — but they are engineering output,
        and a person publishing a workflow that is working has no decision to
        make from them. A stale or contested binding is the case where they
        stop being trivia and start being the answer, so that opens by default.
      */}
      {(row.binding.selectors !== null || row.binding.fingerprint !== null) && (
        <details className="mt-2" data-testid="sop-binding-locator" open={detailOpen}>
          <summary className="cursor-pointer text-xs text-slate-500 hover:text-indigo-600">
            How this element is found
          </summary>

          {row.binding.selectors !== null && (
            <div className="mt-2" data-testid="sop-binding-selectors">
              <p className="text-xs font-medium text-slate-700">In order:</p>
              <ol className="mt-1 list-decimal pl-5 text-xs text-slate-700">
                {row.binding.selectors.map((selector) => (
                  <li key={`${selector.strategy}:${selector.value}:${selector.name ?? ''}`}>
                    <span className="font-mono">
                      {selector.strategy}={selector.value}
                      {selector.name === null ? '' : ` "${selector.name}"`}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {row.binding.fingerprint !== null && (
            <p className="mt-2 text-xs text-slate-600" data-testid="sop-binding-fingerprint">
              Approved as: {row.binding.fingerprint.role ?? 'unknown role'}
              {row.binding.fingerprint.accessibleName === null
                ? ''
                : ` "${row.binding.fingerprint.accessibleName}"`}
            </p>
          )}
        </details>
      )}

      {proposal !== null && (
        <RecoveryProposalCard
          busy={resolvingProposalId === proposal.proposalId}
          onAccept={onAcceptProposal}
          onDismiss={onDismissProposal}
          proposal={proposal}
        />
      )}

      {row.binding.issues.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-xs text-amber-900" data-testid="sop-binding-issues">
          {row.binding.issues.map((issue) => (
            <li key={issue.code}>{issue.message}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * One proposal, and the single action that resolves it.
 *
 * Accepting reuses the ordinary approve path on the server — the same
 * `create` -> `submitForReview` -> `approve` a demonstrated binding goes
 * through — rather than inventing a second way for a mapping to become live.
 * That is why there is one button here and not a small review workflow of its
 * own.
 *
 * The wording avoids implying the run was saved. It was not: the run that hit
 * this drift failed and stays failed, and what accepting buys is the *next*
 * run (ADR-033).
 */
function RecoveryProposalCard({
  proposal,
  onAccept,
  onDismiss,
  busy,
}: {
  readonly proposal: RecoveryProposalView;
  readonly onAccept: (proposalId: string) => void;
  readonly onDismiss: (proposalId: string) => void;
  readonly busy: boolean;
}) {
  const summary = describeProposal(proposal);

  return (
    <div
      className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3"
      data-testid={`recovery-proposal-${proposal.stepId}`}
    >
      <p className="text-xs font-semibold text-amber-900" data-testid="recovery-proposal-headline">
        {summary.headline}
      </p>

      <p className="mt-1 text-xs text-amber-900" data-testid="recovery-proposal-summary">
        {proposal.summary}
      </p>

      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-amber-900">
        <dt className="font-medium">Was</dt>
        <dd className="font-mono" data-testid="recovery-proposal-before">
          {summary.before}
        </dd>
        <dt className="font-medium">Now</dt>
        <dd className="font-mono" data-testid="recovery-proposal-after">
          {summary.after}
        </dd>
        {proposal.approvedFingerprint !== null && (
          <>
            <dt className="font-medium">Still</dt>
            <dd data-testid="recovery-proposal-fingerprint">
              {proposal.approvedFingerprint.role ?? 'unknown role'}
              {proposal.approvedFingerprint.accessibleName === null
                ? ''
                : ` "${proposal.approvedFingerprint.accessibleName}"`}
            </dd>
          </>
        )}
      </dl>

      <p className="mt-2 text-xs text-amber-800" data-testid="recovery-proposal-provenance">
        {summary.provenance}
      </p>

      <p className="mt-1 text-xs text-amber-800">
        The run that found this still failed, and stays failed. Accepting records a new approved
        mapping for this step, which the next published version will use.
      </p>

      <div className="mt-2 flex gap-2">
        <button
          className="rounded-md border border-amber-500 bg-white px-2 py-1 text-xs font-medium text-amber-900 transition-colors hover:border-amber-600 disabled:text-slate-400"
          data-testid={`recovery-proposal-accept-${proposal.stepId}`}
          disabled={busy}
          onClick={() => {
            onAccept(proposal.proposalId);
          }}
          type="button"
        >
          {busy ? 'Working…' : 'Accept this mapping'}
        </button>
        <button
          className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-slate-400 disabled:text-slate-400"
          data-testid={`recovery-proposal-dismiss-${proposal.stepId}`}
          disabled={busy}
          onClick={() => {
            onDismiss(proposal.proposalId);
          }}
          type="button"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
