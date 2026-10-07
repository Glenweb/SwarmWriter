/**
 * End-to-end proof, Agent 4's deliverable.
 *
 * Runs the full product path against the embedded database and the mock
 * WordPress server, then asserts the things that actually matter:
 *   keyword research → clustering → plan → approval → 7-stage generation →
 *   SEO score → internal links into EXISTING posts → publish →
 *   RankMath fields verified by reading the post back off WordPress.
 *
 *   npm run mock:wp     (in one terminal)
 *   npm run e2e
 */
import { ensureSchema, one, sql } from '../src/lib/db/client';
import { env, providerMode } from '../src/lib/env';
import { hashPassword } from '../src/lib/auth/password';
import { newId } from '../src/lib/utils/ids';
import { grant, getBalance } from '../src/lib/services/credits';
import { connectSite, linkIndex, syncPosts } from '../src/lib/services/sites';
import { research } from '../src/lib/services/keywords';
import { clusterSite } from '../src/lib/services/clustering';
import { generatePlans, setPlanStatus } from '../src/lib/services/plans';
import { generateArticle, getRuns, relink } from '../src/lib/services/articles';
import { publishNow, verifyPublishedMeta, schedule, drainDueJobs } from '../src/lib/services/publish';
import { validateSchema } from '../src/lib/services/schema-gen';

const MOCK_WP_URL = process.env.MOCK_WP_URL ?? 'http://localhost:8787';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function step(n: number, title: string) {
  console.log(`\n${n}. ${title}`);
}

