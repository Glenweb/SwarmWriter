/**
 * On-page SEO score, 0–100 across 12 weighted signals.
 * Every deduction returns a specific fix — a number without an instruction is
 * not useful to the person in the editor.
 */
import { fleschReadingEase, stripHtml, wordCount } from '../utils/text';

export type SeoSignal = {
  id: string;
  label: string;
  weight: number;
  earned: number;
  pass: boolean;
  detail: string;
  fix?: string;
};

export type SeoReport = {
  score: number;
  grade: 'excellent' | 'good' | 'needs-work' | 'poor';
  signals: SeoSignal[];
  stats: {
    wordCount: number;
    readability: number;
    keywordDensity: number;
    h2Count: number;
    h3Count: number;
    internalLinks: number;
    externalLinks: number;
    imagesWithAlt: number;
    imagesTotal: number;
  };
};

export type ScoreInput = {
  html: string;
  title: string;
  metaTitle?: string | null;
  metaDescription?: string | null;
  focusKeyword?: string | null;
  wordTarget?: number;
  internalLinkCount?: number;
  externalLinkCount?: number;
  hasSchema?: boolean;
  siteUrl?: string;
};

export function scoreArticle(input: ScoreInput): SeoReport {
  const html = input.html ?? '';
  const text = stripHtml(html);
  const focus = (input.focusKeyword ?? '').trim().toLowerCase();
  const words = wordCount(html);
  const target = input.wordTarget ?? 1800;

  const h1s = matchAll(html, /<h1[^>]*>([\s\S]*?)<\/h1>/gi);
  const h2s = matchAll(html, /<h2[^>]*>([\s\S]*?)<\/h2>/gi);
  const h3s = matchAll(html, /<h3[^>]*>([\s\S]*?)<\/h3>/gi);
  const anchors = matchAll(html, /<a\s[^>]*href="([^"]+)"[^>]*>/gi);
  const images = matchAll(html, /<img\s[^>]*>/gi);
  const imagesWithAlt = images.filter((img) => /alt="[^"]{3,}"/i.test(img)).length;

  const internal =
    input.internalLinkCount ??
    anchors.filter((href) => isInternal(href, input.siteUrl)).length;
  const external =
    input.externalLinkCount ?? anchors.filter((href) => !isInternal(href, input.siteUrl)).length;

  const density = keywordDensity(text, focus);
  const readability = fleschReadingEase(html);
  const firstHundred = text.split(/\s+/).slice(0, 100).join(' ').toLowerCase();
  const metaTitle = input.metaTitle ?? '';
  const metaDesc = input.metaDescription ?? '';
  const h1Text = (h1s[0] ?? input.title ?? '').toLowerCase();

  const signals: SeoSignal[] = [];
  const add = (
    id: string,
    label: string,
    weight: number,
    pass: boolean,
    detail: string,
    fix?: string,
    partial?: number,
  ) => {
    const earned = pass ? weight : Math.round((partial ?? 0) * weight * 10) / 10;
    signals.push({ id, label, weight, earned, pass, detail, fix });
  };

  // 1. Focus keyword in H1/title — 10
  const inH1 = !!focus && (h1Text.includes(focus) || stripHtml(input.title).toLowerCase().includes(focus));
  add('keyword_h1', 'Focus keyword in H1', 10, inH1,
    inH1 ? `"${focus}" appears in the H1.` : focus ? `"${focus}" is missing from the H1.` : 'No focus keyword set.',
    inH1 ? undefined : `Work "${focus || 'your focus keyword'}" into the H1 naturally, ideally in the first half.`);

  // 2. Keyword in first 100 words — 10
  const inIntro = !!focus && firstHundred.includes(focus);
  add('keyword_intro', 'Keyword in opening', 10, inIntro,
    inIntro ? 'Keyword appears in the first 100 words.' : 'Keyword is absent from the opening.',
    inIntro ? undefined : 'Mention the focus keyword in the first paragraph so intent is confirmed immediately.');

  // 3. Density 0.5–2.5% — 10
  const densityOk = density >= 0.5 && density <= 2.5;
  add('keyword_density', 'Keyword density', 10, densityOk,
    `${density.toFixed(2)}% (target 0.5–2.5%).`,
    densityOk ? undefined : density < 0.5
      ? 'Add two or three natural mentions, including one H2.'
      : 'Reduce repetition — swap some mentions for synonyms or pronouns.',
    densityOk ? 1 : density > 0 && density < 0.5 ? 0.4 : 0.2);

  // 4. Meta title — 10
  const mtLen = metaTitle.length;
  const mtKeyword = !!focus && metaTitle.toLowerCase().includes(focus);
  const mtOk = mtLen >= 50 && mtLen <= 60 && mtKeyword;
  add('meta_title', 'Meta title', 10, mtOk,
    `${mtLen} chars${mtKeyword ? ', keyword present' : ', keyword missing'} (target 50–60 with keyword).`,
    mtOk ? undefined : mtLen === 0
      ? 'Write a meta title of 50–60 characters including the focus keyword.'
      : mtLen > 60 ? `Trim ${mtLen - 60} characters so it does not truncate in the SERP.`
      : mtLen < 50 ? `Add ${50 - mtLen} characters — you are leaving SERP real estate unused.`
      : 'Include the focus keyword in the meta title.',
    mtLen >= 40 && mtLen <= 65 ? 0.6 : 0.2);

  // 5. Meta description — 10
  const mdLen = metaDesc.length;
  const mdKeyword = !!focus && metaDesc.toLowerCase().includes(focus);
  const mdOk = mdLen >= 140 && mdLen <= 160 && mdKeyword;
  add('meta_description', 'Meta description', 10, mdOk,
    `${mdLen} chars${mdKeyword ? ', keyword present' : ', keyword missing'} (target 140–160 with keyword).`,
    mdOk ? undefined : mdLen === 0
      ? 'Write a 140–160 character description with the keyword and a reason to click.'
      : mdLen > 160 ? `Trim ${mdLen - 160} characters.`
      : mdLen < 140 ? `Add ${140 - mdLen} characters.`
      : 'Include the focus keyword in the description.',
    mdLen >= 120 && mdLen <= 175 ? 0.6 : 0.2);

  // 6. Word count vs target ±15% — 10
  const lo = target * 0.85;
  const hi = target * 1.15;
  const wcOk = words >= lo && words <= hi;
  add('word_count', 'Length vs target', 10, wcOk,
    `${words} words against a ${target} target.`,
    wcOk ? undefined : words < lo
      ? `Add roughly ${Math.ceil(lo - words)} words — thin content underperforms against the top 10.`
      : `Consider trimming ${Math.ceil(words - hi)} words, or split into two pages.`,
    words >= target * 0.7 ? 0.6 : 0.25);

  // 7. Heading structure — 8
  const structureOk = h2s.length >= 4 && h1s.length <= 1;
  add('structure', 'Heading structure', 8, structureOk,
    `${h1s.length} H1, ${h2s.length} H2, ${h3s.length} H3.`,
    structureOk ? undefined : h1s.length > 1
      ? 'More than one H1. Demote the extras to H2.'
      : `Add ${Math.max(0, 4 - h2s.length)} more H2 sections so the page is scannable.`,
    h2s.length >= 2 ? 0.5 : 0.2);

  // 8. Internal links ≥ 3 — 8
  const internalOk = internal >= 3;
  add('internal_links', 'Internal links', 8, internalOk,
    `${internal} internal link${internal === 1 ? '' : 's'}.`,
    internalOk ? undefined : 'Run Re-link — Swarm Writer will pull candidates from the posts already on the site.',
    internal >= 1 ? internal / 3 : 0);

  // 9. External authority link ≥ 1 — 6
  const externalOk = external >= 1;
  add('external_links', 'External citations', 6, externalOk,
    `${external} outbound link${external === 1 ? '' : 's'}.`,
    externalOk ? undefined : 'Cite at least one authoritative source — it supports the claims and reads as researched.');

  // 10. Image alt text — 6
  const altOk = images.length > 0 && imagesWithAlt === images.length;
  add('image_alt', 'Image alt text', 6, altOk,
    images.length === 0 ? 'No images in the article.' : `${imagesWithAlt} of ${images.length} images have alt text.`,
    altOk ? undefined : images.length === 0
      ? 'Add at least one image with descriptive alt text.'
      : 'Fill in the missing alt text — it is both an accessibility and an image-search miss.',
    images.length ? imagesWithAlt / images.length : 0);

  // 11. Schema — 6
  const schemaOk = !!input.hasSchema || /application\/ld\+json/i.test(html);
  add('schema', 'Structured data', 6, schemaOk,
    schemaOk ? 'JSON-LD present.' : 'No structured data.',
    schemaOk ? undefined : 'Generate Article + FAQPage schema so the page is eligible for rich results.');

  // 12. Readability ≥ 55 — 6
  const readOk = readability >= 55;
  add('readability', 'Readability', 6, readOk,
    `Flesch ${readability} (target 55+).`,
    readOk ? undefined : 'Shorten the longest sentences and break up any paragraph over four lines.',
    readability >= 40 ? 0.5 : 0.2);

  const earned = signals.reduce((s, sig) => s + sig.earned, 0);
  const score = Math.max(0, Math.min(100, Math.round(earned)));

  return {
    score,
    grade: score >= 85 ? 'excellent' : score >= 70 ? 'good' : score >= 50 ? 'needs-work' : 'poor',
    signals,
    stats: {
      wordCount: words,
      readability,
      keywordDensity: Math.round(density * 100) / 100,
      h2Count: h2s.length,
      h3Count: h3s.length,
      internalLinks: internal,
      externalLinks: external,
      imagesWithAlt,
      imagesTotal: images.length,
    },
  };
}

