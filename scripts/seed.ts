/**
 * Seed a demo workspace so the app is usable the moment it boots.
 * Creates the demo user, connects the mock WordPress site if it is running
 * (otherwise connects it unverified), and runs keyword research + clustering.
 */
import { ensureSchema, one, sql } from '../src/lib/db/client';
import { env } from '../src/lib/env';
import { hashPassword } from '../src/lib/auth/password';
import { newId } from '../src/lib/utils/ids';
import { grant } from '../src/lib/services/credits';
import { connectSite, syncPosts } from '../src/lib/services/sites';
import { research } from '../src/lib/services/keywords';
import { clusterSite } from '../src/lib/services/clustering';
import { generatePlans } from '../src/lib/services/plans';

const MOCK_WP_URL = process.env.MOCK_WP_URL ?? 'http://localhost:8787';
const MOCK_WP_USER = 'swarm-demo';
const MOCK_WP_PASSWORD = 'demoappspassword';
const SEED_CREDITS = 250;

async function mockWpRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${MOCK_WP_URL}/wp-json`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  await ensureSchema();

  const email = env.seed.email.toLowerCase();
  let user = await one`SELECT id, credits_balance FROM users WHERE email = ${email}`;

  if (!user) {
    const id = newId('usr');
    await sql`
      INSERT INTO users (id, email, name, password_hash, plan, credits_balance)
      VALUES (${id}, ${email}, 'GMK Media Demo', ${await hashPassword(env.seed.password)}, 'growth', 0)
    `;
    await grant({ userId: id, amount: SEED_CREDITS, reason: 'demo workspace seed' });
    user = { id, credits_balance: SEED_CREDITS };
    console.log(`✓ user ${email} created (password: ${env.seed.password}) with ${SEED_CREDITS} credits`);
  } else {
    console.log(`• user ${email} already exists — leaving it alone`);
  }

  const userId = user.id as string;

  const existingSite = await one`SELECT id, url FROM sites WHERE user_id = ${userId} LIMIT 1`;
  let siteId: string;

  if (existingSite) {
    siteId = existingSite.id;
    console.log(`• site already connected: ${existingSite.url}`);
  } else {
    const live = await mockWpRunning();
    const { site } = await connectSite(userId, {
      name: 'Luggage For Travel (demo)',
      url: MOCK_WP_URL,
      wpUsername: MOCK_WP_USER,
      wpAppPassword: MOCK_WP_PASSWORD,
      niche: 'travel luggage and packing gear, affiliate reviews',
      audience: 'frequent flyers and holiday travellers choosing cabin bags',
      tone: 'expert, direct, practical — British English',
      publishCadence: '3x_week',
      skipVerify: !live,
    });
    siteId = site.id;
    console.log(
      live
        ? `✓ site connected and verified against the mock WordPress at ${MOCK_WP_URL}`
        : `✓ site connected unverified (mock WordPress not running — start it with: npm run mock:wp)`,
    );

    if (live) {
      const synced = await syncPosts(userId, siteId);
      console.log(`✓ internal-link index built: ${synced.count} existing posts`);
    }
  }

  const [{ count: keywordCount }] = await sql`SELECT COUNT(*)::int AS count FROM keywords WHERE site_id = ${siteId}`;
  if (Number(keywordCount) === 0) {
    const result = await research(userId, {
      siteId,
      seeds: ['carry on luggage', 'checked luggage', 'travel backpack'],
      limitPerSeed: 30,
      withSerp: 4,
    });
    console.log(`✓ keyword research: ${result.total} keywords (${result.creditsSpent} credit(s), balance ${result.balance})`);

    const clusters = await clusterSite(userId, siteId);
    console.log(`✓ clustered into ${clusters.length} topic clusters`);

    const plans = await generatePlans(userId, { siteId, maxPerCluster: 2 });
    console.log(`✓ generated ${plans.length} draft content plans awaiting approval`);
  } else {
    console.log(`• ${keywordCount} keywords already present — skipping research`);
  }

  console.log('\n── Demo workspace ready ──');
  console.log(`  URL:      http://localhost:3000`);
  console.log(`  Email:    ${email}`);
  console.log(`  Password: ${env.seed.password}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error('✗ seed failed:', e);
    process.exit(1);
  },
);
