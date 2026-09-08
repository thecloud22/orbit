/**
 * The closed vocabulary of API operations a workflow may call, imported from a
 * contract its owner published.
 *
 * Pure: Zod is the only runtime dependency, and nothing here performs a request.
 * Importing a contract and calling one are different capabilities living in
 * different packages, so a package that reads a schema can never issue a call.
 */
export const PACKAGE_NAME = '@orbit/api-catalog' as const;

export * from './catalog';
export * from './import';
