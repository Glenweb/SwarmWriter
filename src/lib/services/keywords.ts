/**
 * Keyword research. Pulls ideas from DataForSEO, scores opportunity, stores one
 * row per keyword per site, and attaches a SERP snapshot to the terms that
 * matter (the ones a plan will be built from) rather than all of them.
 */
import { one, sql } from '../db/client';
import { newId } from '../utils/ids';
import { AppError } from '../utils/result';
import * as dfs from '../providers/dataforseo';
import { getSite } from './sites';
import * as credits from './credits';
import { parseJson } from '../db/client';

export type Keyword = {
  id: string;
  siteId: string;
  clusterId: string | null;
  keyword: string;
  seed: string | null;
  volume: number;
  cpc: number;
  competition: number;
  difficulty: number;
  intent: dfs.KeywordIntent;
  opportunity: number;
  status: 'new' | 'selected' | 'planned' | 'rejected';
  hasSerp: boolean;
  createdAt: string;
};

function mapKeyword(r: any): Keyword {
  const volume = Number(r.volume ?? 0);
  const difficulty = Number(r.difficulty ?? 0);
  return {
    id: r.id,
    siteId: r.site_id,
    clusterId: r.cluster_id,
    keyword: r.keyword,
    seed: r.seed,
    volume,
    cpc: Number(r.cpc ?? 0),
    competition: Number(r.competition ?? 0),
    difficulty,
    intent: r.intent,
    opportunity: opportunityScore(volume, difficulty, Number(r.cpc ?? 0), r.intent),
    status: r.status,
    hasSerp: r.serp_snapshot != null,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

/**
 * Opportunity = reachable traffic value, not raw volume.
 * Volume is log-scaled (the difference between 200 and 2,000 matters more than
 * 20,000 and 22,000), difficulty is a hard discount, and commercial intent gets
 * a lift because that is what affiliate operators are actually buying.
 */
export function opportunityScore(volume: number, difficulty: number, cpc: number, intent: string): number {
  const vol = Math.log10(Math.max(volume, 1)) / 5; // 0..~1
  const ease = 1 - Math.min(difficulty, 100) / 100;
  const value = Math.min(cpc / 4, 1);
  const intentBoost = intent === 'transactional' ? 1.25 : intent === 'commercial' ? 1.15 : 1;
  return Math.round(vol * 55 * intentBoost + ease * 30 + value * 15);
}

export type ResearchInput = { siteId: string; seeds: string[]; limitPerSeed?: number; withSerp?: number };

export async function research(
  userId: string,
  input: ResearchInput,
): Promise<{ inserted: number; total: number; creditsSpent: number; balance: number; keywords: Keyword[] }> {
  const site = await getSite(userId, input.siteId);
  const seeds = input.seeds.map((s) => s.trim().toLowerCase()).filter(Boolean).slice(0, 10);
  if (!seeds.length) throw new AppError('bad_request', 'Give at least one seed keyword.', 400);

  const limitPerSeed = Math.min(Math.max(input.limitPerSeed ?? 40, 5), 100);

  // Fetch first, then bill, so a provider failure never costs the user a credit.
  const collected = new Map<string, dfs.KeywordIdea & { seed: string }>();
  for (const seed of seeds) {
    const ideas = await dfs.keywordIdeas(seed, limitPerSeed);
    for (const idea of ideas) {
      if (!collected.has(idea.keyword)) collected.set(idea.keyword, { ...idea, seed });
    }
  }

  const cost = credits.researchCost(collected.size);
  const balance = await credits.debit({
    userId,
    amount: cost,
    reason: `keyword research — ${collected.size} keywords for ${site.name}`,
    refId: site.id,
  });

  let inserted = 0;
  for (const idea of collected.values()) {
    const rows = await sql`
      INSERT INTO keywords (id, site_id, keyword, seed, volume, cpc, competition, difficulty, intent, status)
      VALUES (${newId('kw')}, ${site.id}, ${idea.keyword}, ${idea.seed}, ${idea.volume}, ${idea.cpc},
              ${idea.competition}, ${idea.difficulty}, ${idea.intent}, 'new')
      ON CONFLICT (site_id, keyword) DO UPDATE SET
        volume = EXCLUDED.volume, cpc = EXCLUDED.cpc,
        competition = EXCLUDED.competition, difficulty = EXCLUDED.difficulty
      RETURNING (xmax = 0) AS is_new
    `;
    if (rows[0]?.is_new) inserted++;
  }

  // SERP snapshots cost a call each, so take them only for the best few — those
  // are the ones the research stage of the swarm will actually read.
  const serpCount = Math.min(input.withSerp ?? 5, 15);
  if (serpCount > 0) {
    const top = [...collected.values()]
      .map((k) => ({ ...k, opp: opportunityScore(k.volume, k.difficulty, k.cpc, k.intent) }))
      .sort((a, b) => b.opp - a.opp)
      .slice(0, serpCount);
    for (const k of top) {
      try {
        const snapshot = await dfs.serpSnapshot(k.keyword);
        await sql`UPDATE keywords SET serp_snapshot = ${snapshot} WHERE site_id = ${site.id} AND keyword = ${k.keyword}`;
      } catch (e) {
        console.warn(`[keywords] SERP snapshot failed for "${k.keyword}":`, (e as Error).message);
      }
    }
  }

  return { inserted, total: collected.size, creditsSpent: cost, balance, keywords: await listKeywords(userId, site.id) };
}

export async function listKeywords(userId: string, siteId: string, opts: { status?: string; clusterId?: string } = {}): Promise<Keyword[]> {
  await getSite(userId, siteId);
  const rows = await sql`
    SELECT * FROM keywords
     WHERE site_id = ${siteId}
       AND (${opts.status ?? null}::text IS NULL OR status = ${opts.status ?? null})
       AND (${opts.clusterId ?? null}::text IS NULL OR cluster_id = ${opts.clusterId ?? null})
     ORDER BY volume DESC
  `;
  return rows.map(mapKeyword);
}

export async function setStatus(userId: string, keywordId: string, status: Keyword['status']): Promise<Keyword> {
  const row = await one`
    SELECT k.* FROM keywords k JOIN sites s ON s.id = k.site_id
     WHERE k.id = ${keywordId} AND s.user_id = ${userId}
  `;
  if (!row) throw new AppError('not_found', 'Keyword not found.', 404);
  const updated = await sql`UPDATE keywords SET status = ${status} WHERE id = ${keywordId} RETURNING *`;
  return mapKeyword(updated[0]);
}

export async function bulkSetStatus(userId: string, keywordIds: string[], status: Keyword['status']): Promise<number> {
  let n = 0;
  for (const id of keywordIds) {
    try {
      await setStatus(userId, id, status);
      n++;
    } catch {
      /* skip anything not owned by this user */
    }
  }
  return n;
}

export async function getSerp(userId: string, keywordId: string): Promise<dfs.SerpSnapshot | null> {
  const row = await one`
    SELECT k.serp_snapshot, k.keyword FROM keywords k JOIN sites s ON s.id = k.site_id
     WHERE k.id = ${keywordId} AND s.user_id = ${userId}
  `;
  if (!row) throw new AppError('not_found', 'Keyword not found.', 404);
  if (row.serp_snapshot) return parseJson<dfs.SerpSnapshot | null>(row.serp_snapshot, null);
  const snapshot = await dfs.serpSnapshot(row.keyword);
  await sql`UPDATE keywords SET serp_snapshot = ${snapshot} WHERE id = ${keywordId}`;
  return snapshot;
}

/** Weekly refresh driven by n8n. Updates metrics without re-billing. */
export async function refreshMetrics(siteId: string, limit = 100): Promise<number> {
  const rows = await sql`
    SELECT keyword FROM keywords WHERE site_id = ${siteId} ORDER BY volume DESC LIMIT ${limit}
  `;
  let updated = 0;
  for (const r of rows) {
    try {
      const [fresh] = await dfs.keywordIdeas(r.keyword, 1);
      if (!fresh) continue;
      await sql`
        UPDATE keywords SET volume = ${fresh.volume}, cpc = ${fresh.cpc},
               competition = ${fresh.competition}, difficulty = ${fresh.difficulty}
         WHERE site_id = ${siteId} AND keyword = ${r.keyword}
      `;
      updated++;
    } catch {
      /* leave the stale value rather than fail the whole refresh */
    }
  }
  return updated;
}
