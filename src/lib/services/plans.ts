/**
 * Content plans. A cluster becomes a set of briefs: one pillar page plus a
 * supporting post per distinct sub-intent. Plans are generated as `draft` and
 * require human approval before any credit is spent on generation — that
 * approval gate is the difference between a tool and a runaway bill.
 */
import { one, parseJson, sql } from '../db/client';
import { newId } from '../utils/ids';
import { AppError } from '../utils/result';
import { titleCase, tokenize } from '../utils/text';
import { getSite } from './sites';
import { listClusters, type Cluster } from './clustering';
import type { Keyword } from './keywords';

export type OutlineSection = {
  heading: string;
  level: 2 | 3;
  intent: string;
  wordTarget: number;
  keyPoints: string[];
  subheadings?: string[];
};

export type ContentPlan = {
  id: string;
  siteId: string;
  clusterId: string | null;
  keywordId: string | null;
  title: string;
  angle: string | null;
  targetKeyword: string;
  secondaryKeywords: string[];
  searchIntent: string;
  contentType: string;
  wordTarget: number;
  outline: OutlineSection[];
  linkIntents: string[];
  priority: number;
  estVolume: number;
  estDifficulty: number;
  status: 'draft' | 'approved' | 'rejected' | 'generated';
  scheduledFor: string | null;
  createdAt: string;
};

