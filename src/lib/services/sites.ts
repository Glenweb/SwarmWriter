/**
 * Site connection and the internal-link index.
 * WP application passwords are AES-256-GCM encrypted before they touch the DB
 * and are only decrypted inside this module.
 */
import { one, sql } from '../db/client';
import { decryptSecret, encryptSecret } from '../auth/crypto';
import { newId } from '../utils/ids';
import { AppError } from '../utils/result';
import * as wp from '../providers/wordpress';
import { providerMode } from '../env';

export type Site = {
  id: string;
  userId: string;
  name: string;
  url: string;
  wpUsername: string | null;
  hasCredentials: boolean;
  status: 'pending' | 'connected' | 'error';
  statusDetail: string | null;
  defaultAuthorId: number | null;
  defaultCategoryId: number | null;
  rankMathDetected: boolean;
  niche: string | null;
  audience: string | null;
  tone: string;
  postsSyncedAt: string | null;
  postCount: number;
  publishCadence: string;
  autoPublish: boolean;
  createdAt: string;
};

function mapSite(r: any): Site {
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    url: r.url,
    wpUsername: r.wp_username,
    hasCredentials: Boolean(r.wp_app_password_enc),
    status: r.status,
    statusDetail: r.status_detail,
    defaultAuthorId: r.default_author_id == null ? null : Number(r.default_author_id),
    defaultCategoryId: r.default_category_id == null ? null : Number(r.default_category_id),
    rankMathDetected: Boolean(r.rankmath_detected),
    niche: r.niche,
    audience: r.audience,
    tone: r.tone,
    postsSyncedAt: r.posts_synced_at ? new Date(r.posts_synced_at).toISOString() : null,
    postCount: Number(r.post_count ?? 0),
    publishCadence: r.publish_cadence,
    autoPublish: Boolean(r.auto_publish),
    createdAt: new Date(r.created_at).toISOString(),
  };
}

export async function listSites(userId: string): Promise<Site[]> {
  const rows = await sql`SELECT * FROM sites WHERE user_id = ${userId} ORDER BY created_at DESC`;
  return rows.map(mapSite);
}

/** Always use this to load a site — it enforces ownership. */
export async function getSite(userId: string, siteId: string): Promise<Site> {
  const row = await one`SELECT * FROM sites WHERE id = ${siteId} AND user_id = ${userId}`;
  if (!row) throw new AppError('not_found', 'Site not found.', 404);
  return mapSite(row);
}

export async function credentialsFor(userId: string, siteId: string): Promise<wp.WpCredentials> {
  const row = await one`SELECT url, wp_username, wp_app_password_enc FROM sites WHERE id = ${siteId} AND user_id = ${userId}`;
  if (!row) throw new AppError('not_found', 'Site not found.', 404);
  if (!row.wp_app_password_enc || !row.wp_username) {
    throw new AppError('site_not_connected', 'This site has no WordPress credentials saved.', 400);
  }
  return {
    baseUrl: row.url,
    username: row.wp_username,
    appPassword: decryptSecret(row.wp_app_password_enc),
  };
}

export type ConnectInput = {
  name: string;
  url: string;
  wpUsername: string;
  wpAppPassword: string;
  niche?: string;
  audience?: string;
  tone?: string;
  publishCadence?: string;
  autoPublish?: boolean;
  /** Skip the live verification call — used by the seeder. */
  skipVerify?: boolean;
};

export async function connectSite(userId: string, input: ConnectInput): Promise<{ site: Site; verify: wp.WpVerifyResult | null }> {
  const url = input.url.trim().replace(/\/+$/, '');
  const existing = await one`SELECT id FROM sites WHERE user_id = ${userId} AND url = ${url}`;
  if (existing) throw new AppError('duplicate_site', 'That site is already connected.', 409);

  let verifyResult: wp.WpVerifyResult | null = null;
  if (!input.skipVerify) {
    verifyResult = await wp.verify({ baseUrl: url, username: input.wpUsername, appPassword: input.wpAppPassword });
    if (!verifyResult.ok) {
      throw new AppError('wp_verify_failed', verifyResult.error ?? 'Could not connect to WordPress.', 400, {
        warnings: verifyResult.warnings,
      });
    }
  }

  const id = newId('site');
  await sql`
    INSERT INTO sites (
      id, user_id, name, url, wp_username, wp_app_password_enc, status, status_detail,
      default_author_id, rankmath_detected, niche, audience, tone, publish_cadence, auto_publish
    ) VALUES (
      ${id}, ${userId}, ${input.name.trim()}, ${url}, ${input.wpUsername.trim()},
      ${encryptSecret(input.wpAppPassword)},
      ${verifyResult ? 'connected' : 'pending'},
      ${verifyResult?.warnings.length ? verifyResult.warnings.join(' ') : null},
      ${verifyResult?.userId ?? null},
      ${verifyResult?.rankMathDetected ?? false},
      ${input.niche ?? null}, ${input.audience ?? null},
      ${input.tone ?? 'expert, direct, practical'},
      ${input.publishCadence ?? 'weekly'}, ${input.autoPublish ?? false}
    )
  `;
  return { site: await getSite(userId, id), verify: verifyResult };
}

