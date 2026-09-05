/**
 * The runtime's logging seam.
 *
 * Deliberately three methods and no transport: the worker supplies Pino, tests
 * supply a recorder, and the runtime stays free of a logging dependency. Raw
 * underlying error messages are logged here and never persisted, which is what
 * keeps page content out of the evidence tables.
 */
export interface RuntimeLogger {
  debug(fields: Record<string, unknown>, message: string): void;
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
}

export const silentLogger: RuntimeLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
};
