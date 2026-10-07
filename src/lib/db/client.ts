/**
 * Database access. One tagged-template `sql` interface over three drivers:
 *
 *   DATABASE_URL set, Vercel/serverless  -> @neondatabase/serverless (HTTP)
 *   DATABASE_URL set, long-lived process -> pg Pool
 *   DATABASE_URL blank                   -> PGlite embedded Postgres in ./.pgdata
 *
 * All three speak real Postgres, so `schema.sql` and every query are shared.
 * Parameters are always bound ($1, $2, ...) — never interpolated.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { env } from '../env';

export type Row = Record<string, any>;
type Driver = { query: (text: string, params: any[]) => Promise<{ rows: Row[] }>; kind: string };

/**
 * The driver and the applied-schema flag are cached on globalThis, not in module
 * scope.
 *
 * In Next.js dev, editing any file re-evaluates the module graph. Module-scoped
 * state is therefore recreated on every hot reload — which, for an embedded
 * WASM Postgres, means a fresh multi-hundred-megabyte instance each time while
 * the previous ones stay reachable from their own module copies. That walked the
 * dev server into a 13 GB OOM. A global cache survives hot reloads, so exactly
 * one database instance exists per process. The same pattern keeps a pg Pool
 * from leaking connections.
 */
const GLOBAL_KEY = '__swarmWriterDb__';

type GlobalCache = { driver?: Promise<Driver>; migrated?: Promise<void> };

function cache(): GlobalCache {
  const g = globalThis as typeof globalThis & { [GLOBAL_KEY]?: GlobalCache };
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = {};
  return g[GLOBAL_KEY];
}

async function createDriver(): Promise<Driver> {
  if (env.databaseUrl) {
    const url = env.databaseUrl;
    const isNeonHttp = /neon\.tech/.test(url) && !!process.env.VERCEL;
    if (isNeonHttp) {
      const { neon } = await import('@neondatabase/serverless');
      const q = neon(url);
      return {
        kind: 'neon-http',
        query: async (text, params) => ({ rows: (await q.query(text, params)) as Row[] }),
      };
    }
    const { Pool } = await import('pg');
    const pool = new Pool({
      connectionString: url,
      max: 10,
      ssl: /sslmode=require|neon\.tech|amazonaws\.com/.test(url) ? { rejectUnauthorized: false } : undefined,
    });
    return {
      kind: 'pg-pool',
      query: async (text, params) => {
        const r = await pool.query(text, params);
        return { rows: r.rows as Row[] };
      },
    };
  }

  // Embedded Postgres. Zero setup, same dialect — this is what makes day one work.
  const { PGlite } = await import('@electric-sql/pglite');
  const dir = join(process.cwd(), '.pgdata');
  const pg = new PGlite(dir);
  await pg.waitReady;
  return {
    kind: 'pglite',
    query: async (text, params) => {
      const r = await pg.query(text, params);
      return { rows: (r.rows ?? []) as Row[] };
    },
  };
}

function driver(): Promise<Driver> {
  const c = cache();
  if (!c.driver) c.driver = createDriver();
  return c.driver;
}

export async function dbKind(): Promise<string> {
  return (await driver()).kind;
}

/** Tagged template: sql`SELECT * FROM users WHERE id = ${id}` */
export async function sql<T extends Row = Row>(
  strings: TemplateStringsArray,
  ...values: any[]
): Promise<T[]> {
  let text = '';
  const params: any[] = [];
  strings.forEach((chunk, i) => {
    text += chunk;
    if (i < values.length) {
      params.push(normalise(values[i]));
      text += `$${params.length}`;
    }
  });
  const d = await driver();
  const { rows } = await d.query(text, params);
  return rows as T[];
}

/** Raw form for dynamic SQL built from a fixed, non-user-supplied set of fragments. */
export async function rawQuery<T extends Row = Row>(text: string, params: any[] = []): Promise<T[]> {
  const d = await driver();
  const { rows } = await d.query(text, params.map(normalise));
  return rows as T[];
}

export async function one<T extends Row = Row>(
  strings: TemplateStringsArray,
  ...values: any[]
): Promise<T | null> {
  const rows = await sql<T>(strings, ...values);
  return rows[0] ?? null;
}

/**
 * Objects and arrays bound to jsonb columns must go over the wire as JSON text;
 * Date -> ISO so every driver agrees on timestamptz.
 */
function normalise(v: any): any {
  if (v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (v !== null && typeof v === 'object' && !Buffer.isBuffer(v)) return JSON.stringify(v);
  return v;
}

/** jsonb reads come back parsed on pg, as text on some drivers. Normalise both. */
export function parseJson<T>(value: any, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === 'object') return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

/** Apply schema.sql once per process. Idempotent, so safe on every cold start. */
export function ensureSchema(): Promise<void> {
  const c = cache();
  if (!c.migrated) {
    c.migrated = (async () => {
      const path = join(process.cwd(), 'src', 'lib', 'db', 'schema.sql');
      const ddl = readFileSync(path, 'utf8');
      const d = await driver();
      for (const stmt of splitStatements(ddl)) {
        await d.query(stmt, []);
      }
    })();
  }
  return c.migrated;
}

/** Split on semicolons that terminate a statement, ignoring those inside strings. */
function splitStatements(ddl: string): string[] {
  const out: string[] = [];
  let buf = '';
  let inSingle = false;
  let inLineComment = false;
  for (let i = 0; i < ddl.length; i++) {
    const ch = ddl[i];
    const next = ddl[i + 1];
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      buf += ch;
      continue;
    }
    if (!inSingle && ch === '-' && next === '-') {
      inLineComment = true;
      buf += ch;
      continue;
    }
    if (ch === "'") inSingle = !inSingle;
    if (ch === ';' && !inSingle) {
      const stmt = buf.trim();
      if (stmt && !/^(--.*\s*)*$/.test(stmt)) out.push(stmt);
      buf = '';
      continue;
    }
    buf += ch;
  }
  const tail = buf.trim();
  if (tail && !/^(--.*\s*)*$/.test(tail)) out.push(tail);
  return out;
}
