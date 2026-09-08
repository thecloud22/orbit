import type { AgentVersionView, RunListItemView, SopDocumentSummaryView } from '@orbit/api/views';

import { searchForView } from './navigation';
import { describeRunStatus, type StatusTone } from './run-view-model';

/**
 * What the home page knows, as pure functions.
 *
 * The page renders what these return and decides nothing. That matters more
 * here than on most pages, because the interesting behaviour is entirely in the
 * judgements: what counts as "waiting for you" in Studio, whether a deployment
 * is genuinely new or merely quiet, and how many recent runs are worth showing.
 * All three are testable without a DOM.
 *
 * Nothing here fetches. Everything comes from three endpoints that already
 * existed — `GET /v1/agent-versions`, `GET /v1/runs`, `GET /v1/sop-documents` —
 * and no endpoint was added for this page.
 */

/** How many recent runs the home page shows before sending the reader to Runs. */
export const RECENT_RUN_LIMIT = 5;

/** How many unfinished workflows the home page names before summarising the rest. */
export const UNFINISHED_WORKFLOW_LIMIT = 4;

export interface HomeData {
  readonly agentVersions: readonly AgentVersionView[];
  readonly runs: readonly RunListItemView[];
  readonly documents: readonly SopDocumentSummaryView[];
}

export interface RecentRunRow {
  readonly runId: string;
  readonly agentLabel: string;
  readonly statusLabel: string;
  readonly tone: StatusTone;
  readonly when: string;
  readonly href: string;
}

export function recentRuns(runs: readonly RunListItemView[]): readonly RecentRunRow[] {
  return [...runs]
    .sort((left, right) => right.queuedAt.localeCompare(left.queuedAt))
    .slice(0, RECENT_RUN_LIMIT)
    .map((run) => {
      const status = describeRunStatus(run);

      return {
        runId: run.id,
        agentLabel: `${run.agentName} ${run.agentVersion}`,
        statusLabel: status.label,
        tone: status.tone,
        when: formatWhen(run.queuedAt),
        href: searchForView({ kind: 'run', runId: run.id }),
      };
    });
}

/**
 * Which statuses mean "somebody still has to do something here".
 *
 * `approved` is deliberately absent: an approved revision is finished as a
 * *document*, and whether its steps have been demonstrated is a separate
 * question this page cannot answer from a summary — the document list carries
 * no binding state. Claiming an approved workflow is ready would be guessing,
 * and claiming it is unfinished would nag about something already done. It is
 * counted as neither.
 *
 * `superseded` and `rejected` are also absent: nothing is waiting on either.
 */
const UNFINISHED_STATUSES = ['draft', 'needs_clarification', 'in_review'];

export interface UnfinishedWorkflowRow {
  readonly documentId: string;
  readonly title: string;
  readonly statusLabel: string;
  readonly href: string;
}

const STATUS_LABELS: Readonly<Record<string, string>> = {
  draft: 'Draft',
  needs_clarification: 'Needs clarification',
  in_review: 'In review',
};

export function unfinishedWorkflows(
  documents: readonly SopDocumentSummaryView[],
): readonly UnfinishedWorkflowRow[] {
  return [...documents]
    .filter((document) => document.status !== null && UNFINISHED_STATUSES.includes(document.status))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map((document) => ({
      documentId: document.documentId,
      title: document.title,
      statusLabel:
        document.status === null
          ? 'No revision'
          : (STATUS_LABELS[document.status] ?? document.status),
      href: searchForView({ kind: 'review', documentId: document.documentId }),
    }));
}

export interface HomeSummary {
  readonly publishedAgents: number;
  readonly totalRuns: number;
  readonly unfinishedWorkflows: number;
  /**
   * Whether this deployment has nothing at all yet.
   *
   * All three empty, not just one: a deployment with agents but no runs is not
   * new, it is idle, and telling someone who has already published an agent
   * "start by describing a procedure" would be both wrong and patronising.
   */
  readonly isFresh: boolean;
}

export function summarizeHome(data: HomeData): HomeSummary {
  const unfinished = unfinishedWorkflows(data.documents).length;

  return {
    publishedAgents: data.agentVersions.length,
    totalRuns: data.runs.length,
    unfinishedWorkflows: unfinished,
    isFresh:
      data.agentVersions.length === 0 && data.runs.length === 0 && data.documents.length === 0,
  };
}

/** `12` reads "12"; a count with a noun reads "12 agents". */
export function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * A timestamp as something a person can read at a glance.
 *
 * Relative up to a week, because "3 minutes ago" is what someone watching a run
 * they just started wants; absolute beyond that, because "23 days ago" is
 * harder to act on than a date. A malformed timestamp is shown as-is rather
 * than as "Invalid Date" — the raw value is at least a clue.
 */
export function formatWhen(iso: string, now: Date = new Date()): string {
  const parsed = new Date(iso);

  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }

  const elapsed = now.getTime() - parsed.getTime();

  if (elapsed < 0) {
    return parsed.toLocaleString();
  }

  const minutes = Math.floor(elapsed / 60_000);

  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${plural(minutes, 'minute')} ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${plural(hours, 'hour')} ago`;
  }

  const days = Math.floor(hours / 24);

  if (days < 7) {
    return `${plural(days, 'day')} ago`;
  }

  return parsed.toLocaleDateString();
}
