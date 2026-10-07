'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Check, CreditCard, TrendingDown } from 'lucide-react';
import { Alert, Button, Card, CardHeader, EmptyState, Stat, TableShell, Toast } from '@/components/ui';
import { api, errorMessage } from '@/lib/client';
import type { CreditPack, LedgerEntry } from '@/lib/types';
import { formatDateTime } from '@/lib/utils/format';

export function BillingView({
  balance,
  ledger,
  packs,
  stripeMode,
  stats,
  purchase,
}: {
  balance: number;
  ledger: LedgerEntry[];
  packs: CreditPack[];
  stripeMode: string;
  stats: { articles: number; avgCostUsd: number; totalCostUsd: number; targetCostUsd: number };
  purchase: { status: string; credits?: number; mock: boolean } | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
  const [notice, setNotice] = useState(purchase);

  async function buy(pack: CreditPack) {
    setBusy(pack.id);
    try {
      const data = await api.post<{ session: { url: string; mocked: boolean } }>('/api/credits/checkout', {
        packId: pack.id,
      });
      // Mock mode returns a local fulfilment URL; live Stripe returns Checkout.
      window.location.href = data.session.url;
    } catch (e) {
      setToast({ message: errorMessage(e), tone: 'error' });
      setBusy(null);
    }
  }

  /**
   * Margin per article: what the customer paid for a credit, less the model
   * spend it took to fulfil it. Useful for an agency reselling this.
   */
  const marginPerArticle = stats.avgCostUsd ? packs[1].perArticleUsd - stats.avgCostUsd : null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Billing and credits</h1>
        <p className="mt-1 text-sm muted">
          One credit is one article. Keyword research is one credit per 100 keywords. Planning, scoring,
          re-linking and publishing are free, and credits do not expire.
        </p>
      </div>

      {notice?.status === 'success' ? (
        <Alert
          tone="success"
          title={notice.credits ? `${notice.credits} credits added` : 'Purchase complete'}
          onDismiss={() => setNotice(null)}
        >
          {notice.mock
            ? 'Added through the local test checkout — no Stripe key is configured, so no payment was taken.'
            : 'Your balance has been topped up.'}
        </Alert>
      ) : null}
      {notice?.status === 'cancelled' ? (
        <Alert tone="info" title="Checkout cancelled" onDismiss={() => setNotice(null)}>
          Nothing was charged.
        </Alert>
      ) : null}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Credit balance" value={balance} sub={`${balance} article${balance === 1 ? '' : 's'} available`} tone={balance < 5 ? 'warn' : 'good'} />
        <Stat label="Articles generated" value={stats.articles} />
        <Stat
          label="Avg model cost"
          value={stats.avgCostUsd ? `$${stats.avgCostUsd.toFixed(4)}` : '—'}
          sub={`Target $${stats.targetCostUsd.toFixed(3)}`}
          tone={stats.avgCostUsd ? (stats.avgCostUsd <= stats.targetCostUsd ? 'good' : 'warn') : undefined}
        />
        <Stat
          label="Total model spend"
          value={stats.totalCostUsd ? `$${stats.totalCostUsd.toFixed(4)}` : '$0'}
          sub="Across every model call"
        />
      </div>

      {stripeMode === 'mock' ? (
        <Alert tone="warn" title="Stripe is not configured">
          STRIPE_SECRET_KEY is blank, so buying a pack uses a local test checkout that credits your account
          immediately without taking payment. That route is disabled the moment a real key is set.
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        {packs.map((pack) => (
          <Card key={pack.id} className={`relative p-6 ${pack.popular ? 'ring-2 ring-swarm-500' : ''}`}>
            {pack.popular ? (
              <span className="absolute -top-2.5 left-6 rounded-full bg-swarm-600 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                Most picked
              </span>
            ) : null}
            <h2 className="text-sm font-semibold">{pack.name}</h2>
            <p className="mt-3 flex items-baseline gap-1">
              <span className="text-4xl font-bold tracking-tight">${pack.priceUsd}</span>
              <span className="text-sm muted">one-off</span>
            </p>
            <p className="mt-1 text-sm font-medium">
              {pack.credits} credits
              <span className="muted"> · ${pack.perArticleUsd.toFixed(2)} per article</span>
            </p>
            <p className="mt-3 text-sm muted">{pack.blurb}</p>
            <Button
              variant={pack.popular ? 'primary' : 'outline'}
              loading={busy === pack.id}
              onClick={() => buy(pack)}
              className="mt-5 w-full"
            >
              <CreditCard className="h-4 w-4" /> Buy {pack.credits} credits
            </Button>
          </Card>
        ))}
      </div>

      {marginPerArticle !== null ? (
        <Card>
          <CardHeader title="Unit economics" subtitle="What each article actually costs to fulfil" />
          <div className="grid grid-cols-1 gap-4 px-5 py-4 sm:grid-cols-3">
            <div>
              <p className="label">Customer pays (Growth tier)</p>
              <p className="text-xl font-bold tabular-nums">${packs[1].perArticleUsd.toFixed(2)}</p>
            </div>
            <div>
              <p className="label">Model spend</p>
              <p className="text-xl font-bold tabular-nums">${stats.avgCostUsd.toFixed(4)}</p>
            </div>
            <div>
              <p className="label">Gross margin per article</p>
              <p className="inline-flex items-center gap-1.5 text-xl font-bold tabular-nums text-signal-600 dark:text-signal-400">
                <TrendingDown className="h-4 w-4 rotate-180" />
                ${marginPerArticle.toFixed(2)}
                <span className="text-sm font-medium muted">
                  ({Math.round((marginPerArticle / packs[1].perArticleUsd) * 100)}%)
                </span>
              </p>
            </div>
          </div>
          <p className="border-t px-5 py-3 text-xs muted">
            Excludes hosting, DataForSEO and Stripe fees. The figure moves with your article length and how
            often the swarm escalates to Opus, both of which are visible per article under Swarm run.
          </p>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Credit ledger" subtitle="Every movement, so the balance always reconciles" />
        {ledger.length ? (
          <TableShell
            head={
              <tr className="text-left">
                <th className="px-5 py-2.5 font-semibold">When</th>
                <th className="px-3 py-2.5 font-semibold">Reason</th>
                <th className="px-3 py-2.5 text-right font-semibold">Change</th>
                <th className="px-5 py-2.5 text-right font-semibold">Balance</th>
              </tr>
            }
          >
            {ledger.map((e) => (
              <tr key={e.id} className="border-b last:border-b-0">
                <td className="px-5 py-2.5 text-xs muted">
                  {formatDateTime(e.createdAt)}
                </td>
                <td className="px-3 py-2.5">{e.reason}</td>
                <td
                  className={`px-3 py-2.5 text-right font-semibold tabular-nums ${
                    e.delta > 0 ? 'text-signal-600 dark:text-signal-400' : 'text-danger-500'
                  }`}
                >
                  {e.delta > 0 ? '+' : ''}
                  {e.delta}
                </td>
                <td className="px-5 py-2.5 text-right tabular-nums">{e.balanceAfter}</td>
              </tr>
            ))}
          </TableShell>
        ) : (
          <EmptyState icon={<Check className="h-8 w-8" />} title="No credit movements yet" />
        )}
      </Card>

      {toast ? <Toast message={toast.message} tone={toast.tone} onDone={() => setToast(null)} /> : null}
    </div>
  );
}
