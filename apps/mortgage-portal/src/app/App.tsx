import { LoanPage } from '../pages/LoanPage';
import { PipelinePage } from '../pages/PipelinePage';
import { Shell } from '../components/Shell';

/**
 * Pathname switch, matching the other portals in this repository.
 *
 * `/underwriting` takes `?loan=` rather than a path segment, because that is
 * how the real thing works: an underwriter pastes a loan number into a lookup
 * and lands on the file, and a recorded workflow does exactly the same.
 */
export function App() {
  const path = window.location.pathname.replace(/\/+$/, '');

  if (path === '' || path === '/pipeline') {
    return <PipelinePage />;
  }

  if (path === '/underwriting') {
    return <LoanPage />;
  }

  return (
    <Shell>
      <div className="mx-auto max-w-2xl px-8 py-16">
        <h1 className="text-xl font-semibold text-slate-900">Page not found</h1>
        <p className="mt-2 text-sm text-slate-600">
          <a className="text-sky-700 underline" href="/pipeline">
            Return to the pipeline
          </a>
        </p>
      </div>
    </Shell>
  );
}
