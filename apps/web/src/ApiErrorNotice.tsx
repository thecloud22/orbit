import type { ApiRequestError } from './api-client';

/**
 * One consistent shape for "the server said no", reused across every page
 * rather than redrawn per page. Moved out of `App.tsx` once more than one page
 * needed it, so a change to how an error reads is made once.
 */
export function ApiErrorNotice({
  error,
  title,
  testId,
}: {
  readonly error: ApiRequestError;
  readonly title: string;
  readonly testId: string;
}) {
  return (
    <section className="rounded border border-rose-300 bg-rose-50 p-4" data-testid={testId}>
      <h2 className="text-sm font-semibold text-rose-900">{title}</h2>
      <p className="mt-1 text-sm text-rose-900" data-testid={`${testId}-message`}>
        {error.message}
      </p>
      {error.details.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-xs text-rose-900">
          {error.details.map((detail) => (
            <li key={`${detail.field}:${detail.message}`}>
              <span className="font-medium">{detail.field}</span>: {detail.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
