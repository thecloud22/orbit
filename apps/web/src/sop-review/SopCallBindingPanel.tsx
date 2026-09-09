import { useEffect, useState } from 'react';

import type { SopBindingsView, SopDraftInputView, SopReviewStepView } from '@orbit/api/views';

import { ApiErrorNotice } from '../shared/ApiErrorNotice';
import {
  ApiRequestError,
  createCallBinding,
  listApiSystems,
  type ApiSystemOperationView,
  type ApiSystemView,
  type CallArgumentSource,
} from '../api-client';
import { bindingRows, needsCallMapping, type BindingRow } from './sop-binding-view-model';

const TONE_CLASSES: Readonly<Record<string, string>> = {
  neutral: 'bg-slate-100 text-slate-700',
  success: 'bg-emerald-50 text-emerald-900',
};

export interface SopCallBindingPanelProps {
  readonly documentId: string;
  readonly steps: readonly SopReviewStepView[];
  readonly bindings: SopBindingsView | null;
  readonly declaredInputs: readonly SopDraftInputView[];
  /** Refetches bindings after a mapping is saved, the same as the page does after any other edit. */
  readonly onSaved: () => void;
}

/**
 * Mapping a `call` step to an operation.
 *
 * The counterpart to `SopBindingPanel`, and deliberately a separate section
 * rather than another row shape inside it: that panel's whole framing is "a
 * person showed Orbit, in a real browser" — true for every kind it lists, and
 * not true of a call step at all. A call has nothing to demonstrate; a person
 * picks an operation from a contract Orbit already holds and says where each
 * argument comes from. Mixing "click to open a browser" and "pick from these
 * dropdowns" under one heading would describe neither well.
 *
 * Created bindings arrive already approved (`call-bindings.ts` on the server
 * checks everything before storing anything), so there is no separate review
 * step here the way a demonstrated binding has one.
 */
export function SopCallBindingPanel({
  documentId,
  steps,
  bindings,
  declaredInputs,
  onSaved,
}: SopCallBindingPanelProps) {
  const rows = bindingRows(steps, bindings).filter((row) => needsCallMapping(row.kind));

  if (rows.length === 0) {
    return null;
  }

  return (
    <section
      className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
      data-testid="sop-call-bindings"
    >
      <h3 className="text-sm font-semibold text-slate-900">Which operation each call step uses</h3>
      <p className="mt-2 text-sm text-slate-700">
        A call step names what it needs in plain language. This is <em>which</em> registered system
        and operation actually answers it, and where each argument comes from. Register a system in{' '}
        <span className="font-medium">Admin</span> first if none appears below.
      </p>

      <ul className="mt-3 flex flex-col gap-2">
        {rows.map((row) => (
          <CallBindingRow
            declaredInputs={declaredInputs}
            documentId={documentId}
            key={row.stepId}
            onSaved={onSaved}
            row={row}
          />
        ))}
      </ul>
    </section>
  );
}

function CallBindingRow({
  row,
  documentId,
  declaredInputs,
  onSaved,
}: {
  readonly row: BindingRow;
  readonly documentId: string;
  readonly declaredInputs: readonly SopDraftInputView[];
  readonly onSaved: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);

  return (
    <li className="rounded-md border border-slate-200 p-3" data-testid="sop-call-binding-row">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm text-slate-900">
          <span className="mr-2 text-xs text-slate-500">{row.position}.</span>
          <span data-testid="sop-call-binding-step">{row.label}</span>
        </p>
        <span
          className={`rounded px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[row.status.tone] ?? TONE_CLASSES['neutral']}`}
        >
          {row.status.label}
        </span>
      </div>

      <p className="mt-1 text-xs text-slate-600">{row.status.detail}</p>

      {!isEditing && (
        <button
          className="mt-2 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-900 transition-colors hover:border-slate-400"
          data-testid={`sop-call-binding-map-${row.stepId}`}
          onClick={() => {
            setIsEditing(true);
          }}
          type="button"
        >
          {row.status.label === 'Not mapped' ? 'Map this step' : 'Remap this step'}
        </button>
      )}

      {isEditing && (
        <CallMappingForm
          declaredInputs={declaredInputs}
          documentId={documentId}
          onCancel={() => {
            setIsEditing(false);
          }}
          onSaved={() => {
            setIsEditing(false);
            onSaved();
          }}
          stepId={row.stepId}
        />
      )}
    </li>
  );
}

