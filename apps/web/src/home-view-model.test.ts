import type { AgentVersionView, RunListItemView, SopDocumentSummaryView } from '@orbit/api/views';
import { describe, expect, it } from 'vitest';

import {
  formatWhen,
  plural,
  recentRuns,
  RECENT_RUN_LIMIT,
  summarizeHome,
  unfinishedWorkflows,
} from './home-view-model';

function agent(overrides: Partial<AgentVersionView> = {}): AgentVersionView {
  return {
    id: 'agentv_1',
    agentId: 'agent_1',
    name: 'Find Service Request',
    version: '0.1.0',
    description: null,
    lifecycleStatus: 'published',
    inputSchema: {},
    ...overrides,
  } as AgentVersionView;
}

function run(overrides: Partial<RunListItemView> = {}): RunListItemView {
  return {
    id: 'run_1',
    status: 'succeeded',
    businessOutcome: 'request_found',
    agentVersionId: 'agentv_1',
    queuedAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:05.000Z',
    agentName: 'Find Service Request',
    agentVersion: '0.1.0',
    ...overrides,
  };
}

function document(overrides: Partial<SopDocumentSummaryView> = {}): SopDocumentSummaryView {
  return {
    documentId: 'sopdoc_1',
    title: 'Find a service request',
    status: 'draft',
    revisionCount: 1,
    stepCount: 4,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('recentRuns', () => {
  it('shows the newest first, whatever order the endpoint returned', () => {
    const rows = recentRuns([
      run({ id: 'run_old', queuedAt: '2026-01-01T00:00:00.000Z' }),
      run({ id: 'run_new', queuedAt: '2026-02-01T00:00:00.000Z' }),
    ]);

    expect(rows.map((row) => row.runId)).toEqual(['run_new', 'run_old']);
  });

  it('stops at the limit rather than reprinting the Runs page', () => {
    const rows = recentRuns(
      Array.from({ length: 12 }, (_, index) =>
        run({
          id: `run_${String(index)}`,
          queuedAt: `2026-01-${String(index + 10)}T00:00:00.000Z`,
        }),
      ),
    );

    expect(rows).toHaveLength(RECENT_RUN_LIMIT);
  });

  it('carries the server status through rather than restating it', () => {
    const [row] = recentRuns([run({ status: 'failed', businessOutcome: 'none' })]);

    expect(row?.statusLabel).toBe('Failed');
    expect(row?.tone).toBe('failure');
  });

  it('links each row to the run own page', () => {
    const [row] = recentRuns([run({ id: 'run_abc' })]);

    expect(row?.href).toBe('?runId=run_abc');
  });

  it('is empty for a deployment that has never run anything', () => {
    expect(recentRuns([])).toEqual([]);
  });
});

describe('unfinishedWorkflows', () => {
  it('counts what somebody still has to act on', () => {
    const rows = unfinishedWorkflows([
      document({ documentId: 'a', status: 'draft' }),
      document({ documentId: 'b', status: 'needs_clarification' }),
      document({ documentId: 'c', status: 'in_review' }),
    ]);

    expect(rows.map((row) => row.documentId)).toEqual(['a', 'b', 'c']);
    expect(rows.map((row) => row.statusLabel)).toEqual([
      'Draft',
      'Needs clarification',
      'In review',
    ]);
  });

  it('leaves an approved workflow alone, because this page cannot tell if it is ready', () => {
    // A document summary carries no binding state, so "approved" says nothing
    // about whether the steps have been demonstrated. Nagging about it would be
    // guessing.
    expect(unfinishedWorkflows([document({ status: 'approved' })])).toEqual([]);
  });

  it('ignores rejected and superseded workflows, which nothing waits on', () => {
    expect(
      unfinishedWorkflows([
        document({ documentId: 'r', status: 'rejected' }),
        document({ documentId: 's', status: 'superseded' }),
      ]),
    ).toEqual([]);
  });

  it('ignores a document with no revision at all', () => {
    expect(unfinishedWorkflows([document({ status: null })])).toEqual([]);
  });

  it('links each row to its review page', () => {
    const [row] = unfinishedWorkflows([document({ documentId: 'sopdoc_9' })]);

    expect(row?.href).toBe('?documentId=sopdoc_9');
  });
});

describe('summarizeHome', () => {
  it('calls a deployment fresh only when all three are empty', () => {
    expect(summarizeHome({ agentVersions: [], runs: [], documents: [] }).isFresh).toBe(true);
  });

  it('does not call a deployment with a published agent fresh, however quiet it is', () => {
    // Idle is not new. Telling someone who has already published an agent to
    // start by describing a procedure would be both wrong and patronising.
    const summary = summarizeHome({ agentVersions: [agent()], runs: [], documents: [] });

    expect(summary.isFresh).toBe(false);
    expect(summary.publishedAgents).toBe(1);
    expect(summary.totalRuns).toBe(0);
  });

  it('does not call a deployment with a half-finished draft fresh either', () => {
    expect(summarizeHome({ agentVersions: [], runs: [], documents: [document()] }).isFresh).toBe(
      false,
    );
  });

  it('reports each count from the data it was given', () => {
    const summary = summarizeHome({
      agentVersions: [agent(), agent({ id: 'agentv_2' })],
      runs: [run(), run({ id: 'run_2' }), run({ id: 'run_3' })],
      documents: [
        document({ status: 'draft' }),
        document({ documentId: 'd2', status: 'approved' }),
      ],
    });

    expect(summary).toEqual({
      publishedAgents: 2,
      totalRuns: 3,
      unfinishedWorkflows: 1,
      isFresh: false,
    });
  });
});

describe('plural', () => {
  it('agrees with its count', () => {
    expect(plural(1, 'agent')).toBe('1 agent');
    expect(plural(0, 'agent')).toBe('0 agents');
    expect(plural(2, 'run')).toBe('2 runs');
  });
});

describe('formatWhen', () => {
  const now = new Date('2026-03-01T12:00:00.000Z');

  it('reads as relative time inside a week', () => {
    expect(formatWhen('2026-03-01T11:59:30.000Z', now)).toBe('just now');
    expect(formatWhen('2026-03-01T11:55:00.000Z', now)).toBe('5 minutes ago');
    expect(formatWhen('2026-03-01T09:00:00.000Z', now)).toBe('3 hours ago');
    expect(formatWhen('2026-02-27T12:00:00.000Z', now)).toBe('2 days ago');
  });

  it('switches to a date beyond a week, which is easier to act on', () => {
    expect(formatWhen('2026-01-01T12:00:00.000Z', now)).toBe(
      new Date('2026-01-01T12:00:00.000Z').toLocaleDateString(),
    );
  });

  it('shows a malformed timestamp as-is rather than as "Invalid Date"', () => {
    expect(formatWhen('not-a-date', now)).toBe('not-a-date');
  });

  it('does not report a future timestamp as negative time ago', () => {
    expect(formatWhen('2026-06-01T12:00:00.000Z', now)).toBe(
      new Date('2026-06-01T12:00:00.000Z').toLocaleString(),
    );
  });
});
