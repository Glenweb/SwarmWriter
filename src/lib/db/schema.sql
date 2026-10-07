-- Swarm Writer schema. Runs identically on Neon Postgres and embedded PGlite.
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  name            TEXT,
  password_hash   TEXT NOT NULL,
  plan            TEXT NOT NULL DEFAULT 'free',
  credits_balance INTEGER NOT NULL DEFAULT 0,
  stripe_customer_id TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  user_agent  TEXT,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

CREATE TABLE IF NOT EXISTS sites (
  id                   TEXT PRIMARY KEY,
  user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  url                  TEXT NOT NULL,
  wp_username          TEXT,
  wp_app_password_enc  TEXT,
  status               TEXT NOT NULL DEFAULT 'pending',   -- pending|connected|error
  status_detail        TEXT,
  default_author_id    INTEGER,
  default_category_id  INTEGER,
  rankmath_detected    BOOLEAN NOT NULL DEFAULT false,
  niche                TEXT,
  audience             TEXT,
  tone                 TEXT NOT NULL DEFAULT 'expert, direct, practical',
  posts_synced_at      TIMESTAMPTZ,
  post_count           INTEGER NOT NULL DEFAULT 0,
  publish_cadence      TEXT NOT NULL DEFAULT 'weekly',    -- daily|3x_week|weekly|biweekly
  auto_publish         BOOLEAN NOT NULL DEFAULT false,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sites_user_idx ON sites(user_id);

-- Index of the live site's existing posts. Powers internal linking.
CREATE TABLE IF NOT EXISTS site_posts (
  id          TEXT PRIMARY KEY,
  site_id     TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  wp_post_id  INTEGER NOT NULL,
  title       TEXT NOT NULL,
  slug        TEXT NOT NULL,
  url         TEXT NOT NULL,
  excerpt     TEXT,
  tokens      TEXT,                                        -- space-joined normalised tokens
  published_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, wp_post_id)
);
CREATE INDEX IF NOT EXISTS site_posts_site_idx ON site_posts(site_id);

CREATE TABLE IF NOT EXISTS keyword_clusters (
  id             TEXT PRIMARY KEY,
  site_id        TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  label          TEXT NOT NULL,
  pillar_keyword TEXT NOT NULL,
  intent         TEXT NOT NULL DEFAULT 'informational',
  keyword_count  INTEGER NOT NULL DEFAULT 0,
  total_volume   INTEGER NOT NULL DEFAULT 0,
  avg_difficulty NUMERIC(5,2) NOT NULL DEFAULT 0,
  opportunity    NUMERIC(6,2) NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clusters_site_idx ON keyword_clusters(site_id);

CREATE TABLE IF NOT EXISTS keywords (
  id            TEXT PRIMARY KEY,
  site_id       TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  cluster_id    TEXT REFERENCES keyword_clusters(id) ON DELETE SET NULL,
  keyword       TEXT NOT NULL,
  seed          TEXT,
  volume        INTEGER NOT NULL DEFAULT 0,
  cpc           NUMERIC(8,2) NOT NULL DEFAULT 0,
  competition   NUMERIC(4,3) NOT NULL DEFAULT 0,
  difficulty    INTEGER NOT NULL DEFAULT 0,
  intent        TEXT NOT NULL DEFAULT 'informational',     -- informational|commercial|transactional|navigational
  serp_snapshot JSONB,
  status        TEXT NOT NULL DEFAULT 'new',               -- new|selected|planned|rejected
  source        TEXT NOT NULL DEFAULT 'dataforseo',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, keyword)
);
CREATE INDEX IF NOT EXISTS keywords_site_idx ON keywords(site_id);
CREATE INDEX IF NOT EXISTS keywords_cluster_idx ON keywords(cluster_id);

