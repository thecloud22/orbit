/**
 * @orbit/execution-assist
 *
 * Advice for someone mapping a workflow to a page: whether a captured element
 * looks like what the step describes, whether its selectors are as robust as
 * they could be, which steps still need recording, and what might have replaced
 * an element after a run stopped on drift.
 *
 * Boundary. Everything here is advisory. Nothing auto-applies, nothing blocks a
 * save, and nothing touches the drift check's pass/fail logic — that is 4a's
 * runtime code, and this package cannot reach it. Two of the four assists are
 * plain functions with no model at all, because ranking three known strategies
 * and computing a set difference are exact questions; only `anthropic-assist-provider.ts`
 * imports a model client, and a test asserts it stays the only one.
 */
export const PACKAGE_NAME = '@orbit/execution-assist' as const;

export * from './advice';
export * from './anthropic-assist-provider';
export * from './assist';
export * from './provider';