/**
 * Phrase-aware density: counts occurrences of the whole phrase, not its words
 * individually, over the article's full word count.
 *
 * The denominator is every word, which is how RankMath and every other on-page
 * tool defines it. Dividing by stopword-stripped tokens inflates the figure by
 * roughly 1.8x and would have the product chasing a target it had invented.
 */
export function keywordDensity(text: string, focus: string): number {
  if (!focus) return 0;
  const words = text.split(/\s+/).filter(Boolean).length;
  if (!words) return 0;
  const phrase = focus.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = text.toLowerCase().match(new RegExp(`\\b${phrase}\\b`, 'g'));
  const phraseWords = focus.split(/\s+/).length;
  return ((matches?.length ?? 0) * phraseWords * 100) / words;
}

function matchAll(input: string, re: RegExp): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  while ((m = rx.exec(input)) !== null) {
    out.push(m[1] ?? m[0]);
    if (m.index === rx.lastIndex) rx.lastIndex++;
  }
  return out;
}

function isInternal(href: string, siteUrl?: string): boolean {
  if (/^[#/]/.test(href)) return true;
  if (!siteUrl) return false;
  try {
    return new URL(href).hostname.replace(/^www\./, '') === new URL(siteUrl).hostname.replace(/^www\./, '');
  } catch {
    return false;
  }
}