CREATE TABLE IF NOT EXISTS content_plans (
  id                 TEXT PRIMARY KEY,
  site_id            TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  cluster_id         TEXT REFERENCES keyword_clusters(id) ON DELETE SET NULL,
  keyword_id         TEXT REFERENCES keywords(id) ON DELETE SET NULL,
  title              TEXT NOT NULL,
  angle              TEXT,
  target_keyword     TEXT NOT NULL,
  secondary_keywords JSONB NOT NULL DEFAULT '[]',
  search_intent      TEXT NOT NULL DEFAULT 'informational',
  content_type       TEXT NOT NULL DEFAULT 'guide',        -- guide|listicle|comparison|review|how_to|news
  word_target        INTEGER NOT NULL DEFAULT 1800,
  outline            JSONB NOT NULL DEFAULT '[]',
  link_intents       JSONB NOT NULL DEFAULT '[]',
  priority           INTEGER NOT NULL DEFAULT 50,
  est_volume         INTEGER NOT NULL DEFAULT 0,
  est_difficulty     INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'draft',        -- draft|approved|rejected|generated
  scheduled_for      TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS plans_site_idx ON content_plans(site_id);
CREATE INDEX IF NOT EXISTS plans_status_idx ON content_plans(status);

CREATE TABLE IF NOT EXISTS articles (
  id               TEXT PRIMARY KEY,
  site_id          TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  plan_id          TEXT REFERENCES content_plans(id) ON DELETE SET NULL,
  title            TEXT NOT NULL,
  slug             TEXT NOT NULL,
  html             TEXT NOT NULL DEFAULT '',
  markdown         TEXT NOT NULL DEFAULT '',
  excerpt          TEXT,
  meta_title       TEXT,
  meta_description TEXT,
  focus_keyword    TEXT,
  canonical_url    TEXT,
  secondary_keywords JSONB NOT NULL DEFAULT '[]',
  schema_json      JSONB,
  faq              JSONB NOT NULL DEFAULT '[]',
  images           JSONB NOT NULL DEFAULT '[]',
  internal_links   JSONB NOT NULL DEFAULT '[]',
  external_links   JSONB NOT NULL DEFAULT '[]',
  seo_score        INTEGER NOT NULL DEFAULT 0,
  seo_report       JSONB,
  word_count       INTEGER NOT NULL DEFAULT 0,
  reading_minutes  INTEGER NOT NULL DEFAULT 0,
  cost_usd         NUMERIC(10,5) NOT NULL DEFAULT 0,
  tier_mix         JSONB,
  status           TEXT NOT NULL DEFAULT 'queued',         -- queued|generating|draft|scheduled|published|failed
  error            TEXT,
  wp_post_id       INTEGER,
  wp_url           TEXT,
  published_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS articles_site_idx ON articles(site_id);
CREATE INDEX IF NOT EXISTS articles_status_idx ON articles(status);

-- One row per model call. Makes cost-per-article a measurement, not an estimate.
CREATE TABLE IF NOT EXISTS article_runs (
  id            TEXT PRIMARY KEY,
  article_id    TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  stage         TEXT NOT NULL,
  tier          TEXT NOT NULL,                             -- haiku|sonnet|opus
  model         TEXT NOT NULL,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd      NUMERIC(10,6) NOT NULL DEFAULT 0,
  ms            INTEGER NOT NULL DEFAULT 0,
  ok            BOOLEAN NOT NULL DEFAULT true,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS runs_article_idx ON article_runs(article_id);

CREATE TABLE IF NOT EXISTS publish_jobs (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_id       TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  article_id    TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  scheduled_for TIMESTAMPTZ NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',           -- pending|running|published|failed|cancelled
  attempts      INTEGER NOT NULL DEFAULT 0,
  wp_post_id    INTEGER,
  wp_url        TEXT,
  dry_run       BOOLEAN NOT NULL DEFAULT false,
  payload       JSONB,
  last_error    TEXT,
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_due_idx ON publish_jobs(status, scheduled_for);
CREATE INDEX IF NOT EXISTS jobs_site_idx ON publish_jobs(site_id);

CREATE TABLE IF NOT EXISTS usage_credits (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta             INTEGER NOT NULL,                      -- +grant / -debit
  reason            TEXT NOT NULL,
  balance_after     INTEGER NOT NULL,
  ref_id            TEXT,
  stripe_session_id TEXT UNIQUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS credits_user_idx ON usage_credits(user_id);
