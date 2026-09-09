import { useCallback, useEffect, useState } from 'react';

import type { ModelUsageView, PlatformView } from '@orbit/api/views';

import {
  describeMigrations,
  describeModel,
  platformFacts,
  type AdminFact,
  type MigrationStatus,
} from './admin-view-model';
import { ApiErrorNotice } from '../shared/ApiErrorNotice';
import { ApiSystemsPanel } from './ApiSystemsPanel';
import { ApiRequestError, getModelUsage, getPlatform } from '../api-client';
import type { View } from '../app/navigation';
import { formatEstimatedCost } from '../sop-review/sop-draft-view-model';

/**
 * Admin: what this deployment is running with.
 *
 * Every element on this page shows a value the API reported, and there is not
 * one control that changes anything. That is the design rather than an
 * unfinished first pass:
 *
 *   - Budgets and provider selection are deployment configuration. The API
 *     says so in `routes/model-usage.ts` — "a cap a client could lift is not a
 *     cap" — and Orbit has no authentication, so a button here would be a
 *     button for anyone who can reach Watchtower.
 *   - The recovery grant is per *document*, not per deployment (ADR-033).
 *     Hoisting it into a global switch would grant a capability to workflows
 *     nobody reviewed, so this page links to where it lives and does not
 *     mirror it.
 *   - Permissions are compiled into an immutable Agent Version (ADR-005), so
 *     there is no "current permissions" to edit here at all.
 *
 * What is left is genuinely useful and genuinely safe: which model is in force,
 * what has been spent against which ceilings, how far the database has been
 * migrated, where evidence is written, and what address answered.
 */
export function AdminPage({ onNavigate }: { readonly onNavigate: (view: View) => void }) {
  const [platform, setPlatform] = useState<PlatformView | null>(null);
  const [usage, setUsage] = useState<ModelUsageView | null>(null);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);

    try {
      // Both, together: an operator reading "which model" almost always wants
      // "and how much has it cost" in the same glance.
      const [reported, spend] = await Promise.all([getPlatform(), getModelUsage()]);
      setPlatform(reported);
      setUsage(spend);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError
          ? caught
          : new ApiRequestError({ status: 0, message: 'The API could not be reached.' }),
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-6" data-testid="admin-page">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Admin</h2>
        <p className="mt-1 text-sm text-slate-600">
          What this deployment is running with. The platform values below are read-only: they are
          resolved when the API process starts, so changing one means restarting it with a different
          environment — never a click in this page.
        </p>
        <p className="mt-1 text-sm text-slate-600">
          API systems are the exception, and a narrow one (ADR-039). Registering a contract grants
          nothing by itself, and no field there takes a secret: a credential is named here and its
          value is read from the environment at the moment a request is built.
        </p>
      </div>

      <AccessNotice />

      <ApiSystemsPanel />

      {error !== null && (
        <ApiErrorNotice
          error={error}
          testId="admin-load-error"
          title="The platform status could not be read"
        />
      )}

      {isLoading && platform === null && error === null && (
        <p className="text-sm text-slate-500" data-testid="admin-loading">
          Reading platform status…
        </p>
      )}

      {platform !== null && (
        <>
          <ReachabilityCard platform={platform} />
          <ModelCard platform={platform} usage={usage} />
          <DatabaseCard status={describeMigrations(platform.database)} />
          <FactsCard facts={platformFacts(platform)} />
        </>
      )}

      <OwnershipCard onNavigate={onNavigate} />

      <div>
        <button
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium transition-colors hover:border-indigo-400 hover:text-indigo-700"
          data-testid="admin-refresh"
          disabled={isLoading}
          onClick={() => void load()}
          type="button"
        >
          {isLoading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
    </div>
  );
}

/**
 * Said plainly, at the top, before anything else.
 *
 * Orbit has no authentication, no user table and no session. A page called
 * "Admin" implies a privileged role, and there is none, so the page corrects
 * the implication rather than trading on it. The API reports this as a field
 * rather than the page assuming it, so if authentication is ever added the
 * type changes and this stops compiling.
 */
