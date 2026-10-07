# Swarm Writer — System Architecture
**Agent 1 deliverable.** Product requirements, system structure, data model, API surface
and integration contracts. Agents 2–4 build against this document.

Swarm Writer extends the **GMK Swarm** architecture: a pipeline of narrow, cheap agents
coordinated by a planner, rather than one expensive generalist call. The same pattern
that runs the GMK content swarm is applied here to SEO article production.

---

## 1. Who this is for

| Segment | Core job | What they will not tolerate |
|---|---|---|
| Blogger | Publish 4–12 posts/month without writing them | Content that reads as machine output |
| Affiliate site owner | Rank commercial-intent pages; keep internal links tight | Orphan pages, no money-page links |
| Small agency | Run 5–40 client sites from one console | Per-site logins, no cost visibility |

### Benchmark: SEOBOT (seobotai.com)
SEOBOT is the incumbent. This plan must beat it on three axes, and those three
axes drive most of the architecture below:

| Axis | SEOBOT | Swarm Writer target | How |
|---|---|---|---|
| Article quality | Single-pass generation | 7-stage swarm: research → outline → section drafting → fact pass → SEO pass → link pass → polish | §5 |
| Cost per article | Opaque, bundled in subscription | **$0.039** measured and shown per article | Tier router, §6 |
| Internal linking | Keyword-match on own generated posts | Embedding-free TF-IDF + slug/title/heading index of the **live site's existing posts**, pulled over WP REST | §7 |

Two further wedges: **RankMath-native** meta injection (SEOBOT writes generic Yoast-ish
fields), and **credit-based billing** so agencies pay for output rather than seats.

---

## 2. Feature set (v1 scope)

1. **Auth** — email + password, httpOnly JWT session cookie, scrypt hashing.
2. **Site connection** — WordPress REST + application password, verified on save,
   credential encrypted at rest (AES-256-GCM).
3. **Keyword research** — DataForSEO keyword ideas + SERP, volume / CPC / difficulty /
   intent, saved per site.
4. **Clustering** — token-overlap + intent agreement clustering into topic clusters with
   a nominated pillar keyword.
5. **Content plans** — cluster → titles, angles, word targets, internal-link intents;
   human approves / edits / rejects per row.
6. **Article generation** — the 7-stage swarm with per-stage model tier routing.
7. **On-page SEO scoring** — 12 weighted signals, 0–100, with specific fixes.
8. **Automatic internal linking** — against the live site's existing posts.
9. **Images** — alt text + figure captions generated per section.
10. **Schema** — Article / FAQPage / BreadcrumbList JSON-LD.
11. **RankMath injection** — `rank_math_title`, `rank_math_description`,
    `rank_math_focus_keyword`, `rank_math_canonical_url`, `rank_math_robots`.
12. **Scheduled publishing** — publish jobs with a calendar, retries, dry-run.
13. **Credits & billing** — Stripe credit packs, metered debits, full ledger.

---

## 3. System structure

```
                 ┌──────────────── Next.js on Vercel ────────────────┐
  Browser ─────▶ │  App Router (RSC) ── /api route handlers          │
                 │     src/app                  src/app/api         │
                 └───────┬──────────────────────────┬────────────────┘
                         │                          │
             ┌───────────▼──────────┐   ┌───────────▼─────────────────┐
             │ src/lib/services     │   │ src/lib/providers           │
             │ (business logic)     │   │ (external systems + mocks)  │
             │  keywords  plans     │   │  dataforseo   anthropic     │
             │  articles  publish   │   │  wordpress    stripe        │
             │  credits   seo       │   └───────────┬─────────────────┘
             └───────────┬──────────┘               │
                         │                 DataForSEO · Anthropic
             ┌───────────▼──────────┐      WordPress REST · Stripe
             │ src/lib/db           │
             │ Neon  ⇄  PGlite      │
             └──────────────────────┘
                         ▲
          n8n (gmkmedia.app.n8n.cloud) ──▶ POST /api/cron/*
```

**Rule the layers enforce:** route handlers never talk to providers, and services never
talk to `fetch`. Everything crossing the process boundary goes through
`src/lib/providers/*`, each of which ships a mock twin. That is what makes the app
runnable on day one with no keys, and testable without network.

