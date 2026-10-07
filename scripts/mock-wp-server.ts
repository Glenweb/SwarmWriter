/**
 * A minimal WordPress REST stand-in, used to prove the publish path end to end
 * without a real site. Implements only what Swarm Writer calls:
 *   GET  /wp-json/wp/v2/users/me
 *   GET  /wp-json/wp/v2/posts        (list, with X-WP-TotalPages)
 *   POST /wp-json/wp/v2/posts        (create, stores meta)
 *   GET  /wp-json/wp/v2/posts/:id    (read back, including meta)
 *   GET  /wp-json/wp/v2/users | /categories
 * It stores rank_math_* meta exactly as sent, so the E2E check is meaningful.
 *
 *   npx tsx scripts/mock-wp-server.ts [port]
 */
import { createServer } from 'node:http';

const PORT = Number(process.argv[2] ?? process.env.MOCK_WP_PORT ?? 8787);
const USER = 'swarm-demo';
const APP_PASSWORD = 'demoappspassword';

type Post = {
  id: number;
  title: { rendered: string };
  slug: string;
  link: string;
  excerpt: { rendered: string };
  content: { rendered: string };
  status: string;
  date_gmt: string;
  meta: Record<string, unknown>;
};

let nextId = 101;
const posts: Post[] = seedExistingPosts();

/** Pre-existing posts give the internal-link index something real to match against. */
function seedExistingPosts(): Post[] {
  const seeds: Array<[string, string, string]> = [
    ['Carry-On Size Limits by Airline', 'carry-on-size-limits', 'The cabin bag dimensions each major airline actually enforces, with the ones that catch people out.'],
    ['How to Pack a Carry-On for Two Weeks', 'pack-carry-on-two-weeks', 'A packing method that fits two weeks of clothing into a single cabin bag without compression sacks.'],
    ['Hard Shell vs Soft Shell Luggage', 'hard-shell-vs-soft-shell', 'Which case survives baggage handling better, and when a soft shell is the smarter buy.'],
    ['Best Luggage Brands Worth the Money', 'best-luggage-brands', 'The brands whose warranties actually pay out, and the ones trading on a name.'],
    ['Spinner Wheels or Two Wheels?', 'spinner-vs-two-wheel', 'Four wheels glide on smooth floors and fail on cobbles. Here is how to choose.'],
    ['Luggage Weight Limits and Overweight Fees', 'luggage-weight-limits', 'What each airline charges when you go over, and how to avoid it at the desk.'],
    ['TSA Locks: Worth Using or Not?', 'tsa-locks-worth-it', 'What a TSA-approved lock does and does not protect against.'],
    ['Travel Backpack vs Wheeled Case', 'backpack-vs-wheeled-case', 'The trade-off is your back against the terrain. A straightforward decision rule.'],
  ];
  return seeds.map(([title, slug, excerpt], i) => ({
    id: nextId++,
    title: { rendered: title },
    slug,
    link: `http://localhost:${PORT}/${slug}/`,
    excerpt: { rendered: `<p>${excerpt}</p>` },
    content: { rendered: `<p>${excerpt}</p>` },
    status: 'publish',
    date_gmt: new Date(Date.now() - (i + 1) * 86_400_000).toISOString().replace(/\.\d+Z$/, ''),
    meta: {
      rank_math_title: title,
      rank_math_description: excerpt,
      rank_math_focus_keyword: slug.replace(/-/g, ' '),
    },
  }));
}

function authorised(header: string | undefined): boolean {
  if (!header?.startsWith('Basic ')) return false;
  const [user, pass] = Buffer.from(header.slice(6), 'base64').toString('utf8').split(':');
  return user === USER && pass.replace(/\s+/g, '') === APP_PASSWORD;
}