type SourceKind = CallArgumentSource['kind'];

interface ArgumentDraft {
  readonly kind: SourceKind;
  readonly value: string;
}

interface ResponseFieldDraft {
  readonly variableName: string;
  readonly pointer: string;
}

function CallMappingForm({
  documentId,
  stepId,
  declaredInputs,
  onSaved,
  onCancel,
}: {
  readonly documentId: string;
  readonly stepId: string;
  readonly declaredInputs: readonly SopDraftInputView[];
  readonly onSaved: () => void;
  readonly onCancel: () => void;
}) {
  const [systems, setSystems] = useState<readonly ApiSystemView[] | null>(null);
  const [loadError, setLoadError] = useState<ApiRequestError | null>(null);
  const [catalogId, setCatalogId] = useState('');
  const [operationId, setOperationId] = useState('');
  const [args, setArgs] = useState<Record<string, ArgumentDraft>>({});
  const [responseFields, setResponseFields] = useState<readonly ResponseFieldDraft[]>([
    { variableName: '', pointer: '' },
  ]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<ApiRequestError | null>(null);

  useEffect(() => {
    listApiSystems()
      .then((result) => {
        setSystems(result.systems);
      })
      .catch((cause: unknown) => {
        setLoadError(
          cause instanceof ApiRequestError
            ? cause
            : new ApiRequestError({ status: 0, message: 'The API could not be reached.' }),
        );
      });
  }, []);

  const system = systems?.find((one) => one.catalogId === catalogId) ?? null;
  const operation: ApiSystemOperationView | undefined = system?.operations.find(
    (one) => one.operationId === operationId,
  );

  function argumentFor(name: string): ArgumentDraft {
    return args[name] ?? { kind: 'input', value: '' };
  }

  function setArgument(name: string, draft: ArgumentDraft): void {
    setArgs((current) => ({ ...current, [name]: draft }));
  }

  function handleSubmit(): void {
    if (operation === undefined || system === null) {
      return;
    }

    const builtArguments: Record<string, CallArgumentSource> = {};

    for (const parameter of operation.parameters) {
      const draft = argumentFor(parameter.name);
      if (draft.value.trim() === '') {
        continue;
      }

      builtArguments[parameter.name] =
        draft.kind === 'input'
          ? { kind: 'input', inputId: draft.value }
          : draft.kind === 'variable'
            ? { kind: 'variable', name: draft.value }
            : { kind: 'literal', value: draft.value };
    }

    const reads: Record<string, string> = {};
    for (const field of responseFields) {
      if (field.variableName.trim() !== '' && field.pointer.trim() !== '') {
        reads[field.variableName.trim()] = field.pointer.trim();
      }
    }

    setIsSaving(true);
    setSaveError(null);

    createCallBinding(documentId, stepId, {
      catalogId: system.catalogId,
      operationId: operation.operationId,
      arguments: builtArguments,
      reads,
    })
      .then(() => {
        onSaved();
      })
      .catch((cause: unknown) => {
        setSaveError(
          cause instanceof ApiRequestError
            ? cause
            : new ApiRequestError({ status: 0, message: 'The API could not be reached.' }),
        );
      })
      .finally(() => {
        setIsSaving(false);
      });
  }

  if (loadError !== null) {
    return (
      <div className="mt-2">
        <ApiErrorNotice
          error={loadError}
          testId="sop-call-binding-load-error"
          title="That did not work"
        />
      </div>
    );
  }

  if (systems === null) {
    return <p className="mt-2 text-xs text-slate-500">Loading registered systems…</p>;
  }

  if (systems.length === 0) {
    return (
      <p className="mt-2 text-xs text-amber-700">
        No API systems are registered yet. Register one in Admin, then come back here.
      </p>
    );
  }

  return (
    <div className="mt-3 rounded-md border border-indigo-300 bg-indigo-50/40 p-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-slate-700">System</label>
        <select
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
          data-testid="sop-call-binding-system"
          onChange={(event) => {
            setCatalogId(event.target.value);
            setOperationId('');
            setArgs({});
          }}
          value={catalogId}
        >
          <option value="">Choose a system</option>
          {systems.map((one) => (
            <option key={one.catalogId} value={one.catalogId}>
              {one.name}
            </option>
          ))}
        </select>
      </div>

      {system !== null && (
        <div className="mt-3 flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-700">Operation</label>
          <select
            className="rounded-md border border-slate-300 px-2 py-1 text-sm"
            data-testid="sop-call-binding-operation"
            onChange={(event) => {
              setOperationId(event.target.value);
              setArgs({});
            }}
            value={operationId}
          >
            <option value="">Choose an operation</option>
            {system.operations.map((one) => (
              <option key={one.operationId} value={one.operationId}>
                {one.method.toUpperCase()} {one.path} — {one.operationId}
              </option>
            ))}
          </select>
          {system.operations.length === 0 && (
            <p className="text-xs text-amber-700">
              This system has no operation Orbit could import. See its refusals in Admin.
            </p>
          )}
        </div>
      )}

      {operation !== undefined && (
        <>
          {operation.parameters.length > 0 && (
            <div className="mt-3 flex flex-col gap-2">
              <p className="text-xs font-medium text-slate-700">Where each argument comes from</p>
              {operation.parameters.map((parameter) => {
                const draft = argumentFor(parameter.name);
                return (
                  <div className="flex flex-wrap items-center gap-2" key={parameter.name}>
                    <span className="w-32 shrink-0 text-xs text-slate-700">
                      {parameter.name}
                      {parameter.required && <span className="text-rose-700"> *</span>}
                    </span>
                    <select
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                      onChange={(event) => {
                        setArgument(parameter.name, {
                          kind: event.target.value as SourceKind,
                          value: '',
                        });
                      }}
                      value={draft.kind}
                    >
                      <option value="input">Workflow input</option>
                      <option value="variable">Variable</option>
                      <option value="literal">Fixed value</option>
                    </select>
                    {draft.kind === 'input' ? (
                      <select
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                        onChange={(event) => {
                          setArgument(parameter.name, { kind: 'input', value: event.target.value });
                        }}
                        value={draft.value}
                      >
                        <option value="">Choose an input</option>
                        {declaredInputs.map((input) => (
                          <option key={input.id} value={input.id}>
                            {input.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                        onChange={(event) => {
                          setArgument(parameter.name, {
                            kind: draft.kind,
                            value: event.target.value,
                          });
                        }}
                        placeholder={draft.kind === 'variable' ? 'variableName' : 'value'}
                        value={draft.value}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-3 flex flex-col gap-2">
            <p className="text-xs font-medium text-slate-700">
              Values to read out of the response, as new variables
            </p>
            {responseFields.map((field, index) => (
              <div className="flex items-center gap-2" key={index}>
                <input
                  className="w-40 rounded-md border border-slate-300 px-2 py-1 text-xs"
                  onChange={(event) => {
                    setResponseFields((current) =>
                      current.map((one, i) =>
                        i === index ? { ...one, variableName: event.target.value } : one,
                      ),
                    );
                  }}
                  placeholder="variableName"
                  value={field.variableName}
                />
                <span className="text-xs text-slate-500">=</span>
                <input
                  className="w-40 rounded-md border border-slate-300 px-2 py-1 text-xs font-mono"
                  onChange={(event) => {
                    setResponseFields((current) =>
                      current.map((one, i) =>
                        i === index ? { ...one, pointer: event.target.value } : one,
                      ),
                    );
                  }}
                  placeholder="/status"
                  value={field.pointer}
                />
                <button
                  className="text-xs text-slate-400 hover:text-rose-700"
                  onClick={() => {
                    setResponseFields((current) => current.filter((_, i) => i !== index));
                  }}
                  type="button"
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              className="self-start text-xs text-indigo-700"
              onClick={() => {
                setResponseFields((current) => [...current, { variableName: '', pointer: '' }]);
              }}
              type="button"
            >
              + Add a field
            </button>
          </div>

          {saveError !== null && (
            <div className="mt-3">
              <ApiErrorNotice
                error={saveError}
                testId="sop-call-binding-save-error"
                title="That did not work"
              />
            </div>
          )}

          <div className="mt-3 flex gap-2">
            <button
              className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
              data-testid="sop-call-binding-save"
              disabled={isSaving}
              onClick={handleSubmit}
              type="button"
            >
              {isSaving ? 'Saving…' : 'Save mapping'}
            </button>
            <button
              className="rounded-md border border-slate-300 px-3 py-1 text-xs"
              onClick={onCancel}
              type="button"
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}