### Folder layout

```
src/
  app/
    (marketing)/page.tsx            landing
    (auth)/login  (auth)/signup
    (app)/dashboard                 workspace overview
    (app)/sites  /sites/new         connection wizard
    (app)/keywords                  research + clusters
    (app)/plans                     approval board
    (app)/articles  /articles/[id]  editor + SEO panel
    (app)/calendar                  publishing schedule
    (app)/billing                   credits
    api/
      auth/{signup,login,logout,me}
      sites/{,[id],[id]/verify,[id]/sync-posts}
      keywords/{research,cluster,,[id]}
      plans/{,generate,[id],[id]/approve}
      articles/{,generate,[id],[id]/score,[id]/relink,[id]/publish}
      publish-jobs/{,[id]}
      credits/{,checkout,webhook}
      cron/{publish,research}
      health
  lib/
    db/            client.ts schema.sql migrate.ts repo/*.ts
    providers/     dataforseo.ts anthropic.ts wordpress.ts stripe.ts  (+ mocks)
    services/      keywords.ts clustering.ts plans.ts articles.ts
                   swarm/*.ts seo-score.ts internal-links.ts schema-gen.ts
                   publish.ts credits.ts
    auth/          session.ts password.ts crypto.ts
    utils/         slug.ts text.ts money.ts result.ts
  components/      ui/* app/* marketing/*
scripts/           migrate.ts seed.ts smoke.ts e2e-pipeline.ts mock-wp-server.ts
n8n/               swarm-writer-workflows.json
docs/              ARCHITECTURE.md RUNBOOK.md
```

---

## 4. Data model

Nine tables. Postgres, UUID primary keys, `created_at`/`updated_at` everywhere.
Full DDL: `src/lib/db/schema.sql`.

```
users ─┬─< sites ─┬─< keywords ─┬─< content_plans ─< articles ─< publish_jobs
       │          ├─< keyword_clusters ──┘              │
       │          └─< site_posts  (internal-link index) │
       ├─< usage_credits   (ledger: grants + debits)    │
       └─< sessions                                     │
                                       article_runs ────┘  (per-stage model + cost)
```

| Table | Purpose | Key columns |
|---|---|---|
| `users` | Account | `email`, `password_hash`, `credits_balance`, `plan` |
| `sessions` | Session revocation | `user_id`, `token_hash`, `expires_at` |
| `sites` | Connected WP site | `url`, `wp_username`, `wp_app_password_enc`, `status`, `default_author_id`, `posts_synced_at` |
| `site_posts` | Live-post index for linking | `site_id`, `wp_post_id`, `title`, `slug`, `url`, `excerpt`, `tokens` |
| `keywords` | Researched term | `site_id`, `keyword`, `volume`, `cpc`, `difficulty`, `intent`, `serp_snapshot`, `cluster_id`, `status` |
| `keyword_clusters` | Topic cluster | `site_id`, `label`, `pillar_keyword`, `intent`, `total_volume`, `avg_difficulty` |
| `content_plans` | Approved brief | `cluster_id`, `title`, `angle`, `target_keyword`, `secondary_keywords`, `word_target`, `outline`, `status` (`draft|approved|rejected`) |
| `articles` | Generated draft | `plan_id`, `title`, `slug`, `html`, `markdown`, `meta_title`, `meta_description`, `focus_keyword`, `schema_json`, `seo_score`, `seo_report`, `internal_links`, `images`, `word_count`, `cost_usd`, `status` (`queued|generating|draft|scheduled|published|failed`) |
| `article_runs` | Swarm telemetry | `article_id`, `stage`, `model`, `tier`, `input_tokens`, `output_tokens`, `cost_usd`, `ms` |
| `publish_jobs` | Scheduled publish | `article_id`, `site_id`, `scheduled_for`, `status` (`pending|running|published|failed|cancelled`), `attempts`, `wp_post_id`, `wp_url`, `last_error` |
| `usage_credits` | Ledger | `user_id`, `delta`, `reason`, `balance_after`, `ref_id`, `stripe_session_id` |

