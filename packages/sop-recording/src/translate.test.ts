import { buttonFingerprint, fieldFingerprint } from '@orbit/execution-mapping/testing';
import type { SelectorChain } from '@orbit/execution-mapping';
import { parseSopGraphDocument } from '@orbit/sop-graph';
import { describe, expect, it } from 'vitest';

import { translateRecording, type RecordedEntry } from './translate';

const BUTTON = [
  { strategy: 'test_id', value: 'search-request-button' },
  { strategy: 'role_and_name', value: 'button', name: 'Search' },
] as SelectorChain;

const FIELD = [{ strategy: 'test_id', value: 'request-number-input' }] as SelectorChain;

/** The sequence a person actually performs on the demo portal. */
const SEQUENCE: readonly RecordedEntry[] = [
  { kind: 'navigate', url: 'http://localhost:3001/requests' },
  { kind: 'fill', selectors: FIELD, fingerprint: fieldFingerprint(), typedValue: 'SR-1001' },
  { kind: 'click', selectors: BUTTON, fingerprint: buttonFingerprint() },
];

function translate(sequence: readonly RecordedEntry[] = SEQUENCE) {
  return translateRecording({ title: 'Find a service request', sequence });
}

describe('translating a recording', () => {
  it('produces one step per action, plus a terminal', () => {
    const result = translate();

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.graph.steps.map((step) => step.kind)).toEqual([
      'navigate',
      'fill',
      'click',
      'outcome',
    ]);
  });

  it('appends an outcome nobody performed, because a recording just stops', () => {
    const result = translate();
    if (!result.ok) return;

    const last = result.graph.steps.at(-1);

    expect(last?.kind).toBe('outcome');
    expect(last?.kind === 'outcome' && last.outcome).toBe('completed');
  });

  it('enters at the first thing that happened', () => {
    const result = translate();
    if (!result.ok) return;

    expect(result.graph.entryStepId).toBe(result.graph.steps[0]?.id);
  });

  it('names steps after what the element is called, not after their position', () => {
    const result = translate();
    if (!result.ok) return;

    // A reviewer reads these ids in the review page.
    expect(result.graph.steps.map((step) => step.id)).toEqual([
      'open_localhost',
      'enter_service_request_number',
      'click_search',
      'outcome_completed',
    ]);
  });

  it('numbers a repeated action rather than colliding', () => {
    const result = translate([SEQUENCE[2]!, SEQUENCE[2]!, SEQUENCE[2]!]);
    if (!result.ok) return;

    expect(result.graph.steps.slice(0, 3).map((step) => step.id)).toEqual([
      'click_search',
      'click_search_2',
      'click_search_3',
    ]);
  });

  it('says plainly what was done rather than inventing an intent', () => {
    const result = translate();
    if (!result.ok) return;

    const purposes = result.graph.steps.map((step) => step.purpose);

    expect(purposes[0]).toBe('Open http://localhost:3001/requests');
    expect(purposes[1]).toBe('Fill "Service request number"');
    expect(purposes[2]).toBe('Select "Search"');
  });

  it('carries the typed value into the step', () => {
    const result = translate();
    if (!result.ok) return;

    const fill = result.graph.steps.find((step) => step.kind === 'fill');
    expect(fill?.kind === 'fill' && fill.value).toBe('SR-1001');
  });

  it('binds every action step and nothing else', () => {
    const result = translate();
    if (!result.ok) return;

    const bound = result.steps.filter((entry) => entry.binding !== undefined);

    expect(bound.map((entry) => entry.binding?.kind)).toEqual(['fill', 'click']);
    // A navigate names no element and the outcome touches none.
    expect(result.steps.find((entry) => entry.step.kind === 'outcome')?.binding).toBeUndefined();
  });

  it('gives each binding the selector chain that was verified at capture time', () => {
    const result = translate();
    if (!result.ok) return;

    const click = result.steps.find((entry) => entry.binding?.kind === 'click');
    expect(click?.binding?.target.selectors).toEqual(BUTTON);
    expect(click?.binding?.target.fingerprint.accessibleName).toBe('Search');
  });

  it('produces a graph that passes the real validator unchanged', () => {
    const result = translate();
    if (!result.ok) return;

    // The gate every generated document passes through, applied to this one
    // too rather than trusting that a linear sequence must be valid.
    expect(parseSopGraphDocument(result.graph).ok).toBe(true);
  });

  it('refuses a recording with nothing in it', () => {
    const result = translateRecording({ title: 'Nothing happened', sequence: [] });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues[0]?.message).toContain('no captured actions');
  });
});

describe('a password field', () => {
  const withPassword: readonly RecordedEntry[] = [
    { kind: 'navigate', url: 'http://localhost:3001/requests' },
    {
      kind: 'fill',
      selectors: FIELD,
      fingerprint: { ...fieldFingerprint(), accessibleName: 'Password' },
      sensitive: true,
    },
  ];

  it('still becomes a step, because the field is real', () => {
    const result = translateRecording({ title: 'Sign in', sequence: withPassword });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const fill = result.graph.steps.find((step) => step.kind === 'fill');
    expect(fill?.kind === 'fill' && fill.sensitive).toBe(true);
    expect(fill?.kind === 'fill' && fill.fieldHint).toBe('Password');
  });

  it('declares a secret input and references it, rather than holding a value', () => {
    const result = translateRecording({ title: 'Sign in', sequence: withPassword });
    if (!result.ok) return;

    // The graph validator refuses a sensitive fill that holds a literal, so the
    // only valid translation is the one 2.1's rules already require: declare the
    // secret and point at it. The recording therefore arrives with its secret
    // properly declared instead of deferring that to review.
    expect(result.graph.inputs).toEqual([
      { id: 'password', label: 'Password', type: 'secret', required: true },
    ]);

    const fill = result.graph.steps.find((step) => step.kind === 'fill');
    expect(fill?.kind === 'fill' && fill.value).toBe('${inputs.password}');
  });

  it('never lets a typed password reach the graph or the binding', () => {
    const result = translateRecording({ title: 'Sign in', sequence: withPassword });
    if (!result.ok) return;

    // Nothing typed into a password box entered this process at all — the
    // recorder never read it — so there is nothing here to leak.
    expect(JSON.stringify(result)).not.toContain('hunter2');

    const binding = result.steps.find((entry) => entry.binding?.kind === 'fill')?.binding;
    expect(binding?.kind === 'fill' && binding.valueSource).toEqual({ kind: 'literal', value: '' });
  });

  it('declares one input for a field used twice, and two for different fields', () => {
    const twice = translateRecording({
      title: 'Sign in',
      sequence: [...withPassword, withPassword[1]!],
    });
    expect(twice.ok && twice.graph.inputs.length).toBe(1);

    const two = translateRecording({
      title: 'Change password',
      sequence: [
        withPassword[0]!,
        withPassword[1]!,
        {
          kind: 'fill',
          selectors: FIELD,
          fingerprint: { ...fieldFingerprint(), accessibleName: 'New password' },
          sensitive: true,
        },
      ],
    });

    expect(two.ok && two.graph.inputs.map((input) => input.id)).toEqual([
      'password',
      'new_password',
    ]);
  });
});