async function main() {
  console.log('════ Swarm Writer — end-to-end pipeline proof ════');
  console.log(`  database:   ${providerMode.db}`);
  console.log(`  anthropic:  ${providerMode.anthropic}`);
  console.log(`  dataforseo: ${providerMode.dataForSeo}`);
  console.log(`  wordpress:  ${MOCK_WP_URL}`);

  await ensureSchema();

  const wpUp = await fetch(`${MOCK_WP_URL}/wp-json`, { signal: AbortSignal.timeout(2500) })
    .then((r) => r.ok)
    .catch(() => false);
  if (!wpUp) {
    console.error(`\n✗ The mock WordPress server is not running at ${MOCK_WP_URL}.`);
    console.error('  Start it first:  npm run mock:wp');
    process.exit(1);
  }

  // ── 1. account ─────────────────────────────────────────────────────────────
  step(1, 'Account and credits');
  const email = `e2e+${Date.now()}@gmkmedia.co.uk`;
  const userId = newId('usr');
  await sql`
    INSERT INTO users (id, email, name, password_hash, plan, credits_balance)
    VALUES (${userId}, ${email}, 'E2E Runner', ${await hashPassword('e2e-password')}, 'agency', 0)
  `;
  await grant({ userId, amount: 20, reason: 'e2e run' });
  check('account created with credits', (await getBalance(userId)) === 20, '20 credits');

  // ── 2. connect WordPress ───────────────────────────────────────────────────
  step(2, 'Connect WordPress over the REST API with an application password');
  const { site, verify } = await connectSite(userId, {
    name: 'E2E Luggage Site',
    url: MOCK_WP_URL,
    wpUsername: 'swarm-demo',
    wpAppPassword: 'demoappspassword',
    niche: 'travel luggage, affiliate reviews',
    audience: 'frequent flyers choosing cabin bags',
  });
  check('credentials verified against WordPress', verify?.ok === true);
  check('publish capability detected', verify?.canPublish === true, verify?.roles?.join('/'));
  check('RankMath meta exposed over REST', verify?.rankMathDetected === true);
  check('application password stored encrypted', await storedCredentialIsEncrypted(site.id));

  // ── 3. internal-link index ─────────────────────────────────────────────────
  step(3, 'Build the internal-link index from the live site');
  const synced = await syncPosts(userId, site.id);
  const index = await linkIndex(site.id);
  check('existing posts indexed', synced.count >= 5, `${synced.count} posts`);
  check('posts tokenised for matching', index.every((p) => p.tokens.length > 0));

  // ── 4. keyword research ────────────────────────────────────────────────────
  step(4, 'Keyword research via DataForSEO');
  const researchResult = await research(userId, {
    siteId: site.id,
    seeds: ['carry on luggage'],
    limitPerSeed: 30,
    withSerp: 3,
  });
  check('keywords returned', researchResult.total >= 20, `${researchResult.total} keywords`);
  check('metrics populated', researchResult.keywords.every((k) => k.volume > 0 && k.difficulty >= 0));
  check('intent classified', researchResult.keywords.some((k) => k.intent === 'commercial'));
  check('research billed correctly', researchResult.creditsSpent === 1, `${researchResult.creditsSpent} credit`);
  const withSerp = researchResult.keywords.filter((k) => k.hasSerp).length;
  check('SERP snapshots captured for top terms', withSerp >= 3, `${withSerp} snapshots`);

  // ── 5. clustering ──────────────────────────────────────────────────────────
  step(5, 'Cluster keywords into topics');
  const clusters = await clusterSite(userId, site.id);
  check('clusters built', clusters.length > 0, `${clusters.length} clusters`);
  check('every cluster has a pillar keyword', clusters.every((c) => !!c.pillarKeyword));
  const multi = clusters.filter((c) => c.keywordCount > 1);
  check('clusters group related keywords', multi.length > 0, `${multi.length} multi-keyword clusters`);
  check('clusters ranked by opportunity', isDescending(clusters.map((c) => c.opportunity)));

  // ── 6. content plans + approval gate ───────────────────────────────────────
  step(6, 'Generate content plans and approve one');
  const best = clusters.find((c) => c.keywordCount > 1) ?? clusters[0];
  const plans = await generatePlans(userId, { siteId: site.id, clusterIds: [best.id], maxPerCluster: 2 });
  check('plans generated', plans.length > 0, `${plans.length} plans`);
  check('plans start as drafts', plans.every((p) => p.status === 'draft'));
  check('plans carry an outline', plans[0].outline.length >= 4, `${plans[0].outline.length} sections`);
  check('plans carry secondary keywords', plans[0].secondaryKeywords.length > 0);

  const balanceBefore = await getBalance(userId);
  let gateHeld = false;
  try {
    await generateArticle(userId, plans[0].id);
  } catch (e: any) {
    gateHeld = e?.code === 'plan_not_approved';
  }
  check('unapproved plan cannot be generated', gateHeld);
  check('no credit spent on the blocked attempt', (await getBalance(userId)) === balanceBefore);

  const approved = await setPlanStatus(userId, plans[0].id, 'approved');
  check('plan approved', approved.status === 'approved');

  // ── 7. the generation swarm ────────────────────────────────────────────────
  step(7, 'Run the 7-stage generation swarm');
  const t0 = Date.now();
  const { article, output, balance } = await generateArticle(userId, approved.id);
  const elapsed = Date.now() - t0;

  check('article generated', article.status === 'draft');
  check('one credit spent', balance === balanceBefore - 1, `balance ${balance}`);
  check('H1 present', /<h1>/.test(article.html));
  check('H2 sections present', (article.html.match(/<h2>/g) ?? []).length >= 4,
    `${(article.html.match(/<h2>/g) ?? []).length} H2s`);
  check('substantial word count', article.wordCount >= 900, `${article.wordCount} words`);
  check('meta title within 50-60 chars', (article.metaTitle ?? '').length >= 50 && (article.metaTitle ?? '').length <= 60,
    `${(article.metaTitle ?? '').length} chars`);
  check('meta description within 140-160 chars',
    (article.metaDescription ?? '').length >= 140 && (article.metaDescription ?? '').length <= 160,
    `${(article.metaDescription ?? '').length} chars`);
  check('focus keyword set', !!article.focusKeyword, article.focusKeyword ?? '');
  check('FAQ generated', article.faq.length >= 2, `${article.faq.length} questions`);
  check('images carry alt text', article.images.length > 0 && article.images.every((i) => i.alt.length > 5),
    `${article.images.length} images`);
  check('schema is valid JSON-LD', validateSchema(article.schema).valid,
    validateSchema(article.schema).issues.join('; ') || 'Article + FAQPage + BreadcrumbList');
  check('schema embedded in the body', /application\/ld\+json/.test(article.html));

  // ── 8. tier routing and cost ───────────────────────────────────────────────
  step(8, 'Model tier routing and measured cost');
  const runs = await getRuns(userId, article.id);
  const stages = new Set(runs.map((r) => r.stage));
  check('every stage logged', runs.length >= 8, `${runs.length} model calls`);
  check('research stage ran', stages.has('research'));
  check('outline stage ran', stages.has('outline'));
  check('draft stage ran per section', runs.filter((r) => r.stage === 'draft').length >= 4,
    `${runs.filter((r) => r.stage === 'draft').length} section calls`);
  check('facts stage ran', stages.has('facts'));
  check('seo stage ran', stages.has('seo'));
  check('polish stage ran', stages.has('polish'));
  check('outline used the Sonnet tier', runs.some((r) => r.stage === 'outline' && r.tier === 'sonnet'));
  check('drafting used the Haiku tier', runs.filter((r) => r.stage === 'draft').every((r) => r.tier === 'haiku'));
  check('token usage recorded', runs.every((r) => r.inputTokens > 0 && r.outputTokens > 0));

  const summary = output.tierSummary;
  console.log(`      cost: $${output.costUsd.toFixed(5)} against a $${summary.targetUsd} target`);
  console.log(`      spend share: haiku ${pct(summary.spendShare.haiku)} · sonnet ${pct(summary.spendShare.sonnet)} · opus ${pct(summary.spendShare.opus)}`);
  console.log(`      wall clock: ${(elapsed / 1000).toFixed(1)}s`);
  check('cost measured from real token counts', output.costUsd > 0);
  check('cost within the router ceiling (target × 1.1)', output.costUsd <= summary.targetUsd * 1.1,
    `$${output.costUsd.toFixed(5)} vs $${(summary.targetUsd * 1.1).toFixed(5)} ceiling`);
  check('router reports the run inside target', summary.withinTarget === true);
  check('spend mix is Haiku-dominant as designed (>= 65%)', summary.spendShare.haiku >= 0.65,
    pct(summary.spendShare.haiku));
  check('Opus is not used on a routine run', summary.spendShare.opus === 0);

  // ── 9. internal linking ────────────────────────────────────────────────────
  step(9, 'Internal linking against the existing site');

  // Assert the links the SWARM itself placed, before the free re-link runs —
  // otherwise re-link would mask a broken link stage.
  check('swarm placed internal links during generation', output.internalLinks.length >= 2,
    `${output.internalLinks.length} links from the links stage`);
  check('swarm links point at indexed posts',
    output.internalLinks.every((l) => index.some((p) => p.url === l.url)));
  check('swarm links carry anchor text', output.internalLinks.every((l) => l.anchor.trim().length >= 3));
  check('swarm links are present in the generated HTML',
    output.internalLinks.every((l) => output.html.includes(`href="${l.url}"`)));

  const relinked = await relink(userId, article.id);
  check('internal links placed', relinked.placed.length >= 2, `${relinked.placed.length} links`);
  const indexUrls = new Set(index.map((p) => p.url));
  check('every link points at a real existing post', relinked.placed.every((l) => indexUrls.has(l.url)));
  check('no duplicate link targets', new Set(relinked.placed.map((l) => l.url)).size === relinked.placed.length);
  check('no self-link', relinked.placed.every((l) => !l.url.includes(relinked.article.slug)));
  check('anchors are descriptive phrases', relinked.placed.every((l) => l.anchor.split(/\s+/).length >= 2));
  check('links are present in the HTML', relinked.placed.every((l) => relinked.article.html.includes(`href="${l.url}"`)));
  const linkDensity = relinked.article.wordCount / Math.max(relinked.placed.length, 1);
  check('link density is not stuffed (>= 120 words/link)', linkDensity >= 120, `${Math.round(linkDensity)} words per link`);

  // re-linking twice must not duplicate
  const second = await relink(userId, article.id);
  const anchorCount = (second.article.html.match(/<a href="http:\/\/localhost/g) ?? []).length;
  check('re-linking is idempotent', anchorCount === second.placed.length,
    `${anchorCount} anchors for ${second.placed.length} links`);

  // ── 10. SEO score ──────────────────────────────────────────────────────────
  step(10, 'On-page SEO score');
  const report = second.article.seoReport!;
  console.log(`      score: ${second.article.seoScore}/100 (${report.grade})`);
  check('score computed', second.article.seoScore > 0);
  check('score is production-grade (>= 85)', second.article.seoScore >= 85, `${second.article.seoScore}/100`);
  check('keyword density inside the 0.5-2.5% band', report.stats.keywordDensity >= 0.5 && report.stats.keywordDensity <= 2.5,
    `${report.stats.keywordDensity}%`);
  check('word count within 15% of the plan target', report.signals.find((s) => s.id === 'word_count')?.pass === true,
    `${report.stats.wordCount} words`);
  check('all 12 signals evaluated', report.signals.length === 12);
  check('failing signals carry a fix', report.signals.filter((s) => !s.pass).every((s) => !!s.fix));
  check('internal-link signal passes', report.signals.find((s) => s.id === 'internal_links')?.pass === true);
  check('schema signal passes', report.signals.find((s) => s.id === 'schema')?.pass === true);
  for (const s of report.signals.filter((x) => !x.pass)) {
    console.log(`      · ${s.label}: ${s.detail}  → ${s.fix}`);
  }

  // ── 11. publish with RankMath fields ───────────────────────────────────────
  step(11, 'Publish to WordPress with RankMath fields');
  const published = await publishNow(userId, article.id);
  check('post created on WordPress', published.wpPostId > 0, `post id ${published.wpPostId}`);
  check('post URL returned', /^http/.test(published.wpUrl), published.wpUrl);
  check('article marked published', (await one`SELECT status FROM articles WHERE id = ${article.id}`)?.status === 'published');

  const metaCheck = await verifyPublishedMeta(userId, article.id);
  console.log('      RankMath fields read back off WordPress:');
  for (const c of metaCheck.checks) {
    console.log(`      ${c.ok ? '✓' : '✗'} ${c.field} = ${JSON.stringify(c.actual).slice(0, 90)}`);
  }
  check('all RankMath fields landed on the post', metaCheck.allOk);
  check('rank_math_focus_keyword matches', metaCheck.checks.find((c) => c.field === 'rank_math_focus_keyword')?.ok === true);
  check('rank_math_title matches', metaCheck.checks.find((c) => c.field === 'rank_math_title')?.ok === true);
  check('rank_math_description matches', metaCheck.checks.find((c) => c.field === 'rank_math_description')?.ok === true);
  check('rank_math_robots set to index/follow', metaCheck.checks.find((c) => c.field === 'rank_math_robots')?.ok === true);

  // The published body must still contain the internal links and the schema.
  const liveBody = await fetchPublishedBody(published.wpPostId);
  check('published body contains the internal links', second.placed.every((l) => liveBody.includes(l.url)));
  check('published body contains the JSON-LD', /application\/ld\+json/.test(liveBody));
  check('published body contains the H1', /<h1>/.test(liveBody));

  // ── 12. scheduling and the n8n drain ───────────────────────────────────────
  step(12, 'Scheduled publishing and the n8n cron drain');
  const secondPlan = plans[1] ?? (await generatePlans(userId, { siteId: site.id, maxPerCluster: 1 }))[0];
  await setPlanStatus(userId, secondPlan.id, 'approved');
  const { article: scheduledArticle } = await generateArticle(userId, secondPlan.id);
  const job = await schedule(userId, scheduledArticle.id, new Date(Date.now() - 1000));
  check('publish job queued', job.status === 'pending');
  check('article marked scheduled', (await one`SELECT status FROM articles WHERE id = ${scheduledArticle.id}`)?.status === 'scheduled');

  const drain = await drainDueJobs(5);
  check('cron drained the due job', drain.published >= 1, `${drain.published} published, ${drain.failed} failed`);
  const afterDrain = await one`SELECT status, wp_post_id FROM articles WHERE id = ${scheduledArticle.id}`;
  check('scheduled article went live', afterDrain?.status === 'published', `wp post ${afterDrain?.wp_post_id}`);

  const emptyDrain = await drainDueJobs(5);
  check('cron is idempotent on an empty queue', emptyDrain.claimed === 0);

  // ── 13. ledger reconciliation ──────────────────────────────────────────────
  step(13, 'Credit ledger reconciles');
  const [sum] = await sql`SELECT COALESCE(SUM(delta), 0)::int AS total FROM usage_credits WHERE user_id = ${userId}`;
  const finalBalance = await getBalance(userId);
  check('ledger sum equals the balance', Number(sum.total) === finalBalance, `${sum.total} = ${finalBalance}`);

  // ── summary ────────────────────────────────────────────────────────────────
  console.log('\n════ result ════');
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log(`\n  Live post:   ${published.wpUrl}`);
  console.log(`  SEO score:   ${second.article.seoScore}/100`);
  console.log(`  Cost:        $${output.costUsd.toFixed(5)} per article (target $${summary.targetUsd})`);
  console.log(`  Links:       ${second.placed.length} internal links into existing posts`);
  if (failed) {
    console.log(`\n  Failures:\n${failures.map((f) => `   - ${f}`).join('\n')}`);
    process.exit(1);
  }
  console.log('\n  ✓ keyword research through to a published WordPress post with RankMath fields and internal links.');
}

async function storedCredentialIsEncrypted(siteId: string): Promise<boolean> {
  const row = await one`SELECT wp_app_password_enc FROM sites WHERE id = ${siteId}`;
  const stored = String(row?.wp_app_password_enc ?? '');
  return stored.startsWith('v1.') && !stored.includes('demoappspassword');
}

async function fetchPublishedBody(postId: number): Promise<string> {
  const auth = Buffer.from('swarm-demo:demoappspassword').toString('base64');
  const res = await fetch(`${MOCK_WP_URL}/wp-json/wp/v2/posts/${postId}`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  const post: any = await res.json();
  return String(post?.content?.rendered ?? '');
}

function isDescending(nums: number[]): boolean {
  return nums.every((n, i) => i === 0 || nums[i - 1] >= n);
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

main().then(
  // PGlite keeps file handles open, so exit explicitly rather than hanging.
  () => process.exit(0),
  (e) => {
    console.error('\n✗ e2e run threw:', e);
    process.exit(1);
  },
);
