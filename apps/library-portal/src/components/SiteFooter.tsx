import { Clock, MapPin, Phone } from 'lucide-react';

export function SiteFooter() {
  return (
    <footer
      className="border-t border-slate-800 bg-slate-900 text-slate-300"
      data-testid="site-footer"
    >
      <div className="mx-auto max-w-5xl px-8 py-8 text-sm">
        <p className="font-serif text-base font-semibold text-white">
          Fairview Township Public Library
        </p>

        <div className="mt-3 flex flex-col gap-1.5">
          <p className="flex items-center gap-2">
            <MapPin aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-500" />
            100 Civic Center Drive, Fairview, ST 00000
          </p>
          <p className="flex items-center gap-2">
            <Phone aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-500" />
            (555) 013-0142
          </p>
          <p className="flex items-center gap-2 text-slate-400">
            <Clock aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-500" />
            Mon–Thu 9:00 AM–8:00 PM · Fri–Sat 9:00 AM–5:00 PM · Sun Closed
          </p>
        </div>

        <p className="mt-4 text-xs text-slate-500">A proud member of the State Library Network.</p>
      </div>
    </footer>
  );
}
