/** Text analysis shared by clustering, internal linking and SEO scoring. */

const STOP = new Set(
  ('a about above after again against all am an and any are as at be because been before being below between both but by ' +
    'can cant cannot could couldnt did didnt do does doesnt doing dont down during each few for from further had hadnt has ' +
    'hasnt have havent having he her here hers herself him himself his how i if in into is isnt it its itself just me more ' +
    'most my myself no nor not now of off on once only or other our ours ourselves out over own same she should shouldnt so ' +
    'some such than that the their theirs them themselves then there these they this those through to too under until up ' +
    'very was wasnt we were werent what when where which while who whom why will with wont would wouldnt you your yours ' +
    'yourself yourselves best top guide review vs how what why')
    .split(/\s+/),
);

export function tokenize(input: string): string[] {
  return (input || '')
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 2 && !STOP.has(t))
    .map(stem);
}

/**
 * Deliberately crude suffix stripper — enough to match "luggage"/"luggages".
 *
 * The "es" case needs care: "boxes" loses both letters, but "luggages" loses
 * only the "s" because the "e" belongs to the stem. Getting this wrong means
 * "luggage" and "luggages" stem differently and never match each other, which
 * silently weakens every clustering and link-ranking decision.
 */
export function stem(word: string): string {
  if (word.length <= 4) return word;

  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith('ied') && word.length > 4) return `${word.slice(0, -3)}y`;

  if (word.endsWith('es') && word.length > 4) {
    const before = word.slice(0, -2);
    // Plural of a sibilant stem ("boxes", "watches", "dishes") drops both.
    return /(?:s|x|z|ch|sh)$/.test(before) ? before : word.slice(0, -1);
  }

  for (const suf of ['ingly', 'edly', 'ing', 'ed']) {
    if (word.endsWith(suf) && word.length - suf.length >= 3) return word.slice(0, -suf.length);
  }

  // Never strip the "s" of "ss" ("class" is not a plural of "clas").
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 4) return word.slice(0, -1);

  return word;
}

export function termFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}

/** Cosine similarity over term-frequency maps, optionally IDF-weighted. */
export function cosine(a: Map<string, number>, b: Map<string, number>, idf?: Map<string, number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const w = (t: string) => idf?.get(t) ?? 1;
  for (const [t, v] of a) {
    const vv = v * w(t);
    na += vv * vv;
    const bv = b.get(t);
    if (bv) dot += vv * bv * w(t);
  }
  for (const [t, v] of b) {
    const vv = v * w(t);
    nb += vv * vv;
  }
  if (!na || !nb) return 0;
  return dot / Math.sqrt(na * nb);
}

export function buildIdf(docs: string[][]): Map<string, number> {
  const df = new Map<string, number>();
  for (const doc of docs) {
    for (const t of new Set(doc)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const n = Math.max(docs.length, 1);
  const idf = new Map<string, number>();
  for (const [t, c] of df) idf.set(t, Math.log((n + 1) / (c + 0.5)));
  return idf;
}

/** Jaccard overlap on unique tokens. Used for keyword clustering. */
export function jaccard(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function wordCount(text: string): number {
  const clean = stripHtml(text);
  return clean ? clean.split(/\s+/).length : 0;
}

export function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const groups = w
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '')
    .replace(/^y/, '')
    .match(/[aeiouy]{1,2}/g);
  return Math.max(groups ? groups.length : 1, 1);
}

/** Flesch Reading Ease. Target >= 55 for the SEO score. */
export function fleschReadingEase(text: string): number {
  const clean = stripHtml(text);
  const sentences = clean.split(/[.!?]+/).filter((s) => s.trim().length > 1);
  const words = clean.split(/\s+/).filter(Boolean);
  if (!sentences.length || !words.length) return 0;
  const syllables = words.reduce((s, w) => s + countSyllables(w), 0);
  const score = 206.835 - 1.015 * (words.length / sentences.length) - 84.6 * (syllables / words.length);
  return Math.round(Math.max(0, Math.min(100, score)) * 10) / 10;
}

/** Deterministic hash. Keeps mock providers reproducible across runs. */
export function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Seeded PRNG so mock data is stable for a given seed string. */
export function seededRandom(seed: string): () => number {
  let s = fnv1a(seed) || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0xffffffff;
  };
}

export function titleCase(s: string): string {
  const small = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs', 'with']);
  return s
    .split(/\s+/)
    .map((w, i) => (i > 0 && small.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[,;:.\s]+$/, '');
}
