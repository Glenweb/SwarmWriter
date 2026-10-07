/**
 * Publishing: RankMath field injection, scheduling, and the job queue that n8n
 * drains. Jobs are claimed with a conditional UPDATE so two concurrent cron
 * hits cannot publish the same article twice.
 */
import { one, parseJson, sql } from '../db/client';
import { newId } from '../utils/ids';
import { AppError } from '../utils/result';
import { env } from '../env';
import * as wp from '../providers/wordpress';
import { credentialsFor, getSite } from './sites';
import { getArticle, mapArticle, type Article } from './articles';
import { schemaScriptTag } from './schema-gen';

export type PublishJob = {
  id: string;
  userId: string;
  siteId: string;
  articleId: string;
  scheduledFor: string;
  status: 'pending' | 'running' | 'published' | 'failed' | 'cancelled';
  attempts: number;
  wpPostId: number | null;
  wpUrl: string | null;
  dryRun: boolean;
  lastError: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  /** Joined for the calendar view. */
  articleTitle?: string;
  articleSeoScore?: number;
  siteName?: string;
};

function mapJob(r: any): PublishJob {
  return {
    id: r.id,
    userId: r.user_id,
    siteId: r.site_id,
    articleId: r.article_id,
    scheduledFor: new Date(r.scheduled_for).toISOString(),
    status: r.status,
    attempts: Number(r.attempts ?? 0),
    wpPostId: r.wp_post_id == null ? null : Number(r.wp_post_id),
    wpUrl: r.wp_url,
    dryRun: Boolean(r.dry_run),
    lastError: r.last_error,
    startedAt: r.started_at ? new Date(r.started_at).toISOString() : null,
    finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString(),
    articleTitle: r.article_title,
    articleSeoScore: r.article_seo_score == null ? undefined : Number(r.article_seo_score),
    siteName: r.site_name,
  };
}

/** The RankMath field map. The one integration detail that decides whether this is useful to a RankMath site. */
export function rankMathMeta(article: Article): wp.RankMathMeta {
  return {
    rank_math_title: article.metaTitle ?? article.title,
    rank_math_description: article.metaDescription ?? article.excerpt ?? '',
    rank_math_focus_keyword: article.focusKeyword ?? '',
    rank_math_canonical_url: article.canonicalUrl ?? '',
    rank_math_robots: ['index', 'follow'],
  };
}

/** Schema is injected into the body so it ships even on installs where RankMath's own schema module is off. */
function contentWithSchema(article: Article): string {
  const html = article.html ?? '';
  if (/application\/ld\+json/i.test(html)) return html;
  if (!article.schema) return html;
  return `${html}\n${schemaScriptTag(article.schema)}`;
}

export function buildPostInput(article: Article, site: { defaultAuthorId: number | null; defaultCategoryId: number | null }, when?: Date): wp.CreatePostInput {
  const future = when && when.getTime() > Date.now() + 60_000;
  return {
    title: article.title,
    slug: article.slug,
    content: contentWithSchema(article),
    excerpt: article.excerpt ?? '',
    status: future ? 'future' : 'publish',
    date: future ? when!.toISOString() : undefined,
    authorId: site.defaultAuthorId ?? undefined,
    categoryIds: site.defaultCategoryId ? [site.defaultCategoryId] : undefined,
    meta: rankMathMeta(article),
  };
}

