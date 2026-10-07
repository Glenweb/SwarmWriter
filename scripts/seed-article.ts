/**
 * Approve the top demo plan and generate one article, so a fresh checkout has
 * something in the editor to look at. Idempotent: skips if articles exist.
 */
import { ensureSchema, one, sql } from '../src/lib/db/client';
import { env } from '../src/lib/env';
import { listPlans, setPlanStatus } from '../src/lib/services/plans';
import { generateArticle } from '../src/lib/services/articles';

async function main() {
  await ensureSchema();
  const user = await one`SELECT id FROM users WHERE email = ${env.seed.email.toLowerCase()}`;
  if (!user) {
    console.log('• no demo user — run `npm run db:seed` first');
    return;
  }
  const site = await one`SELECT id, name FROM sites WHERE user_id = ${user.id} ORDER BY created_at ASC LIMIT 1`;
  if (!site) {
    console.log('• no demo site — run `npm run db:seed` first');
    return;
  }

  const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM articles WHERE site_id = ${site.id}`;
  if (Number(count) > 0) {
    console.log(`• ${count} article(s) already present — nothing to do`);
    return;
  }

  const drafts = await listPlans(user.id, site.id, 'draft');
  if (!drafts.length) {
    console.log('• no draft plans to generate from');
    return;
  }

  // Two articles: enough to show the list, the editor and the calendar.
  for (const plan of drafts.slice(0, 2)) {
    await setPlanStatus(user.id, plan.id, 'approved');
    const { article, output } = await generateArticle(user.id, plan.id);
    console.log(
      `✓ "${article.title}" — SEO ${output.seoScore}/100, ${output.internalLinks.length} internal links, $${output.costUsd.toFixed(5)}`,
    );
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error('✗ failed:', e);
    process.exit(1);
  },
);
