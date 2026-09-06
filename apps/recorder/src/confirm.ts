import { describeSelector, type ElementFingerprint } from '@orbit/execution-mapping';
import type { Advice } from '@orbit/execution-assist';
import { describeStep, type SopStep } from '@orbit/sop-graph';

import type { CapturedAction } from '@orbit/execution-recorder';

/**
 * The confirm screen, as text.
 *
 * Nothing is persisted before a person has read this and said yes. It shows
 * what was actually captured next to what the step says it does, using
 * `describeStep` — the same renderer the review view uses, so a step is named
 * identically wherever it appears and there is no second renderer to drift.
 */

export interface ConfirmSummary {
  readonly stepLabel: string;
  readonly lines: readonly string[];
}

function fingerprintLines(fingerprint: ElementFingerprint): readonly string[] {
  return [
    `  role            ${fingerprint.role ?? '(none)'}`,
    `  accessible name ${fingerprint.accessibleName ?? '(none)'}`,
    `  visible text    ${truncate(fingerprint.text)}`,
    `  position        ${
      fingerprint.boundingBox === null
        ? '(not measurable)'
        : `${Math.round(fingerprint.boundingBox.width)}x${Math.round(fingerprint.boundingBox.height)} at ${Math.round(fingerprint.boundingBox.x)},${Math.round(fingerprint.boundingBox.y)}`
    }`,
  ];
}

function truncate(value: string | null): string {
  if (value === null || value === '') {
    return '(none)';
  }
  const collapsed = value.replace(/\s+/g, ' ').trim();
  return collapsed.length > 60 ? `${collapsed.slice(0, 57)}…` : collapsed;
}

export interface ConfirmInput {
  readonly step: SopStep;
  readonly capture: CapturedAction;
  readonly valueSourceSummary: string | undefined;
  readonly readMethodSummary: string | undefined;
  readonly advice: readonly Advice[];
}

export function buildConfirmSummary(input: ConfirmInput): ConfirmSummary {
  const lines: string[] = [];

  lines.push(`Step        ${describeStep(input.step)}`);
  lines.push(`Kind        ${input.step.kind}`);
  lines.push(`Captured    ${input.capture.type} on ${input.capture.url}`);
  lines.push('');
  lines.push('How the element will be found, in order:');

  input.capture.selectors.forEach((locator, index) => {
    lines.push(`  ${index + 1}. ${describeSelector(locator)}`);
  });

  const rejected = input.capture.considered.filter(
    (entry) => !(entry.matchCount === 1 && entry.isTarget),
  );

  if (rejected.length > 0) {
    lines.push('');
    lines.push('Not used:');
    for (const entry of rejected) {
      lines.push(
        `  ${describeSelector(entry.locator)} — ${
          entry.matchCount === 1
            ? 'matched a different element'
            : `matched ${entry.matchCount} elements`
        }`,
      );
    }
  }

  lines.push('');
  lines.push('What it looked like when you confirmed it:');
  lines.push(...fingerprintLines(input.capture.fingerprint));

  if (input.valueSourceSummary !== undefined) {
    lines.push('');
    lines.push(`Value       ${input.valueSourceSummary}`);
  }

  if (input.readMethodSummary !== undefined) {
    lines.push('');
    lines.push(`Read        ${input.readMethodSummary}`);
  }

  if (input.advice.length > 0) {
    lines.push('');
    lines.push('Suggestions (advisory — nothing here changes what is saved):');
    for (const advice of input.advice) {
      lines.push(
        `  ${advice.severity === 'warning' ? '!' : '-'} ${advice.message}${advice.fromModel ? ' [model]' : ''}`,
      );
    }
  }

  return { stepLabel: describeStep(input.step), lines };
}

/**
 * How a fill's value source reads on the confirm screen.
 *
 * A typed value is shown as discarded unless it was explicitly kept, so the
 * screen states what will be stored rather than what was typed.
 */
export function summarizeValueSource(
  source:
    | { readonly kind: 'sop_variable'; readonly name: string }
    | { readonly kind: 'literal'; readonly value: string },
  typedValue: string | undefined,
): string {
  if (source.kind === 'sop_variable') {
    return typedValue === undefined
      ? `from the workflow value "${source.name}"`
      : `from the workflow value "${source.name}" (you typed "${truncate(typedValue)}" to check the field; it will not be saved)`;
  }

  return `a fixed default: "${truncate(source.value)}"`;
}
