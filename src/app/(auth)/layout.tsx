import Link from 'next/link';
import { Sparkles } from 'lucide-react';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
      <div className="flex flex-col justify-center px-4 py-12 sm:px-10">
        <div className="mx-auto w-full max-w-sm">
          <Link href="/" className="mb-8 inline-flex items-center gap-2 font-bold tracking-tight">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-swarm-600 text-white">
              <Sparkles className="h-4 w-4" />
            </span>
            Swarm Writer
          </Link>
          {children}
        </div>
      </div>

      {/* Context panel — hidden on small screens where it would just push the form down. */}
      <aside className="hidden flex-col justify-center border-l px-12 lg:flex" style={{ background: 'var(--surface)' }}>
        <blockquote className="max-w-md">
          <p className="text-xl font-semibold leading-8 tracking-tight">
            &ldquo;The linking is the part nobody else gets right. Everything else is table stakes.&rdquo;
          </p>
          <footer className="mt-4 text-sm muted">On why Swarm Writer indexes your live site first</footer>
        </blockquote>
        <ul className="mt-10 space-y-3 text-sm muted">
          {[
            'Connect WordPress with an application password — no plugin to install.',
            'Approve the plan before a single credit is spent.',
            'RankMath fields written on publish, verified by reading the post back.',
            'Every model call metered, so cost per article is a number you can audit.',
          ].map((line) => (
            <li key={line} className="flex gap-2.5">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-swarm-500" />
              {line}
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
