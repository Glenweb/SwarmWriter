/**
 * Keyword clustering, in code rather than via a model call.
 *
 * Agglomerative single-pass: sort by volume so the highest-volume term seeds
 * each cluster (and becomes the pillar), then absorb any keyword that is both
 * token-similar and intent-compatible. Deterministic, free, and instant — which
 * matters because users re-cluster repeatedly while exploring.
 */
import { sql } from '../db/client';
import { newId } from '../utils/ids';
import { jaccard, titleCase, tokenize } from '../utils/text';
import { getSite } from './sites';
import { listKeywords, opportunityScore, type Keyword } from './keywords';

export type Cluster = {
  id: string;
  siteId: string;
  label: string;
  pillarKeyword: string;
  intent: string;
  keywordCount: number;
  totalVolume: number;
  avgDifficulty: number;
  opportunity: number;
  keywords: Keyword[];
};

const SIMILARITY_THRESHOLD = 0.34;

/** Informational and commercial can share a page; transactional cannot. */
function intentCompatible(a: string, b: string): boolean {
  if (a === b) return true;
  const soft = new Set(['informational', 'commercial']);
  return soft.has(a) && soft.has(b);
}

export async function clusterSite(
  userId: string,
  siteId: string,
  opts: { threshold?: number; onlySelected?: boolean } = {},
): Promise<Cluster[]> {
  await getSite(userId, siteId);
  const threshold = opts.threshold ?? SIMILARITY_THRESHOLD;

  const all = await listKeywords(userId, siteId);
  const pool = all.filter((k) => k.status !== 'rejected' && (!opts.onlySelected || k.status !== 'new'));
  if (!pool.length) return [];

  // Re-clustering replaces the previous grouping outright.
  await sql`UPDATE keywords SET cluster_id = NULL WHERE site_id = ${siteId}`;
  await sql`DELETE FROM keyword_clusters WHERE site_id = ${siteId}`;

  const tokenised = pool.map((k) => ({ kw: k, tokens: tokenize(k.keyword) }));
  tokenised.sort((a, b) => b.kw.volume - a.kw.volume);

  const groups: Array<{ pillar: Keyword; members: Array<{ kw: Keyword; tokens: string[] }>; tokens: string[] }> = [];

  for (const item of tokenised) {
    let best: { group: (typeof groups)[number]; score: number } | null = null;
    for (const group of groups) {
      if (!intentCompatible(group.pillar.intent, item.kw.intent)) continue;
      const score = jaccard(group.tokens, item.tokens);
      if (score >= threshold && (!best || score > best.score)) best = { group, score };
    }
    if (best) {
      best.group.members.push(item);
      // Keep the centroid broad enough to attract genuine siblings.
      best.group.tokens = Array.from(new Set([...best.group.tokens, ...item.tokens]));
    } else {
      groups.push({ pillar: item.kw, members: [item], tokens: [...item.tokens] });
    }
  }

  const out: Cluster[] = [];
  for (const group of groups) {
    const id = newId('cl');
    const totalVolume = group.members.reduce((s, m) => s + m.kw.volume, 0);
    const avgDifficulty = group.members.reduce((s, m) => s + m.kw.difficulty, 0) / group.members.length;
    const avgCpc = group.members.reduce((s, m) => s + m.kw.cpc, 0) / group.members.length;
    const opportunity = opportunityScore(totalVolume, avgDifficulty, avgCpc, group.pillar.intent);
    const label = clusterLabel(group.pillar.keyword, group.members.map((m) => m.kw.keyword));

    await sql`
      INSERT INTO keyword_clusters (id, site_id, label, pillar_keyword, intent, keyword_count, total_volume, avg_difficulty, opportunity)
      VALUES (${id}, ${siteId}, ${label}, ${group.pillar.keyword}, ${group.pillar.intent},
              ${group.members.length}, ${totalVolume}, ${avgDifficulty.toFixed(2)}, ${opportunity.toFixed(2)})
    `;
    for (const m of group.members) {
      await sql`UPDATE keywords SET cluster_id = ${id} WHERE id = ${m.kw.id}`;
    }

    out.push({
      id,
      siteId,
      label,
      pillarKeyword: group.pillar.keyword,
      intent: group.pillar.intent,
      keywordCount: group.members.length,
      totalVolume,
      avgDifficulty: Math.round(avgDifficulty * 100) / 100,
      opportunity,
      keywords: group.members.map((m) => ({ ...m.kw, clusterId: id })),
    });
  }

  return out.sort((a, b) => b.opportunity - a.opportunity);
}

/** A human-readable name: the shared tokens, or the pillar if there is no overlap. */
function clusterLabel(pillar: string, members: string[]): string {
  if (members.length === 1) return titleCase(pillar);
  const tokenSets = members.map((m) => new Set(tokenize(m)));
  const shared = [...tokenSets[0]].filter((t) => tokenSets.every((s) => s.has(t)));
  if (shared.length) return titleCase(shared.join(' '));
  return titleCase(pillar);
}

export async function listClusters(userId: string, siteId: string): Promise<Cluster[]> {
  await getSite(userId, siteId);
  const rows = await sql`
    SELECT * FROM keyword_clusters WHERE site_id = ${siteId} ORDER BY opportunity DESC
  `;
  const keywords = await listKeywords(userId, siteId);
  const byCluster = new Map<string, Keyword[]>();
  for (const k of keywords) {
    if (!k.clusterId) continue;
    const list = byCluster.get(k.clusterId) ?? [];
    list.push(k);
    byCluster.set(k.clusterId, list);
  }
  return rows.map((r) => ({
    id: r.id,
    siteId: r.site_id,
    label: r.label,
    pillarKeyword: r.pillar_keyword,
    intent: r.intent,
    keywordCount: Number(r.keyword_count),
    totalVolume: Number(r.total_volume),
    avgDifficulty: Number(r.avg_difficulty),
    opportunity: Number(r.opportunity),
    keywords: (byCluster.get(r.id) ?? []).sort((a, b) => b.volume - a.volume),
  }));
}
