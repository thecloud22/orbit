import { useState, type FormEvent } from 'react';

import type { SopReviewStepView } from '@orbit/api/views';

import {
  describeVariable,
  fieldsForStepKind,
  pruneEmptyFields,
  type StepFieldSpec,
} from './sop-review-view-model';

export interface SopStepEditorProps {
  readonly step: SopReviewStepView;
  readonly isSaving: boolean;
  readonly onSave: (step: Record<string, unknown>, note: string | undefined) => void;
  readonly onCancel: () => void;
  /** Every variable name some step in this workflow produces, for the `returns` picker. */
  readonly availableVariables?: readonly string[];
}

type Row = Record<string, unknown>;

/**
 * The step editor: structured fields only, never raw JSON.
 *
 * Which fields a kind has is data (`fieldsForStepKind`), so this component
 * renders rather than branching seven ways, and the shared parts — the id, the
 * purpose, saving, cancelling — are written once.
 *
 * Nothing here validates the graph. An edit is sent, and the server answers
 * with the real issues if it would break the workflow; a second validator in
 * the browser would be a second thing to keep in step with `validateSopGraph`.
 */
export function SopStepEditor({
  step,
  isSaving,
  onSave,
  onCancel,
  availableVariables,
}: SopStepEditorProps) {
  const [values, setValues] = useState<Record<string, unknown>>(() => ({ ...step.step }));
  const [note, setNote] = useState('');
  const specs = fieldsForStepKind(step.kind);

  function set(name: string, value: unknown) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSaving) {
      return;
    }

    // The id is never editable: branches name their targets by it, so renaming
    // one here would silently rewire the graph. The server refuses a mismatch.
    onSave(pruneEmptyFields({ ...values, id: step.id, kind: step.kind }), note.trim() || undefined);
  }

  return (
    <form
      className="mt-3 rounded-md border border-slate-300 bg-slate-50 p-3"
      onSubmit={handleSubmit}
      data-testid="sop-step-editor"
    >
      <p className="text-xs text-slate-500">
        Editing step {step.position} · <span className="font-mono">{step.kind}</span> ·{' '}
        <span className="font-mono">{step.id}</span>
      </p>

      <div className="mt-3 flex flex-col gap-3">
        {specs.map((spec) => (
          <StepField
            key={spec.name}
            spec={spec}
            value={values[spec.name]}
            onChange={set}
            stepId={step.id}
            {...(availableVariables === undefined ? {} : { availableVariables })}
          />
        ))}
      </div>

      <div className="mt-3 flex flex-col gap-1">
        <label className="text-xs font-medium text-slate-700" htmlFor={`note-${step.id}`}>
          What you changed, and why
        </label>
        <input
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
          data-testid="sop-edit-note"
          id={`note-${step.id}`}
          onChange={(event) => setNote(event.target.value)}
          value={note}
        />
      </div>

      <div className="mt-3 flex gap-2">
        <button
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:bg-slate-300"
          data-testid="sop-step-save"
          disabled={isSaving}
          type="submit"
        >
          {isSaving ? 'Saving…' : 'Save as a new revision'}
        </button>
        <button
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          data-testid="sop-step-cancel"
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * One field of one step kind.
 *
 * Exported so `SopStepInserter` renders the same controls the editor does. A
 * second form for adding a step would be seven kinds' worth of fields to keep
 * in step with `fieldsForStepKind`, and the only real difference between adding
 * and editing is a kind picker and the absence of existing values.
 */
export function StepField({
  spec,
  value,
  onChange,
  stepId,
  availableVariables,
}: {
  readonly spec: StepFieldSpec;
  readonly value: unknown;
  readonly onChange: (name: string, value: unknown) => void;
  readonly stepId: string;
  /**
   * Variable names some other step in this workflow already produces --
   * an `extract`'s fields, a `call`'s response reads, a `decision`'s branch
   * outcomes. Used only by the `returns` field kind, to offer a picker
   * instead of a free-text box a person had to get exactly right by typing.
   */
  readonly availableVariables?: readonly string[];
}) {
  const id = `${stepId}-${spec.name}`;
  const label = (
    <label className="text-xs font-medium text-slate-700" htmlFor={id}>
      {spec.label}
    </label>
  );

  if (spec.kind === 'boolean') {
    return (
      <div className="flex items-center gap-2">
        <input
          checked={value === true}
          data-testid={`field-${spec.name}`}
          id={id}
          onChange={(event) => onChange(spec.name, event.target.checked)}
          type="checkbox"
        />
        {label}
      </div>
    );
  }

  if (spec.kind === 'select') {
    return (
      <div className="flex flex-col gap-1">
        {label}
        <select
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
          data-testid={`field-${spec.name}`}
          id={id}
          onChange={(event) => onChange(spec.name, event.target.value || undefined)}
          value={typeof value === 'string' ? value : ''}
        >
          <option value="">Not specified</option>
          {spec.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (spec.kind === 'textarea') {
    return (
      <div className="flex flex-col gap-1">
        {label}
        <textarea
          className="min-h-16 rounded-md border border-slate-300 px-2 py-1 text-sm"
          data-testid={`field-${spec.name}`}
          id={id}
          onChange={(event) => onChange(spec.name, event.target.value)}
          value={typeof value === 'string' ? value : ''}
        />
      </div>
    );
  }

  if (spec.kind === 'text') {
    return (
      <div className="flex flex-col gap-1">
        {label}
        <input
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
          data-testid={`field-${spec.name}`}
          id={id}
          onChange={(event) => onChange(spec.name, event.target.value)}
          value={typeof value === 'string' ? value : ''}
        />
      </div>
    );
  }

  if (spec.kind === 'stringList') {
    const items = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div className="flex flex-col gap-1">
        {label}
        <input
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
          data-testid={`field-${spec.name}`}
          id={id}
          onChange={(event) =>
            onChange(
              spec.name,
              event.target.value
                .split(',')
                .map((entry) => entry.trim())
                .filter((entry) => entry !== ''),
            )
          }
          value={items.join(', ')}
        />
        <p className="text-xs text-slate-500">Separate names with commas.</p>
      </div>
    );
  }

  return (
    <RowsField
      onChange={onChange}
      spec={spec}
      value={value}
      {...(availableVariables === undefined ? {} : { availableVariables })}
    />
  );
}

/** The three array-shaped fields: branches, extract fields, and outcome returns. */
function RowsField({
  spec,
  value,
  onChange,
  availableVariables,
}: {
  readonly spec: StepFieldSpec;
  readonly value: unknown;
  readonly onChange: (name: string, value: unknown) => void;
  readonly availableVariables?: readonly string[];
}) {
  const rows: Row[] = Array.isArray(value) ? (value as Row[]) : [];

  // `returns` is the one row shape naming a variable that must already exist
  // -- the server refuses a name no step produces (UNDECLARED_OUTCOME_RETURN)
  // -- so it gets a picker rather than a free-text box a person had to type
  // exactly right. The other two name things that do not exist yet (a new
  // branch condition, a new field to extract), where nothing to pick from.
  const columns =
    spec.kind === 'branches'
      ? [
          { key: 'when', label: 'When', type: 'text' as const },
          { key: 'nextStepId', label: 'Go to step', type: 'text' as const },
        ]
      : spec.kind === 'extractFields'
        ? [
            { key: 'name', label: 'Name', type: 'text' as const },
            { key: 'labelHint', label: 'Label on screen', type: 'text' as const },
            { key: 'required', label: 'Required', type: 'boolean' as const },
          ]
        : [
            { key: 'name', label: 'Variable', type: 'variableSelect' as const },
            { key: 'optional', label: 'May be absent', type: 'boolean' as const },
          ];

  function update(index: number, key: string, next: unknown) {
    const copy = rows.map((row, position) => (position === index ? { ...row, [key]: next } : row));
    onChange(spec.name, copy);
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-700">{spec.label}</span>
      <div className="flex flex-col gap-2" data-testid={`field-${spec.name}`}>
        {rows.map((row, index) => (
          <div className="flex flex-wrap items-center gap-2" key={index}>
            {columns.map((column) =>
              column.type === 'boolean' ? (
                <label className="flex items-center gap-1 text-xs text-slate-700" key={column.key}>
                  <input
                    checked={row[column.key] === true}
                    onChange={(event) => update(index, column.key, event.target.checked)}
                    type="checkbox"
                  />
                  {column.label}
                </label>
              ) : column.type === 'variableSelect' && (availableVariables ?? []).length > 0 ? (
                <select
                  aria-label={column.label}
                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                  key={column.key}
                  onChange={(event) => update(index, column.key, event.target.value)}
                  value={typeof row[column.key] === 'string' ? (row[column.key] as string) : ''}
                >
                  <option value="">Choose a variable</option>
                  {(availableVariables ?? []).map((name) => (
                    <option key={name} value={name}>
                      {describeVariable(name)}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  aria-label={column.label}
                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                  key={column.key}
                  onChange={(event) => update(index, column.key, event.target.value)}
                  placeholder={
                    column.type === 'variableSelect'
                      ? 'No steps produce a variable yet'
                      : column.label
                  }
                  value={typeof row[column.key] === 'string' ? (row[column.key] as string) : ''}
                />
              ),
            )}
            <button
              className="rounded-md border border-slate-300 px-2 py-1 text-xs"
              onClick={() =>
                onChange(
                  spec.name,
                  rows.filter((_, position) => position !== index),
                )
              }
              type="button"
            >
              Remove
            </button>
          </div>
        ))}
        <div>
          <button
            className="rounded-md border border-slate-300 px-2 py-1 text-xs"
            onClick={() => onChange(spec.name, [...rows, {}])}
            type="button"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
