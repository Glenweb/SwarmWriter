/**
 * Internal linking.
 *
 * The candidate set is computed here, in code, from the live site's existing
 * posts. The model is only ever asked to choose an anchor phrase from a short
 * list of real URLs — so a hallucinated link is structurally impossible, and
 * every link points at a page that already exists.
 */
import { buildIdf, cosine, stripHtml, termFrequency, tokenize } from '../utils/text';
import type { SitePost } from './sites';

export type LinkCandidate = {
  url: string;
  title: string;
  slug: string;
  score: number;
  reason: string;
};

export type PlacedLink = {
  url: string;
  anchor: string;
  title: string;
  sectionIndex: number;
  score: number;
};

export type LinkRules = {
  /** One link per N words, so a short post does not get stuffed. */
  wordsPerLink: number;
  maxLinks: number;
  maxPerSection: number;
  minScore: number;
};

export const DEFAULT_LINK_RULES: LinkRules = {
  wordsPerLink: 150,
  maxLinks: 8,
  maxPerSection: 2,
  minScore: 0.06,
};

export function linkBudget(wordCount: number, rules: LinkRules = DEFAULT_LINK_RULES): number {
  return Math.max(2, Math.min(rules.maxLinks, Math.floor(wordCount / rules.wordsPerLink)));
}

/**
 * Rank existing posts against one section.
 * TF-IDF cosine over tokens, then three adjustments that matter in practice:
 *   + exact focus-keyword appearance in the candidate title
 *   + cluster sibling (shares the pillar term)
 *   - already linked from this article
 */
export function rankCandidates(args: {
  sectionText: string;
  sectionHeading: string;
  posts: SitePost[];
  focusKeyword: string;
  excludeUrls?: string[];
  excludeSlug?: string;
  limit?: number;
}): LinkCandidate[] {
  const { sectionText, sectionHeading, posts, focusKeyword } = args;
  const exclude = new Set((args.excludeUrls ?? []).map(normaliseUrl));
  const pool = posts.filter((p) => p.slug !== args.excludeSlug && !exclude.has(normaliseUrl(p.url)));
  if (!pool.length) return [];

  const docs = pool.map((p) => (p.tokens.length ? p.tokens : tokenize(`${p.title} ${p.excerpt}`)));
  const idf = buildIdf(docs);

  const queryTokens = tokenize(`${sectionHeading} ${sectionHeading} ${stripHtml(sectionText)}`);
  const queryTf = termFrequency(queryTokens);
  const focusTokens = new Set(tokenize(focusKeyword));

  const scored = pool.map((post, i) => {
    const postTf = termFrequency(docs[i]);
    let score = cosine(queryTf, postTf, idf);
    const reasons: string[] = [];
    if (score > 0) reasons.push('topical overlap');

    const titleLower = post.title.toLowerCase();
    if (focusKeyword && titleLower.includes(focusKeyword.toLowerCase())) {
      score += 0.18;
      reasons.push('exact focus keyword in title');
    } else {
      const titleTokens = new Set(tokenize(post.title));
      const shared = [...focusTokens].filter((t) => titleTokens.has(t)).length;
      if (shared && focusTokens.size) {
        score += 0.09 * (shared / focusTokens.size);
        reasons.push('cluster sibling');
      }
    }

    // A heading-word match is a strong signal the section is genuinely about it.
    const headingTokens = new Set(tokenize(sectionHeading));
    const postTokenSet = new Set(docs[i]);
    const headingHits = [...headingTokens].filter((t) => postTokenSet.has(t)).length;
    if (headingHits >= 2) {
      score += 0.07;
      reasons.push('heading match');
    }

    return {
      url: post.url,
      title: post.title,
      slug: post.slug,
      score: Math.round(score * 1000) / 1000,
      reason: reasons.join(', ') || 'weak match',
    };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, args.limit ?? 5);
}

/**
 * Insert anchors into section HTML. Matches the anchor phrase case-insensitively
 * outside existing tags, links the first clean occurrence only, and falls back
 * to a sentence-end "related" link when the phrase is not present verbatim.
 */
export function injectLinks(
  sectionHtml: string,
  links: Array<{ url: string; anchor: string; title: string }>,
): { html: string; placed: Array<{ url: string; anchor: string; title: string }> } {
  let html = sectionHtml;
  const placed: Array<{ url: string; anchor: string; title: string }> = [];

  for (const link of links) {
    const anchor = link.anchor.trim();
    if (!anchor || anchor.length < 3) continue;
    if (html.includes(`href="${link.url}"`)) continue;

    const replaced = replaceFirstOutsideTags(html, anchor, (match) =>
      `<a href="${escapeAttr(link.url)}" title="${escapeAttr(link.title)}">${match}</a>`,
    );
    if (replaced) {
      html = replaced;
      placed.push({ ...link, anchor });
      continue;
    }

    // Phrase absent: append a clearly-labelled related link rather than forcing
    // an awkward anchor into prose that does not contain the phrase.
    const paraEnd = html.lastIndexOf('</p>');
    if (paraEnd !== -1) {
      const sentence = ` <a href="${escapeAttr(link.url)}" title="${escapeAttr(link.title)}">${escapeHtml(anchor)}</a> covers this in more detail.`;
      html = `${html.slice(0, paraEnd)}${sentence}${html.slice(paraEnd)}`;
      placed.push({ ...link, anchor });
    }
  }

  return { html, placed };
}

/** Replace the first occurrence of `phrase` in text nodes only, never inside a tag or an existing anchor. */
function replaceFirstOutsideTags(html: string, phrase: string, wrap: (match: string) => string): string | null {
  const needle = phrase.toLowerCase();
  let inTag = false;
  let anchorDepth = 0;
  for (let i = 0; i < html.length; i++) {
    const ch = html[i];
    if (ch === '<') {
      inTag = true;
      if (/^<a[\s>]/i.test(html.slice(i, i + 4))) anchorDepth++;
      else if (/^<\/a>/i.test(html.slice(i, i + 4))) anchorDepth = Math.max(0, anchorDepth - 1);
      continue;
    }
    if (ch === '>') {
      inTag = false;
      continue;
    }
    if (inTag || anchorDepth > 0) continue;
    if (html.slice(i, i + needle.length).toLowerCase() !== needle) continue;
    // Require word boundaries so "cart" does not match inside "carton".
    const before = html[i - 1] ?? ' ';
    const after = html[i + needle.length] ?? ' ';
    if (/[a-z0-9]/i.test(before) || /[a-z0-9]/i.test(after)) continue;
    const actual = html.slice(i, i + needle.length);
    return html.slice(0, i) + wrap(actual) + html.slice(i + needle.length);
  }
  return null;
}

/** Report on which existing posts receive no internal links — the orphan problem. */
export function orphanReport(posts: SitePost[], placedUrls: string[]): SitePost[] {
  const linked = new Set(placedUrls.map(normaliseUrl));
  return posts.filter((p) => !linked.has(normaliseUrl(p.url)));
}

function normaliseUrl(url: string): string {
  return url.replace(/\/+$/, '').toLowerCase();
}

export function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
