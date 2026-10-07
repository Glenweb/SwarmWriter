import Link from 'next/link';
import { Globe, Plus } from 'lucide-react';
import { requireUser } from '@/lib/auth/session';
import { listSites } from '@/lib/services/sites';
import { providerMode } from '@/lib/env';
import { Card, EmptyState } from '@/components/ui';
import { SiteCard } from '@/components/app/site-card';

export const metadata = { title: 'Sites — Swarm Writer' };
export const dynamic = 'force-dynamic';

export default async function SitesPage() {
  const user = await requireUser();
  const sites = await listSites(user.id);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Sites</h1>
          <p className="mt-1 text-sm muted">
            Each connected site keeps its own keyword set, plans, link index and publishing cadence.
          </p>
        </div>
        <Link href="/sites/new" className="btn-primary">
          <Plus className="h-4 w-4" /> Connect a site
        </Link>
      </div>

      {providerMode.wordpress === 'dry-run' ? (
        <div className="rounded-lg border border-warn-500/35 bg-warn-500/[0.08] px-4 py-3 text-sm">
          <strong>Dry-run mode is on.</strong>{' '}
          <span className="muted">
            WORDPRESS_DRY_RUN=true, so publishing records the exact payload and returns a synthetic post id
            instead of writing to WordPress. Useful for rehearsal; turn it off to go live.
          </span>
        </div>
      ) : null}

      {sites.length ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {sites.map((site) => (
            <SiteCard key={site.id} site={site} />
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={<Globe className="h-8 w-8" />}
            title="No sites yet"
            action={
              <Link href="/sites/new" className="btn-primary">
                <Plus className="h-4 w-4" /> Connect your first site
              </Link>
            }
          >
            You will need a WordPress application password — generate one under Users → Profile →
            Application Passwords. Swarm Writer never asks for your account password.
          </EmptyState>
        </Card>
      )}
    </div>
  );
}
