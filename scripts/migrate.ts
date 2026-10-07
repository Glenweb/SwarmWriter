/** Apply schema.sql. Idempotent. */
import { dbKind, ensureSchema, sql } from '../src/lib/db/client';
import { providerMode } from '../src/lib/env';

async function main() {
  console.log(`→ database mode: ${providerMode.db}`);
  await ensureSchema();
  console.log(`→ driver: ${await dbKind()}`);
  const tables = await sql`
    SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' ORDER BY table_name
  `;
  console.log(`✓ migrated ${tables.length} tables: ${tables.map((t) => t.table_name).join(', ')}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error('✗ migration failed:', e);
    process.exit(1);
  },
);
