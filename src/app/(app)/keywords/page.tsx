import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { listSites } from '@/lib/services/sites';
import { listKeywords } from '@/lib/services/keywords';
import { listClusters } from '@/lib/services/clustering';
import { Card, EmptyState } from '@/components/ui';
import { KeywordWorkbench } from '@/components/app/keyword-workbench';

export const metadata = { title: 'Keywords — Swarm Writer' };
export const dynamic = 'force-dynamic';

export default async function KeywordsPage({
  searchParams,
}: {
  searchParams: Promise<{ siteId?: string }>;
}) {
  const user = await requireUser();
  const { siteId } = await searchParams;
  const sites = await listSites(user.id);

  if (!sites.length) {
    return (
      <Card>
        <EmptyState
          title="Connect a site first"
          action={<Link href="/sites/new" className="btn-primary">Connect a site</Link>}
        >
          Keyword research is scoped to a site so the clusters and plans stay separate per domain.
        </EmptyState>
      </Card>
    );
  }

  const site = sites.find((s) => s.id === siteId) ?? sites[0];
  const [keywords, clusters] = await Promise.all([listKeywords(user.id, site.id), listClusters(user.id, site.id)]);

  return (
    <KeywordWorkbench
      site={{ id: site.id, name: site.name, niche: site.niche }}
      initialKeywords={keywords}
      initialClusters={clusters}
      creditsBalance={user.creditsBalance}
    />
  );
}
