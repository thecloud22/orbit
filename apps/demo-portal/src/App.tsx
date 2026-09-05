import { APP_INFO } from './app-info';
import { RequestPortal } from './RequestPortal';

/**
 * Minimal pathname switch.
 *
 * Vite serves index.html as the history fallback for unknown paths in both dev
 * and preview (appType: 'spa'), so /requests reaches this component without a
 * router dependency. One meaningful route does not justify one.
 */
export function App() {
  const path = window.location.pathname.replace(/\/+$/, '');

  if (path === '/requests') {
    return <RequestPortal />;
  }

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold text-slate-900">{APP_INFO.title}</h1>
      <p className="mt-2 text-sm text-slate-600">{APP_INFO.description}</p>
      <p className="mt-4 text-sm">
        <a className="text-slate-900 underline" href="/requests">
          Go to the service request portal
        </a>
      </p>
    </main>
  );
}
