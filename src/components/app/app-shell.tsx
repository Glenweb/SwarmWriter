'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import {
  CalendarDays, ChevronDown, CreditCard, FileText, Globe, LayoutDashboard, ListChecks,
  LogOut, Menu, Search, Sparkles, X,
} from 'lucide-react';
import { api } from '@/lib/client';
import type { SessionUser } from '@/lib/types';

type SiteRef = { id: string; name: string; url: string; status: string };

const NAV = [
  { href: '/dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { href: '/sites', label: 'Sites', Icon: Globe },
  { href: '/keywords', label: 'Keywords', Icon: Search },
  { href: '/plans', label: 'Content plans', Icon: ListChecks },
  { href: '/articles', label: 'Articles', Icon: FileText },
  { href: '/calendar', label: 'Calendar', Icon: CalendarDays },
  { href: '/billing', label: 'Billing', Icon: CreditCard },
];

export function AppShell({
  user,
  sites,
  mocked,
  children,
}: {
  user: SessionUser;
  sites: SiteRef[];
  mocked: { anthropic: boolean; dataForSeo: boolean; stripe: boolean };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const [navOpen, setNavOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const activeSiteId = params.get('siteId') ?? sites[0]?.id ?? '';
  const activeSite = sites.find((s) => s.id === activeSiteId) ?? sites[0];

  /** Site switching is a query param, so every page stays shareable. */
  function switchSite(siteId: string) {
    const next = new URLSearchParams(Array.from(params.entries()));
    next.set('siteId', siteId);
    router.push(`${pathname}?${next.toString()}`);
  }

  async function logout() {
    await api.post('/api/auth/logout');
    router.push('/login');
    router.refresh();
  }

  const mockedList = [
    mocked.anthropic && 'Anthropic',
    mocked.dataForSeo && 'DataForSEO',
    mocked.stripe && 'Stripe',
  ].filter(Boolean) as string[];

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[232px_1fr]">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-[232px] border-r transition-transform lg:static lg:translate-x-0 ${
          navOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{ background: 'var(--surface)' }}
      >
        <div className="flex h-14 items-center justify-between border-b px-4">
          <Link href="/dashboard" className="flex items-center gap-2 text-sm font-bold tracking-tight">
            <span className="grid h-6 w-6 place-items-center rounded-md bg-swarm-600 text-white">
              <Sparkles className="h-3.5 w-3.5" />
            </span>
            Swarm Writer
          </Link>
          <button onClick={() => setNavOpen(false)} className="rounded p-1 hover:bg-black/[0.06] lg:hidden" aria-label="Close menu">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Site switcher */}
        {sites.length > 0 ? (
          <div className="border-b px-3 py-3">
            <span className="label">Site</span>
            <select
              value={activeSite?.id ?? ''}
              onChange={(e) => switchSite(e.target.value)}
              className="input py-1.5 text-xs"
              aria-label="Active site"
            >
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.status !== 'connected' ? ` (${s.status})` : ''}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <nav className="space-y-0.5 p-2">
          {NAV.map(({ href, label, Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            const to = activeSite && href !== '/billing' && href !== '/dashboard' ? `${href}?siteId=${activeSite.id}` : href;
            return (
              <Link
                key={href}
                href={to}
                onClick={() => setNavOpen(false)}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
                  active ? 'bg-swarm-500/12 font-semibold text-swarm-700 dark:text-swarm-300' : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                {label}
              </Link>
            );
          })}
        </nav>

        {mockedList.length ? (
          <div className="mx-3 mt-2 rounded-lg border border-warn-500/35 bg-warn-500/[0.08] px-3 py-2.5 text-[11px] leading-5">
            <p className="font-semibold">Running on mock providers</p>
            <p className="mt-0.5 muted">
              {mockedList.join(', ')} {mockedList.length === 1 ? 'has' : 'have'} no API key, so deterministic
              stand-ins are used. The pipeline is otherwise identical.
            </p>
            <Link href="/api/health" className="mt-1 inline-block font-semibold hover:underline">
              Check status →
            </Link>
          </div>
        ) : null}
      </aside>

      {navOpen ? <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setNavOpen(false)} aria-hidden /> : null}

      {/* Main column */}
      <div className="flex min-w-0 flex-col">
        <header
          className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b px-4 backdrop-blur-xl"
          style={{ background: 'color-mix(in srgb, var(--bg) 85%, transparent)' }}
        >
          <button onClick={() => setNavOpen(true)} className="rounded p-1.5 hover:bg-black/[0.06] lg:hidden" aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>

          <div className="min-w-0 flex-1">
            {activeSite ? (
              <p className="truncate text-xs muted">
                {activeSite.name} · <span className="font-mono">{activeSite.url.replace(/^https?:\/\//, '')}</span>
              </p>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Link
              href="/billing"
              className="rounded-lg border px-2.5 py-1.5 text-xs font-semibold tabular-nums hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
              title="Credit balance — 1 credit = 1 article"
            >
              {user.creditsBalance} credits
            </Link>

            <div className="relative">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
                aria-expanded={menuOpen}
              >
                <span className="grid h-6 w-6 place-items-center rounded-full bg-swarm-600 text-[10px] font-bold text-white">
                  {(user.name ?? user.email).charAt(0).toUpperCase()}
                </span>
                <ChevronDown className="h-3.5 w-3.5" aria-hidden />
              </button>
              {menuOpen ? (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} aria-hidden />
                  <div className="card absolute right-0 z-20 mt-1.5 w-56 p-1.5 shadow-lift">
                    <div className="border-b px-2.5 py-2">
                      <p className="truncate text-xs font-semibold">{user.name ?? 'Account'}</p>
                      <p className="truncate text-xs muted">{user.email}</p>
                      <p className="mt-1 text-[11px] muted">Plan: {user.plan}</p>
                    </div>
                    <button
                      onClick={logout}
                      className="mt-1 flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-black/[0.05] dark:hover:bg-white/[0.07]"
                    >
                      <LogOut className="h-4 w-4" /> Sign out
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
