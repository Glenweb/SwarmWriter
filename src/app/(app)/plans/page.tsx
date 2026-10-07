import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { listSites } from '@/lib/services/sites';
import { listPlans } from '@/lib/services/plans';
import { listClusters } from '@/lib/services/clustering';
import { Card, EmptyState } from '@/components/ui';
import { PlanBoard } from '@/components/app/plan-board';

export const metadata = { title: 'Content plans — Swarm Writer' };
export const dynamic = 'force-dynamic';

export default async function PlansPage({ searchParams }: { searchParams: Promise<{ siteId?: string }> }) {
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
  const [plans, clusters] = await Promise.all([listPlans(user.id, site.id), listClusters(user.id, site.id)]);

  return (
    <PlanBoard
      site={{ id: site.id, name: site.name, postCount: site.postCount, postsSynced: Boolean(site.postsSyncedAt) }}
      initialPlans={plans}
      hasClusters={clusters.length > 0}
      creditsBalance={user.creditsBalance}
    />
  );
}
