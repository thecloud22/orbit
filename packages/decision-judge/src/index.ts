/**
 * @orbit/decision-judge
 *
 * The implementation behind @orbit/runtime's `DecisionJudge` port: the prompt,
 * the model layer, the budget check and the ledger write, in that order.
 *
 * Boundary. This package exists so that the runtime does not have to. The
 * runtime declares a one-method interface returning an index into a closed list
 * and imports nothing from here; `apps/browser-worker` wires the two together,
 * exactly as it wires @orbit/executor-playwright behind `BrowserExecutor`, and
 * `packages/runtime/src/steps/decision-judge-boundary.test.ts` proves the runtime
 * cannot reach this package transitively.
 *
 * It legitimately reaches the network, in one direction, from
 * `decision-model.ts` alone — which builds its client through
 * @orbit/model-provider, the one place that decides which model family a
 * deployment uses and how it is reached (ADR-034). It never touches a browser, a database, or the
 * filesystem: the ledger is an interface the entry point satisfies.
 */
export const PACKAGE_NAME = '@orbit/decision-judge' as const;

export * from './decision-model';
export * from './judge';
export * from './prompt';
