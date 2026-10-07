'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ExternalLink, RefreshCw, Search, Trash2, Zap } from 'lucide-react';
import { Alert, Button, Card, CardHeader, Modal, Pill, StatusPill, Toast } from '@/components/ui';
import { api, errorMessage } from '@/lib/client';
import type { Site, VerifyResult } from '@/lib/types';
import { formatDate } from '@/lib/utils/format';

const CADENCE: Record<string, string> = {
  daily: 'Daily',
  '3x_week': '3× a week',
  weekly: 'Weekly',
  biweekly: 'Fortnightly',
};

export function SiteCard({ site }: { site: Site }) {
  const router = useRouter();
  const [busy, setBusy] = useState<'verify' | 'sync' | 'delete' | null>(null);
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function run(action: 'verify' | 'sync') {
    setBusy(action);
    try {
      if (action === 'verify') {
        const data = await api.post<{ verify: VerifyResult }>(`/api/sites/${site.id}/verify`);
        setVerify(data.verify);
        setToast({
          message: data.verify.ok ? 'Connection verified.' : data.verify.error ?? 'Verification failed.',
          tone: data.verify.ok ? 'success' : 'error',
        });
      } else {
        const data = await api.post<{ count: number }>(`/api/sites/${site.id}/sync-posts`);
        setToast({ message: `Indexed ${data.count} existing posts for internal linking.`, tone: 'success' });
      }
      router.refresh();
    } catch (e) {
      setToast({ message: errorMessage(e), tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy('delete');
    try {
      await api.del(`/api/sites/${site.id}`);
      setConfirmDelete(false);
      router.refresh();
    } catch (e) {
      setToast({ message: errorMessage(e), tone: 'error' });
      setBusy(null);
    }
  }

  return (
    <>
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              {site.name} <StatusPill status={site.status} />
            </span>
          }
          subtitle={
            <a href={site.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline">
              {site.url.replace(/^https?:\/\//, '')} <ExternalLink className="h-3 w-3" />
            </a>
          }
          actions={
            <>
              <Button variant="ghost" loading={busy === 'verify'} onClick={() => run('verify')} className="text-xs">
                <Zap className="h-3.5 w-3.5" /> Verify
              </Button>
              <Button variant="ghost" loading={busy === 'sync'} onClick={() => run('sync')} className="text-xs">
                <RefreshCw className="h-3.5 w-3.5" /> Sync posts
              </Button>
            </>
          }
        />

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-5 py-4 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wide muted">Link index</dt>
            <dd className="mt-0.5 font-medium tabular-nums">{site.postCount} posts</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wide muted">Last synced</dt>
            <dd className="mt-0.5 font-medium">
              {site.postsSyncedAt ? formatDate(site.postsSyncedAt) : 'Never'}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wide muted">Cadence</dt>
            <dd className="mt-0.5 font-medium">{CADENCE[site.publishCadence] ?? site.publishCadence}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wide muted">RankMath</dt>
            <dd className="mt-0.5">
              {site.rankMathDetected ? <Pill tone="green">Detected</Pill> : <Pill tone="amber">Not over REST</Pill>}
            </dd>
          </div>
        </dl>

        {site.niche ? (
          <p className="border-t px-5 py-3 text-xs muted">
            <span className="font-semibold">Brief:</span> {site.niche}
            {site.audience ? ` · ${site.audience}` : ''}
          </p>
        ) : null}

        {site.statusDetail ? (
          <div className="border-t px-5 py-3">
            <Alert tone={site.status === 'error' ? 'error' : 'warn'}>{site.statusDetail}</Alert>
          </div>
        ) : null}

        {verify && verify.warnings.length ? (
          <div className="space-y-2 border-t px-5 py-3">
            {verify.warnings.map((w) => (
              <Alert key={w} tone="warn">{w}</Alert>
            ))}
          </div>
        ) : null}

        {!site.postsSyncedAt ? (
          <div className="border-t px-5 py-3">
            <Alert tone="info" title="Sync the posts before generating">
              Internal linking ranks candidates from your existing posts. Without the index, articles ship
              with no internal links and lose 8 points of on-page score.
            </Alert>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-5 py-3">
          <div className="flex flex-wrap gap-2">
            <Link href={`/keywords?siteId=${site.id}`} className="btn-outline text-xs">
              <Search className="h-3.5 w-3.5" /> Keywords
            </Link>
            <Link href={`/plans?siteId=${site.id}`} className="btn-outline text-xs">
              Plans
            </Link>
            <Link href={`/articles?siteId=${site.id}`} className="btn-outline text-xs">
              Articles
            </Link>
          </div>
          <Button variant="ghost" onClick={() => setConfirmDelete(true)} className="text-xs text-danger-500">
            <Trash2 className="h-3.5 w-3.5" /> Remove
          </Button>
        </div>
      </Card>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Remove ${site.name}?`}
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="danger" loading={busy === 'delete'} onClick={remove}>Remove site</Button>
          </>
        }
      >
        <p className="text-sm">
          This deletes the site&apos;s keywords, clusters, plans, articles and publish jobs from Swarm Writer.
        </p>
        <p className="mt-2 text-sm muted">
          Posts already published to WordPress are not touched — they stay live on your site.
        </p>
      </Modal>

      {toast ? <Toast message={toast.message} tone={toast.tone} onDone={() => setToast(null)} /> : null}
    </>
  );
}
