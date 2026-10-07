import { boot } from '@/lib/api';
import { dbKind, sql } from '@/lib/db/client';
import { env, providerMode } from '@/lib/env';
import { handleError, ok } from '@/lib/utils/result';

/**
 * Which mode every integration is in, and whether the DB answers.
 * This is the page to open first when something looks wrong.
 */
export async function GET() {
  try {
    await boot();
    const started = Date.now();
    const [row] = await sql`SELECT count(*)::int AS users FROM users`;
    const dbMs = Date.now() - started;

    return ok({
      status: 'ok',
      version: '1.0.0',
      time: new Date().toISOString(),
      database: { driver: await dbKind(), mode: providerMode.db, users: Number(row?.users ?? 0), latencyMs: dbMs },
      providers: {
        anthropic: {
          mode: providerMode.anthropic,
          models: env.anthropic.models,
          costTargetUsd: env.anthropic.costTargetUsd,
          note: providerMode.anthropic === 'mock' ? 'Set ANTHROPIC_API_KEY for live generation.' : undefined,
        },
        dataForSeo: {
          mode: providerMode.dataForSeo,
          locationCode: env.dataForSeo.locationCode,
          note: providerMode.dataForSeo === 'mock' ? 'Set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD for live keyword data.' : undefined,
        },
        wordpress: { mode: providerMode.wordpress, dryRun: env.wordpressDryRun },
        stripe: {
          mode: providerMode.stripe,
          note: providerMode.stripe === 'mock' ? 'Set STRIPE_SECRET_KEY for real checkout.' : undefined,
        },
        n8n: { baseUrl: env.cron.n8nBaseUrl, cronSecretSet: Boolean(env.cron.secret) },
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
