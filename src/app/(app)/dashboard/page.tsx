import Link from 'next/link';
import { ArrowRight, CheckCircle2, Globe, Link2, Plus, Sparkles } from 'lucide-react';
import { requireUser } from '@/lib/auth/session';
import { workspaceStats } from '@/lib/services/articles';
import { listSites } from '@/lib/services/sites';
import { listPlans } from '@/lib/services/plans';
import { listArticles } from '@/lib/services/articles';
import { listJobs } from '@/lib/services/publish';
import { env } from '@/lib/env';
import { Card, CardHeader, EmptyState, Pill, ScoreChip, Stat, StatusPill } from '@/components/ui';
import { TierMixBar } from '@/components/app/tier-mix-bar';
import { formatDateTime, formatNumber } from '@/lib/utils/format';

export const metadata = { title: 'Dashboard — Swarm Writer' };
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await requireUser();
  const [stats, sites, articles, jobs] = await Promise.all([
    workspaceStats(user.id),
    listSites(user.id),
    listArticles(user.id),
    listJobs(user.id),
  ]);

  const draftPlans = sites.length
    ? (await Promise.all(sites.map((s) => listPlans(user.id, s.id, 'draft')))).flat()
    : [];
  const approvedPlans = sites.length
    ? (await Promise.all(sites.map((s) => listPlans(user.id, s.id, 'approved')))).flat()
    : [];

  const upcoming = jobs.filter((j) => j.status === 'pending').slice(0, 5);
  const recent = articles.slice(0, 6);
  const connectedCount = sites.filter((s) => s.status === 'connected').length;
  const target = stats.cost.targetPerArticleUsd || env.anthropic.costTargetUsd;
  const avg = stats.cost.avgPerArticleUsd;

  if (!sites.length) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-bold tracking-tight">Welcome to Swarm Writer</h1>
        <p className="mt-2 text-sm muted">
          One thing to do first: connect the WordPress site you want to publish to. Swarm Writer reads your
          existing posts straight away, because that index is what makes the internal linking worth having.
        </p>
        <Card className="mt-6">
          <EmptyState
            icon={<Globe className="h-8 w-8" />}
            title="No site connected yet"
            action={
              <Link href="/sites/new" className="btn-primary">
                <Plus className="h-4 w-4" /> Connect a WordPress site
              </Link>
            }
          >
            You will need the site URL, a username, and a WordPress application password
            (Users → Profile → Application Passwords). It takes about a minute.
          </EmptyState>
        </Card>
        <p className="mt-4 text-xs muted">
          You have <strong>{user.creditsBalance} credits</strong>. Connecting a site and planning content costs nothing.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm muted">
            {connectedCount} of {sites.length} site{sites.length === 1 ? '' : 's'} connected ·{' '}
            {user.creditsBalance} credits left
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/keywords?siteId=${sites[0].id}`} className="btn-outline">
            <Sparkles className="h-4 w-4" /> Research keywords
          </Link>
          <Link href={`/plans?siteId=${sites[0].id}`} className="btn-primary">
            Review plans <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="Articles"
          value={stats.articles.total}
          sub={`${stats.articles.published} published · ${stats.articles.drafts} draft · ${stats.articles.scheduled} scheduled`}
        />
        <Stat
          label="Avg SEO score"
          value={stats.seo.avgScore || '—'}
          sub={stats.seo.avgScore ? (stats.seo.avgScore >= 85 ? 'Excellent' : stats.seo.avgScore >= 70 ? 'Good' : 'Needs work') : 'No scored articles yet'}
          tone={stats.seo.avgScore >= 85 ? 'good' : stats.seo.avgScore >= 70 ? undefined : stats.seo.avgScore ? 'warn' : undefined}
        />
        <Stat
          label="Cost per article"
          value={avg ? `$${avg.toFixed(4)}` : '—'}
          sub={avg ? `Target $${target.toFixed(3)} · ${avg <= target ? 'under' : 'over'} by $${Math.abs(avg - target).toFixed(4)}` : `Target $${target.toFixed(3)}`}
          tone={avg ? (avg <= target ? 'good' : 'warn') : undefined}
        />
        <Stat
          label="Internal links placed"
          value={stats.internalLinks}
          sub={`Into posts already on your site${stats.articles.total ? ` · ${(stats.internalLinks / Math.max(stats.articles.total, 1)).toFixed(1)} per article` : ''}`}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Recent articles"
            subtitle={`${formatNumber(stats.articles.totalWords)} words generated across ${stats.cost.modelCalls} model calls`}
            actions={
              <Link href={`/articles?siteId=${sites[0].id}`} className="btn-ghost text-xs">
                View all
              </Link>
            }
          />
          {recent.length ? (
            <ul className="divide-y">
              {recent.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/articles/${a.id}`}
                    className="flex items-center gap-3 px-5 py-3 transition hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
                  >
                    <ScoreChip score={a.seoScore} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{a.title}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs muted">
                        <span>{formatNumber(a.wordCount)} words</span>
                        <span>·</span>
                        <span>{a.internalLinks.length} internal links</span>
                        <span>·</span>
                        <span className="tabular-nums">${Number(a.costUsd).toFixed(4)}</span>
                      </p>
                    </div>
                    <StatusPill status={a.status} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title="No articles yet"
              action={
                <Link href={`/plans?siteId=${sites[0].id}`} className="btn-primary">
                  Approve a plan to generate one
                </Link>
              }
            >
              {approvedPlans.length
                ? `${approvedPlans.length} approved plan${approvedPlans.length === 1 ? '' : 's'} is ready to generate.`
                : 'Research keywords, then approve a content plan.'}
            </EmptyState>
          )}
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Model spend mix" subtitle="Share of spend by tier, against the design target" />
            <div className="px-5 py-4">
              <TierMixBar
                actual={stats.tierSpendShare}
                target={{ haiku: env.anthropic.mix.haiku, sonnet: env.anthropic.mix.sonnet, opus: env.anthropic.mix.opus }}
                totalUsd={stats.cost.totalUsd}
              />
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Needs you"
              subtitle="Nothing generates without an approval"
              actions={
                draftPlans.length ? (
                  <Link href={`/plans?siteId=${sites[0].id}`} className="btn-ghost text-xs">
                    Open board
                  </Link>
                ) : null
              }
            />
            <ul className="divide-y text-sm">
              <li className="flex items-center justify-between gap-3 px-5 py-3">
                <span>Plans awaiting approval</span>
                {draftPlans.length ? <Pill tone="amber">{draftPlans.length}</Pill> : <CheckCircle2 className="h-4 w-4 text-signal-500" />}
              </li>
              <li className="flex items-center justify-between gap-3 px-5 py-3">
                <span>Approved, not yet generated</span>
                {approvedPlans.length ? <Pill tone="blue">{approvedPlans.length}</Pill> : <CheckCircle2 className="h-4 w-4 text-signal-500" />}
              </li>
              <li className="flex items-center justify-between gap-3 px-5 py-3">
                <span>Sites needing a post sync</span>
                {sites.filter((s) => !s.postsSyncedAt).length ? (
                  <Pill tone="amber">{sites.filter((s) => !s.postsSyncedAt).length}</Pill>
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-signal-500" />
                )}
              </li>
            </ul>
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Next to publish"
            subtitle="Drained by n8n every 15 minutes"
            actions={
              <Link href={`/calendar?siteId=${sites[0].id}`} className="btn-ghost text-xs">
                Calendar
              </Link>
            }
          />
          {upcoming.length ? (
            <ul className="divide-y">
              {upcoming.map((j) => (
                <li key={j.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{j.articleTitle}</p>
                    <p className="text-xs muted">
                      {formatDateTime(j.scheduledFor)}
                      {j.dryRun ? ' · dry run' : ''}
                    </p>
                  </div>
                  <StatusPill status={j.status} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Nothing scheduled">Open an article and schedule it, or publish immediately.</EmptyState>
          )}
        </Card>

        <Card>
          <CardHeader title="Connected sites" actions={<Link href="/sites" className="btn-ghost text-xs">Manage</Link>} />
          <ul className="divide-y">
            {sites.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{s.name}</p>
                  <p className="flex flex-wrap items-center gap-x-2 text-xs muted">
                    <span className="truncate font-mono">{s.url.replace(/^https?:\/\//, '')}</span>
                    <span>·</span>
                    <span className="inline-flex items-center gap-1">
                      <Link2 className="h-3 w-3" /> {s.postCount} posts indexed
                    </span>
                  </p>
                </div>
                <StatusPill status={s.status} />
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
