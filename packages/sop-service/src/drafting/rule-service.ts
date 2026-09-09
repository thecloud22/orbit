import type { SopDocumentId } from '@orbit/contracts';
import { createRepositories, type OrbitDatabase } from '@orbit/db';
import {
  draftRuleDecision,
  type BudgetRefusal,
  type LLMProvider,
  type ModelBudgets,
  type RuleDraftRefusal,
} from '@orbit/sop-generation';
import { describeStep, producedBy, type SopGraph, type SopStepDraft } from '@orbit/sop-graph';

/**
 * Drafting a business rule against the workflow it belongs to (ADR-040).
 *
 * The service's whole job beyond calling the model is building the *context*:
 * which values this workflow reads and where, and which steps a branch may be
 * routed at. That is what turns a rule-drafting call from open-ended
 * text generation into a choice from two closed lists — the model picks names
 * out of them and every name it returns is checked back against them.
 *
 * Nothing here writes. The result is a step draft the caller shows for
 * approval, and it reaches the revision only through the ordinary insert-step
 * path, which validates it exactly as it validates one somebody typed.
 */

export type DraftRuleResult =
  | {
      readonly ok: true;
      readonly step: SopStepDraft;
      /** Where the model believes the rule should be checked. */
      readonly insertAfterStepId: string;
      /** The position that step id corresponds to, for the insert call. */
      readonly insertAtIndex: number;
    }
  | { readonly ok: false; readonly reason: 'not_found' }
  | { readonly ok: false; readonly reason: 'provider_error'; readonly message: string }
  | { readonly ok: false; readonly reason: 'budget_exhausted'; readonly refusal: BudgetRefusal }
  | {
      readonly ok: false;
      readonly reason: 'unusable_proposal';
      readonly refusals: readonly RuleDraftRefusal[];
    };

export interface SopRuleService {
  draft(input: {
    readonly documentId: SopDocumentId;
    readonly ruleText: string;
  }): Promise<DraftRuleResult>;
}

/**
 * Every value this workflow reads, in the order the steps read them.
 *
 * Order matters to the model rather than to the check: a rule can only test a
 * figure the run already holds, so telling it where each value is read is what
 * lets it place the decision after all of them. Getting that wrong is not
 * dangerous — the graph validator refuses a step that reads a value not yet
 * available on every path — but a refusal a person has to fix is worse than a
 * placement that was right first time.
 */
export function valuesReadBy(
  graph: SopGraph,
): readonly { readonly name: string; readonly readAtStepId: string }[] {
  return graph.steps.flatMap((step) =>
    producedBy(step).map((name) => ({ name, readAtStepId: step.id })),
  );
}

export function createSopRuleService(options: {
  readonly database: OrbitDatabase;
  readonly provider: LLMProvider;
  readonly budgets?: ModelBudgets;
}): SopRuleService {
  const repositories = createRepositories(options.database);

  return {
    async draft(input) {
      const revision = await repositories.sopGraphRevisions.findCurrent(input.documentId);

      if (revision === null) {
        return { ok: false, reason: 'not_found' };
      }

      const { graph } = revision;

      // Spend is read once, from the same ledger every other model call is
      // measured against, so a rule draft cannot slip past a ceiling by being
      // counted somewhere else.
      const [global, document] = await Promise.all([
        repositories.modelUsage.totals(),
        repositories.modelUsage.totalsForDocument(input.documentId),
      ]);

      const result = await draftRuleDecision({
        provider: options.provider,
        ...(options.budgets === undefined ? {} : { budgets: options.budgets }),
        spend: {
          global: global.totalTokens,
          document: document.totalTokens,
          // Zero rather than absent, and measurable rather than guessed: a rule
          // draft is one request making one call, so nothing has been spent
          // against *this* request yet. Leaving it unset made `checkModelBudget`
          // refuse a `request` ceiling it could not measure -- correctly, and
          // with a message about a budget nobody had actually spent.
          request: 0,
        },
        context: {
          ruleText: input.ruleText,
          availableValues: valuesReadBy(graph),
          inputs: graph.inputs.map((declaration) => declaration.id),
          steps: graph.steps.map((step) => ({
            id: step.id,
            kind: step.kind,
            summary: describeStep(step),
          })),
        },
      });

      if (!result.ok) {
        return result.reason === 'provider_failed'
          ? { ok: false, reason: 'provider_error', message: result.message }
          : result.reason === 'budget_exhausted'
            ? { ok: false, reason: 'budget_exhausted', refusal: result.refusal }
            : { ok: false, reason: 'unusable_proposal', refusals: result.refusals };
      }

      // A rule is checked *after* the step that reads what it tests, so the
      // insert position is one past it. `insertSopStep` takes an index, and
      // translating here keeps that arithmetic in one place rather than in
      // every caller.
      const at = graph.steps.findIndex((step) => step.id === result.insertAfterStepId);

      return {
        ok: true,
        step: result.step,
        insertAfterStepId: result.insertAfterStepId,
        insertAtIndex: at + 1,
      };
    },
  };
}
