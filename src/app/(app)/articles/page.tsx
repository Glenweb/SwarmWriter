import Link from 'next/link';
import { FileText } from 'lucide-react';
import { requireUser } from '@/lib/auth/session';
import { listSites } from '@/lib/services/sites';
import { listArticles } from '@/lib/services/articles';
import { Card, CardHeader, EmptyState, ScoreChip, StatusPill, TableShell } from '@/components/ui';
import { formatDate, formatNumber } from '@/lib/utils/format';

export const metadata = { title: 'Articles — Swarm Writer' };
export const dynamic = 'force-dynamic';

export default async function ArticlesPage({ searchParams }: { searchParams: Promise<{ siteId?: string }> }) {
  const user = await requireUser();
  const { siteId } = await searchParams;
  const sites = await listSites(user.id);

  if (!sites.length) {
    return (
      <Card>
        <EmptyState title="Connect a site first" action={<Link href="/sites/new" className="btn-primary">Connect a site</Link>} />
      </Card>
    );
  }

  const site = sites.find((s) => s.id === siteId) ?? sites[0];
  const articles = await listArticles(user.id, site.id);

  const totalCost = articles.reduce((s, a) => s + Number(a.costUsd), 0);
  const avgScore = articles.filter((a) => a.seoScore > 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Articles</h1>
        <p className="mt-1 text-sm muted">
          {site.name} · {articles.length} article{articles.length === 1 ? '' : 's'}
          {avgScore.length
            ? ` · avg SEO ${Math.round(avgScore.reduce((s, a) => s + a.seoScore, 0) / avgScore.length)}/100`
            : ''}
          {totalCost ? ` · $${totalCost.toFixed(4)} total model spend` : ''}
        </p>
      </div>

      <Card>
        <CardHeader title="All articles" subtitle="Open one to edit, re-link, re-score, schedule or publish." />
        {articles.length ? (
          <TableShell
            head={
              <tr className="text-left">
                <th className="px-5 py-2.5 font-semibold">SEO</th>
                <th className="px-3 py-2.5 font-semibold">Title</th>
                <th className="px-3 py-2.5 text-right font-semibold">Words</th>
                <th className="px-3 py-2.5 text-right font-semibold">Links</th>
                <th className="px-3 py-2.5 text-right font-semibold">Cost</th>
                <th className="px-3 py-2.5 font-semibold">Status</th>
                <th className="px-5 py-2.5 text-right font-semibold">Updated</th>
              </tr>
            }
          >
            {articles.map((a) => (
              <tr key={a.id} className="border-b last:border-b-0 hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
                <td className="px-5 py-2.5">
                  <ScoreChip score={a.seoScore} size="sm" />
                </td>
                <td className="px-3 py-2.5">
                  <Link href={`/articles/${a.id}`} className="font-medium hover:underline">
                    {a.title}
                  </Link>
                  <p className="mt-0.5 text-xs muted">{a.focusKeyword}</p>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(a.wordCount)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{a.internalLinks.length}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">${Number(a.costUsd).toFixed(4)}</td>
                <td className="px-3 py-2.5">
                  <StatusPill status={a.status} />
                  {a.wpUrl ? (
                    <a
                      href={a.wpUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-0.5 block text-[11px] text-swarm-600 hover:underline dark:text-swarm-400"
                    >
                      View live
                    </a>
                  ) : null}
                </td>
                <td className="px-5 py-2.5 text-right text-xs muted">
                  {formatDate(a.updatedAt)}
                </td>
              </tr>
            ))}
          </TableShell>
        ) : (
          <EmptyState
            icon={<FileText className="h-8 w-8" />}
            title="No articles yet"
            action={<Link href={`/plans?siteId=${site.id}`} className="btn-primary">Approve a plan to generate one</Link>}
          >
            Articles are generated from approved content plans. One credit each.
          </EmptyState>
        )}
      </Card>
    </div>
  );
}
