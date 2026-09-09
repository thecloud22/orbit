import { createLocalFilesystemArtifactStorage, type ArtifactStorage } from '@orbit/artifacts';
import { createTestArtifactRoot, removeTestArtifactRoot } from '@orbit/artifacts/testing';
import type { AgentIr } from '@orbit/agent-ir';
import {
  mortgageUnderwritingBindings,
  mortgageUnderwritingGraph,
} from '@orbit/agent-ir-compiler/testing';
import { compileCandidate } from '@orbit/agent-ir-compiler';
import { publishedDocumentFor } from '@orbit/sop-service';
import { createRepositories } from '@orbit/db';
import { TEST_TRIGGER, useTestDatabase } from '@orbit/db/testing';
import { createPlaywrightExecutorFactory } from '@orbit/executor-playwright';
import { executeAgentVersion } from '@orbit/runtime';
import { createDatabaseRunStore } from '@orbit/runtime/persistence';
import {
  adoptedProcess,
  createFakeJudge,
  isHttpReady,
  startManagedProcess,
  waitForHttpReady,
  type ManagedProcess,
} from '@orbit/runtime/testing';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Business rules, executed (ADR-040).
 *
 * One published workflow, run against seven different loan files, taking a
 * different path through the same graph each time. That is the claim: a
 * lender's underwriting rules become branches an agent actually takes, decided
 * by comparing figures the loan origination system published.
 *
 * Four of the five decisions in this workflow are `value.compare` steps. No
 * model is asked about any of them, nothing is read from the page to resolve
 * them, and the run records both operands so the branch can be recomputed by
 * hand from the timeline. The fifth is a judged decision reading the income
 * analyst's prose, which is the case that genuinely needs a model — and having
 * both in one workflow is the point rather than a convenience.
 *
 * **No model is called.** The judge is the deterministic fake, classifying the
 * real note the real page rendered, for the reason `judged-availability`'s test
 * uses one: model behaviour is ADR-032's subject, not this test's.
 */

const PORTAL_URL = 'http://localhost:3030/pipeline';
const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * A judge that reads the note the way an income analyst would.
 *
 * Deterministic, and deliberately keyed on what the prose *says* rather than on
 * the loan number: a judge that recognised files would prove nothing about
 * whether the note reached it.
 */
function incomeJudge() {
  return createFakeJudge({
    confidence: 0.93,
    rationale: 'classified from the income analyst note',
    decide: (request) => {
      const note = request.sources
        .map((source) => source.text)
        .join(' ')
        .toLowerCase();

      if (
        note.includes('self-employed') ||
        note.includes('sole member') ||
        note.includes('seasonal') ||
        note.includes('contract') ||
        note.includes('may not renew') ||
        note.includes('no guaranteed renewal')
      ) {
        return 0; // needs two years of returns
      }

      if (note.includes('salaried') || note.includes('pension') || note.includes('hourly')) {
        return 1; // straightforward income
      }

      return 2; // the note does not settle it
    },
  });
}

