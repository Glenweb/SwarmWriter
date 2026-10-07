/**
 * WordPress REST provider.
 *
 * Auth is an application password over Basic. Three capabilities:
 *   verify()      — confirm the credential, detect RankMath meta exposure
 *   listPosts()   — build the internal-link index from the live site
 *   createPost()  — publish, carrying RankMath meta fields
 *
 * WORDPRESS_DRY_RUN=true records the exact payload and returns a synthetic post
 * id, so the publish path can be proven without touching a real site.
 */
import { env } from '../env';
import { stripHtml, tokenize } from '../utils/text';

export type WpCredentials = { baseUrl: string; username: string; appPassword: string };

export type WpVerifyResult = {
  ok: boolean;
  userId?: number;
  userName?: string;
  roles?: string[];
  canPublish: boolean;
  rankMathDetected: boolean;
  restBase: string;
  warnings: string[];
  error?: string;
};

export type WpPost = {
  id: number;
  title: string;
  slug: string;
  url: string;
  excerpt: string;
  publishedAt: string | null;
};

export type RankMathMeta = {
  rank_math_title?: string;
  rank_math_description?: string;
  rank_math_focus_keyword?: string;
  rank_math_canonical_url?: string;
  rank_math_robots?: string[];
};

export type CreatePostInput = {
  title: string;
  slug: string;
  content: string;
  excerpt?: string;
  status?: 'publish' | 'draft' | 'future' | 'pending';
  date?: string;
  authorId?: number;
  categoryIds?: number[];
  meta: RankMathMeta;
};

export type CreatePostResult = {
  id: number;
  link: string;
  status: string;
  dryRun: boolean;
  payload: Record<string, unknown>;
};

function normaliseBase(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withScheme.replace(/\/wp-json.*$/i, '');
}

export function restUrl(baseUrl: string, path: string): string {
  return `${normaliseBase(baseUrl)}/wp-json${path.startsWith('/') ? path : `/${path}`}`;
}

