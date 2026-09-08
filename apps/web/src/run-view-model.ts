import type { ArtifactView, RunDetailView } from '@orbit/api/views';
import {
  NO_BUSINESS_OUTCOME,
  type BusinessOutcome,
  type OrbitError,
  type RunOutputs,
  type RunStatus,
} from '@orbit/contracts';

/**
 * Every state decision Watchtower makes, as pure functions.
 *
 * The components below this file render what these return and decide nothing on
 * their own, so the rules that matter — that a run is only "succeeded" because
 * the server said so, that a not-found request is a business outcome and not a
 * failure, that polling stops at a terminal state — are testable without a DOM
 * and cannot drift between one component and another.
 */

export type StatusTone = 'neutral' | 'progress' | 'success' | 'attention' | 'failure';

export interface RunStatusDescription {
  readonly label: string;
  readonly tone: StatusTone;
  readonly detail: string;
  readonly isTerminal: boolean;
}

/** One tone-to-colour mapping, reused everywhere a run's status gets a badge. */
export const STATUS_BADGE_CLASSES: Readonly<Record<StatusTone, string>> = {
  neutral: 'bg-slate-100 text-slate-700',
  progress: 'bg-sky-100 text-sky-800',
  success: 'bg-emerald-100 text-emerald-800',
  attention: 'bg-amber-100 text-amber-900',
  failure: 'bg-rose-100 text-rose-800',
};

const TERMINAL_STATUSES: readonly RunStatus[] = ['succeeded', 'failed', 'cancelled'];

export function isTerminalStatus(status: RunStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** An outcome identifier as prose: `request_not_found` reads "request not found". */
export function outcomeLabel(outcome: BusinessOutcome): string {
  return outcome.replaceAll('_', ' ');
}

/**
 * Technical status and business outcome are separate (ADR-006), and the UI must
 * not blur them: a run that correctly established the request does not exist is
 * a *successful* run whose outcome happens to be `request_not_found`. It is
 * never shown as a failure.
 *
 * The outcome is reported, not interpreted. It used to be one of two names
 * inherited from the Phase 1 demo, so this could special-case `request_not_found`
 * into an "attention" state and write a sentence about service requests. An
 * outcome is now whatever the workflow's own outcome step declares (ADR-030) —
 * `borrowed`, `held`, `escalated` — and Watchtower has no basis for deciding
 * which of a stranger's business conclusions deserves a warning colour. Naming
 * it is the honest thing this can do; judging it would be guessing.
 */
export function describeRunStatus(run: {
  readonly status: RunStatus;
  readonly businessOutcome: BusinessOutcome;
}): RunStatusDescription {
  const isTerminal = isTerminalStatus(run.status);

  switch (run.status) {
    case 'queued':
      return {
        label: 'Queued',
        tone: 'progress',
        detail: 'The run has been created and is waiting to start.',
        isTerminal,
      };
    case 'running':
      return {
        label: 'Running',
        tone: 'progress',
        detail: 'The agent is executing against the demo portal.',
        isTerminal,
      };
    case 'succeeded':
      return {
        label:
          run.businessOutcome === NO_BUSINESS_OUTCOME
            ? 'Succeeded'
            : `Succeeded — ${outcomeLabel(run.businessOutcome)}`,
        tone: 'success',
        detail:
          run.businessOutcome === NO_BUSINESS_OUTCOME
            ? 'The agent completed the procedure and recorded its evidence.'
            : `The agent completed the procedure and reached the outcome "${run.businessOutcome}". This is the workflow's own conclusion, not a judgement about it.`,
        isTerminal,
      };
    case 'failed':
      return {
        label: 'Failed',
        tone: 'failure',
        detail: 'The run stopped on a technical failure. The recorded error is shown below.',
        isTerminal,
      };
    case 'cancelled':
      return {
        label: 'Cancelled',
        tone: 'neutral',
        detail: 'The run was cancelled.',
        isTerminal,
      };
  }
}

/** Polling continues only while the server says the run is not finished. */
export function shouldPollRun(run: { readonly status: RunStatus } | null): boolean {
  return run !== null && !isTerminalStatus(run.status);
}

export interface OutputRow {
  readonly key: string;
  readonly label: string;
  readonly value: string;
}

/** `assignedTeam` reads as "Assigned team" without a hand-maintained label map. */
export function humanizeKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function summarizeOutputs(outputs: RunOutputs | null): readonly OutputRow[] {
  if (outputs === null) {
    return [];
  }

  return Object.entries(outputs).map(([key, value]) => ({
    key,
    label: humanizeKey(key),
    value,
  }));
}

export interface ErrorDescription {
  readonly code: string;
  readonly message: string;
  readonly details: readonly { readonly field: string; readonly message: string }[];
}

export function describeError(error: OrbitError | null): ErrorDescription | null {
  if (error === null) {
    return null;
  }

  return { code: error.code, message: error.message, details: error.details ?? [] };
}

export type EvidenceAction = 'preview' | 'download';

export interface EvidenceItem {
  readonly id: string;
  readonly label: string;
  readonly kind: ArtifactView['kind'];
  readonly action: EvidenceAction;
  readonly url: string;
  readonly sizeLabel: string;
  readonly contentType: string;
  readonly digest: string;
  readonly roles: readonly string[];
}

const EVIDENCE_LABELS: Record<ArtifactView['kind'], string> = {
  browser_screenshot: 'Screenshot',
  dom_snapshot: 'HTML snapshot',
  browser_trace: 'Playwright trace',
  extracted_json: 'Extracted data',
  error_context: 'Error context',
  decision_input: 'What the judge was shown',
};

/**
 * Only a screenshot is previewed in place. An HTML snapshot is a captured copy
 * of another page, so it is offered as a download that the browser opens in its
 * own context — never rendered inside Watchtower.
 */
export function describeEvidence(artifacts: readonly ArtifactView[]): readonly EvidenceItem[] {
  return artifacts.map((artifact) => ({
    id: artifact.id,
    label: EVIDENCE_LABELS[artifact.kind],
    kind: artifact.kind,
    action: artifact.kind === 'browser_screenshot' ? 'preview' : 'download',
    url: artifact.url,
    sizeLabel: formatBytes(artifact.sizeBytes),
    contentType: artifact.contentType,
    digest: `${artifact.sha256.slice(0, 12)}…`,
    roles: artifact.roles,
  }));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type EvidenceFailure = 'missing' | 'integrity' | 'unavailable';

/**
 * Distinguishes "this evidence is not there" from "this evidence is there but no
 * longer matches its digest". The second is an integrity problem and must not be
 * shown as a plain missing file.
 */
export function classifyEvidenceFailure(status: number, code?: string): EvidenceFailure {
  if (status === 404) {
    return 'missing';
  }
  if (code === 'ARTIFACT_STORAGE_ERROR') {
    return 'integrity';
  }
  return 'unavailable';
}

export const EVIDENCE_FAILURE_MESSAGES: Record<EvidenceFailure, string> = {
  missing: 'This evidence is not available for this run.',
  integrity:
    'This evidence failed integrity verification on the server and was not served. The stored bytes no longer match the digest recorded when the run captured them.',
  unavailable: 'This evidence could not be loaded.',
};

export interface RunProgress {
  readonly completedSteps: number;
  readonly totalSteps: number;
  readonly failedStep: string | null;
}

export function summarizeProgress(run: RunDetailView): RunProgress {
  const failed = run.steps.find((step) => step.status === 'failed');

  return {
    completedSteps: run.steps.filter((step) => step.status === 'succeeded').length,
    totalSteps: run.steps.length,
    failedStep: failed?.agentStepId ?? null,
  };
}