function AccessNotice() {
  return (
    <section
      className="rounded-lg border border-amber-300 bg-amber-50 p-4"
      data-testid="admin-access-notice"
    >
      <h3 className="text-sm font-semibold text-amber-900">This page is not protected</h3>
      <p className="mt-1 text-sm text-amber-900">
        Orbit has no authentication, no user accounts and no sessions. Anyone who can reach
        Watchtower can open this page and every other one, and can start a run. Restricting access
        is the job of whatever sits in front of the deployment — a network boundary or a reverse
        proxy — not of Orbit.
      </p>
    </section>
  );
}

/** The one liveness fact this page can honestly report: the API answered. */
function ReachabilityCard({ platform }: { readonly platform: PlatformView }) {
  return (
    <Card testId="admin-api-card" title="API">
      <p className="text-sm text-slate-700">
        The API answered this page’s request, from{' '}
        <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs">
          {platform.api.host}:{platform.api.port}
        </code>
        .
      </p>
      <p className="mt-2 text-sm text-slate-600">
        For an external monitor, the check is{' '}
        <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs">GET /health</code> on
        the API itself, which returns{' '}
        <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs">
          {'{ "status": "ok" }'}
        </code>
        . Watchtower cannot call it from the browser: the dev server proxies only{' '}
        <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs">/v1</code>, so this
        page does not pretend to.
      </p>
    </Card>
  );
}

function ModelCard({
  platform,
  usage,
}: {
  readonly platform: PlatformView;
  readonly usage: ModelUsageView | null;
}) {
  const model = describeModel(platform.model);

  return (
    <Card testId="admin-model-card" title="Model">
      <p
        className={`text-sm font-medium ${model.configured ? 'text-slate-900' : 'text-amber-800'}`}
        data-testid="admin-model-headline"
      >
        {model.headline}
      </p>
      <p className="mt-1 text-sm text-slate-600">{model.detail}</p>

      {usage === null ? (
        <p className="mt-3 text-sm text-slate-500">Spend could not be read.</p>
      ) : (
        <div className="mt-3">
          <p className="text-sm text-slate-700" data-testid="admin-model-spend">
            {usage.global.totalTokens.toLocaleString('en-US')} tokens across {usage.global.calls}{' '}
            model {usage.global.calls === 1 ? 'call' : 'calls'} ·{' '}
            {formatEstimatedCost(usage.global.estimatedCostMicroUsd)} estimated
          </p>
          <p className="mt-1 text-xs text-slate-500">
            The cost is an estimate computed from rates held in configuration. It is not a bill from
            anyone.
          </p>

          <ul className="mt-3 flex flex-col gap-1" data-testid="admin-budget-scopes">
            {usage.scopes.map((scope) => (
              <li
                className={`text-sm ${scope.exhausted ? 'text-rose-800' : 'text-slate-700'}`}
                key={scope.scope}
              >
                <span className="font-medium">{scope.label}:</span>{' '}
                {scope.limitTokens === null
                  ? 'uncapped in this deployment'
                  : `${(scope.remainingTokens ?? 0).toLocaleString('en-US')} of ${scope.limitTokens.toLocaleString('en-US')} tokens left`}
              </li>
            ))}
          </ul>

          <p className="mt-3 text-xs text-slate-500">
            Ceilings are set by{' '}
            <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px]">
              ORBIT_LLM_TOKEN_BUDGET_GLOBAL
            </code>
            ,{' '}
            <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px]">
              ORBIT_LLM_TOKEN_BUDGET_PER_AGENT
            </code>{' '}
            and{' '}
            <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px]">
              ORBIT_LLM_TOKEN_BUDGET_PER_RUN
            </code>
            , and are read once at start-up. They are not editable here on purpose: a cap a client
            could lift is not a cap.
          </p>
        </div>
      )}
    </Card>
  );
}

function DatabaseCard({ status }: { readonly status: MigrationStatus }) {
  const tone =
    status.tone === 'current'
      ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
      : status.tone === 'behind'
        ? 'border-amber-300 bg-amber-50 text-amber-900'
        : 'border-rose-300 bg-rose-50 text-rose-900';

  return (
    <Card testId="admin-database-card" title="Schema">
      <div
        className={`rounded-md border p-3 ${tone}`}
        data-testid={`admin-migrations-${status.tone}`}
      >
        <p className="text-sm font-medium">{status.headline}</p>
        <p className="mt-1 text-sm">{status.appliedLabel}.</p>
        {status.action !== null && (
          <p className="mt-2 text-sm">
            Run{' '}
            <code className="rounded bg-white/70 px-1 py-0.5 font-mono text-xs">
              {status.action}
            </code>{' '}
            from the repository root.
          </p>
        )}
        {status.tone === 'ahead' && (
          <p className="mt-2 text-sm">
            No migration command resolves this. Update this checkout to the version that migrated
            the database.
          </p>
        )}
      </div>
      <p className="mt-3 text-xs text-slate-500">
        The same reading is available from the command line as{' '}
        <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px]">
          pnpm db:check
        </code>
        , which is read-only too.
      </p>
    </Card>
  );
}

