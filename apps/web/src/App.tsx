import { APP_INFO } from './app-info';

export function App() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-3 p-8">
      <h1 className="text-2xl font-semibold text-slate-900">{APP_INFO.title}</h1>
      <p className="text-sm text-slate-600">{APP_INFO.description}</p>
    </main>
  );
}