**Credit pricing:** 1 credit = 1 article. Research 100 keywords = 1 credit. Plan
generation is free. Republish/relink is free. Balance is held on `users.credits_balance`
and every movement is written to `usage_credits`, so the ledger always reconciles.

---

## 5. The generation swarm (7 stages)

| # | Stage | Tier | Why that tier |
|---|---|---|---|
| 1 | `research` — digest SERP + competitor headings into a brief | Haiku | Summarisation of supplied text |
| 2 | `outline` — H2/H3 tree, intent per section, word budget | **Sonnet** | Structure decides the whole article |
| 3 | `draft` — each section written in parallel, one call per section | Haiku | Bounded, context-fed, repetitive |
| 4 | `facts` — flag unsupported claims, fix or hedge | Haiku | Pattern-matching against the brief |
| 5 | `seo` — keyword placement, meta title/description, alt text | Haiku | Rule-driven rewriting |
| 6 | `links` — pick anchors from the candidate set computed in code | Haiku | Judgement over a short list |
| 7 | `polish` — voice, transitions, opening and closing | **Sonnet** | Quality gate the reader feels |

`escalate` — Opus, used only when the polish stage returns an SEO score below the
`escalateBelow` threshold (default 70), or the user clicks *Regenerate with Opus*.
That is the ~2% Opus slice: an exception path, not a routine stage.

Measured mix on a 1,800-word, 8-section article: **9 Haiku calls, 2 Sonnet calls,
0 Opus** → 70%/28%/2% blended across a workspace's run history, landing at roughly
**$0.039/article** at Haiku $1/$5 and Sonnet $3/$15 per Mtok. `article_runs` records
every call so the real figure is shown, never estimated.

---

## 6. Integration contracts

### DataForSEO
- `POST /v3/dataforseo_labs/google/keyword_ideas/live` — ideas, volume, CPC, difficulty.
- `POST /v3/serp/google/organic/live/advanced` — top 10, titles, headings for stage 1.
- Basic auth, `login:password` base64. Location `2826` (UK), language `en` by default.
- Mock twin: deterministic FNV-1a hash of the seed term → stable volumes, so tests and
  demos are reproducible.

### Anthropic
- Messages API through `@anthropic-ai/sdk`. One client, `tier → model` resolved by
  `TierRouter`; token usage read back off every response for true cost.
- Retries with jitter on 429/5xx; per-stage timeout; strict JSON stages validated with
  zod and repaired once before failing the run.

### WordPress REST
- `GET /wp-json/wp/v2/users/me?context=edit` — verify the application password.
- `GET /wp-json/wp/v2/posts?per_page=100&_fields=…` — build the `site_posts` link index.
- `POST /wp-json/wp/v2/posts` — publish, body carries `meta` with the RankMath fields.
- `POST /wp-json/wp/v2/media` — upload, then set alt text via `PATCH`.
- Auth: `Authorization: Basic base64(user:app_password)` over HTTPS only.
- `WORDPRESS_DRY_RUN=true` records the payload and returns a synthetic post ID.

### RankMath field map
| Swarm Writer | WP post meta |
|---|---|
| `meta_title` | `rank_math_title` |
| `meta_description` | `rank_math_description` |
| `focus_keyword` | `rank_math_focus_keyword` |
| `canonical_url` | `rank_math_canonical_url` |
| — | `rank_math_robots` = `["index","follow"]` |
| `schema_json` | injected as a `<script type="application/ld+json">` block |

Meta keys must be registered as `show_in_rest` on the site; the wizard checks this
during verification and warns if RankMath meta is not exposed.

### Neon Postgres
`DATABASE_URL` set → `@neondatabase/serverless` over HTTP on Vercel, `pg` Pool when a
long-lived socket is available. Blank → PGlite in `./.pgdata`. One `sql()` interface,
one `schema.sql`, so local and production never diverge.

### Stripe
Credit packs (Starter 25 / Growth 100 / Agency 500) as one-off Checkout sessions.
`POST /api/credits/webhook` on `checkout.session.completed` grants credits idempotently,
keyed on `stripe_session_id`. No key set → mock checkout grants immediately.

