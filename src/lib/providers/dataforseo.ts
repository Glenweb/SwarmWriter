/**
 * DataForSEO provider: keyword ideas + SERP.
 * Mock twin is deterministic off the seed term, so demos and tests are stable.
 */
import { env, providerMode } from '../env';
import { fnv1a, seededRandom, titleCase, tokenize } from '../utils/text';

const BASE = 'https://api.dataforseo.com';

export type KeywordIdea = {
  keyword: string;
  volume: number;
  cpc: number;
  competition: number;
  difficulty: number;
  intent: KeywordIntent;
};

export type KeywordIntent = 'informational' | 'commercial' | 'transactional' | 'navigational';

export type SerpResult = {
  position: number;
  title: string;
  url: string;
  domain: string;
  description: string;
  headings: string[];
  wordCount: number;
};

export type SerpSnapshot = {
  keyword: string;
  fetchedAt: string;
  results: SerpResult[];
  peopleAlsoAsk: string[];
  avgWordCount: number;
};

function authHeader(): string {
  const raw = `${env.dataForSeo.login}:${env.dataForSeo.password}`;
  return `Basic ${Buffer.from(raw).toString('base64')}`;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify([body]),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`DataForSEO ${path} failed: ${res.status} ${text.slice(0, 300)}`);
  }
  const json: any = await res.json();
  const task = json?.tasks?.[0];
  if (!task) throw new Error('DataForSEO returned no task');
  if (task.status_code && task.status_code >= 40000) {
    throw new Error(`DataForSEO: ${task.status_message ?? 'task error'}`);
  }
  return task.result as T;
}

export async function keywordIdeas(seed: string, limit = 50): Promise<KeywordIdea[]> {
  if (providerMode.dataForSeo === 'mock') return mockKeywordIdeas(seed, limit);

  const result = await post<any[]>('/v3/dataforseo_labs/google/keyword_ideas/live', {
    keywords: [seed],
    location_code: env.dataForSeo.locationCode,
    language_code: env.dataForSeo.languageCode,
    include_serp_info: false,
    limit,
  });
  const items: any[] = result?.[0]?.items ?? [];
  const ideas = items.map((item) => {
    const info = item.keyword_info ?? {};
    const props = item.keyword_properties ?? {};
    return {
      keyword: String(item.keyword ?? '').toLowerCase(),
      volume: Number(info.search_volume ?? 0),
      cpc: Number(info.cpc ?? 0),
      competition: Number(info.competition ?? 0),
      difficulty: Number(props.keyword_difficulty ?? estimateDifficulty(Number(info.competition ?? 0), Number(info.search_volume ?? 0))),
      intent: classifyIntent(String(item.keyword ?? '')),
    } satisfies KeywordIdea;
  });
  const seen = new Set<string>();
  return ideas.filter((i) => i.keyword && !seen.has(i.keyword) && seen.add(i.keyword)).slice(0, limit);
}

export async function serpSnapshot(keyword: string): Promise<SerpSnapshot> {
  if (providerMode.dataForSeo === 'mock') return mockSerp(keyword);

  const result = await post<any[]>('/v3/serp/google/organic/live/advanced', {
    keyword,
    location_code: env.dataForSeo.locationCode,
    language_code: env.dataForSeo.languageCode,
    depth: 10,
    calculate_rectangles: false,
  });
  const items: any[] = result?.[0]?.items ?? [];
  const organic = items.filter((i) => i.type === 'organic').slice(0, 10);
  const paa = items
    .filter((i) => i.type === 'people_also_ask')
    .flatMap((i) => (i.items ?? []).map((q: any) => String(q.title ?? '')))
    .filter(Boolean)
    .slice(0, 8);

  const results: SerpResult[] = organic.map((item, idx) => ({
    position: Number(item.rank_absolute ?? idx + 1),
    title: String(item.title ?? ''),
    url: String(item.url ?? ''),
    domain: String(item.domain ?? ''),
    description: String(item.description ?? ''),
    headings: [],
    wordCount: 0,
  }));

  return {
    keyword,
    fetchedAt: new Date().toISOString(),
    results,
    peopleAlsoAsk: paa,
    avgWordCount: 0,
  };
}

