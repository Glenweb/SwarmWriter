import { boot } from '@/lib/api';
import { requireUser } from '@/lib/auth/session';
import { workspaceStats } from '@/lib/services/articles';
import { listSites } from '@/lib/services/sites';
import { getBalance } from '@/lib/services/credits';
import { handleError, ok } from '@/lib/utils/result';

/** Dashboard payload: measured cost per article, tier spend mix, link coverage. */
export async function GET() {
  try {
    await boot();
    const user = await requireUser();
    const [stats, sites, balance] = await Promise.all([
      workspaceStats(user.id),
      listSites(user.id),
      getBalance(user.id),
    ]);
    return ok({
      ...stats,
      sites: { total: sites.length, connected: sites.filter((s) => s.status === 'connected').length },
      credits: { balance },
    });
  } catch (e) {
    return handleError(e);
  }
}
