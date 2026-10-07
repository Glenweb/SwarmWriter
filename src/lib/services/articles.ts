/**
 * Article orchestration: credit gate → swarm run → persistence → telemetry.
 *
 * The credit is debited before generation and refunded if the run fails, so a
 * provider outage never costs the user anything.
 */
import { one, parseJson, sql } from '../db/client';
import { newId } from '../utils/ids';
import { AppError } from '../utils/result';
import { round } from '../utils/money';
import { getSite, linkIndex, type Site } from './sites';
import { getPlan, setPlanStatus, type ContentPlan } from './plans';
import * as credits from './credits';
import { runSwarm, type SwarmOutput } from './swarm/pipeline';
import { scoreArticle, type SeoReport } from './seo-score';
import { buildSchema, validateSchema } from './schema-gen';
import { DEFAULT_LINK_RULES, injectLinks, linkBudget, rankCandidates, type PlacedLink } from './internal-links';
import { parseJson as pj } from '../db/client';
import * as dfs from '../providers/dataforseo';
import { stripHtml, wordCount } from '../utils/text';
import type { StageLog } from './swarm/types';

export type Article = {
  id: string;
  siteId: string;
  planId: string | null;
  title: string;
  slug: string;
  html: string;
  markdown: string;
  excerpt: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  focusKeyword: string | null;
  canonicalUrl: string | null;
  secondaryKeywords: string[];
  schema: Record<string, unknown> | null;
  faq: Array<{ question: string; answer: string }>;
  images: Array<{ position: number; alt: string; caption: string }>;
  internalLinks: PlacedLink[];
  externalLinks: Array<{ url: string; anchor: string }>;
  seoScore: number;
  seoReport: SeoReport | null;
  wordCount: number;
  readingMinutes: number;
  costUsd: number;
  tierMix: unknown;
  status: 'queued' | 'generating' | 'draft' | 'scheduled' | 'published' | 'failed';
  error: string | null;
  wpPostId: number | null;
  wpUrl: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export function mapArticle(r: any): Article {
  return {
    id: r.id,
    siteId: r.site_id,
    planId: r.plan_id,
    title: r.title,
    slug: r.slug,
    html: r.html ?? '',
    markdown: r.markdown ?? '',
    excerpt: r.excerpt,
    metaTitle: r.meta_title,
    metaDescription: r.meta_description,
    focusKeyword: r.focus_keyword,
    canonicalUrl: r.canonical_url,
    secondaryKeywords: parseJson<string[]>(r.secondary_keywords, []),
    schema: parseJson<Record<string, unknown> | null>(r.schema_json, null),
    faq: parseJson<Array<{ question: string; answer: string }>>(r.faq, []),
    images: parseJson<Array<{ position: number; alt: string; caption: string }>>(r.images, []),
    internalLinks: parseJson<PlacedLink[]>(r.internal_links, []),
    externalLinks: parseJson<Array<{ url: string; anchor: string }>>(r.external_links, []),
    seoScore: Number(r.seo_score ?? 0),
    seoReport: parseJson<SeoReport | null>(r.seo_report, null),
    wordCount: Number(r.word_count ?? 0),
    readingMinutes: Number(r.reading_minutes ?? 0),
    costUsd: Number(r.cost_usd ?? 0),
    tierMix: parseJson<unknown>(r.tier_mix, null),
    status: r.status,
    error: r.error,
    wpPostId: r.wp_post_id == null ? null : Number(r.wp_post_id),
    wpUrl: r.wp_url,
    publishedAt: r.published_at ? new Date(r.published_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

export async function listArticles(userId: string, siteId?: string, status?: string): Promise<Article[]> {
  const rows = siteId
    ? await (async () => {
        await getSite(userId, siteId);
        return sql`
          SELECT * FROM articles WHERE site_id = ${siteId}
            AND (${status ?? null}::text IS NULL OR status = ${status ?? null})
          ORDER BY created_at DESC LIMIT 200
        `;
      })()
    : await sql`
        SELECT a.* FROM articles a JOIN sites s ON s.id = a.site_id
         WHERE s.user_id = ${userId}
           AND (${status ?? null}::text IS NULL OR a.status = ${status ?? null})
         ORDER BY a.created_at DESC LIMIT 200
      `;
  return rows.map(mapArticle);
}

export async function getArticle(userId: string, articleId: string): Promise<Article> {
  const row = await one`
    SELECT a.* FROM articles a JOIN sites s ON s.id = a.site_id
     WHERE a.id = ${articleId} AND s.user_id = ${userId}
  `;
  if (!row) throw new AppError('not_found', 'Article not found.', 404);
  return mapArticle(row);
}

export async function getRuns(userId: string, articleId: string): Promise<StageLog[]> {
  await getArticle(userId, articleId);
  const rows = await sql`
    SELECT stage, tier, model, input_tokens, output_tokens, cost_usd, ms, ok, note
      FROM article_runs WHERE article_id = ${articleId} ORDER BY created_at ASC
  `;
  return rows.map((r) => ({
    stage: r.stage,
    tier: r.tier,
    model: r.model,
    inputTokens: Number(r.input_tokens),
    outputTokens: Number(r.output_tokens),
    costUsd: Number(r.cost_usd),
    ms: Number(r.ms),
    ok: Boolean(r.ok),
    note: r.note ?? undefined,
  }));
}

export type GenerateOptions = { forceOpus?: boolean; escalateBelow?: number };

/**
 * Generate one article from an approved plan.
 * Plans must be approved first — the gate that stops credits burning on content
 * nobody signed off.
 */
export async function generateArticle(
  userId: string,
  planId: string,
  opts: GenerateOptions = {},
): Promise<{ article: Article; output: SwarmOutput; balance: number }> {
  const plan = await getPlan(userId, planId);
  if (plan.status === 'rejected') throw new AppError('plan_rejected', 'That plan was rejected.', 400);
  if (plan.status === 'draft') {
    throw new AppError('plan_not_approved', 'Approve the plan before generating. Credits are only spent on approved plans.', 400);
  }
  const site = await getSite(userId, plan.siteId);

  const articleId = newId('art');
  await sql`
    INSERT INTO articles (id, site_id, plan_id, title, slug, focus_keyword, status, secondary_keywords)
    VALUES (${articleId}, ${site.id}, ${plan.id}, ${plan.title}, ${plan.targetKeyword.replace(/\s+/g, '-')},
            ${plan.targetKeyword}, 'generating', ${plan.secondaryKeywords})
  `;

  const balance = await credits.debit({
    userId,
    amount: credits.CREDIT_COST.article,
    reason: `article — "${plan.title}"`,
    refId: articleId,
  });

  try {
    const [serp, existingPosts] = await Promise.all([serpFor(plan), linkIndex(site.id)]);

    const output = await runSwarm({
      plan,
      site: { id: site.id, name: site.name, url: site.url, niche: site.niche, audience: site.audience, tone: site.tone },
      serp,
      existingPosts,
      authorName: site.name,
      forceOpus: opts.forceOpus,
      escalateBelow: opts.escalateBelow,
    });

    await sql`
      UPDATE articles SET
        title = ${output.title}, slug = ${output.slug},
        html = ${output.html}, markdown = ${output.markdown}, excerpt = ${output.excerpt},
        meta_title = ${output.metaTitle}, meta_description = ${output.metaDescription},
        focus_keyword = ${output.focusKeyword}, canonical_url = ${output.canonicalUrl},
        secondary_keywords = ${output.secondaryKeywords},
        schema_json = ${output.schema}, faq = ${output.faq}, images = ${output.images},
        internal_links = ${output.internalLinks}, external_links = ${output.externalLinks},
        seo_score = ${output.seoScore}, seo_report = ${output.seoReport},
        word_count = ${output.wordCount}, reading_minutes = ${output.readingMinutes},
        cost_usd = ${output.costUsd}, tier_mix = ${output.tierSummary},
        status = 'draft', error = NULL, updated_at = now()
      WHERE id = ${articleId}
    `;

    for (const log of output.stageLogs) {
      await sql`
        INSERT INTO article_runs (id, article_id, stage, tier, model, input_tokens, output_tokens, cost_usd, ms, ok, note)
        VALUES (${newId('run')}, ${articleId}, ${log.stage}, ${log.tier}, ${log.model},
                ${log.inputTokens}, ${log.outputTokens}, ${log.costUsd}, ${log.ms}, ${log.ok}, ${log.note ?? null})
      `;
    }

    await setPlanStatus(userId, plan.id, 'generated');
    return { article: await getArticle(userId, articleId), output, balance };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Generation failed';
    await sql`UPDATE articles SET status = 'failed', error = ${message}, updated_at = now() WHERE id = ${articleId}`;
    // The user pays for output, not for our outage.
    const restored = await credits.refund({
      userId,
      amount: credits.CREDIT_COST.article,
      reason: `generation failed — "${plan.title}"`,
      refId: articleId,
    });
    throw new AppError('generation_failed', `Generation failed: ${message} Your credit has been returned (balance ${restored}).`, 502);
  }
}

async function serpFor(plan: ContentPlan): Promise<dfs.SerpSnapshot | null> {
  if (plan.keywordId) {
    const row = await one`SELECT serp_snapshot FROM keywords WHERE id = ${plan.keywordId}`;
    const cached = pj<dfs.SerpSnapshot | null>(row?.serp_snapshot, null);
    if (cached?.results?.length) return cached;
  }
  try {
    return await dfs.serpSnapshot(plan.targetKeyword);
  } catch {
    return null; // the swarm degrades to keyword-only research
  }
}

export type ArticlePatch = Partial<
  Pick<Article, 'title' | 'html' | 'markdown' | 'excerpt' | 'metaTitle' | 'metaDescription' | 'focusKeyword' | 'slug' | 'faq'>
>;

/** Editor save. Re-scores on every save so the panel is never stale. */
export async function updateArticle(userId: string, articleId: string, patch: ArticlePatch): Promise<Article> {
  const current = await getArticle(userId, articleId);
  const site = await getSite(userId, current.siteId);

  const next = {
    title: patch.title ?? current.title,
    html: patch.html ?? current.html,
    markdown: patch.markdown ?? current.markdown,
    excerpt: patch.excerpt ?? current.excerpt,
    metaTitle: patch.metaTitle ?? current.metaTitle,
    metaDescription: patch.metaDescription ?? current.metaDescription,
    focusKeyword: patch.focusKeyword ?? current.focusKeyword,
    slug: patch.slug ?? current.slug,
    faq: patch.faq ?? current.faq,
  };

  const plan = current.planId ? await getPlan(userId, current.planId).catch(() => null) : null;
  const report = scoreArticle({
    html: next.html,
    title: next.title,
    metaTitle: next.metaTitle,
    metaDescription: next.metaDescription,
    focusKeyword: next.focusKeyword,
    wordTarget: plan?.wordTarget ?? 1800,
    internalLinkCount: current.internalLinks.length,
    externalLinkCount: current.externalLinks.length,
    hasSchema: !!current.schema,
    siteUrl: site.url,
  });

  const words = wordCount(next.html);

  await sql`
    UPDATE articles SET
      title = ${next.title}, html = ${next.html}, markdown = ${next.markdown},
      excerpt = ${next.excerpt}, meta_title = ${next.metaTitle}, meta_description = ${next.metaDescription},
      focus_keyword = ${next.focusKeyword}, slug = ${next.slug}, faq = ${next.faq},
      seo_score = ${report.score}, seo_report = ${report},
      word_count = ${words}, reading_minutes = ${Math.max(1, Math.round(words / 230))},
      updated_at = now()
    WHERE id = ${articleId}
  `;
  return getArticle(userId, articleId);
}

export async function rescore(userId: string, articleId: string): Promise<{ article: Article; report: SeoReport }> {
  const article = await getArticle(userId, articleId);
  const updated = await updateArticle(userId, articleId, { html: article.html });
  return { article: updated, report: updated.seoReport! };
}

/**
 * Recompute internal links against the current state of the site, with no model
 * call — anchors are taken from the top-ranked candidate's title. Free, so the
 * user can re-link after every sync.
 */
export async function relink(userId: string, articleId: string): Promise<{ article: Article; placed: PlacedLink[] }> {
  const article = await getArticle(userId, articleId);
  const site = await getSite(userId, article.siteId);
  const posts = await linkIndex(site.id);
  if (!posts.length) {
    throw new AppError('no_link_index', 'Sync this site\'s posts first — there is nothing to link to yet.', 400);
  }

  // Strip links Swarm Writer previously placed, so re-linking is idempotent.
  let html = article.html;
  for (const link of article.internalLinks) {
    const re = new RegExp(`<a href="${escapeRe(link.url)}"[^>]*>([\\s\\S]*?)</a>`, 'gi');
    html = html.replace(re, '$1');
  }

  const sections = splitByH2(html);
  const budget = linkBudget(wordCount(html), DEFAULT_LINK_RULES);
  const used = new Set<string>();
  const placed: PlacedLink[] = [];

  for (let i = 0; i < sections.length && placed.length < budget; i++) {
    const candidates = rankCandidates({
      sectionText: sections[i].body,
      sectionHeading: sections[i].heading,
      posts,
      focusKeyword: article.focusKeyword ?? '',
      excludeSlug: article.slug,
      excludeUrls: [...used],
      limit: 3,
    }).filter((c) => c.score >= DEFAULT_LINK_RULES.minScore);

    let inSection = 0;
    for (const candidate of candidates) {
      if (placed.length >= budget || inSection >= DEFAULT_LINK_RULES.maxPerSection) break;
      if (used.has(candidate.url)) continue;
      const anchor = anchorFromTitle(candidate.title, article.focusKeyword ?? '');
      const { html: nextHtml, placed: done } = injectLinks(sections[i].body, [
        { url: candidate.url, anchor, title: candidate.title },
      ]);
      if (!done.length) continue;
      sections[i].body = nextHtml;
      used.add(candidate.url);
      inSection++;
      placed.push({ url: candidate.url, anchor: done[0].anchor, title: candidate.title, sectionIndex: i, score: candidate.score });
    }
  }

  const rebuilt = sections.map((s) => (s.heading ? `<h2>${s.heading}</h2>\n${s.body}` : s.body)).join('\n');
  await sql`UPDATE articles SET html = ${rebuilt}, internal_links = ${placed}, updated_at = now() WHERE id = ${articleId}`;
  const rescored = await updateArticle(userId, articleId, { html: rebuilt });
  return { article: rescored, placed };
}

/** 2–5 words from the destination title, never the current page's focus keyword. */
function anchorFromTitle(title: string, avoidKeyword: string): string {
  const cleaned = title.replace(/[:|–—].*$/, '').trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  const phrase = words.slice(0, Math.min(5, Math.max(2, words.length))).join(' ');
  if (avoidKeyword && phrase.toLowerCase() === avoidKeyword.toLowerCase() && words.length > 2) {
    return words.slice(0, 3).join(' ');
  }
  return phrase;
}

function splitByH2(html: string): Array<{ heading: string; body: string }> {
  const parts = html.split(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
  const out: Array<{ heading: string; body: string }> = [];
  if (parts[0]?.trim()) out.push({ heading: '', body: parts[0] });
  for (let i = 1; i < parts.length; i += 2) {
    out.push({ heading: stripHtml(parts[i] ?? ''), body: parts[i + 1] ?? '' });
  }
  return out;
}

/** Rebuild schema after an edit changed the title, description or FAQ. */
export async function regenerateSchema(userId: string, articleId: string): Promise<Article> {
  const article = await getArticle(userId, articleId);
  const site = await getSite(userId, article.siteId);
  const schema = buildSchema({
    title: article.title,
    description: article.metaDescription ?? article.excerpt ?? '',
    url: article.canonicalUrl ?? `${site.url}/${article.slug}/`,
    siteUrl: site.url,
    siteName: site.name,
    authorName: site.name,
    datePublished: article.publishedAt ?? article.createdAt,
    dateModified: new Date().toISOString(),
    faq: article.faq,
    wordCount: article.wordCount,
    keywords: [article.focusKeyword ?? '', ...article.secondaryKeywords].filter(Boolean),
  });
  const check = validateSchema(schema);
  if (!check.valid) console.warn('[articles] schema issues:', check.issues);
  await sql`UPDATE articles SET schema_json = ${schema}, updated_at = now() WHERE id = ${articleId}`;
  return getArticle(userId, articleId);
}

export async function deleteArticle(userId: string, articleId: string): Promise<void> {
  await getArticle(userId, articleId);
  await sql`DELETE FROM articles WHERE id = ${articleId}`;
}

/** Workspace stats for the dashboard: real measured cost, not an estimate. */
export async function workspaceStats(userId: string) {
  const [counts] = await sql`
    SELECT
      COUNT(*)::int                                                       AS total,
      COUNT(*) FILTER (WHERE a.status = 'published')::int                 AS published,
      COUNT(*) FILTER (WHERE a.status = 'draft')::int                     AS drafts,
      COUNT(*) FILTER (WHERE a.status = 'scheduled')::int                 AS scheduled,
      COALESCE(AVG(a.seo_score) FILTER (WHERE a.seo_score > 0), 0)        AS avg_score,
      COALESCE(SUM(a.cost_usd), 0)                                        AS total_cost,
      COALESCE(AVG(a.cost_usd) FILTER (WHERE a.cost_usd > 0), 0)          AS avg_cost,
      COALESCE(SUM(a.word_count), 0)::int                                 AS total_words
    FROM articles a JOIN sites s ON s.id = a.site_id
    WHERE s.user_id = ${userId}
  `;

  const [tier] = await sql`
    SELECT
      COALESCE(SUM(r.cost_usd) FILTER (WHERE r.tier = 'haiku'), 0)  AS haiku,
      COALESCE(SUM(r.cost_usd) FILTER (WHERE r.tier = 'sonnet'), 0) AS sonnet,
      COALESCE(SUM(r.cost_usd) FILTER (WHERE r.tier = 'opus'), 0)   AS opus,
      COUNT(*)::int                                                  AS calls
    FROM article_runs r
    JOIN articles a ON a.id = r.article_id
    JOIN sites s ON s.id = a.site_id
    WHERE s.user_id = ${userId}
  `;

  const totalTier = Number(tier?.haiku ?? 0) + Number(tier?.sonnet ?? 0) + Number(tier?.opus ?? 0);
  const share = (v: number) => (totalTier ? round(v / totalTier, 4) : 0);

  const [linkStats] = await sql`
    SELECT COALESCE(SUM(jsonb_array_length(a.internal_links)), 0)::int AS internal_links
      FROM articles a JOIN sites s ON s.id = a.site_id WHERE s.user_id = ${userId}
  `;

  return {
    articles: {
      total: Number(counts?.total ?? 0),
      published: Number(counts?.published ?? 0),
      drafts: Number(counts?.drafts ?? 0),
      scheduled: Number(counts?.scheduled ?? 0),
      totalWords: Number(counts?.total_words ?? 0),
    },
    seo: { avgScore: Math.round(Number(counts?.avg_score ?? 0)) },
    cost: {
      totalUsd: round(Number(counts?.total_cost ?? 0), 4),
      avgPerArticleUsd: round(Number(counts?.avg_cost ?? 0), 5),
      targetPerArticleUsd: round(Number(process.env.ARTICLE_COST_TARGET_USD ?? 0.039), 5),
      modelCalls: Number(tier?.calls ?? 0),
    },
    tierSpendShare: {
      haiku: share(Number(tier?.haiku ?? 0)),
      sonnet: share(Number(tier?.sonnet ?? 0)),
      opus: share(Number(tier?.opus ?? 0)),
    },
    internalLinks: Number(linkStats?.internal_links ?? 0),
  };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
