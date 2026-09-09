import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { ApiErrorNotice } from '../shared/ApiErrorNotice';
import {
  ApiRequestError,
  deleteApiSystem,
  listApiSystems,
  registerApiSystem,
  type ApiSystemView,
} from '../api-client';

/**
 * Registering the API contracts this deployment can call.
 *
 * The first write controls Admin has, and the boundary is what makes them
 * acceptable in an application with no authentication (ADR-039). **No field here
 * takes a secret.** `credentialRef` is a *name*; the value is supplied as an
 * environment variable by whoever deploys Orbit, and this page reports only
 * whether that variable is set.
 *
 * Registering a contract grants nothing on its own. A workflow still has to name
 * an operation, a reviewer still has to approve the binding, and the published
 * version still carries its own immutable grant — so the worst a hostile
 * registration achieves is adding an option nobody chose.
 */
export function ApiSystemsPanel() {
  const [systems, setSystems] = useState<readonly ApiSystemView[]>([]);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [name, setName] = useState('');
  const [catalogId, setCatalogId] = useState('');
  const [spec, setSpec] = useState('');
  const [authScheme, setAuthScheme] = useState<'none' | 'bearer' | 'basic'>('none');
  const [credentialRef, setCredentialRef] = useState('');

  const refresh = useCallback(() => {
    listApiSystems()
      .then((result) => {
        setSystems(result.systems);
        setError(null);
      })
      .catch((cause: unknown) => {
        // A raw network failure (the API restarting, a dropped connection) is
        // not an ApiRequestError, and discarding it here used to leave `error`
        // at null with `systems` still `[]` -- rendering "No API systems are
        // registered," which looks identical to a genuinely empty registry.
        // Wrapped the way AdminPage already does, so the notice always has
        // something to show rather than silently agreeing with the failure.
        setError(
          cause instanceof ApiRequestError
            ? cause
            : new ApiRequestError({ status: 0, message: 'The API could not be reached.' }),
        );
      });
  }, []);

  useEffect(refresh, [refresh]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setIsSaving(true);

    registerApiSystem({
      catalogId,
      name,
      spec,
      authScheme,
      ...(credentialRef.trim() === '' ? {} : { credentialRef: credentialRef.trim() }),
    })
      .then(() => {
        setIsAdding(false);
        setName('');
        setCatalogId('');
        setSpec('');
        setAuthScheme('none');
        setCredentialRef('');
        refresh();
      })
      .catch((cause: unknown) => {
        // Same reasoning as the load path: a failure that is not a structured
        // ApiRequestError must still produce something visible, or a person
        // who just clicked Register sees nothing happen at all.
        setError(
          cause instanceof ApiRequestError
            ? cause
            : new ApiRequestError({ status: 0, message: 'The API could not be reached.' }),
        );
      })
      .finally(() => {
        setIsSaving(false);
      });
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4" data-testid="api-systems">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">API systems</h3>
        {!isAdding && (
          <button
            className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white"
            onClick={() => {
              setIsAdding(true);
            }}
            type="button"
          >
            Register a system
          </button>
        )}
      </div>

      <p className="mt-1 text-xs text-slate-500">
        Contracts a workflow may call. Registering one grants nothing on its own — a step still
        names an operation, and a reviewer still approves the mapping.
      </p>

      {error !== null && (
        <div className="flex flex-col gap-2">
          <ApiErrorNotice error={error} testId="api-systems-error" title="That did not work" />
          {/* The load path only ever fires once, on mount. Without this, a
              transient failure -- the API mid-restart, a dropped connection --
              leaves the page stuck showing the error until a full reload,
              which is a worse experience than the bug this replaced. */}
          <button
            className="self-start rounded-md border border-rose-300 px-3 py-1 text-xs font-medium text-rose-900"
            onClick={refresh}
            type="button"
          >
            Try again
          </button>
        </div>
      )}

      {isAdding && (
        <form
          className="mt-3 rounded-md border border-indigo-300 bg-indigo-50/40 p-3"
          onSubmit={handleSubmit}
        >
          <Field label="Name" onChange={setName} placeholder="Service Desk" value={name} />
          <Field
            label="Catalog id (how a step names this system)"
            onChange={setCatalogId}
            placeholder="service-desk"
            value={catalogId}
          />

          <div className="mt-3 flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-700">OpenAPI specification</label>
            <textarea
              className="h-40 rounded-md border border-slate-300 px-2 py-1 font-mono text-xs"
              data-testid="api-system-spec"
              onChange={(event) => {
                setSpec(event.target.value);
              }}
              placeholder="openapi: 3.0.0"
              value={spec}
            />
            <span className="text-xs text-slate-500">
              Parsed on registration, never fetched. Operations Orbit cannot import are listed
              rather than silently skipped.
            </span>
          </div>

          <div className="mt-3 flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-700">Authentication</label>
            <select
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
              data-testid="api-system-auth"
              onChange={(event) => {
                setAuthScheme(event.target.value as 'none' | 'bearer' | 'basic');
              }}
              value={authScheme}
            >
              <option value="none">None</option>
              <option value="bearer">Bearer token</option>
              <option value="basic">Basic</option>
            </select>
          </div>

          {authScheme !== 'none' && (
            <>
              <Field
                label="Credential name"
                onChange={setCredentialRef}
                placeholder="serviceDeskToken"
                value={credentialRef}
              />
              <p className="mt-1 text-xs text-amber-700">
                A name, not a secret. Orbit reads the value from an environment variable at the
                moment it builds the request — never from this form, and never from the database.
              </p>
            </>
          )}

          <div className="mt-3 flex gap-2">
            <button
              className="rounded-md bg-indigo-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
              disabled={isSaving}
              type="submit"
            >
              Register
            </button>
            <button
              className="rounded-md border border-slate-300 px-3 py-1 text-sm"
              onClick={() => {
                setIsAdding(false);
              }}
              type="button"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {systems.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No API systems are registered.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {systems.map((system) => (
            <li className="rounded-md border border-slate-200 p-3" key={system.id}>
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium text-slate-900">{system.name}</span>
                <code className="text-xs text-slate-500">{system.catalogId}</code>
                <span className="text-xs text-slate-500">
                  {system.operations.length} operation{system.operations.length === 1 ? '' : 's'}
                </span>
                <button
                  className="ml-auto text-xs text-red-700"
                  onClick={() => {
                    deleteApiSystem(system.id)
                      .then(refresh)
                      .catch(() => undefined);
                  }}
                  type="button"
                >
                  Remove
                </button>
              </div>

              {system.credentialRef !== null && (
                <p className="mt-1 text-xs">
                  <code>{system.credentialRef}</code>{' '}
                  <span
                    className={
                      system.credentialConfigured === true ? 'text-emerald-700' : 'text-red-700'
                    }
                  >
                    {system.credentialConfigured === true
                      ? 'configured'
                      : `not set — export ${system.credentialVariable ?? ''}`}
                  </span>
                </p>
              )}

              {system.importError !== null && (
                <p className="mt-1 text-xs text-red-700">{system.importError}</p>
              )}

              {system.refusals.length > 0 && (
                <p className="mt-1 text-xs text-amber-700">
                  {system.refusals.length} operation{system.refusals.length === 1 ? '' : 's'} could
                  not be imported: {system.refusals.map((one) => one.operationId).join(', ')}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder: string;
}) {
  return (
    <div className="mt-3 flex flex-col gap-1">
      <label className="text-xs font-medium text-slate-700">{label}</label>
      <input
        className="rounded-md border border-slate-300 px-2 py-1 text-sm"
        onChange={(event) => {
          onChange(event.target.value);
        }}
        placeholder={placeholder}
        value={value}
      />
    </div>
  );
}