function mapPlan(r: any): ContentPlan {
  return {
    id: r.id,
    siteId: r.site_id,
    clusterId: r.cluster_id,
    keywordId: r.keyword_id,
    title: r.title,
    angle: r.angle,
    targetKeyword: r.target_keyword,
    secondaryKeywords: parseJson<string[]>(r.secondary_keywords, []),
    searchIntent: r.search_intent,
    contentType: r.content_type,
    wordTarget: Number(r.word_target),
    outline: parseJson<OutlineSection[]>(r.outline, []),
    linkIntents: parseJson<string[]>(r.link_intents, []),
    priority: Number(r.priority),
    estVolume: Number(r.est_volume),
    estDifficulty: Number(r.est_difficulty),
    status: r.status,
    scheduledFor: r.scheduled_for ? new Date(r.scheduled_for).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

/** Content type follows intent and phrasing — this drives the outline shape. */
export function inferContentType(keyword: string, intent: string): string {
  const k = keyword.toLowerCase();
  if (/\bvs\b|\bversus\b|\bcompar/.test(k)) return 'comparison';
  if (/^(best|top)\b|\bbest\b/.test(k)) return 'listicle';
  if (/^how to\b|\bhow to\b|\bguide\b|\bsetup\b/.test(k)) return 'how_to';
  if (/\breview/.test(k)) return 'review';
  if (intent === 'transactional' || intent === 'commercial') return 'listicle';
  return 'guide';
}

/** Longer for commercial pages — they compete with deep comparison content. */
function wordTargetFor(contentType: string, volume: number): number {
  const base: Record<string, number> = {
    guide: 1800, listicle: 2200, comparison: 2000, review: 1600, how_to: 1400, news: 900,
  };
  const b = base[contentType] ?? 1800;
  const lift = volume > 8000 ? 400 : volume > 2000 ? 200 : 0;
  return b + lift;
}

function titleFor(keyword: string, contentType: string, year = new Date().getFullYear()): string {
  const k = titleCase(keyword);
  switch (contentType) {
    case 'listicle': return `${k}: The ${year} Shortlist, Tested Against Real Use`;
    case 'comparison': return `${k} — Which One Actually Suits You`;
    case 'review': return `${k}: An Honest Review After Real Use`;
    case 'how_to': return `${k}: A Step-by-Step Walkthrough`;
    default: return `${k}: The Practical Guide (${year})`;
  }
}

function angleFor(keyword: string, contentType: string): string {
  switch (contentType) {
    case 'listicle': return `Lead with the decision rule, then the shortlist. Name who each pick is wrong for — that is what the top 10 never do.`;
    case 'comparison': return `Pick a winner for each use case rather than declaring one overall winner. Specifics beat hedging.`;
    case 'review': return `Open with the verdict and the one thing that would make you choose something else.`;
    case 'how_to': return `Numbered steps, each with the failure mode called out. Readers arrive mid-problem.`;
    default: return `Decision-first: the three criteria that settle "${keyword}", then the detail behind each.`;
  }
}

/** A skeleton outline, shaped by content type. The swarm's outline stage refines it. */
function skeletonOutline(keyword: string, contentType: string, wordTarget: number): OutlineSection[] {
  const specs: Record<string, Array<[string, string]>> = {
    guide: [
      [`What ${keyword} actually means`, 'define and frame the decision'],
      ['The three criteria that decide it', 'give the decision rule'],
      ['The options, with trade-offs named', 'inform and compare'],
      ['What it costs and where the money goes', 'set expectations'],
      ['Common mistakes and what to do instead', 'de-risk'],
      ['The short answer', 'resolve and recommend'],
    ],
    listicle: [
      ['How we chose', 'establish credibility'],
      ['Best overall', 'primary recommendation'],
      ['Best on a budget', 'price-sensitive pick'],
      ['Best for heavy use', 'edge-case pick'],
      ['Also considered, and why they missed', 'show the working'],
      ['What to look for yourself', 'transferable criteria'],
      ['Verdict', 'resolve'],
    ],
    comparison: [
      ['The short answer', 'lead with the verdict'],
      ['Where they differ that matters', 'the real trade-off'],
      ['Where they are effectively the same', 'kill the false choice'],
      ['Cost over two years', 'total cost of ownership'],
      ['Which one suits you', 'segment the recommendation'],
    ],
    review: [
      ['Verdict first', 'resolve immediately'],
      ['What it does well', 'strengths with evidence'],
      ['What it does badly', 'credible criticism'],
      ['How it compares to the obvious alternative', 'context'],
      ['Who should buy it', 'segment'],
    ],
    how_to: [
      ['What you need first', 'prerequisites'],
      ['Step by step', 'the walkthrough'],
      ['Where this usually goes wrong', 'failure modes'],
      ['How to check it worked', 'verification'],
    ],
  };
  const rows = specs[contentType] ?? specs.guide;
  const per = Math.round(wordTarget / rows.length);
  return rows.map(([heading, intent]) => ({
    heading,
    level: 2 as const,
    intent,
    wordTarget: per,
    keyPoints: [],
  }));
}

/**
 * Turn clusters into draft plans.
 * One pillar for the cluster, plus supporting posts for sub-intents that are
 * distinct enough to deserve their own page (and have volume worth the credit).
 */
export async function generatePlans(
  userId: string,
  args: { siteId: string; clusterIds?: string[]; maxPerCluster?: number },
): Promise<ContentPlan[]> {
  const site = await getSite(userId, args.siteId);
  const clusters = await listClusters(userId, args.siteId);
  const selected = args.clusterIds?.length ? clusters.filter((c) => args.clusterIds!.includes(c.id)) : clusters;
  if (!selected.length) throw new AppError('no_clusters', 'Run clustering on this site first.', 400);

  const maxPerCluster = Math.min(Math.max(args.maxPerCluster ?? 3, 1), 10);
  const created: ContentPlan[] = [];

  for (const cluster of selected) {
    for (const candidate of planCandidates(cluster, maxPerCluster)) {
      const existing = await one`
        SELECT id FROM content_plans
         WHERE site_id = ${site.id} AND target_keyword = ${candidate.targetKeyword} AND status <> 'rejected'
      `;
      if (existing) continue;

      const contentType = inferContentType(candidate.targetKeyword, candidate.intent);
      const wordTarget = wordTargetFor(contentType, candidate.volume);
      const id = newId('plan');

      await sql`
        INSERT INTO content_plans (
          id, site_id, cluster_id, keyword_id, title, angle, target_keyword, secondary_keywords,
          search_intent, content_type, word_target, outline, link_intents, priority, est_volume, est_difficulty, status
        ) VALUES (
          ${id}, ${site.id}, ${cluster.id}, ${candidate.keywordId},
          ${titleFor(candidate.targetKeyword, contentType)},
          ${angleFor(candidate.targetKeyword, contentType)},
          ${candidate.targetKeyword}, ${candidate.secondary},
          ${candidate.intent}, ${contentType}, ${wordTarget},
          ${skeletonOutline(candidate.targetKeyword, contentType, wordTarget)},
          ${candidate.linkIntents}, ${candidate.priority},
          ${candidate.volume}, ${candidate.difficulty}, 'draft'
        )
      `;
      if (candidate.keywordId) {
        await sql`UPDATE keywords SET status = 'planned' WHERE id = ${candidate.keywordId}`;
      }
      const row = await one`SELECT * FROM content_plans WHERE id = ${id}`;
      created.push(mapPlan(row));
    }
  }

  return created.sort((a, b) => b.priority - a.priority);
}

type Candidate = {
  targetKeyword: string;
  keywordId: string | null;
  secondary: string[];
  intent: string;
  volume: number;
  difficulty: number;
  priority: number;
  linkIntents: string[];
};

/**
 * Pillar = the cluster's highest-volume term, carrying the rest as secondaries.
 * Supporting pages = remaining keywords whose token set differs enough from the
 * pillar to avoid cannibalisation.
 */
function planCandidates(cluster: Cluster, max: number): Candidate[] {
  const kws = [...cluster.keywords].sort((a, b) => b.volume - a.volume);
  if (!kws.length) return [];

  const pillar = kws[0];
  const pillarTokens = new Set(tokenize(pillar.keyword));
  const out: Candidate[] = [
    {
      targetKeyword: pillar.keyword,
      keywordId: pillar.id,
      secondary: kws.slice(1, 9).map((k) => k.keyword),
      intent: pillar.intent,
      volume: pillar.volume,
      difficulty: pillar.difficulty,
      priority: Math.min(100, 60 + Math.round(cluster.opportunity / 4)),
      linkIntents: [
        `Link to the existing post that best covers "${cluster.pillarKeyword}"`,
        'Link to any money page in this cluster',
      ],
    },
  ];

  for (const k of kws.slice(1)) {
    if (out.length >= max) break;
    const tokens = tokenize(k.keyword);
    const novel = tokens.filter((t) => !pillarTokens.has(t));
    // Needs its own distinct angle and enough volume to be worth a credit.
    if (novel.length < 1 || k.volume < 150) continue;
    if (out.some((c) => tokenize(c.targetKeyword).join(' ') === tokens.join(' '))) continue;
    out.push({
      targetKeyword: k.keyword,
      keywordId: k.id,
      secondary: kws.filter((x) => x.id !== k.id && x.id !== pillar.id).slice(0, 5).map((x) => x.keyword),
      intent: k.intent,
      volume: k.volume,
      difficulty: k.difficulty,
      priority: Math.min(95, 35 + Math.round(k.volume / 200)),
      linkIntents: [`Link up to the pillar page for "${pillar.keyword}"`],
    });
  }

  return out;
}

export async function listPlans(userId: string, siteId: string, status?: string): Promise<ContentPlan[]> {
  await getSite(userId, siteId);
  const rows = await sql`
    SELECT * FROM content_plans
     WHERE site_id = ${siteId}
       AND (${status ?? null}::text IS NULL OR status = ${status ?? null})
     ORDER BY priority DESC, created_at DESC
  `;
  return rows.map(mapPlan);
}

export async function getPlan(userId: string, planId: string): Promise<ContentPlan> {
  const row = await one`
    SELECT p.* FROM content_plans p JOIN sites s ON s.id = p.site_id
     WHERE p.id = ${planId} AND s.user_id = ${userId}
  `;
  if (!row) throw new AppError('not_found', 'Content plan not found.', 404);
  return mapPlan(row);
}

export async function updatePlan(
  userId: string,
  planId: string,
  patch: Partial<Pick<ContentPlan, 'title' | 'angle' | 'targetKeyword' | 'secondaryKeywords' | 'wordTarget' | 'outline' | 'contentType' | 'priority' | 'scheduledFor'>>,
): Promise<ContentPlan> {
  await getPlan(userId, planId);
  await sql`
    UPDATE content_plans SET
      title = COALESCE(${patch.title ?? null}, title),
      angle = COALESCE(${patch.angle ?? null}, angle),
      target_keyword = COALESCE(${patch.targetKeyword ?? null}, target_keyword),
      secondary_keywords = COALESCE(${patch.secondaryKeywords ? JSON.stringify(patch.secondaryKeywords) : null}::jsonb, secondary_keywords),
      word_target = COALESCE(${patch.wordTarget ?? null}, word_target),
      outline = COALESCE(${patch.outline ? JSON.stringify(patch.outline) : null}::jsonb, outline),
      content_type = COALESCE(${patch.contentType ?? null}, content_type),
      priority = COALESCE(${patch.priority ?? null}, priority),
      scheduled_for = COALESCE(${patch.scheduledFor ?? null}, scheduled_for),
      updated_at = now()
    WHERE id = ${planId}
  `;
  return getPlan(userId, planId);
}

export async function setPlanStatus(userId: string, planId: string, status: ContentPlan['status']): Promise<ContentPlan> {
  const plan = await getPlan(userId, planId);
  await sql`UPDATE content_plans SET status = ${status}, updated_at = now() WHERE id = ${planId}`;
  if (status === 'rejected' && plan.keywordId) {
    await sql`UPDATE keywords SET status = 'rejected' WHERE id = ${plan.keywordId}`;
  }
  return getPlan(userId, planId);
}

export async function bulkApprove(userId: string, planIds: string[]): Promise<number> {
  let n = 0;
  for (const id of planIds) {
    try {
      await setPlanStatus(userId, id, 'approved');
      n++;
    } catch {
      /* skip plans this user does not own */
    }
  }
  return n;
}