function FactsCard({ facts }: { readonly facts: readonly AdminFact[] }) {
  return (
    <Card testId="admin-facts-card" title="Deployment">
      <dl className="flex flex-col gap-3">
        {facts.map((fact) => (
          <div key={fact.id}>
            <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
              {fact.label}
            </dt>
            <dd
              className="mt-0.5 font-mono text-sm break-all text-slate-900"
              data-testid={`admin-fact-${fact.id}`}
            >
              {fact.value}
            </dd>
            {fact.detail !== null && <p className="mt-0.5 text-xs text-slate-500">{fact.detail}</p>}
          </div>
        ))}
      </dl>
    </Card>
  );
}

/**
 * Where the things that are *not* platform settings actually live.
 *
 * This section exists because the absence of those controls here is the most
 * likely thing to be read as a gap. It is not: each one is owned somewhere
 * narrower on purpose, and naming the owner is more useful than a disabled
 * control would be.
 */
function OwnershipCard({ onNavigate }: { readonly onNavigate: (view: View) => void }) {
  return (
    <Card testId="admin-ownership-card" title="Not set here">
      <ul className="flex flex-col gap-3 text-sm text-slate-700">
        <li>
          <span className="font-medium text-slate-900">Recovery from UI drift</span> is granted per
          workflow document, never globally (ADR-033). A drifted run fails and is never resumed; a
          repair is suggested only from the approved binding’s existing fallback locator chain, the
          page is never scanned for unapproved lookalikes, and a proposal is a separate record from
          a binding. A person accepts it through the ordinary create → review → approve path, and{' '}
          <span className="font-medium">acceptance does not publish</span> — someone must publish
          before later runs use the change. The diagnosis is deterministic and uses no model. The
          grant itself is set by calling{' '}
          <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs">
            POST /v1/sop-documents/:documentId/recovery
          </code>
          ; Watchtower has no control for it today. Accepting and dismissing proposals is on each
          workflow’s review page in{' '}
          <LinkTo onNavigate={onNavigate} view={{ kind: 'documents' }}>
            Studio
          </LinkTo>
          , and the{' '}
          <LinkTo onNavigate={onNavigate} view={{ kind: 'wiki', topic: 'drift-recovery' }}>
            Wiki
          </LinkTo>{' '}
          explains what to do with one.
        </li>
        <li>
          <span className="font-medium text-slate-900">
            Allowed domains, model permission and the recovery permission
          </span>{' '}
          are compiled into an Agent Version when it is published, and an Agent Version is immutable
          (ADR-005). Changing one means publishing a new version, not editing a setting. Withdrawing
          a document’s grant affects future versions only.
        </li>
        <li>
          <span className="font-medium text-slate-900">Per-workflow spend</span> is reported against
          the same ceilings on each workflow’s own page, scoped to that document.
        </li>
        <li>
          <span className="font-medium text-slate-900">User preferences</span> do not exist. There
          are no accounts to hold them.
        </li>
      </ul>
      <p className="mt-3 text-xs text-slate-500">
        Configuration variables and what each one does are documented in{' '}
        <LinkTo onNavigate={onNavigate} view={{ kind: 'wiki', topic: 'configuration' }}>
          Wiki → Configuration
        </LinkTo>
        .
      </p>
    </Card>
  );
}

function LinkTo({
  view,
  onNavigate,
  children,
}: {
  readonly view: View;
  readonly onNavigate: (next: View) => void;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      className="text-indigo-700 underline transition-colors hover:text-indigo-900"
      onClick={() => onNavigate(view)}
      type="button"
    >
      {children}
    </button>
  );
}

function Card({
  title,
  testId,
  children,
}: {
  readonly title: string;
  readonly testId: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section
      className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
      data-testid={testId}
    >
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}
