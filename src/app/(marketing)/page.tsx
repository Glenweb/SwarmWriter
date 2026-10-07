import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  ArrowRight, Calendar, CircleDollarSign, Gauge, Link2, ListChecks, Search, Sparkles, Workflow,
} from 'lucide-react';
import { getSessionUser } from '@/lib/auth/session';
import { CREDIT_PACKS } from '@/lib/providers/stripe';
import { env } from '@/lib/env';

// Reads the session cookie, so this segment is never prerendered.
export const dynamic = 'force-dynamic';

export default async function LandingPage() {
  // Signed-in visitors go straight to work.
  const user = await getSessionUser();
  if (user) redirect('/dashboard');

  const target = env.anthropic.costTargetUsd.toFixed(3);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b backdrop-blur-xl" style={{ background: 'color-mix(in srgb, var(--bg) 82%, transparent)' }}>
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3.5">
          <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-swarm-600 text-white">
              <Sparkles className="h-4 w-4" />
            </span>
            Swarm Writer
          </Link>
          <nav className="flex items-center gap-1.5">
            <Link href="/login" className="btn-ghost">Sign in</Link>
            <Link href="/signup" className="btn-primary">Start free</Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 pb-14 pt-16 sm:pt-24">
        <p className="mb-4 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold">
          <span className="h-1.5 w-1.5 rounded-full bg-signal-500" />
          Part of the GMK Swarm architecture
        </p>
        <h1 className="max-w-3xl text-4xl font-bold leading-[1.1] tracking-tight sm:text-6xl">
          SEO articles that link into the site you already built.
        </h1>
        <p className="mt-5 max-w-2xl text-lg muted">
          Connect WordPress, research keywords, approve a plan. Swarm Writer drafts, scores and publishes
          with RankMath fields filled in — and links every post into the content already ranking on your
          domain, not just into its own output.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link href="/signup" className="btn-primary px-5 py-2.5 text-base">
            Start with 5 free articles <ArrowRight className="h-4 w-4" />
          </Link>
          <Link href="/login" className="btn-outline px-5 py-2.5 text-base">Sign in</Link>
        </div>
        <p className="mt-3 text-xs muted">No card required. 5 credits on signup — enough to take a keyword to a live post.</p>

        <dl className="mt-14 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { value: `$${target}`, label: 'Measured cost per article', sub: 'Not an estimate — every model call is metered.' },
            { value: '7', label: 'Specialist agents per article', sub: 'Research, outline, draft, facts, SEO, links, polish.' },
            { value: '12', label: 'On-page signals scored', sub: 'Each deduction comes with the specific fix.' },
            { value: '100%', label: 'Links to real existing pages', sub: 'Candidates come from your live post index.' },
          ].map(({ value, label, sub }) => (
            <div key={label} className="card px-4 py-4">
              <dt className="text-[11px] font-semibold uppercase tracking-wide muted">{label}</dt>
              <dd className="mt-1 text-3xl font-bold tracking-tight">{value}</dd>
              <dd className="mt-1 text-xs muted">{sub}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* How it works */}
      <section className="border-y" style={{ background: 'var(--surface)' }}>
        <div className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="text-2xl font-bold tracking-tight">Five steps, then it runs itself</h2>
          <p className="mt-2 max-w-2xl text-sm muted">
            You approve the plan. Everything after that is automated, and everything before it is reversible.
          </p>
          <ol className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-5">
            {[
              { Icon: Workflow, title: 'Connect', body: 'Paste your URL and a WordPress application password. Verified on save, encrypted at rest.' },
              { Icon: Search, title: 'Research', body: 'DataForSEO volumes, CPC and difficulty. Clustered into topics with a pillar keyword each.' },
              { Icon: ListChecks, title: 'Approve', body: 'Review titles, angles and outlines on a board. Edit or reject before a credit is spent.' },
              { Icon: Sparkles, title: 'Generate', body: 'The swarm drafts, fact-checks, scores and links. You get a draft at 85+ on-page.' },
              { Icon: Calendar, title: 'Publish', body: 'Schedule on a calendar. n8n drains the queue and the post goes live with RankMath set.' },
            ].map(({ Icon, title, body }, i) => (
              <li key={title} className="relative">
                <div className="mb-3 flex items-center gap-2">
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-swarm-500/12 text-swarm-600 dark:text-swarm-300">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="text-xs font-bold tabular-nums muted">0{i + 1}</span>
                </div>
                <h3 className="text-sm font-semibold">{title}</h3>
                <p className="mt-1 text-sm muted">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* The three wedges */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-2xl font-bold tracking-tight">Where this beats the incumbent</h2>
        <p className="mt-2 max-w-2xl text-sm muted">
          SEOBOT set the benchmark for automated SEO content. These are the three places it leaves room.
        </p>
        <div className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-3">
          {[
            {
              Icon: Link2,
              title: 'Internal linking that uses your site',
              body: 'Most tools link their own generated posts together. Swarm Writer pulls every published post off your site over the REST API, ranks candidates per section with TF-IDF, and hands the model a shortlist of real URLs. It picks the anchor; it cannot invent a link.',
            },
            {
              Icon: CircleDollarSign,
              title: 'Cost you can see',
              body: `Seven stages, each routed to the cheapest model that can do the job — Haiku for drafting, Sonnet for structure, Opus only when a score falls short. Token counts come back off every call, so the $${target} per article on your dashboard is measured.`,
            },
            {
              Icon: Gauge,
              title: 'A score with instructions',
              body: 'Twelve weighted signals from keyword placement to Flesch readability. Every deduction names the fix — "add 505 words", "trim 8 characters off the meta title" — rather than leaving you a number to interpret.',
            },
          ].map(({ Icon, title, body }) => (
            <div key={title} className="card p-5">
              <Icon className="h-5 w-5 text-swarm-600 dark:text-swarm-400" />
              <h3 className="mt-3 text-sm font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-6 muted">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* RankMath */}
      <section className="border-y" style={{ background: 'var(--surface)' }}>
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-4 py-16 md:grid-cols-2">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">RankMath-native, not RankMath-adjacent</h2>
            <p className="mt-3 text-sm leading-7 muted">
              Swarm Writer writes the actual RankMath post meta over the REST API. Open the post in WordPress
              and the SEO fields are already filled in — no copy-paste, no second pass. Schema ships in the
              body as JSON-LD too, so structured data works even where RankMath&apos;s own schema module is off.
            </p>
            <p className="mt-4 text-sm leading-7 muted">
              The connection wizard checks that your install exposes these fields over REST and tells you if
              it does not, before you spend anything.
            </p>
          </div>
          <div className="card overflow-hidden">
            <div className="border-b px-4 py-2.5 text-xs font-semibold muted">Fields written on publish</div>
            <ul className="divide-y text-sm">
              {[
                ['rank_math_title', 'Meta title, held to 50–60 characters'],
                ['rank_math_description', 'Meta description, held to 140–160'],
                ['rank_math_focus_keyword', 'The plan’s target keyword'],
                ['rank_math_canonical_url', 'Canonical, derived from the slug'],
                ['rank_math_robots', 'index, follow'],
              ].map(([field, note]) => (
                <li key={field} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5">
                  <code className="font-mono text-xs text-swarm-600 dark:text-swarm-400">{field}</code>
                  <span className="text-xs muted">{note}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-2xl font-bold tracking-tight">Credits, not seats</h2>
        <p className="mt-2 max-w-2xl text-sm muted">
          One credit is one article. Keyword research is one credit per 100 keywords. Planning, scoring,
          re-linking and re-publishing are free. Credits do not expire.
        </p>
        <div className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-3">
          {CREDIT_PACKS.map((pack) => (
            <div key={pack.id} className={`card relative p-6 ${pack.popular ? 'ring-2 ring-swarm-500' : ''}`}>
              {pack.popular ? (
                <span className="absolute -top-2.5 left-6 rounded-full bg-swarm-600 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                  Most picked
                </span>
              ) : null}
              <h3 className="text-sm font-semibold">{pack.name}</h3>
              <p className="mt-3 flex items-baseline gap-1">
                <span className="text-4xl font-bold tracking-tight">${pack.priceUsd}</span>
                <span className="text-sm muted">one-off</span>
              </p>
              <p className="mt-1 text-sm font-medium">
                {pack.credits} articles
                <span className="muted"> · ${pack.perArticleUsd.toFixed(2)} each</span>
              </p>
              <p className="mt-3 text-sm muted">{pack.blurb}</p>
              <Link href="/signup" className={`mt-5 w-full ${pack.popular ? 'btn-primary' : 'btn-outline'}`}>
                Get started
              </Link>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-8 text-xs muted">
          <p>Swarm Writer — GMK Media Ltd. Built on the GMK Swarm architecture.</p>
          <div className="flex items-center gap-4">
            <Link href="/api/health" className="hover:underline">System status</Link>
            <Link href="/login" className="hover:underline">Sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
