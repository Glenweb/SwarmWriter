import { requireUser } from '@/lib/auth/session';
import { getBalance, ledger } from '@/lib/services/credits';
import { workspaceStats } from '@/lib/services/articles';
import { CREDIT_PACKS } from '@/lib/providers/stripe';
import { providerMode } from '@/lib/env';
import { BillingView } from '@/components/app/billing-view';

export const metadata = { title: 'Billing — Swarm Writer' };
export const dynamic = 'force-dynamic';

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ purchase?: string; credits?: string; mock?: string }>;
}) {
  const user = await requireUser();
  const { purchase, credits, mock } = await searchParams;

  const [balance, entries, stats] = await Promise.all([
    getBalance(user.id),
    ledger(user.id, 50),
    workspaceStats(user.id),
  ]);

  return (
    <BillingView
      balance={balance}
      ledger={entries}
      packs={CREDIT_PACKS}
      stripeMode={providerMode.stripe}
      stats={{
        articles: stats.articles.total,
        avgCostUsd: stats.cost.avgPerArticleUsd,
        totalCostUsd: stats.cost.totalUsd,
        targetCostUsd: stats.cost.targetPerArticleUsd,
      }}
      purchase={purchase ? { status: purchase, credits: credits ? Number(credits) : undefined, mock: mock === '1' } : null}
    />
  );
}
