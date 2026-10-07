import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { listSites } from '@/lib/services/sites';
import { listJobs } from '@/lib/services/publish';
import { listArticles } from '@/lib/services/articles';
import { env } from '@/lib/env';
import { Card, EmptyState } from '@/components/ui';
import { PublishCalendar } from '@/components/app/publish-calendar';

export const metadata = { title: 'Calendar — Swarm Writer' };
export const dynamic = 'force-dynamic';

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ siteId?: string }> }) {
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
  const [jobs, articles] = await Promise.all([
    listJobs(user.id, { siteId: site.id }),
    listArticles(user.id, site.id),
  ]);

  return (
    <PublishCalendar
      site={{ id: site.id, name: site.name, cadence: site.publishCadence }}
      initialJobs={jobs}
      schedulable={articles
        .filter((a) => a.status === 'draft' && !jobs.some((j) => j.articleId === a.id && j.status === 'pending'))
        .map((a) => ({ id: a.id, title: a.title, seoScore: a.seoScore }))}
      n8n={{ baseUrl: env.cron.n8nBaseUrl, secretSet: Boolean(env.cron.secret), appUrl: env.appUrl }}
    />
  );
}
