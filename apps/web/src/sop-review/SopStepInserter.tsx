import { useEffect, useState, type FormEvent } from 'react';

import { listApiSystems } from '../api-client';

import {
  EDITABLE_STEP_KINDS,
  fieldsForStepKind,
  pruneEmptyFields,
  stepKindLabel,
} from './sop-review-view-model';
import { StepField } from './SopStepEditor';

export interface SopStepInserterProps {
  /** Where the step lands: 0 puts it first, `steps.length` puts it last. */
  readonly index: number;
  readonly isSaving: boolean;
  readonly onInsert: (step: Record<string, unknown>, note: string | undefined) => void;
  readonly onCancel: () => void;
  /** Every variable name some step in this workflow produces, for the `returns` picker. */
  readonly availableVariables?: readonly string[];
}

/**
 * Adding a step to a workflow.
 *
 * This is the only route by which a recorded workflow can become a branching
 * one. The recording translator deliberately refuses to invent a branch nobody
 * demonstrated, so without an insert a `decision` step could only ever come
 * from the drafting flow or a fixture.
 *
 * The same form as `SopStepEditor`, rendered from the same `fieldsForStepKind`
 * data through the same `StepField`, because the only real differences are a
 * kind picker and the absence of existing values. It carries no id field: ids
 * are generated on the server, since branches name their targets by them and
 * the editor refuses to change one, so a name chosen badly here could not be
 * undone.
 *
 * A newly inserted step has no Execution Binding, so it will show as "Not
 * recorded" and block publishing until somebody demonstrates it on a real page.
 * That is the system working, not a gap to close: an unbound step is a claim
 * about a page that nothing has confirmed (ADR-025, ADR-027), and adding one
 * from a form is exactly the case that must not bypass that.
 *
 * Nothing here validates the graph. The server answers with the real issues if
 * the insert would break the workflow; a second validator in the browser would
 * be a second thing to keep in step with `validateSopGraph`.
 */
export function SopStepInserter({
  index,
  isSaving,
  onInsert,
  onCancel,
  availableVariables,
}: SopStepInserterProps) {
  const [kind, setKind] = useState<string>(EDITABLE_STEP_KINDS[0] ?? 'navigate');
  const [apiSystems, setApiSystems] = useState<readonly string[]>([]);

  // Loaded once, so the "Which system" field can offer what Admin registered
  // rather than asking a person to remember a catalog id. A failure is silent:
  // the field falls back to free text, which is what it was before.
  useEffect(() => {
    listApiSystems()
      .then((result) => {
        setApiSystems(result.systems.map((system) => system.catalogId));
      })
      .catch(() => undefined);
  }, []);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [note, setNote] = useState('');
  const specs = fieldsForStepKind(kind, { apiSystems });

  function set(name: string, value: unknown) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSaving) {
      return;
    }

    onInsert(pruneEmptyFields({ ...values, kind }), note.trim() || undefined);
  }

  return (
    <form
      className="mt-3 rounded-md border border-indigo-300 bg-indigo-50/40 p-3"
      data-testid="sop-step-inserter"
      onSubmit={handleSubmit}
    >
      <p className="text-xs text-slate-500">Adding a step at position {index + 1}</p>

      <div className="mt-3 flex flex-col gap-1">
        <label className="text-xs font-medium text-slate-700" htmlFor={`insert-kind-${index}`}>
          What kind of step
        </label>
        <select
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
          data-testid="sop-insert-kind"
          id={`insert-kind-${index}`}
          onChange={(event) => {
            // Fields are per kind, so values typed against the old kind would be
            // sent as fields the new kind does not have and refused as a schema
            // error. Cleared rather than merged.
            setKind(event.target.value);
            setValues({});
          }}
          value={kind}
        >
          {EDITABLE_STEP_KINDS.map((option) => (
            <option key={option} value={option}>
              {stepKindLabel(option)}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-3 flex flex-col gap-3">
        {specs.map((spec) => (
          <StepField
            key={spec.name}
            onChange={set}
            spec={spec}
            stepId={`insert-${String(index)}`}
            value={values[spec.name]}
            {...(availableVariables === undefined ? {} : { availableVariables })}
          />
        ))}
      </div>

      <div className="mt-3 flex flex-col gap-1">
        <label className="text-xs font-medium text-slate-700" htmlFor={`insert-note-${index}`}>
          Why you added this, for whoever reviews it
        </label>
        <input
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
          data-testid="sop-insert-note"
          id={`insert-note-${index}`}
          onChange={(event) => setNote(event.target.value)}
          value={note}
        />
      </div>

      <p className="mt-3 text-xs text-slate-500">
        {kind === 'call'
          ? apiSystems.length === 0
            ? 'No API systems are registered yet. Register one in Admin, then this field becomes a picker.'
            : 'This step still needs mapping to an operation before the workflow can be published.'
          : 'A step added here has not been shown on a real page yet, so it will need binding before this workflow can be published.'}
      </p>

      <div className="mt-3 flex gap-2">
        <button
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:bg-slate-300"
          data-testid="sop-insert-save"
          disabled={isSaving}
          type="submit"
        >
          {isSaving ? 'Adding…' : 'Add as a new revision'}
        </button>
        <button
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          data-testid="sop-insert-cancel"
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
