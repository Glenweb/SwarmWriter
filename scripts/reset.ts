/** Drop every Swarm Writer table, then re-migrate. Destroys all local data. */
import { ensureSchema, rawQuery } from '../src/lib/db/client';

const TABLES = [
  'article_runs', 'publish_jobs', 'articles', 'content_plans',
  'keywords', 'keyword_clusters', 'site_posts', 'sites',
  'usage_credits', 'sessions', 'users',
];

async function main() {
  await ensureSchema();
  for (const table of TABLES) {
    await rawQuery(`DROP TABLE IF EXISTS ${table} CASCADE`);
    console.log(`  dropped ${table}`);
  }
  // ensureSchema memoises per process, so re-apply the DDL directly.
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const ddl = readFileSync(join(process.cwd(), 'src/lib/db/schema.sql'), 'utf8');
  for (const stmt of ddl.split(/;\s*\n/)) {
    const s = stmt.trim();
    if (s && !/^(--)/.test(s)) await rawQuery(s);
  }
  console.log('✓ reset complete');
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error('✗ reset failed:', e);
    process.exit(1);
  },
);
