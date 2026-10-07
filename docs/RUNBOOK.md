# Swarm Writer — Runbook

Operating notes: what to check first, what each failure mode looks like, and the
decisions baked into the system that are not obvious from the code.

---

## First thing to check

`GET /api/health` — unauthenticated, reports the driver behind the database and the
mode of every provider (`live` / `mock` / `dry-run`), plus database latency. Nearly
every "it isn't working" report resolves here: a key is missing, so a mock is answering.

---

## Common failures

### "Could not connect to WordPress"
The wizard surfaces the real cause. In order of likelihood:
- **401/403** — wrong username, or the application password was copied short. Spaces are
  fine; Swarm Writer strips them.
- **404 on `/wp-json`** — the REST API is disabled, or a security plugin blocks it.
- **Role too low** — the user needs Author or above to publish. Verification warns.
- **No HTTPS** — allowed for `localhost` only; everything else gets a warning, because an
  application password over plain HTTP is in the clear.

### "RankMath meta fields are not exposed over REST"
Publishing still works and the JSON-LD still ships inside the post body, so structured
data is unaffected. The RankMath panel in wp-admin may not show the values until its
meta is registered with `show_in_rest`. This is a warning, never a block.

### Articles generate with no internal links
The site has no post index. Open **Sites → Sync posts**. Linking ranks candidates from
the posts already on the domain; with nothing indexed there is nothing to link to, and
the article loses 8 points of on-page score. The editor's **Re-link** button is free and
can be re-run any time — it is code-only, no model call.

### A publish job keeps failing
`publish_jobs.last_error` holds the WordPress response. Jobs retry twice at 15-minute
intervals, then stop at `failed`. The calendar shows the error inline. Common causes: the
application password was revoked, or the slug collides with an existing post.

### Cost per article drifts above target
Check the article's **Swarm run** tab. Every call is listed with its tier and token
counts. Drift usually means one of:
- longer word targets on the plans (cost scales with output tokens),
- frequent Opus escalations, which means articles are scoring below threshold — look at
  the SEO panel rather than the cost,
- an upstream pricing change: `PRICING` in `src/lib/providers/anthropic.ts`.

The `TierRouter` prices each upgradeable stage before committing and downgrades polish to
Haiku rather than exceed `ARTICLE_COST_TARGET_USD × 1.1`. Downgrades are listed in the
run's `tierSummary.downgrades` with the reason.

---

## Deliberate design decisions

**Credits are debited before generation and refunded on failure.** A provider outage must
never cost the user. See `generateArticle` in `src/lib/services/articles.ts`.

**Plans require approval before a credit is spent.** The single most important guard in
an automated content system: it stops the pipeline writing things nobody wanted. The API
rejects generation on a `draft` plan with `plan_not_approved`.

**Debits are conditional in SQL.** `UPDATE users SET credits_balance = credits_balance - $n
WHERE id = $id AND credits_balance >= $n` — two concurrent generations cannot overdraw.
The `usage_credits` ledger always sums to the balance; the E2E asserts it.

**Publish jobs are claimed, not just read.** `UPDATE ... WHERE id = $id AND status =
'pending' RETURNING *` returns zero rows if another worker got there first, so overlapping
cron runs cannot double-publish. The cron endpoints are safe to retry.

**Stripe fulfilment is idempotent on the session id.** Stripe will replay webhooks; the
grant is keyed on `stripe_session_id`, which is `UNIQUE`.

**The link candidate set is computed in code.** The model receives a shortlist of real
URLs and returns only an anchor phrase. A hallucinated link is structurally impossible.
If the model under-uses the link budget, the pipeline tops it up deterministically.

**The database client is cached on `globalThis`.** In Next.js dev, module scope is
re-evaluated on every hot reload — which for an embedded WASM Postgres meant a fresh
multi-hundred-megabyte instance each time. That walked the dev server into a 13 GB OOM
before the cache was added. The same pattern stops a `pg` Pool leaking connections.

**All dates render in UTC through `src/lib/utils/format.ts`.** `toLocaleString` produces
different output under Node and Chromium (`"Friday 9 October"` vs `"Friday, 9 October"`),
which React treats as a hydration mismatch and discards the server-rendered tree. The
calendar does all of its arithmetic in UTC for the same reason.

**Meta fields are repaired in code, not by re-prompting.** When the model misses the
50–60 or 140–160 character window, `enforceMetaConstraints` fixes it with whole clauses
rather than paying for another round-trip. It never truncates mid-sentence — a dangling
fragment in the SERP is worse than a short description, and the score reports the
shortfall honestly.

---

## Scheduled work

Two n8n workflows at `gmkmedia.app.n8n.cloud`, importable from
`n8n/swarm-writer-workflows.json`:

| Workflow | Cadence | Endpoint |
|---|---|---|
| Publisher | every 15 min | `POST /api/cron/publish` |
| Researcher | Mondays 06:07 | `POST /api/cron/research?perSite=50` |

Both authenticate with `Authorization: Bearer $CRON_SECRET`. Without `CRON_SECRET` set,
the endpoints accept localhost calls only — so a deployment missing the secret fails
closed rather than open. The calendar's **Run queue now** button calls the same endpoint,
which means the UI exercises the production path rather than a parallel one.

---

## Database

One `schema.sql` runs on all three drivers (Neon HTTP, `pg` Pool, embedded PGlite), so
local and production never diverge. `ensureSchema()` applies it idempotently on cold
start, which makes a serverless deploy self-migrating.

To reset local data entirely: `npm run db:reset && npm run db:seed`.

Stop the dev server first — the embedded database is single-process, so a script and a
running server cannot both hold `./.pgdata`.

---

## Test suites

| Command | Covers |
|---|---|
| `npm test` | 93 unit checks — scoring, linking, clustering, schema, crypto, cost maths. No DB, no network. |
| `npm run e2e` | 87 checks — the full product path against the embedded DB and mock WordPress, including reading RankMath meta back off the published post. |
| `npm run smoke` | 75 checks — the same journey over HTTP against a running server: real cookies, real handlers, real validation, plus ownership isolation between accounts. |

`npm run e2e` and `npm run smoke` both need `npm run mock:wp` running. `smoke` also needs
`npm run dev`.