/** Publish immediately. Returns the WP post id and URL. */
export async function publishNow(
  userId: string,
  articleId: string,
  opts: { dryRun?: boolean } = {},
): Promise<{ article: Article; job: PublishJob; wpPostId: number; wpUrl: string; dryRun: boolean; meta: wp.RankMathMeta }> {
  const article = await getArticle(userId, articleId);
  if (!article.html.trim()) throw new AppError('empty_article', 'This article has no content to publish.', 400);
  const site = await getSite(userId, article.siteId);
  const creds = await credentialsFor(userId, article.siteId);

  const jobId = newId('job');
  await sql`
    INSERT INTO publish_jobs (id, user_id, site_id, article_id, scheduled_for, status, dry_run, started_at, attempts)
    VALUES (${jobId}, ${userId}, ${site.id}, ${article.id}, now(), 'running', ${opts.dryRun ?? env.wordpressDryRun}, now(), 1)
  `;

  try {
    const input = buildPostInput(article, site);
    const result = await createPost(creds, input, opts.dryRun);
    await markPublished(jobId, article.id, result);
    return {
      article: await getArticle(userId, articleId),
      job: (await getJob(userId, jobId))!,
      wpPostId: result.id,
      wpUrl: result.link,
      dryRun: result.dryRun,
      meta: input.meta,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Publish failed';
    await sql`
      UPDATE publish_jobs SET status = 'failed', last_error = ${message}, finished_at = now(), updated_at = now()
       WHERE id = ${jobId}
    `;
    await sql`UPDATE articles SET status = 'failed', error = ${message}, updated_at = now() WHERE id = ${article.id}`;
    throw new AppError('publish_failed', message, 502);
  }
}

/** Per-call dry-run override, independent of the global env flag. */
async function createPost(creds: wp.WpCredentials, input: wp.CreatePostInput, dryRun?: boolean) {
  if (dryRun === true && !env.wordpressDryRun) {
    const previous = process.env.WORDPRESS_DRY_RUN;
    process.env.WORDPRESS_DRY_RUN = 'true';
    try {
      // The provider reads env at module load, so do the dry-run shape here.
      const id = 900_000 + (Math.abs(hashCode(input.slug)) % 90_000);
      return {
        id,
        link: `${creds.baseUrl.replace(/\/+$/, '')}/${input.slug}/`,
        status: 'publish (dry-run)',
        dryRun: true,
        payload: input as unknown as Record<string, unknown>,
      };
    } finally {
      if (previous === undefined) delete process.env.WORDPRESS_DRY_RUN;
      else process.env.WORDPRESS_DRY_RUN = previous;
    }
  }
  return wp.createPost(creds, input);
}

async function markPublished(jobId: string, articleId: string, result: wp.CreatePostResult) {
  await sql`
    UPDATE publish_jobs SET status = 'published', wp_post_id = ${result.id}, wp_url = ${result.link},
           payload = ${result.payload}, finished_at = now(), updated_at = now()
     WHERE id = ${jobId}
  `;
  await sql`
    UPDATE articles SET status = 'published', wp_post_id = ${result.id}, wp_url = ${result.link},
           published_at = now(), error = NULL, updated_at = now()
     WHERE id = ${articleId}
  `;
}

export async function schedule(
  userId: string,
  articleId: string,
  scheduledFor: Date,
  opts: { dryRun?: boolean } = {},
): Promise<PublishJob> {
  const article = await getArticle(userId, articleId);
  await getSite(userId, article.siteId);
  if (scheduledFor.getTime() < Date.now() - 60_000) {
    throw new AppError('bad_request', 'Pick a time in the future.', 400);
  }

  const existing = await one`
    SELECT id FROM publish_jobs WHERE article_id = ${articleId} AND status = 'pending'
  `;
  const jobId = existing?.id ?? newId('job');
  if (existing) {
    await sql`UPDATE publish_jobs SET scheduled_for = ${scheduledFor}, updated_at = now() WHERE id = ${jobId}`;
  } else {
    await sql`
      INSERT INTO publish_jobs (id, user_id, site_id, article_id, scheduled_for, status, dry_run)
      VALUES (${jobId}, ${userId}, ${article.siteId}, ${articleId}, ${scheduledFor}, 'pending', ${opts.dryRun ?? env.wordpressDryRun})
    `;
  }
  await sql`UPDATE articles SET status = 'scheduled', updated_at = now() WHERE id = ${articleId}`;
  return (await getJob(userId, jobId))!;
}

export async function getJob(userId: string, jobId: string): Promise<PublishJob | null> {
  const row = await one`
    SELECT j.*, a.title AS article_title, a.seo_score AS article_seo_score, s.name AS site_name
      FROM publish_jobs j
      JOIN articles a ON a.id = j.article_id
      JOIN sites s ON s.id = j.site_id
     WHERE j.id = ${jobId} AND j.user_id = ${userId}
  `;
  return row ? mapJob(row) : null;
}

export async function listJobs(userId: string, opts: { siteId?: string; from?: Date; to?: Date } = {}): Promise<PublishJob[]> {
  const rows = await sql`
    SELECT j.*, a.title AS article_title, a.seo_score AS article_seo_score, s.name AS site_name
      FROM publish_jobs j
      JOIN articles a ON a.id = j.article_id
      JOIN sites s ON s.id = j.site_id
     WHERE j.user_id = ${userId}
       AND (${opts.siteId ?? null}::text IS NULL OR j.site_id = ${opts.siteId ?? null})
       AND (${opts.from ?? null}::timestamptz IS NULL OR j.scheduled_for >= ${opts.from ?? null})
       AND (${opts.to ?? null}::timestamptz IS NULL OR j.scheduled_for <= ${opts.to ?? null})
     ORDER BY j.scheduled_for ASC
     LIMIT 500
  `;
  return rows.map(mapJob);
}

export async function rescheduleJob(userId: string, jobId: string, scheduledFor: Date): Promise<PublishJob> {
  const job = await getJob(userId, jobId);
  if (!job) throw new AppError('not_found', 'Publish job not found.', 404);
  if (job.status !== 'pending' && job.status !== 'failed') {
    throw new AppError('bad_state', `A ${job.status} job cannot be rescheduled.`, 400);
  }
  await sql`
    UPDATE publish_jobs SET scheduled_for = ${scheduledFor}, status = 'pending', last_error = NULL, updated_at = now()
     WHERE id = ${jobId}
  `;
  return (await getJob(userId, jobId))!;
}

export async function cancelJob(userId: string, jobId: string): Promise<PublishJob> {
  const job = await getJob(userId, jobId);
  if (!job) throw new AppError('not_found', 'Publish job not found.', 404);
  if (job.status === 'published') throw new AppError('bad_state', 'That article is already live.', 400);
  await sql`UPDATE publish_jobs SET status = 'cancelled', updated_at = now() WHERE id = ${jobId}`;
  await sql`UPDATE articles SET status = 'draft', updated_at = now() WHERE id = ${job.articleId}`;
  return (await getJob(userId, jobId))!;
}

const MAX_ATTEMPTS = 3;

export type DrainResult = {
  claimed: number;
  published: number;
  failed: number;
  results: Array<{ jobId: string; articleId: string; ok: boolean; wpPostId?: number; wpUrl?: string; error?: string }>;
};

/**
 * Drain due jobs. Called by n8n every 15 minutes (and by the UI's "run now").
 * Safe to call concurrently: each job is claimed with a conditional UPDATE, so
 * a second caller sees zero rows for an already-claimed job.
 */
export async function drainDueJobs(limit = 10): Promise<DrainResult> {
  const due = await sql`
    SELECT id FROM publish_jobs
     WHERE status = 'pending' AND scheduled_for <= now() AND attempts < ${MAX_ATTEMPTS}
     ORDER BY scheduled_for ASC LIMIT ${limit}
  `;

  const result: DrainResult = { claimed: 0, published: 0, failed: 0, results: [] };

  for (const { id } of due) {
    const claimed = await sql`
      UPDATE publish_jobs
         SET status = 'running', attempts = attempts + 1, started_at = now(), updated_at = now()
       WHERE id = ${id} AND status = 'pending'
      RETURNING *
    `;
    if (!claimed.length) continue; // another worker took it
    result.claimed++;
    const job = mapJob(claimed[0]);

    try {
      const articleRow = await one`SELECT * FROM articles WHERE id = ${job.articleId}`;
      if (!articleRow) throw new Error('Article no longer exists.');
      const article = mapArticle(articleRow);
      const siteRow = await one`SELECT * FROM sites WHERE id = ${job.siteId}`;
      if (!siteRow) throw new Error('Site no longer exists.');

      const creds = await credentialsFor(job.userId, job.siteId);
      const input = buildPostInput(article, {
        defaultAuthorId: siteRow.default_author_id == null ? null : Number(siteRow.default_author_id),
        defaultCategoryId: siteRow.default_category_id == null ? null : Number(siteRow.default_category_id),
      });
      const posted = await createPost(creds, input, job.dryRun);
      await markPublished(job.id, job.articleId, posted);
      result.published++;
      result.results.push({ jobId: job.id, articleId: job.articleId, ok: true, wpPostId: posted.id, wpUrl: posted.link });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Publish failed';
      const exhausted = job.attempts >= MAX_ATTEMPTS;
      await sql`
        UPDATE publish_jobs
           SET status = ${exhausted ? 'failed' : 'pending'},
               last_error = ${message},
               scheduled_for = ${exhausted ? job.scheduledFor : new Date(Date.now() + 15 * 60_000)},
               finished_at = ${exhausted ? new Date() : null},
               updated_at = now()
         WHERE id = ${job.id}
      `;
      if (exhausted) {
        await sql`UPDATE articles SET status = 'failed', error = ${message}, updated_at = now() WHERE id = ${job.articleId}`;
        result.failed++;
      }
      result.results.push({ jobId: job.id, articleId: job.articleId, ok: false, error: message });
    }
  }

  return result;
}

/** Spread N articles across the calendar at the site's cadence. */
export function cadenceSlots(cadence: string, count: number, startFrom = new Date()): Date[] {
  const stepDays: Record<string, number> = { daily: 1, '3x_week': 2, weekly: 7, biweekly: 14 };
  const step = stepDays[cadence] ?? 7;
  const slots: Date[] = [];
  const cursor = new Date(startFrom);
  cursor.setHours(9, 30, 0, 0);
  if (cursor.getTime() <= Date.now()) cursor.setDate(cursor.getDate() + 1);
  for (let i = 0; i < count; i++) {
    slots.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + step);
  }
  return slots;
}

/** Verify the RankMath fields actually landed — used by the E2E proof. */
export async function verifyPublishedMeta(userId: string, articleId: string) {
  const article = await getArticle(userId, articleId);
  if (!article.wpPostId) throw new AppError('not_published', 'That article has not been published yet.', 400);
  const creds = await credentialsFor(userId, article.siteId);
  const post = await wp.readPostMeta(creds, article.wpPostId);
  const meta = (post as any).meta ?? {};
  const expected = rankMathMeta(article);
  const checks = Object.entries(expected).map(([key, value]) => ({
    field: key,
    expected: Array.isArray(value) ? value.join(',') : String(value ?? ''),
    actual: Array.isArray(meta[key]) ? meta[key].join(',') : String(meta[key] ?? ''),
    ok: Array.isArray(value)
      ? JSON.stringify(meta[key] ?? []) === JSON.stringify(value)
      : String(meta[key] ?? '') === String(value ?? ''),
  }));
  return { postId: article.wpPostId, url: article.wpUrl, checks, allOk: checks.every((c) => c.ok) };
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
