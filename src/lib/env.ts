/**
 * Single source of truth for configuration.
 *
 * Every integration is optional. A blank key selects that provider's mock twin,
 * which is what lets the whole pipeline run on a clean checkout with no accounts.
 * `/api/health` reports exactly which mode each provider is in.
 */
import { createHash } from 'node:crypto';

const str = (v: string | undefined, fallback = ''): string => (v && v.trim() ? v.trim() : fallback);
const num = (v: string | undefined, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const bool = (v: string | undefined, fallback = false): boolean =>
  v == null || v.trim() === '' ? fallback : ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());

/** Stable dev-only secret so sessions survive a restart without forcing setup. */
function devSecret(): string {
  return createHash('sha256').update('swarm-writer::dev::do-not-use-in-production').digest('hex');
}

export const env = {
  nodeEnv: str(process.env.NODE_ENV, 'development'),
  isProd: process.env.NODE_ENV === 'production',
  appUrl: str(process.env.APP_URL, 'http://localhost:3000').replace(/\/$/, ''),
  authSecret: str(process.env.AUTH_SECRET) || devSecret(),

  databaseUrl: str(process.env.DATABASE_URL),

  anthropic: {
    apiKey: str(process.env.ANTHROPIC_API_KEY),
    models: {
      haiku: str(process.env.MODEL_HAIKU, 'claude-haiku-4-5-20251001'),
      sonnet: str(process.env.MODEL_SONNET, 'claude-sonnet-5-5'),
      opus: str(process.env.MODEL_OPUS, 'claude-opus-5-5'),
    },
    mix: {
      haiku: num(process.env.TIER_MIX_HAIKU, 0.7),
      sonnet: num(process.env.TIER_MIX_SONNET, 0.28),
      opus: num(process.env.TIER_MIX_OPUS, 0.02),
    },
    costTargetUsd: num(process.env.ARTICLE_COST_TARGET_USD, 0.039),
  },

  dataForSeo: {
    login: str(process.env.DATAFORSEO_LOGIN),
    password: str(process.env.DATAFORSEO_PASSWORD),
    locationCode: num(process.env.DATAFORSEO_LOCATION_CODE, 2826),
    languageCode: str(process.env.DATAFORSEO_LANGUAGE_CODE, 'en'),
  },

  stripe: {
    secretKey: str(process.env.STRIPE_SECRET_KEY),
    webhookSecret: str(process.env.STRIPE_WEBHOOK_SECRET),
    prices: {
      starter: str(process.env.STRIPE_PRICE_STARTER),
      growth: str(process.env.STRIPE_PRICE_GROWTH),
      agency: str(process.env.STRIPE_PRICE_AGENCY),
    },
  },

  cron: {
    secret: str(process.env.CRON_SECRET),
    n8nBaseUrl: str(process.env.N8N_BASE_URL, 'https://gmkmedia.app.n8n.cloud'),
    n8nWebhookPath: str(process.env.N8N_WEBHOOK_PATH, '/webhook/swarm-writer'),
  },

  wordpressDryRun: bool(process.env.WORDPRESS_DRY_RUN, false),

  seed: {
    email: str(process.env.SEED_DEMO_USER, 'demo@gmkmedia.co.uk'),
    password: str(process.env.SEED_DEMO_PASSWORD, 'swarmwriter'),
  },
} as const;

export const providerMode = {
  db: env.databaseUrl ? ('neon' as const) : ('embedded' as const),
  anthropic: env.anthropic.apiKey ? ('live' as const) : ('mock' as const),
  dataForSeo: env.dataForSeo.login && env.dataForSeo.password ? ('live' as const) : ('mock' as const),
  stripe: env.stripe.secretKey ? ('live' as const) : ('mock' as const),
  wordpress: env.wordpressDryRun ? ('dry-run' as const) : ('live' as const),
};
