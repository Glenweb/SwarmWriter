import { assertCronAuth, boot } from '@/lib/api';
import { env } from '@/lib/env';
import { drainDueJobs } from '@/lib/services/publish';
import { handleError, ok } from '@/lib/utils/result';

/**
 * Drains due publish jobs.
 * Called by the n8n "Swarm Writer — Publisher" workflow every 15 minutes:
 *   POST https://<app>/api/cron/publish
 *   Authorization: Bearer $CRON_SECRET
 * Idempotent and safe to retry: each job is claimed with a conditional UPDATE.
 */
export async function POST(req: Request) {
  try {
    await boot();
    assertCronAuth(req, env.cron.secret);
    const url = new URL(req.url);
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 10) || 10, 50);
    const result = await drainDueJobs(limit);
    return ok({ ...result, ranAt: new Date().toISOString() });
  } catch (e) {
    return handleError(e);
  }
}

/** Convenience for a GET-only scheduler. */
export async function GET(req: Request) {
  return POST(req);
}

export const maxDuration = 300;
