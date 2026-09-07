import { CatalogPage } from './CatalogPage';
import { CirculationPage } from './CirculationPage';
import { Layout } from './components/Layout';
import { EventsPage } from './EventsPage';
import { HomePage } from './HomePage';
import { HoursPage } from './HoursPage';

/**
 * Minimal pathname switch, matching the Phase 1 demo portal's App.tsx.
 *
 * Vite serves index.html as the history fallback for unknown paths in both
 * dev and preview (appType: 'spa'), so every route below reaches its
 * component without a router dependency.
 */
export function App() {
  const path = window.location.pathname.replace(/\/+$/, '');

  if (path === '') {
    return <HomePage />;
  }

  if (path === '/catalog') {
    return <CatalogPage />;
  }

  if (path === '/circulation') {
    return <CirculationPage />;
  }

  if (path === '/hours') {
    return <HoursPage />;
  }

  if (path === '/events') {
    return <EventsPage />;
  }

  return (
    <Layout>
      <div className="mx-auto max-w-2xl px-8 py-12">
        <h1 className="text-2xl font-semibold text-slate-900">Page not found</h1>
        <p className="mt-2 text-sm text-slate-600">
          <a className="underline" href="/">
            Return to the homepage
          </a>
          .
        </p>
      </div>
    </Layout>
  );
}