function headers(creds: WpCredentials): Record<string, string> {
  // Application passwords are issued with spaces for readability; WP ignores them.
  const token = Buffer.from(`${creds.username}:${creds.appPassword.replace(/\s+/g, '')}`).toString('base64');
  return {
    Authorization: `Basic ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': 'SwarmWriter/1.0 (+https://gmkmedia.co.uk)',
  };
}

async function wpFetch(creds: WpCredentials, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(restUrl(creds.baseUrl, path), {
    ...init,
    headers: { ...headers(creds), ...(init.headers as Record<string, string> | undefined) },
    signal: AbortSignal.timeout(30_000),
    cache: 'no-store',
  });
}

export async function verify(creds: WpCredentials): Promise<WpVerifyResult> {
  const base = normaliseBase(creds.baseUrl);
  const warnings: string[] = [];
  if (!/^https:/i.test(base) && !/localhost|127\.0\.0\.1/.test(base)) {
    warnings.push('Site is not on HTTPS. Application passwords would be sent in the clear.');
  }

  try {
    const res = await wpFetch(creds, '/wp/v2/users/me?context=edit');
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        canPublish: false,
        rankMathDetected: false,
        restBase: base,
        warnings,
        error:
          'WordPress rejected the credentials. Check the username and that the application password was copied in full.',
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        canPublish: false,
        rankMathDetected: false,
        restBase: base,
        warnings,
        error: `WordPress REST returned ${res.status}. Confirm the REST API is reachable at ${base}/wp-json.`,
      };
    }
    const me: any = await res.json();
    const roles: string[] = Array.isArray(me.roles) ? me.roles : [];
    const canPublish =
      roles.some((r) => ['administrator', 'editor', 'author'].includes(r)) ||
      Boolean(me.capabilities?.publish_posts);
    if (!canPublish) warnings.push('This user cannot publish posts. Use an Author role or above.');

    const rankMathDetected = await detectRankMath(creds);
    if (!rankMathDetected) {
      warnings.push(
        'RankMath meta fields are not exposed over REST. Swarm Writer will still publish; SEO fields may need the RankMath REST helper enabled.',
      );
    }

    return {
      ok: true,
      userId: Number(me.id),
      userName: String(me.name ?? me.slug ?? ''),
      roles,
      canPublish,
      rankMathDetected,
      restBase: base,
      warnings,
    };
  } catch (e: any) {
    const msg = e?.name === 'TimeoutError' ? 'Connection to WordPress timed out.' : e?.message ?? 'Connection failed';
    return { ok: false, canPublish: false, rankMathDetected: false, restBase: base, warnings, error: msg };
  }
}

/**
 * RankMath registers its meta with show_in_rest on most installs. Probe a post's
 * `meta` object for any rank_math_* key.
 */
async function detectRankMath(creds: WpCredentials): Promise<boolean> {
  try {
    const res = await wpFetch(creds, '/wp/v2/posts?per_page=1&context=edit&_fields=id,meta');
    if (!res.ok) return false;
    const posts: any[] = await res.json();
    const meta = posts?.[0]?.meta;
    if (meta && typeof meta === 'object') {
      return Object.keys(meta).some((k) => k.startsWith('rank_math'));
    }
    // No posts yet: fall back to asking the route schema.
    const schema = await wpFetch(creds, '/wp/v2/posts', { method: 'OPTIONS' });
    if (!schema.ok) return false;
    const body: any = await schema.json();
    const props = body?.schema?.properties?.meta?.properties ?? {};
    return Object.keys(props).some((k) => k.startsWith('rank_math'));
  } catch {
    return false;
  }
}

/** Walk every page of published posts, capped so a huge site cannot stall a request. */
export async function listPosts(creds: WpCredentials, maxPosts = 500): Promise<WpPost[]> {
  const out: WpPost[] = [];
  const perPage = 100;
  for (let page = 1; page <= Math.ceil(maxPosts / perPage); page++) {
    const res = await wpFetch(
      creds,
      `/wp/v2/posts?per_page=${perPage}&page=${page}&status=publish&orderby=date&order=desc&_fields=id,title,slug,link,excerpt,date_gmt`,
    );
    if (res.status === 400) break; // past the last page
    if (!res.ok) throw new Error(`Could not read posts from WordPress (${res.status}).`);
    const batch: any[] = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const p of batch) {
      out.push({
        id: Number(p.id),
        title: stripHtml(String(p.title?.rendered ?? '')),
        slug: String(p.slug ?? ''),
        url: String(p.link ?? ''),
        excerpt: stripHtml(String(p.excerpt?.rendered ?? '')).slice(0, 400),
        publishedAt: p.date_gmt ? `${p.date_gmt}Z` : null,
      });
      if (out.length >= maxPosts) return out;
    }
    const totalPages = Number(res.headers.get('x-wp-totalpages') ?? 1);
    if (page >= totalPages) break;
  }
  return out;
}

export async function createPost(creds: WpCredentials, input: CreatePostInput): Promise<CreatePostResult> {
  const payload: Record<string, unknown> = {
    title: input.title,
    slug: input.slug,
    content: input.content,
    excerpt: input.excerpt ?? '',
    status: input.status ?? 'publish',
    meta: {
      ...input.meta,
      rank_math_robots: input.meta.rank_math_robots ?? ['index', 'follow'],
    },
  };
  if (input.date) payload.date = input.date;
  if (input.authorId) payload.author = input.authorId;
  if (input.categoryIds?.length) payload.categories = input.categoryIds;

  if (env.wordpressDryRun) {
    // Deterministic synthetic id so dry-run output is still assertable.
    const id = 900_000 + (Math.abs(hash(input.slug)) % 90_000);
    return {
      id,
      link: `${normaliseBase(creds.baseUrl)}/${input.slug}/`,
      status: `${input.status ?? 'publish'} (dry-run)`,
      dryRun: true,
      payload,
    };
  }

  const res = await wpFetch(creds, '/wp/v2/posts', { method: 'POST', body: JSON.stringify(payload) });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`WordPress rejected the post (${res.status}): ${text.slice(0, 400)}`);
  }
  const post: any = await res.json();
  return {
    id: Number(post.id),
    link: String(post.link ?? `${normaliseBase(creds.baseUrl)}/${input.slug}/`),
    status: String(post.status ?? 'publish'),
    dryRun: false,
    payload,
  };
}

/** Confirm the RankMath fields actually landed. Used by the E2E proof. */
export async function readPostMeta(creds: WpCredentials, postId: number): Promise<Record<string, unknown>> {
  const res = await wpFetch(creds, `/wp/v2/posts/${postId}?context=edit&_fields=id,meta,slug,link,title`);
  if (!res.ok) throw new Error(`Could not read post ${postId} (${res.status}).`);
  return (await res.json()) as Record<string, unknown>;
}

export async function listAuthors(creds: WpCredentials): Promise<Array<{ id: number; name: string }>> {
  const res = await wpFetch(creds, '/wp/v2/users?per_page=50&_fields=id,name');
  if (!res.ok) return [];
  const users: any[] = await res.json();
  return users.map((u) => ({ id: Number(u.id), name: String(u.name ?? '') }));
}

export async function listCategories(creds: WpCredentials): Promise<Array<{ id: number; name: string }>> {
  const res = await wpFetch(creds, '/wp/v2/categories?per_page=100&_fields=id,name');
  if (!res.ok) return [];
  const cats: any[] = await res.json();
  return cats.map((c) => ({ id: Number(c.id), name: String(c.name ?? '') }));
}

/** Tokenised post text for the link index. */
export function postTokens(post: WpPost): string {
  return Array.from(new Set(tokenize(`${post.title} ${post.slug.replace(/-/g, ' ')} ${post.excerpt}`))).join(' ');
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
