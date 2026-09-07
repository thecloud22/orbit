export function SiteFooter() {
  return (
    <footer
      className="border-t border-slate-800 bg-slate-900 text-slate-300"
      data-testid="site-footer"
    >
      <div className="mx-auto max-w-5xl px-8 py-8 text-sm">
        <p className="font-semibold text-white">Fairview Township Public Library</p>
        <p className="mt-2">100 Civic Center Drive, Fairview, ST 00000</p>
        <p>(555) 013-0142</p>
        <p className="mt-2 text-slate-400">
          Mon–Thu 9:00 AM–8:00 PM · Fri–Sat 9:00 AM–5:00 PM · Sun Closed
        </p>
        <p className="mt-4 text-xs text-slate-500">A proud member of the State Library Network.</p>
      </div>
    </footer>
  );
}