export async function verifySite(userId: string, siteId: string): Promise<wp.WpVerifyResult> {
  const creds = await credentialsFor(userId, siteId);
  const result = await wp.verify(creds);
  await sql`
    UPDATE sites
       SET status = ${result.ok ? 'connected' : 'error'},
           status_detail = ${result.ok ? (result.warnings.join(' ') || null) : (result.error ?? 'Verification failed')},
           rankmath_detected = ${result.rankMathDetected},
           default_author_id = COALESCE(default_author_id, ${result.userId ?? null}),
           updated_at = now()
     WHERE id = ${siteId} AND user_id = ${userId}
  `;
  return result;
}

export async function updateSite(
  userId: string,
  siteId: string,
  patch: Partial<Pick<Site, 'name' | 'niche' | 'audience' | 'tone' | 'publishCadence' | 'autoPublish' | 'defaultAuthorId' | 'defaultCategoryId'>>,
): Promise<Site> {
  await getSite(userId, siteId);
  await sql`
    UPDATE sites SET
      name = COALESCE(${patch.name ?? null}, name),
      niche = COALESCE(${patch.niche ?? null}, niche),
      audience = COALESCE(${patch.audience ?? null}, audience),
      tone = COALESCE(${patch.tone ?? null}, tone),
      publish_cadence = COALESCE(${patch.publishCadence ?? null}, publish_cadence),
      auto_publish = COALESCE(${patch.autoPublish ?? null}, auto_publish),
      default_author_id = COALESCE(${patch.defaultAuthorId ?? null}, default_author_id),
      default_category_id = COALESCE(${patch.defaultCategoryId ?? null}, default_category_id),
      updated_at = now()
    WHERE id = ${siteId} AND user_id = ${userId}
  `;
  return getSite(userId, siteId);
}

export async function deleteSite(userId: string, siteId: string): Promise<void> {
  await getSite(userId, siteId);
  await sql`DELETE FROM sites WHERE id = ${siteId} AND user_id = ${userId}`;
}

/**
 * Rebuild the internal-link index from the live site. This is the asset that
 * makes Swarm Writer's linking better than keyword-matching against its own
 * output: it links into posts that already exist and already rank.
 */
export async function syncPosts(userId: string, siteId: string): Promise<{ count: number; syncedAt: string }> {
  const creds = await credentialsFor(userId, siteId);
  const posts = await wp.listPosts(creds, 500);

  for (const post of posts) {
    await sql`
      INSERT INTO site_posts (id, site_id, wp_post_id, title, slug, url, excerpt, tokens, published_at)
      VALUES (${newId('sp')}, ${siteId}, ${post.id}, ${post.title}, ${post.slug}, ${post.url},
              ${post.excerpt}, ${wp.postTokens(post)}, ${post.publishedAt})
      ON CONFLICT (site_id, wp_post_id) DO UPDATE SET
        title = EXCLUDED.title, slug = EXCLUDED.slug, url = EXCLUDED.url,
        excerpt = EXCLUDED.excerpt, tokens = EXCLUDED.tokens, published_at = EXCLUDED.published_at
    `;
  }

  const syncedAt = new Date();
  await sql`
    UPDATE sites SET posts_synced_at = ${syncedAt}, post_count = ${posts.length}, updated_at = now()
     WHERE id = ${siteId} AND user_id = ${userId}
  `;
  return { count: posts.length, syncedAt: syncedAt.toISOString() };
}

export type SitePost = { id: string; wpPostId: number; title: string; slug: string; url: string; excerpt: string; tokens: string[] };

export async function linkIndex(siteId: string): Promise<SitePost[]> {
  const rows = await sql`
    SELECT id, wp_post_id, title, slug, url, excerpt, tokens FROM site_posts WHERE site_id = ${siteId}
  `;
  return rows.map((r) => ({
    id: r.id,
    wpPostId: Number(r.wp_post_id),
    title: r.title,
    slug: r.slug,
    url: r.url,
    excerpt: r.excerpt ?? '',
    tokens: String(r.tokens ?? '').split(/\s+/).filter(Boolean),
  }));
}

export async function siteOptions(userId: string, siteId: string) {
  const creds = await credentialsFor(userId, siteId);
  const [authors, categories] = await Promise.all([wp.listAuthors(creds), wp.listCategories(creds)]);
  return { authors, categories, mode: providerMode.wordpress };
}