export function classifyIntent(keyword: string): KeywordIntent {
  const k = keyword.toLowerCase();
  if (/\b(buy|price|cheap|deal|discount|coupon|for sale|order|shop)\b/.test(k)) return 'transactional';
  if (/\b(best|top|review|reviews|vs|versus|compare|comparison|alternative|alternatives)\b/.test(k)) return 'commercial';
  if (/\b(login|sign in|dashboard|official|website|app)\b/.test(k)) return 'navigational';
  return 'informational';
}

function estimateDifficulty(competition: number, volume: number): number {
  const volFactor = Math.min(1, Math.log10(Math.max(volume, 1)) / 5);
  return Math.round(Math.min(100, competition * 70 + volFactor * 30));
}

// ─────────────────────────────── Mock twin ───────────────────────────────────

const MODIFIERS = [
  '', 'best', 'top', 'cheap', 'how to choose', 'review', 'vs alternatives', 'for beginners',
  'guide', 'uk', '2026', 'under 100', 'checklist', 'mistakes', 'worth it', 'comparison',
  'buying guide', 'tips', 'problems', 'setup', 'maintenance', 'for travel', 'professional',
  'lightweight', 'durable', 'alternatives', 'brands', 'what to look for', 'pros and cons',
  'size guide',
];

function mockKeywordIdeas(seed: string, limit: number): KeywordIdea[] {
  const base = seed.toLowerCase().trim();
  const out: KeywordIdea[] = [];
  const seen = new Set<string>();
  for (let i = 0; out.length < limit && i < MODIFIERS.length * 3; i++) {
    const mod = MODIFIERS[i % MODIFIERS.length];
    const suffix = i >= MODIFIERS.length ? ` ${['2026', 'uk', 'reddit', 'amazon'][i % 4]}` : '';
    const kw = (mod ? (mod.startsWith('for ') || mod.startsWith('under ') || /^(uk|2026)$/.test(mod) ? `${base} ${mod}` : `${mod} ${base}`) : base) + suffix;
    const norm = kw.replace(/\s+/g, ' ').trim();
    if (seen.has(norm)) continue;
    seen.add(norm);
    const rnd = seededRandom(`dfs:${norm}`);
    const longTailPenalty = Math.max(0.12, 1 - (norm.split(/\s+/).length - 1) * 0.18);
    const volume = Math.round((300 + rnd() * 18_000) * longTailPenalty);
    const competition = Math.round(rnd() * 1000) / 1000;
    const intent = classifyIntent(norm);
    const cpc = Math.round((intent === 'transactional' ? 0.8 + rnd() * 4 : 0.1 + rnd() * 1.6) * 100) / 100;
    out.push({
      keyword: norm,
      volume,
      cpc,
      competition,
      difficulty: estimateDifficulty(competition, volume),
      intent,
    });
  }
  return out.sort((a, b) => b.volume - a.volume).slice(0, limit);
}

function mockSerp(keyword: string): SerpSnapshot {
  const rnd = seededRandom(`serp:${keyword}`);
  const domains = [
    'wirecutter.com', 'techradar.com', 'reddit.com', 'which.co.uk', 'tomsguide.com',
    'forbes.com', 'cnet.com', 'theguardian.com', 'bestreviews.com', 'consumerreports.org',
  ];
  const tokens = tokenize(keyword);
  const results: SerpResult[] = domains.map((domain, i) => {
    const wc = Math.round(1200 + rnd() * 2600);
    return {
      position: i + 1,
      title: `${titleCase(keyword)} — ${['Our Pick', 'Tested & Rated', 'Full Guide', 'What To Buy', 'Honest Review'][i % 5]}`,
      url: `https://${domain}/${keyword.replace(/\s+/g, '-')}`,
      domain,
      description: `Everything on ${keyword}, with hands-on testing and a clear recommendation.`,
      headings: [
        `What is ${keyword}?`,
        `How we tested`,
        `The best ${tokens[0] ?? 'option'} overall`,
        `Budget pick`,
        `What to look for`,
        `Verdict`,
      ],
      wordCount: wc,
    };
  });
  return {
    keyword,
    fetchedAt: new Date().toISOString(),
    results,
    peopleAlsoAsk: [
      `What should I look for in ${keyword}?`,
      `Is ${keyword} worth the money?`,
      `How long does ${keyword} last?`,
      `What is the best budget option for ${keyword}?`,
    ],
    avgWordCount: Math.round(results.reduce((s, r) => s + r.wordCount, 0) / results.length),
  };
}

/** Stable per-keyword hash used to keep mock ordering consistent in tests. */
export function keywordSeedHash(keyword: string): number {
  return fnv1a(keyword);
}