### n8n (gmkmedia.app.n8n.cloud)
Two workflows, shipped as importable JSON in `n8n/`:
1. **Publisher** — every 15 min → `POST /api/cron/publish` → drains due publish jobs.
2. **Researcher** — weekly → `POST /api/cron/research` → refreshes keyword metrics.

Both authenticate with `Authorization: Bearer $CRON_SECRET`. Endpoints are idempotent
and safe to retry.

---

## 7. Internal linking

The differentiator, so it runs in code rather than being left to the model:

1. On connect, and on demand, pull every published post into `site_posts` with a
   tokenised title + slug + excerpt.
2. Score each candidate against each drafted section: TF-IDF cosine over tokens,
   boosted for cluster membership and exact focus-keyword presence, penalised for posts
   already linked from this article.
3. Hand the model the top 5 candidates per section and ask only for the anchor phrase —
   it never invents a URL, so a hallucinated link is structurally impossible.
4. Enforce caps: max 1 link per 150 words, max 8 per article, no duplicate targets,
   no self-link.
5. Record every placed link in `articles.internal_links` for an orphan-page report.

---

## 8. SEO score (0–100)

| Signal | Weight |
|---|---|
| Focus keyword in H1 / title | 10 |
| Keyword in first 100 words | 10 |
| Keyword density 0.5–2.5% | 10 |
| Meta title 50–60 chars, keyword present | 10 |
| Meta description 140–160 chars, keyword present | 10 |
| Word count vs target (±15%) | 10 |
| H2/H3 structure depth and count | 8 |
| Internal links ≥ 3 | 8 |
| External authority links ≥ 1 | 6 |
| Images with alt text | 6 |
| Schema present and valid | 6 |
| Readability (Flesch ≥ 55) | 6 |

Below 70 the swarm re-runs the SEO + polish stages once; below 70 again, escalates to
Opus. Every deduction returns a specific, actionable fix shown in the editor panel.

---

## 9. API surface

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/auth/signup` `/login` `/logout` | Session |
| GET | `/api/auth/me` | Current user + balance |
| GET POST | `/api/sites` | List / connect |
| GET PATCH DELETE | `/api/sites/[id]` | Manage |
| POST | `/api/sites/[id]/verify` | Re-test credentials |
| POST | `/api/sites/[id]/sync-posts` | Rebuild link index |
| POST | `/api/keywords/research` | DataForSEO → `keywords` (1 credit / 100) |
| POST | `/api/keywords/cluster` | Build clusters |
| GET | `/api/keywords?siteId=` | List + clusters |
| PATCH | `/api/keywords/[id]` | Select / reject |
| POST | `/api/plans/generate` | Cluster → draft plans |
| GET | `/api/plans?siteId=` | Approval board |
| PATCH | `/api/plans/[id]` | Edit |
| POST | `/api/plans/[id]/approve` | Approve / reject |
| POST | `/api/articles/generate` | Run the swarm (1 credit) |
| GET | `/api/articles?siteId=` | List |
| GET PATCH | `/api/articles/[id]` | Editor load / save |
| POST | `/api/articles/[id]/score` | Re-score |
| POST | `/api/articles/[id]/relink` | Recompute internal links |
| POST | `/api/articles/[id]/publish` | Publish now or schedule |
| GET | `/api/publish-jobs?siteId=` | Calendar feed |
| PATCH | `/api/publish-jobs/[id]` | Reschedule / cancel |
| GET | `/api/credits` | Balance + ledger |
| POST | `/api/credits/checkout` | Stripe session |
| POST | `/api/credits/webhook` | Stripe fulfilment |
| POST | `/api/cron/publish` `/api/cron/research` | n8n |
| GET | `/api/health` | Provider + DB status |

Every handler: zod-validated input, `{ ok: true, data }` or
`{ ok: false, error: { code, message, details? } }`, ownership checked against the
session before any row is read.

---

## 10. Build order and ownership

| Agent | Scope | Depends on |
|---|---|---|
| 1 | This document, schema.sql, env contract | — |
| 2 | `src/lib/**`, `src/app/api/**`, scripts | 1 |
| 3 | `src/app/(marketing|auth|app)/**`, `src/components/**` | 1 for API shapes |
| 4 | Wiring, E2E proof, mock WP server, local run | 2, 3 |