describe('mortgage underwriting rules against the real loan origination portal', () => {
  const getDatabase = useTestDatabase();

  let artifactRoot: string;
  let storage: ArtifactStorage;
  let portal: ManagedProcess;
  let startedPortal = false;
  let agentIr: AgentIr;

  beforeAll(async () => {
    if (await isHttpReady(PORTAL_URL)) {
      portal = adoptedProcess('mortgage-portal');
    } else {
      portal = startManagedProcess({
        name: 'mortgage-portal',
        command: 'pnpm',
        args: ['--filter', '@orbit/mortgage-portal', 'dev'],
        cwd: REPOSITORY_ROOT,
      });

      try {
        await waitForHttpReady(PORTAL_URL, 'The mortgage portal');
      } catch (error) {
        await portal.stop();
        throw error;
      }

      startedPortal = true;
    }

    artifactRoot = await createTestArtifactRoot();
    storage = await createLocalFilesystemArtifactStorage({ root: artifactRoot });

    const compiled = compileCandidate({
      graph: mortgageUnderwritingGraph(),
      bindings: mortgageUnderwritingBindings(),
      agentId: 'agent_mortgage_underwriting',
      version: '0.1.0',
      sopId: 'sop_mortgage_underwriting',
      sopVersion: '1',
    });

    if (!compiled.ok) {
      throw new Error(`the workflow did not compile: ${JSON.stringify(compiled.refusals)}`);
    }

    agentIr = publishedDocumentFor(compiled.agentIr, '0.1.0');
  }, 180_000);

  afterAll(async () => {
    await removeTestArtifactRoot(artifactRoot);

    if (startedPortal) {
      await portal.stop();
    }
  });

  async function underwrite(loanNumber: string) {
    const repositories = createRepositories(getDatabase().db);
    await repositories.agents.upsert({ id: agentIr.id, name: agentIr.name });
    const agentVersion = await repositories.agentVersions.create({ agentIr });

    const factory = createPlaywrightExecutorFactory({ headless: true });

    const result = await executeAgentVersion({
      agentVersionId: agentVersion.id,
      agentIr: agentVersion.agentIr,
      inputs: { loanNumber },
      trigger: TEST_TRIGGER,
      store: createDatabaseRunStore({ database: getDatabase().db, storage }),
      judge: incomeJudge(),
      executors: { browser: { open: () => factory.open() } },
    });

    const steps = await repositories.runSteps.listByRun(result.runId);

    return {
      run: await repositories.runs.findById(result.runId),
      ranStepIds: steps.map((step) => step.agentStepId),
      comparison: (stepId: string) =>
        steps.find((step) => step.agentStepId === stepId)?.output as
          Record<string, unknown> | undefined,
    };
  }

  it('approves a clean file, having asked every rule and been refused by none', async () => {
    // ML-26-04471: LTV 72.73, DTI 28.00, FICO 762, zone X, salaried nurse.
    const { run, ranStepIds, comparison } = await underwrite('ML-26-04471');

    expect(run?.status).toBe('succeeded');
    expect(run?.businessOutcome).toBe('file_approved');
    expect(run?.outputs?.['fileDecision']).toBe('Approved');

    // Not one condition was attached, because not one threshold was crossed.
    expect(ranStepIds).not.toContain('add_pmi_condition');
    expect(ranStepIds).not.toContain('add_flood_condition');
    expect(ranStepIds).not.toContain('add_tax_returns_condition');

    // And the evidence says why, in numbers a person can check against the
    // rule: 72.73 is not more than 80.
    expect(comparison('check_pmi_threshold')).toMatchObject({
      describedAs: 'Loan To Value is more than 80',
      leftValue: '72.73%',
      rightValue: '80',
      comparedAs: 'number',
      conditionHolds: false,
      next: 'check_flood_zone',
    });
  }, 180_000);

  it('requires mortgage insurance on a file over the loan-to-value threshold', async () => {
    // ML-26-04488: LTV 92.09 because the appraisal came in below the price.
    const { run, ranStepIds, comparison } = await underwrite('ML-26-04488');

    expect(run?.status).toBe('succeeded');
    expect(run?.businessOutcome).toBe('file_approved');
    expect(run?.outputs?.['fileDecision']).toBe('Conditionally approved');

    expect(ranStepIds).toContain('add_pmi_condition');
    expect(ranStepIds).not.toContain('add_flood_condition');

    expect(comparison('check_pmi_threshold')).toMatchObject({
      leftValue: '92.09%',
      conditionHolds: true,
      next: 'add_pmi_condition',
    });
  }, 180_000);

  it('requires flood insurance on a property in a hazard area, comparing text not numbers', async () => {
    // ML-26-04513: zone AE. The comparison is `neq X`, which is the rule as a
    // lender writes it rather than a list of zone codes that goes stale.
    const { run, ranStepIds, comparison } = await underwrite('ML-26-04513');

    expect(run?.status).toBe('succeeded');
    expect(run?.businessOutcome).toBe('file_approved');
    expect(ranStepIds).toContain('add_flood_condition');
    expect(ranStepIds).not.toContain('add_pmi_condition');

    expect(comparison('check_flood_zone')).toMatchObject({
      leftValue: 'AE',
      rightValue: 'X',
      comparedAs: 'text',
      conditionHolds: true,
    });
  }, 180_000);

  it('attaches both conditions when a file trips both rules', async () => {
    // ML-26-04561: LTV 85.00 and zone VE. Two independent rules, both applying
    // to one file, which is the case a single decision could not express.
    const { run, ranStepIds } = await underwrite('ML-26-04561');

    expect(run?.status).toBe('succeeded');
    expect(run?.businessOutcome).toBe('file_approved');
    expect(ranStepIds).toContain('add_pmi_condition');
    expect(ranStepIds).toContain('add_flood_condition');
  }, 180_000);

  it('refers a file over the debt-to-income limit, and stops asking the later rules', async () => {
    // ML-26-04529: DTI 47.00. Its LTV is 95.00 and would have required mortgage
    // insurance -- but a referred file never reaches that question, which is
    // how an underwriter works and what ordering the rules is for.
    const { run, ranStepIds, comparison } = await underwrite('ML-26-04529');

    expect(run?.status).toBe('succeeded');
    expect(run?.businessOutcome).toBe('file_referred');

    expect(comparison('check_dti_limit')).toMatchObject({
      describedAs: 'Debt To Income is more than 43',
      leftValue: '47.00%',
      conditionHolds: true,
      next: 'escalate_file',
    });

    expect(ranStepIds).toContain('escalate_file');
    expect(ranStepIds).not.toContain('check_pmi_threshold');
    expect(ranStepIds).not.toContain('approve_file');
  }, 180_000);

  it('declines a file below the credit floor before any other rule is asked', async () => {
    // ML-26-04547: FICO 596. The credit floor is the first rule, so this file
    // is declined without its DTI or LTV ever being compared.
    const { run, ranStepIds, comparison } = await underwrite('ML-26-04547');

    expect(run?.status).toBe('succeeded');
    expect(run?.businessOutcome).toBe('file_declined');

    expect(comparison('check_credit_floor')).toMatchObject({
      describedAs: 'Credit Score is less than 620',
      leftValue: '596',
      rightValue: '620',
      conditionHolds: true,
      next: 'decline_file',
    });

    expect(ranStepIds).toContain('decline_file');
    expect(ranStepIds).not.toContain('check_dti_limit');
    expect(ranStepIds).not.toContain('check_pmi_threshold');
  }, 180_000);

  it('asks a model only about the one thing no threshold settles', async () => {
    // ML-26-04502: every ratio is inside its limit, so the four computed rules
    // all pass -- and the file still needs a condition, because the analyst's
    // note describes seasonal self-employment. That is the division of labour
    // this design exists for: arithmetic where the answer is arithmetic, a
    // model only where the answer is in a paragraph of prose.
    const { run, ranStepIds, comparison } = await underwrite('ML-26-04502');

    expect(run?.status).toBe('succeeded');
    expect(run?.businessOutcome).toBe('file_approved');
    expect(run?.outputs?.['fileDecision']).toBe('Conditionally approved');

    expect(comparison('check_pmi_threshold')).toMatchObject({ conditionHolds: false });
    expect(comparison('check_dti_limit')).toMatchObject({ conditionHolds: false });
    expect(comparison('check_credit_floor')).toMatchObject({ conditionHolds: false });
    expect(comparison('check_flood_zone')).toMatchObject({ conditionHolds: false });

    expect(ranStepIds).toContain('add_tax_returns_condition');
    expect(ranStepIds).not.toContain('add_pmi_condition');
    expect(ranStepIds).not.toContain('add_flood_condition');
  }, 180_000);

  it('reaches the judged decision on a salaried file and takes its other branch', async () => {
    // The same judged step, the same page region, a different note. Nothing
    // about the workflow changed between this run and the one above.
    const { ranStepIds } = await underwrite('ML-26-04471');

    expect(ranStepIds).toContain('check_income_stability');
    expect(ranStepIds).not.toContain('add_tax_returns_condition');
  }, 180_000);
});
