/**
 * HTTP smoke test. Agent 4's deliverable: drives the running app over HTTP the
 * way the browser does — real cookies, real route handlers, real validation —
 * rather than calling services directly like the E2E does.
 *
 *   npm run dev        (terminal 1)
 *   npm run mock:wp    (terminal 2)
 *   npm run smoke      (terminal 3)
 */
const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:3000';
const MOCK_WP = process.env.MOCK_WP_URL ?? 'http://localhost:8787';

let passed = 0;
let failed = 0;
const failures: string[] = [];
let cookie = '';

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

type Res<T> = { status: number; ok: boolean; data?: T; error?: { code: string; message: string } };

async function call<T = any>(method: string, path: string, body?: unknown): Promise<Res<T>> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  // Capture the session cookie the API sets.
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) {
    const match = setCookie.match(/sw_session=[^;]+/);
    if (match) cookie = match[0];
  }
  let json: any = {};
  try {
    json = await res.json();
  } catch {
    /* redirects and empty bodies */
  }
  return { status: res.status, ok: Boolean(json?.ok), data: json?.data, error: json?.error };
}

async function main() {
  console.log(`════ Swarm Writer — HTTP smoke test against ${BASE} ════`);

  const up = await fetch(`${BASE}/api/health`).then((r) => r.ok).catch(() => false);
  if (!up) {
    console.error(`\n✗ Nothing answering at ${BASE}. Start the app first:  npm run dev`);
    process.exit(1);
  }

  console.log('\n1. Health and provider modes');
  const health = await call('GET', '/api/health');
  check('health endpoint responds', health.ok, `db: ${health.data?.database?.driver}`);
  check('database reachable', Number(health.data?.database?.latencyMs) >= 0);
  check('provider modes reported', !!health.data?.providers?.anthropic?.mode,
    `anthropic ${health.data?.providers?.anthropic?.mode}, dataforseo ${health.data?.providers?.dataForSeo?.mode}`);

  console.log('\n2. Auth is enforced');
  const anon = await call('GET', '/api/sites');
  check('unauthenticated request rejected', anon.status === 401 && anon.error?.code === 'unauthorized');
  const meAnon = await call('GET', '/api/auth/me');
  check('/api/auth/me returns null when signed out', meAnon.ok && meAnon.data?.user === null);

  console.log('\n3. Signup, session and validation');
  const email = `smoke+${Date.now()}@gmkmedia.co.uk`;
  const badSignup = await call('POST', '/api/auth/signup', { email, password: 'short' });
  check('short password rejected', badSignup.status === 400 && badSignup.error?.code === 'validation_failed');
  const badEmail = await call('POST', '/api/auth/signup', { email: 'not-an-email', password: 'password123' });
  check('invalid email rejected', badEmail.status === 400);

  const signup = await call('POST', '/api/auth/signup', { email, password: 'smoke-password-123', name: 'Smoke Test' });
  check('signup succeeds', signup.status === 201 && signup.ok, email);
  check('welcome credits granted', signup.data?.creditsBalance === 5, `${signup.data?.creditsBalance} credits`);
  check('session cookie set', cookie.startsWith('sw_session='));

  const dupe = await call('POST', '/api/auth/signup', { email, password: 'smoke-password-123' });
  check('duplicate email rejected', dupe.status === 409 && dupe.error?.code === 'email_taken');

  const me = await call('GET', '/api/auth/me');
  check('session resolves to the user', me.data?.user?.email === email);

  console.log('\n4. Connect a site over HTTP');
  const badSite = await call('POST', '/api/sites', { name: 'Bad', url: MOCK_WP, wpUsername: 'nope', wpAppPassword: 'wrongpassword' });
  check('bad WordPress credentials rejected', badSite.status === 400 && badSite.error?.code === 'wp_verify_failed');

  const site = await call('POST', '/api/sites', {
    name: 'Smoke Site',
    url: MOCK_WP,
    wpUsername: 'swarm-demo',
    wpAppPassword: 'demoappspassword',
    niche: 'travel luggage',
    audience: 'frequent flyers',
    publishCadence: 'weekly',
  });
  check('site connected', site.status === 201 && site.ok, site.data?.site?.name);
  check('RankMath detected during verification', site.data?.verify?.rankMathDetected === true);
  const siteId = site.data?.site?.id as string;

  const sync = await call('POST', `/api/sites/${siteId}/sync-posts`);
  check('post index built over HTTP', Number(sync.data?.count) >= 5, `${sync.data?.count} posts`);

  const options = await call('GET', `/api/sites/${siteId}/options`);
  check('site options readable', Array.isArray(options.data?.authors) && options.data.authors.length > 0);

  console.log('\n5. Keyword research and clustering over HTTP');
  const noSeeds = await call('POST', '/api/keywords/research', { siteId, seeds: [] });
  check('empty seed list rejected', noSeeds.status === 400);

  const research = await call('POST', '/api/keywords/research', {
    siteId,
    seeds: ['carry on luggage'],
    limitPerSeed: 25,
    withSerp: 2,
  });
  check('research succeeds', research.ok, `${research.data?.total} keywords`);
  check('credit debited for research', research.data?.balance === 4, `balance ${research.data?.balance}`);

  const list = await call('GET', `/api/keywords?siteId=${siteId}`);
  check('keywords listed', Array.isArray(list.data?.keywords) && list.data.keywords.length > 0);

  const firstKeyword = list.data.keywords[0];
  const patch = await call('PATCH', `/api/keywords/${firstKeyword.id}`, { status: 'selected' });
  check('keyword status updates', patch.data?.keyword?.status === 'selected');

  const cluster = await call('POST', '/api/keywords/cluster', { siteId });
  check('clustering succeeds', cluster.ok, `${cluster.data?.count} clusters`);

  console.log('\n6. Plans, the approval gate, and generation');
  const plans = await call('POST', '/api/plans/generate', { siteId, maxPerCluster: 1 });
  check('plans generated', plans.status === 201 && Number(plans.data?.count) > 0, `${plans.data?.count} plans`);
  const plan = plans.data.plans[0];
  check('plans start as drafts', plan.status === 'draft');

  const blocked = await call('POST', '/api/articles/generate', { planId: plan.id });
  check('generation blocked before approval', blocked.status === 400 && blocked.error?.code === 'plan_not_approved');

  const approve = await call('POST', `/api/plans/${plan.id}/approve`, { decision: 'approved' });
  check('plan approved over HTTP', approve.data?.plan?.status === 'approved');

  const generated = await call('POST', '/api/articles/generate', { planId: plan.id });
  check('article generated over HTTP', generated.status === 201 && generated.ok);
  const article = generated.data.article;
  check('credit debited for the article', generated.data?.balance === 3, `balance ${generated.data?.balance}`);
  check('SEO score returned', Number(generated.data?.generation?.seoScore) >= 70, `${generated.data?.generation?.seoScore}/100`);
  check('cost reported', Number(generated.data?.generation?.costUsd) > 0, `$${Number(generated.data?.generation?.costUsd).toFixed(5)}`);
  check('swarm placed internal links during generation',
    generated.data?.generation?.internalLinks?.length >= 2,
    `${generated.data?.generation?.internalLinks?.length} links`);
  check('stage telemetry returned', generated.data?.generation?.stages?.length >= 8,
    `${generated.data?.generation?.stages?.length} model calls`);

  console.log('\n7. Editor operations');
  const runs = await call('GET', `/api/articles/${article.id}/runs`);
  check('per-stage runs readable', Array.isArray(runs.data?.runs) && runs.data.runs.length >= 8);

  const edited = await call('PATCH', `/api/articles/${article.id}`, { title: 'Edited By Smoke Test' });
  check('article saved', edited.data?.article?.title === 'Edited By Smoke Test');
  check('score recomputed on save', typeof edited.data?.article?.seoScore === 'number');

  const relinked = await call('POST', `/api/articles/${article.id}/relink`);
  check('re-link works', relinked.ok, `${relinked.data?.count} links`);

  const scored = await call('POST', `/api/articles/${article.id}/score`);
  check('re-score works', Number(scored.data?.seoScore) > 0, `${scored.data?.seoScore}/100`);
  check('report lists all 12 signals', scored.data?.report?.signals?.length === 12);

  console.log('\n8. Publish and schedule over HTTP');
  const dry = await call('POST', `/api/articles/${article.id}/publish`, { dryRun: true });
  check('dry-run publish works', dry.data?.mode === 'published' && dry.data?.dryRun === true,
    `synthetic post ${dry.data?.wpPostId}`);
  check('RankMath meta included in the payload', !!dry.data?.meta?.rank_math_focus_keyword,
    dry.data?.meta?.rank_math_focus_keyword);

  const live = await call('POST', `/api/articles/${article.id}/publish`, {});
  check('live publish to WordPress', Number(live.data?.wpPostId) > 0, `post ${live.data?.wpPostId}`);

  // Confirm the meta really landed by reading the post straight off the mock WP.
  const auth = Buffer.from('swarm-demo:demoappspassword').toString('base64');
  const wpPost: any = await fetch(`${MOCK_WP}/wp-json/wp/v2/posts/${live.data.wpPostId}`, {
    headers: { Authorization: `Basic ${auth}` },
  }).then((r) => r.json());
  check('rank_math_title landed on WordPress', !!wpPost?.meta?.rank_math_title);
  check('rank_math_description landed', !!wpPost?.meta?.rank_math_description);
  check('rank_math_focus_keyword landed', !!wpPost?.meta?.rank_math_focus_keyword);
  check('rank_math_robots landed', Array.isArray(wpPost?.meta?.rank_math_robots));
  check('JSON-LD present in the published body', /application\/ld\+json/.test(String(wpPost?.content?.rendered ?? '')));

  const jobs = await call('GET', `/api/publish-jobs?siteId=${siteId}`);
  check('publish jobs listed', Array.isArray(jobs.data?.jobs) && jobs.data.jobs.length >= 2);

  console.log('\n9. Credits and billing');
  const credits = await call('GET', '/api/credits');
  check('credit balance and ledger readable', typeof credits.data?.balance === 'number' && Array.isArray(credits.data?.ledger));
  const total = credits.data.ledger.reduce((s: number, e: any) => s + e.delta, 0);
  check('ledger reconciles with the balance', total === credits.data.balance, `${total} = ${credits.data.balance}`);
  check('credit packs exposed', credits.data?.packs?.length === 3);

  const checkout = await call('POST', '/api/credits/checkout', { packId: 'starter' });
  check('checkout session created', !!checkout.data?.session?.url, checkout.data?.session?.mocked ? 'mock mode' : 'stripe');
  const badPack = await call('POST', '/api/credits/checkout', { packId: 'nope' });
  check('unknown pack rejected', badPack.status === 400);

  console.log('\n10. Cron endpoints');
  const cronPublish = await call('POST', '/api/cron/publish');
  check('cron publish endpoint responds', cronPublish.ok, `${cronPublish.data?.claimed} claimed`);
  const cronResearch = await call('POST', '/api/cron/research?perSite=5');
  check('cron research endpoint responds', cronResearch.ok, `${cronResearch.data?.sites} site(s) refreshed`);

  console.log('\n11. Ownership is enforced');
  const otherEmail = `smoke-other+${Date.now()}@gmkmedia.co.uk`;
  const firstCookie = cookie;
  cookie = '';
  await call('POST', '/api/auth/signup', { email: otherEmail, password: 'other-password-123' });
  const stolen = await call('GET', `/api/articles/${article.id}`);
  check("another user cannot read this user's article", stolen.status === 404);
  const stolenSite = await call('GET', `/api/sites/${siteId}`);
  check("another user cannot read this user's site", stolenSite.status === 404);
  const stolenKeywords = await call('GET', `/api/keywords?siteId=${siteId}`);
  check("another user cannot list this user's keywords", stolenKeywords.status === 404);
  cookie = firstCookie;

  console.log('\n12. Signed-in pages render');
  for (const path of ['/dashboard', '/sites', '/sites/new', '/keywords', '/plans', '/articles', '/calendar', '/billing']) {
    const res = await fetch(`${BASE}${path}`, { headers: { Cookie: cookie }, redirect: 'manual' });
    const body = res.ok ? await res.text() : '';
    check(`GET ${path}`, res.ok && body.includes('<html'), `${res.status}`);
  }
  const articlePage = await fetch(`${BASE}/articles/${article.id}`, { headers: { Cookie: cookie } });
  check('GET /articles/[id]', articlePage.ok, `${articlePage.status}`);

  console.log('\n13. Signed-in visitors are redirected away from the public pages');
  for (const path of ['/', '/login', '/signup']) {
    const res = await fetch(`${BASE}${path}`, { headers: { Cookie: cookie }, redirect: 'manual' });
    check(`GET ${path} redirects when signed in`, res.status === 307 || res.status === 302,
      `${res.status} → ${res.headers.get('location') ?? '?'}`);
  }

  const loggedOut = await call('POST', '/api/auth/logout');
  check('logout succeeds', loggedOut.ok);

  console.log('\n14. Public pages render when signed out');
  for (const path of ['/', '/login', '/signup']) {
    const res = await fetch(`${BASE}${path}`, { redirect: 'manual' });
    const body = res.ok ? await res.text() : '';
    check(`GET ${path}`, res.ok && body.includes('<html'), `${res.status}`);
  }
  const guarded = await fetch(`${BASE}/dashboard`, { redirect: 'manual' });
  check('/dashboard redirects to login when signed out', guarded.status === 307 || guarded.status === 302,
    `${guarded.status}`);

  console.log('\n════ result ════');
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failed) {
    console.log(`\n  Failures:\n${failures.map((f) => `   - ${f}`).join('\n')}`);
    process.exit(1);
  }
  console.log(`\n  ✓ The HTTP surface works end to end at ${BASE}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error('\n✗ smoke run threw:', e);
    process.exit(1);
  },
);
