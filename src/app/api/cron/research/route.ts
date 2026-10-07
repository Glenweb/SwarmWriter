import { assertCronAuth, boot } from '@/lib/api';
import { env } from '@/lib/env';
import { sql } from '@/lib/db/client';
import { refreshMetrics } from '@/lib/services/keywords';
import { handleError, ok } from '@/lib/utils/result';

/**
 * Weekly keyword-metric refresh.
 * Called by the n8n "Swarm Writer — Researcher" workflow. Does not bill credits:
 * refreshing numbers the user already paid to discover is maintenance, not research.
 */
export async function POST(req: Request) {
  try {
    await boot();
    assertCronAuth(req, env.cron.secret);
    const url = new URL(req.url);
    const siteId = url.searchParams.get('siteId');
    const perSite = Math.min(Number(url.searchParams.get('perSite') ?? 50) || 50, 200);

    const sites = siteId
      ? await sql`SELECT id, name FROM sites WHERE id = ${siteId}`
      : await sql`SELECT id, name FROM sites WHERE status = 'connected' ORDER BY updated_at ASC LIMIT 25`;

    const results: Array<{ siteId: string; name: string; updated: number }> = [];
    for (const site of sites) {
      const updated = await refreshMetrics(site.id, perSite);
      results.push({ siteId: site.id, name: site.name, updated });
    }
    return ok({ sites: results.length, results, ranAt: new Date().toISOString() });
  } catch (e) {
    return handleError(e);
  }
}

export async function GET(req: Request) {
  return POST(req);
}

export const maxDuration = 300;