function json(res: any, status: number, body: unknown, headers: Record<string, string> = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers });
  res.end(payload);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (req.method === 'OPTIONS' && path === '/wp-json/wp/v2/posts') {
    return json(res, 200, {
      schema: {
        properties: {
          meta: {
            properties: {
              rank_math_title: {}, rank_math_description: {},
              rank_math_focus_keyword: {}, rank_math_canonical_url: {}, rank_math_robots: {},
            },
          },
        },
      },
    });
  }

  if (path === '/wp-json') return json(res, 200, { name: 'Swarm Writer Mock WP', namespaces: ['wp/v2'] });

  if (!authorised(req.headers.authorization as string | undefined)) {
    return json(res, 401, { code: 'incorrect_password', message: 'Invalid username or application password.' });
  }

  if (req.method === 'GET' && path === '/wp-json/wp/v2/users/me') {
    return json(res, 200, {
      id: 1, name: 'Swarm Demo', slug: USER,
      roles: ['administrator'], capabilities: { publish_posts: true },
    });
  }

  if (req.method === 'GET' && path === '/wp-json/wp/v2/users') {
    return json(res, 200, [{ id: 1, name: 'Swarm Demo' }]);
  }

  if (req.method === 'GET' && path === '/wp-json/wp/v2/categories') {
    return json(res, 200, [{ id: 3, name: 'Guides' }, { id: 4, name: 'Reviews' }]);
  }

  const postById = path.match(/^\/wp-json\/wp\/v2\/posts\/(\d+)$/);
  if (req.method === 'GET' && postById) {
    const post = posts.find((p) => p.id === Number(postById[1]));
    if (!post) return json(res, 404, { code: 'rest_post_invalid_id', message: 'Invalid post ID.' });
    return json(res, 200, post);
  }

  if (req.method === 'GET' && path === '/wp-json/wp/v2/posts') {
    const perPage = Number(url.searchParams.get('per_page') ?? 10);
    const page = Number(url.searchParams.get('page') ?? 1);
    const slice = posts.slice((page - 1) * perPage, page * perPage);
    return json(res, 200, slice, {
      'X-WP-Total': String(posts.length),
      'X-WP-TotalPages': String(Math.max(1, Math.ceil(posts.length / perPage))),
    });
  }

  if (req.method === 'POST' && path === '/wp-json/wp/v2/posts') {
    const body = await readBody(req);
    let input: any;
    try {
      input = JSON.parse(body || '{}');
    } catch {
      return json(res, 400, { code: 'invalid_json', message: 'Body was not valid JSON.' });
    }
    if (!input.title) return json(res, 400, { code: 'empty_content', message: 'A title is required.' });

    const slug = String(input.slug || String(input.title).toLowerCase().replace(/[^a-z0-9]+/g, '-'));
    const post: Post = {
      id: nextId++,
      title: { rendered: String(input.title) },
      slug,
      link: `http://localhost:${PORT}/${slug}/`,
      excerpt: { rendered: String(input.excerpt ?? '') },
      content: { rendered: String(input.content ?? '') },
      status: String(input.status ?? 'publish'),
      date_gmt: new Date().toISOString().replace(/\.\d+Z$/, ''),
      meta: { ...(input.meta ?? {}) },  // stored verbatim — this is what the E2E asserts
    };
    posts.push(post);
    console.log(`  [mock-wp] created post ${post.id} "${post.title.rendered}" (meta keys: ${Object.keys(post.meta).join(', ')})`);
    return json(res, 201, post);
  }

  return json(res, 404, { code: 'rest_no_route', message: `No route for ${req.method} ${path}` });
});

function readBody(req: any): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c: Buffer) => (data += c.toString('utf8')));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

server.listen(PORT, () => {
  console.log(`[mock-wp] listening on http://localhost:${PORT}`);
  console.log(`[mock-wp] user: ${USER}  app password: ${APP_PASSWORD}`);
  console.log(`[mock-wp] ${posts.length} existing posts seeded for internal linking`);
});

export const MOCK_WP = { port: PORT, user: USER, appPassword: APP_PASSWORD, url: `http://localhost:${PORT}` };
