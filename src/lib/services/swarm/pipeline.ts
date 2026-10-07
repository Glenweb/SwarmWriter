/**
 * The generation swarm: 7 stages, each routed to a model tier by budget.
 *
 *   1 research  (Haiku)   digest SERP + competitor headings into a brief
 *   2 outline   (Sonnet)  H2/H3 tree, word budgets, FAQ
 *   3 draft     (Haiku)   one call per section, in parallel
 *   4 facts     (Haiku)   flag unsupportable claims
 *   5 seo       (Haiku)   meta title/description, slug, alt text
 *   6 links     (Haiku)   pick anchors from code-computed candidates
 *   7 polish    (Sonnet)  opening, closing, transitions
 *   + escalate  (Opus)    only when the score still falls short
 *
 * Cost is measured from real token counts and kept near the target by the
 * TierRouter, which downgrades the polish stage rather than overspending.
 */
import { TierRouter, complete, estimateTokens, type Tier } from '../../providers/anthropic';
import { env } from '../../env';
import { slugify } from '../../utils/slug';
import { stripHtml, truncate, wordCount } from '../../utils/text';
import { round } from '../../utils/money';
import {
  DEFAULT_LINK_RULES,
  injectLinks,
  linkBudget,
  rankCandidates,
  type LinkCandidate,
  type PlacedLink,
} from '../internal-links';
import { scoreArticle, type SeoReport } from '../seo-score';
import { buildSchema, schemaScriptTag } from '../schema-gen';
import type { ContentPlan, OutlineSection } from '../plans';
import type { SitePost } from '../sites';
import type { SerpSnapshot } from '../../providers/dataforseo';
import {
  briefSchema, factsSchema, linkPicksSchema, outlineSchema, polishSchema, seoMetaSchema,
  type Brief, type FactsReview, type Outline, type Polish, type SeoMeta, type StageLog, type SwarmProgress,
} from './types';
import * as P from './prompts';

export type SwarmInput = {
  plan: ContentPlan;
  site: { id: string; name: string; url: string; niche: string | null; audience: string | null; tone: string };
  serp: SerpSnapshot | null;
  existingPosts: SitePost[];
  authorName: string;
  /** Force the Opus path (the "Regenerate with Opus" button). */
  forceOpus?: boolean;
  escalateBelow?: number;
  onProgress?: SwarmProgress;
};

export type SwarmOutput = {
  title: string;
  slug: string;
  html: string;
  markdown: string;
  excerpt: string;
  metaTitle: string;
  metaDescription: string;
  focusKeyword: string;
  canonicalUrl: string;
  secondaryKeywords: string[];
  schema: Record<string, unknown>;
  faq: Array<{ question: string; answer: string }>;
  images: Array<{ position: number; alt: string; caption: string }>;
  internalLinks: PlacedLink[];
  externalLinks: Array<{ url: string; anchor: string }>;
  seoScore: number;
  seoReport: SeoReport;
  wordCount: number;
  readingMinutes: number;
  costUsd: number;
  tierSummary: ReturnType<TierRouter['summary']>;
  stageLogs: StageLog[];
  brief: Brief;
  factsReview: FactsReview;
  escalated: boolean;
};

const MAX_PARALLEL_SECTIONS = 4;

export async function runSwarm(input: SwarmInput): Promise<SwarmOutput> {
  const { plan, site } = input;
  const router = new TierRouter();
  const logs: StageLog[] = [];
  const progress = input.onProgress ?? (() => {});

  const run = async (args: {
    stage: string;
    tier: Tier;
    system: string;
    prompt: string;
    maxTokens: number;
    json?: boolean;
    note?: string;
  }) => {
    const res = await complete({
      stage: args.stage,
      tier: args.tier,
      system: args.system,
      prompt: args.prompt,
      maxTokens: args.maxTokens,
      json: args.json,
    });
    router.record(res.tier, res.costUsd);
    logs.push({
      stage: args.stage,
      tier: res.tier,
      model: res.model,
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
      costUsd: res.costUsd,
      ms: res.ms,
      ok: true,
      note: args.note,
    });
    return res;
  };

  // ── Stage 1: research ──────────────────────────────────────────────────────
  progress({ stage: 'research', message: 'Reading the SERP and competitor structure', pct: 8 });
  const researchRes = await run({
    stage: 'research',
    tier: 'haiku',
    system: P.VOICE,
    maxTokens: 900,
    json: true,
    prompt: P.researchPrompt({
      focusKeyword: plan.targetKeyword,
      secondary: plan.secondaryKeywords,
      intent: plan.searchIntent,
      serp: input.serp,
      niche: site.niche,
      audience: site.audience,
    }),
  });
  const brief = briefSchema.parse(researchRes.json ?? {});

  // ── Stage 2: outline (Sonnet — structure decides the article) ──────────────
  progress({ stage: 'outline', message: 'Designing the structure', pct: 20 });
  const outlineRes = await run({
    stage: 'outline',
    tier: router.tierFor('outline'),
    system: P.VOICE,
    maxTokens: 2000,
    json: true,
    prompt: P.outlinePrompt({
      focusKeyword: plan.targetKeyword,
      title: plan.title,
      secondary: plan.secondaryKeywords,
      intent: plan.searchIntent,
      contentType: plan.contentType,
      wordTarget: plan.wordTarget,
      brief,
      tone: site.tone,
    }),
  });
  const outline = normaliseOutline(outlineSchema.parse(outlineRes.json ?? {}), plan);

  // ── Stage 3: draft, one call per section, bounded parallelism ──────────────
  progress({ stage: 'draft', message: `Drafting ${outline.sections.length} sections`, pct: 30 });
  const sectionBodies = await mapWithLimit(outline.sections, MAX_PARALLEL_SECTIONS, async (section, i) => {
    // Spread the focus keyword rather than letting every section repeat it.
    const shouldUseKeyword = i === 0 || i === Math.floor(outline.sections.length / 2);
    const res = await run({
      stage: 'draft',
      tier: 'haiku',
      system: P.VOICE,
      maxTokens: Math.max(700, Math.ceil(section.wordTarget * 2.2)),
      note: section.heading,
      prompt: P.sectionPrompt({
        section,
        index: i,
        total: outline.sections.length,
        focusKeyword: plan.targetKeyword,
        secondary: plan.secondaryKeywords,
        title: outline.h1,
        previousHeading: i > 0 ? outline.sections[i - 1].heading : null,
        nextHeading: i < outline.sections.length - 1 ? outline.sections[i + 1].heading : null,
        brief,
        tone: site.tone,
        shouldUseKeyword,
      }),
    });
    return res.text;
  });

  let sections: Array<{ section: OutlineSection; body: string }> = outline.sections.map((section, i) => ({
    section: section as OutlineSection,
    body: sectionBodies[i] ?? '',
  }));

  // ── Stage 4: facts ─────────────────────────────────────────────────────────
  progress({ stage: 'facts', message: 'Checking claims against the brief', pct: 52 });
  const factsRes = await run({
    stage: 'facts',
    tier: 'haiku',
    system: P.VOICE,
    maxTokens: 800,
    json: true,
    prompt: P.factsPrompt({
      html: sections.map((s) => `## ${s.section.heading}\n${s.body}`).join('\n\n'),
      focusKeyword: plan.targetKeyword,
      brief,
    }),
  });
  const factsReview = factsSchema.parse(factsRes.json ?? {});

  // ── Stage 5: SEO metadata ──────────────────────────────────────────────────
  progress({ stage: 'seo', message: 'Writing metadata and alt text', pct: 62 });
  const seoRes = await run({
    stage: 'seo',
    tier: 'haiku',
    system: P.VOICE,
    maxTokens: 800,
    json: true,
    prompt: P.seoPrompt({
      title: outline.h1,
      focusKeyword: plan.targetKeyword,
      secondary: plan.secondaryKeywords,
      headings: outline.sections.map((s) => s.heading),
      firstParagraph: sections[0]?.body ?? '',
      siteName: site.name,
    }),
  });
  let seo = enforceMetaConstraints(seoMetaSchema.parse(seoRes.json ?? {}), plan, outline.h1);

  // ── Stage 7a: polish (run before linking so anchors land in final prose) ───
  progress({ stage: 'polish', message: 'Tightening the opening and close', pct: 72 });
  const polishMaxTokens = 1200;
  const polishText = P.polishPrompt({
    title: outline.h1,
    focusKeyword: plan.targetKeyword,
    headings: outline.sections.map((s) => s.heading),
    currentIntro: firstParagraph(sections[0]?.body ?? ''),
    currentConclusion: lastParagraph(sections[sections.length - 1]?.body ?? ''),
    tone: site.tone,
  });
  // Price the stage before committing: Sonnet here, or Haiku if that would
  // push the run past the cost target.
  const polishTier = router.tierFor('polish', {
    inputTokens: estimateTokens(P.VOICE + polishText),
    outputTokens: Math.round(polishMaxTokens * 0.7),
  });
  const polishRes = await run({
    stage: 'polish',
    tier: polishTier,
    system: P.VOICE,
    maxTokens: polishMaxTokens,
    json: true,
    prompt: polishText,
  });
  const polish = polishSchema.parse(polishRes.json ?? {});
  sections = applyPolish(sections, polish);

  // ── Stage 6: internal links ────────────────────────────────────────────────
  progress({ stage: 'links', message: `Matching against ${input.existingPosts.length} existing posts`, pct: 82 });
  const draftWordCount = sections.reduce((s, x) => s + wordCount(x.body), 0);
  const budget = linkBudget(draftWordCount, DEFAULT_LINK_RULES);

  let placedLinks: PlacedLink[] = [];
  if (input.existingPosts.length && budget > 0) {
    const candidatesBySection = sections.map((s, i) => ({
      sectionIndex: i,
      heading: s.section.heading,
      candidates: rankCandidates({
        sectionText: s.body,
        sectionHeading: s.section.heading,
        posts: input.existingPosts,
        focusKeyword: plan.targetKeyword,
        excludeSlug: seo.slug,
        limit: 5,
      }).filter((c) => c.score >= DEFAULT_LINK_RULES.minScore),
    }));

    const anyCandidates = candidatesBySection.some((s) => s.candidates.length);
    if (anyCandidates) {
      const linksRes = await run({
        stage: 'links',
        tier: 'haiku',
        system: P.VOICE,
        maxTokens: 900,
        json: true,
        prompt: P.linksPrompt({
          focusKeyword: plan.targetKeyword,
          headings: sections.map((s) => s.section.heading),
          candidatesBySection,
          budget,
        }),
      });
      const picks = linkPicksSchema.parse(linksRes.json ?? {});
      placedLinks = applyLinks(sections, picks.links, candidatesBySection, budget);

      // Top up from the code-ranked candidates when the model under-uses the
      // budget — it may return duplicate targets, bad URLs or simply too few.
      // Internal linking is worth 8 points of on-page score and is this
      // product's main differentiator, so the budget is filled deterministically
      // rather than left to the model's discretion.
      if (placedLinks.length < budget) {
        const alreadyUsed = new Set(placedLinks.map((l) => l.url));
        const perSection = new Map<number, number>();
        for (const l of placedLinks) perSection.set(l.sectionIndex, (perSection.get(l.sectionIndex) ?? 0) + 1);

        const topUp = applyLinks(
          sections,
          fallbackPicks(candidatesBySection, plan.targetKeyword, budget - placedLinks.length, alreadyUsed, perSection),
          candidatesBySection,
          budget - placedLinks.length,
          perSection,
          alreadyUsed,
        );
        placedLinks = [...placedLinks, ...topUp];
      }
    }
  }

  // ── Keyword density guard ──────────────────────────────────────────────────
  // Section drafting is parallel, so no single call can see the whole article's
  // keyword count. Over-optimisation is corrected here rather than being left
  // as a deduction for the user to fix by hand.
  sections = balanceKeywordDensity(sections, plan.targetKeyword);

  // ── Assemble ───────────────────────────────────────────────────────────────
  progress({ stage: 'assemble', message: 'Assembling HTML, schema and images', pct: 90 });
  const images = buildImages(outline.sections, seo.imageAlts, plan.targetKeyword);
  const slug = seo.slug || slugify(plan.targetKeyword);
  const canonicalUrl = `${site.url.replace(/\/+$/, '')}/${slug}/`;

  const faq = outline.faq.length ? outline.faq : [];
  const schema = buildSchema({
    title: outline.h1,
    description: seo.metaDescription,
    url: canonicalUrl,
    siteUrl: site.url,
    siteName: site.name,
    authorName: input.authorName,
    datePublished: new Date().toISOString(),
    faq,
    wordCount: draftWordCount,
    keywords: [plan.targetKeyword, ...plan.secondaryKeywords].slice(0, 10),
  });

  const externalLinks = pickExternalCitations(input.serp, plan.targetKeyword);
  const html = assembleHtml({ outline, sections, faq, images, externalLinks, schema });
  const markdown = assembleMarkdown({ outline, sections, faq });

  let seoReport = scoreArticle({
    html,
    title: outline.h1,
    metaTitle: seo.metaTitle,
    metaDescription: seo.metaDescription,
    focusKeyword: plan.targetKeyword,
    wordTarget: plan.wordTarget,
    internalLinkCount: placedLinks.length,
    externalLinkCount: externalLinks.length,
    hasSchema: true,
    siteUrl: site.url,
  });

  // ── Escalation: Opus, only when the score still falls short ────────────────
  const threshold = input.escalateBelow ?? 70;
  let escalated = false;
  let finalHtml = html;
  let finalMarkdown = markdown;
  let finalTitle = outline.h1;

  if (input.forceOpus || seoReport.score < threshold) {
    progress({ stage: 'escalate', message: 'Score below target — escalating to Opus', pct: 94 });
    const escRes = await run({
      stage: 'escalate',
      tier: 'opus',
      system: P.VOICE,
      maxTokens: 1600,
      json: true,
      note: `score ${seoReport.score} < ${threshold}`,
      prompt: P.polishPrompt({
        title: outline.h1,
        focusKeyword: plan.targetKeyword,
        headings: sections.map((s) => s.section.heading),
        currentIntro: sections[0]?.body ?? '',
        currentConclusion: sections[sections.length - 1]?.body ?? '',
        tone: site.tone,
      }),
    });
    const escPolish = polishSchema.parse(escRes.json ?? {});
    const escalatedSections = applyPolish(sections, escPolish);
    escalated = true;
    if (escPolish.titleSuggestion) finalTitle = escPolish.titleSuggestion;
    finalHtml = assembleHtml({
      outline: { ...outline, h1: finalTitle },
      sections: escalatedSections,
      faq,
      images,
      externalLinks,
      schema,
    });
    finalMarkdown = assembleMarkdown({ outline: { ...outline, h1: finalTitle }, sections: escalatedSections, faq });
    seoReport = scoreArticle({
      html: finalHtml,
      title: finalTitle,
      metaTitle: seo.metaTitle,
      metaDescription: seo.metaDescription,
      focusKeyword: plan.targetKeyword,
      wordTarget: plan.wordTarget,
      internalLinkCount: placedLinks.length,
      externalLinkCount: externalLinks.length,
      hasSchema: true,
      siteUrl: site.url,
    });
  }

  const words = wordCount(finalHtml);
  progress({ stage: 'done', message: `Done — SEO ${seoReport.score}/100`, pct: 100 });

  return {
    title: finalTitle,
    slug,
    html: finalHtml,
    markdown: finalMarkdown,
    excerpt: seo.excerpt || truncate(stripHtml(sections[0]?.body ?? ''), 180),
    metaTitle: seo.metaTitle,
    metaDescription: seo.metaDescription,
    focusKeyword: plan.targetKeyword,
    canonicalUrl,
    secondaryKeywords: plan.secondaryKeywords,
    schema,
    faq,
    images,
    internalLinks: placedLinks,
    externalLinks,
    seoScore: seoReport.score,
    seoReport,
    wordCount: words,
    readingMinutes: Math.max(1, Math.round(words / 230)),
    costUsd: round(router.totalUsd, 5),
    tierSummary: router.summary(),
    stageLogs: logs,
    brief,
    factsReview,
    escalated,
  };
}


/**
 * Keep exact-phrase density inside the 0.5–2.5% band the score checks.
 *
 * Too high: thin out later exact matches, preferring a shortened variant that
 * still reads naturally ("carry on luggage" -> "carry on"), then a pronoun-ish
 * fallback. The first mention in each section is always kept, because that is
 * the one doing the ranking work.
 * Too low: nothing is forced — stuffing a keyword in to clear a threshold is
 * the behaviour this product is meant to beat, so the shortfall is reported
 * as a fix in the SEO panel instead.
 */
export function balanceKeywordDensity(
  sections: Array<{ section: OutlineSection; body: string }>,
  focusKeyword: string,
  maxDensityPct = 2.3,
): Array<{ section: OutlineSection; body: string }> {
  const phrase = focusKeyword.trim();
  if (phrase.split(/\s+/).length < 2) return sections; // single words are too risky to rewrite

  const out = sections.map((s) => ({ ...s }));
  const totalWords = out.reduce((n, s) => n + wordCount(s.body), 0);
  if (!totalWords) return out;

  const phraseWords = phrase.split(/\s+/).length;
  const re = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');

  const occurrences = out.reduce((n, s) => n + (s.body.match(re)?.length ?? 0), 0);
  const allowed = Math.max(1, Math.floor((maxDensityPct / 100) * totalWords / phraseWords));
  let excess = occurrences - allowed;
  if (excess <= 0) return out;

  const shortVariant = shortenPhrase(phrase);

  for (const s of out) {
    if (excess <= 0) break;
    let seenInSection = 0;
    s.body = s.body.replace(re, (match) => {
      seenInSection++;
      if (seenInSection === 1 || excess <= 0) return match;  // keep each section's first mention
      excess--;
      // Preserve the original capitalisation of the match.
      return /^[A-Z]/.test(match) ? capitalise(shortVariant) : shortVariant;
    });
  }
  return out;
}

/** Drop the least meaningful leading or trailing word, keeping the head noun. */
function shortenPhrase(phrase: string): string {
  const words = phrase.split(/\s+/);
  if (words.length <= 2) return words[words.length - 1];
  const filler = new Set(['best', 'top', 'cheap', 'the', 'a', 'for', 'and', 'with', 'alternatives', 'alternative']);
  if (filler.has(words[0].toLowerCase())) return words.slice(1).join(' ');
  if (filler.has(words[words.length - 1].toLowerCase())) return words.slice(0, -1).join(' ');
  return words.slice(-2).join(' ');
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}


/**
 * Deterministic link picks: the best candidate per section, with an anchor
 * taken from the destination's own title. Used when the model's picks are
 * unusable, and by the free "Re-link" action.
 */
function fallbackPicks(
  candidatesBySection: Array<{ sectionIndex: number; heading: string; candidates: LinkCandidate[] }>,
  focusKeyword: string,
  budget: number,
  alreadyUsed: Set<string> = new Set(),
  perSectionSoFar: Map<number, number> = new Map(),
): Array<{ url: string; anchor: string; sectionIndex: number }> {
  const picks: Array<{ url: string; anchor: string; sectionIndex: number }> = [];
  const used = new Set(alreadyUsed);
  const perSection = new Map(perSectionSoFar);

  // Round-robin over sections so links spread across the article rather than
  // clustering in whichever section happened to rank highest.
  for (let round = 0; round < DEFAULT_LINK_RULES.maxPerSection; round++) {
    for (const section of candidatesBySection) {
      if (picks.length >= budget) return picks;
      if ((perSection.get(section.sectionIndex) ?? 0) >= DEFAULT_LINK_RULES.maxPerSection) continue;
      const candidate = section.candidates.find((c) => !used.has(c.url));
      if (!candidate) continue;
      used.add(candidate.url);
      perSection.set(section.sectionIndex, (perSection.get(section.sectionIndex) ?? 0) + 1);
      picks.push({
        url: candidate.url,
        anchor: anchorFromTitle(candidate.title, focusKeyword),
        sectionIndex: section.sectionIndex,
      });
    }
  }
  return picks;
}

/** 2–5 words from the destination title, never this page's own focus keyword. */
function anchorFromTitle(title: string, avoidKeyword: string): string {
  const cleaned = title.replace(/[:|–—].*$/, '').trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  const phrase = words.slice(0, Math.min(5, Math.max(2, words.length))).join(' ');
  if (avoidKeyword && phrase.toLowerCase() === avoidKeyword.toLowerCase() && words.length > 2) {
    return words.slice(0, 3).join(' ');
  }
  return phrase;
}


/**
 * Bring a short meta description into the 140–160 band using whole clauses.
 *
 * Padding and then truncating to 160 leaves a dangling fragment ("...We cover
 * the criteria that"), which reads as broken in the SERP. Instead, append
 * complete clauses one at a time and keep the best result that still ends in a
 * full sentence. If nothing reaches the band, the shorter complete text is
 * returned and the SEO panel reports the shortfall honestly rather than
 * shipping a fragment.
 */
export function padDescription(base: string): string {
  const CLAUSES = [
    'We cover the criteria that decide it, the real costs, and the mistakes that waste money.',
    'Read the trade-offs, the price you should expect to pay, and who each option genuinely suits.',
    'Written for people choosing now, not browsing.',
    'No filler, no affiliate hype.',
    'Updated for this year.',
  ];

  const sentence = (text: string): string => {
    const stem = text.replace(/\s+$/, '').replace(/[,;:]+$/, '');
    return /[.!?]$/.test(stem) ? stem : `${stem}.`;
  };

  let current = sentence(base);
  if (current.length >= 140) return current.length <= 160 ? current : `${truncate(current, 159)}.`;

  // Append clauses longest-first, keeping any that fits, until we reach the band.
  for (const clause of CLAUSES) {
    if (current.length >= 140) break;
    const candidate = `${current} ${clause}`;
    if (candidate.length <= 160) current = candidate;
  }

  return current;
}

// ───────────────────────────────── helpers ───────────────────────────────────

/** Keep the model's outline but make the word budgets add up to the plan target. */
function normaliseOutline(outline: Outline, plan: ContentPlan): Outline {
  const sections = outline.sections.slice(0, 10);
  const sum = sections.reduce((s, x) => s + (x.wordTarget || 0), 0) || 1;
  const scale = plan.wordTarget / sum;
  return {
    h1: outline.h1 || plan.title,
    sections: sections.map((s) => ({
      ...s,
      level: (s.level === 3 ? 3 : 2) as 2 | 3,
      wordTarget: Math.max(120, Math.round(s.wordTarget * scale)),
      subheadings: s.subheadings ?? [],
    })),
    faq: outline.faq.slice(0, 6),
  };
}

/**
 * Meta fields are scored on exact character ranges, so repair them in code
 * rather than paying for another round-trip when the model misses by two chars.
 */
function enforceMetaConstraints(seo: SeoMeta, plan: ContentPlan, h1: string): SeoMeta {
  const kw = plan.targetKeyword;

  let metaTitle = (seo.metaTitle || h1).trim();
  if (!metaTitle.toLowerCase().includes(kw.toLowerCase())) {
    metaTitle = `${kw.charAt(0).toUpperCase() + kw.slice(1)}: ${metaTitle}`;
  }
  if (metaTitle.length > 60) metaTitle = truncate(metaTitle, 60);
  if (metaTitle.length < 50) {
    const tails = [' — Tested & Compared', ' | Full Guide', ' — What To Know', ' | Honest Guide'];
    for (const tail of tails) {
      if (metaTitle.length + tail.length <= 60) {
        metaTitle = `${metaTitle}${tail}`;
        if (metaTitle.length >= 50) break;
      }
    }
  }

  let metaDescription = (seo.metaDescription || '').trim();
  if (!metaDescription.toLowerCase().includes(kw.toLowerCase())) {
    metaDescription = `${kw.charAt(0).toUpperCase() + kw.slice(1)}: ${metaDescription}`.trim();
  }
  if (metaDescription.length > 160) metaDescription = `${truncate(metaDescription, 159)}.`;
  if (metaDescription.length < 140) metaDescription = padDescription(metaDescription);

  return {
    ...seo,
    metaTitle,
    metaDescription,
    focusKeyword: kw,
    slug: slugify(seo.slug || kw),
  };
}

/**
 * Apply the polish pass at paragraph level.
 *
 * The stage returns a replacement opening and closing paragraph, not whole
 * sections — swapping an entire section for a two-sentence intro would throw
 * away most of the article's body and its word budget with it.
 */
function applyPolish(
  sections: Array<{ section: OutlineSection; body: string }>,
  polish: Polish,
): Array<{ section: OutlineSection; body: string }> {
  const out = sections.map((s) => ({ ...s }));

  if (polish.intro.trim() && out.length) {
    out[0].body = replaceFirstParagraph(out[0].body, polish.intro.trim());
  }
  if (polish.conclusion.trim() && out.length > 1) {
    const last = out.length - 1;
    out[last].body = replaceLastParagraph(out[last].body, polish.conclusion.trim());
  }
  // Transitions open the middle sections, giving the article a through-line.
  polish.transitions.forEach((t, i) => {
    const idx = i + 1;
    if (idx < out.length - 1 && t.trim()) out[idx].body = `${t.trim()}\n\n${out[idx].body}`;
  });
  return out;
}

function paragraphsOf(body: string): string[] {
  return body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
}

export function firstParagraph(body: string): string {
  return paragraphsOf(body)[0] ?? '';
}

export function lastParagraph(body: string): string {
  const paras = paragraphsOf(body);
  return paras[paras.length - 1] ?? '';
}

function replaceFirstParagraph(body: string, replacement: string): string {
  const paras = paragraphsOf(body);
  if (!paras.length) return replacement;
  paras[0] = replacement;
  return paras.join('\n\n');
}

function replaceLastParagraph(body: string, replacement: string): string {
  const paras = paragraphsOf(body);
  if (!paras.length) return replacement;
  paras[paras.length - 1] = replacement;
  return paras.join('\n\n');
}

/** Enforce the link rules the model was asked to honour — never trust the output. */
function applyLinks(
  sections: Array<{ section: OutlineSection; body: string }>,
  picks: Array<{ url: string; anchor: string; sectionIndex: number }>,
  candidatesBySection: Array<{ sectionIndex: number; heading: string; candidates: LinkCandidate[] }>,
  budget: number,
  perSectionSoFar: Map<number, number> = new Map(),
  alreadyUsed: Set<string> = new Set(),
): PlacedLink[] {
  const validUrls = new Map<string, LinkCandidate>();
  for (const s of candidatesBySection) for (const c of s.candidates) validUrls.set(c.url, c);

  const usedUrls = new Set(alreadyUsed);
  const perSection = new Map(perSectionSoFar);
  const placed: PlacedLink[] = [];

  for (const pick of picks) {
    if (placed.length >= budget) break;
    const candidate = validUrls.get(pick.url);
    if (!candidate) continue;                                   // not a real URL on this site
    if (usedUrls.has(pick.url)) continue;                       // no duplicate targets
    const idx = Math.min(Math.max(pick.sectionIndex, 0), sections.length - 1);
    if ((perSection.get(idx) ?? 0) >= DEFAULT_LINK_RULES.maxPerSection) continue;

    const target = sections[idx];
    // sectionHtml() is idempotent: it converts markdown-ish prose on the first
    // pass and returns the already-converted HTML on later ones. Calling
    // paragraphsToHtml() again here would wrap finished HTML in <p> tags and
    // corrupt the section, which capped a section at one link.
    const { html, placed: done } = injectLinks(sectionHtml(target.body), [
      { url: pick.url, anchor: pick.anchor, title: candidate.title },
    ]);
    if (!done.length) continue;

    target.body = htmlToParagraphs(html);
    usedUrls.add(pick.url);
    perSection.set(idx, (perSection.get(idx) ?? 0) + 1);
    placed.push({
      url: pick.url,
      anchor: done[0].anchor,
      title: candidate.title,
      sectionIndex: idx,
      score: candidate.score,
    });
  }
  return placed;
}

/** One authoritative outbound citation from the SERP, excluding forums. */
function pickExternalCitations(serp: SerpSnapshot | null, keyword: string): Array<{ url: string; anchor: string }> {
  if (!serp?.results.length) return [];
  const skip = /reddit|quora|pinterest|facebook|twitter|x\.com|tiktok/i;
  const pick = serp.results.find((r) => !skip.test(r.domain) && /^https?:/.test(r.url));
  if (!pick) return [];
  return [{ url: pick.url, anchor: `${pick.domain}'s testing of ${keyword}` }];
}

function buildImages(
  sections: OutlineSection[],
  alts: string[],
  keyword: string,
): Array<{ position: number; alt: string; caption: string }> {
  // One hero plus an image roughly every third section — enough for image
  // search without bloating the page.
  const positions = [0, ...sections.map((_, i) => i).filter((i) => i > 0 && i % 3 === 0)].slice(0, 4);
  return positions.map((pos, n) => ({
    position: pos,
    alt: alts[n] || `${sections[pos]?.heading ?? keyword} — illustration for ${keyword}`,
    caption: sections[pos]?.heading ?? '',
  }));
}

function paragraphsToHtml(body: string): string {
  return body
    .split(/\n{2,}/)
    .map((block) => {
      const t = block.trim();
      if (!t) return '';
      if (/^###\s+/.test(t)) return `<h3>${esc(t.replace(/^###\s+/, ''))}</h3>`;
      if (/^##\s+/.test(t)) return `<h3>${esc(t.replace(/^##\s+/, ''))}</h3>`;
      if (/^(\s*[-*]\s+)/m.test(t) && t.split('\n').every((l) => /^\s*[-*]\s+/.test(l) || !l.trim())) {
        const items = t.split('\n').filter((l) => /^\s*[-*]\s+/.test(l)).map((l) => `<li>${inline(l.replace(/^\s*[-*]\s+/, ''))}</li>`);
        return `<ul>${items.join('')}</ul>`;
      }
      if (/^\s*\d+\.\s+/m.test(t) && t.split('\n').every((l) => /^\s*\d+\.\s+/.test(l) || !l.trim())) {
        const items = t.split('\n').filter((l) => /^\s*\d+\.\s+/.test(l)).map((l) => `<li>${inline(l.replace(/^\s*\d+\.\s+/, ''))}</li>`);
        return `<ol>${items.join('')}</ol>`;
      }
      return `<p>${inline(t)}</p>`;
    })
    .filter(Boolean)
    .join('\n');
}

/** Round-trip marker so a linked section survives re-serialisation. */
function htmlToParagraphs(html: string): string {
  return `<!--html-->${html}`;
}

function sectionHtml(body: string): string {
  return body.startsWith('<!--html-->') ? body.slice('<!--html-->'.length) : paragraphsToHtml(body);
}

function sectionMarkdown(body: string): string {
  if (!body.startsWith('<!--html-->')) return body;
  return stripHtml(body.slice('<!--html-->'.length));
}

function assembleHtml(args: {
  outline: Outline;
  sections: Array<{ section: OutlineSection; body: string }>;
  faq: Array<{ question: string; answer: string }>;
  images: Array<{ position: number; alt: string; caption: string }>;
  externalLinks: Array<{ url: string; anchor: string }>;
  schema: Record<string, unknown>;
}): string {
  const parts: string[] = [];
  parts.push(`<h1>${esc(args.outline.h1)}</h1>`);

  args.sections.forEach((s, i) => {
    const image = args.images.find((img) => img.position === i);
    if (image) {
      // Placeholder src: the publisher swaps in the uploaded media URL. Alt text
      // is what the SEO score checks, and it is written per section.
      parts.push(
        `<figure><img src="/wp-content/uploads/swarm-placeholder.jpg" alt="${esc(image.alt)}" loading="lazy" width="1200" height="675" /><figcaption>${esc(image.caption)}</figcaption></figure>`,
      );
    }
    parts.push(`<h2>${esc(s.section.heading)}</h2>`);
    parts.push(sectionHtml(s.body));

    if (i === args.sections.length - 2 && args.externalLinks.length) {
      const l = args.externalLinks[0];
      parts.push(
        `<p>For a second opinion, see <a href="${esc(l.url)}" rel="noopener nofollow" target="_blank">${esc(l.anchor)}</a>.</p>`,
      );
    }
  });

  if (args.faq.length) {
    parts.push('<h2>Frequently asked questions</h2>');
    for (const f of args.faq) {
      parts.push(`<h3>${esc(f.question)}</h3>`);
      parts.push(`<p>${esc(f.answer)}</p>`);
    }
  }

  parts.push(schemaScriptTag(args.schema));
  return parts.join('\n');
}

function assembleMarkdown(args: {
  outline: Outline;
  sections: Array<{ section: OutlineSection; body: string }>;
  faq: Array<{ question: string; answer: string }>;
}): string {
  const parts: string[] = [`# ${args.outline.h1}`, ''];
  for (const s of args.sections) {
    parts.push(`## ${s.section.heading}`, '', sectionMarkdown(s.body), '');
  }
  if (args.faq.length) {
    parts.push('## Frequently asked questions', '');
    for (const f of args.faq) parts.push(`### ${f.question}`, '', f.answer, '');
  }
  return parts.join('\n');
}

/** Minimal inline markdown, so bold/italic/links from the model survive. */
function inline(text: string): string {
  return esc(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\s)\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" rel="noopener">$1</a>');
}

function esc(s: string): string {
  return String(s).replace(/&(?!(amp|lt|gt|quot|#\d+);)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Bounded-concurrency map — keeps section drafting fast without rate-limiting. */
async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export const COST_TARGET_USD = env.anthropic.costTargetUsd;

/** Exported under a distinct name so the unit suite can assert the padding rules. */
export const padDescriptionForTest = padDescription;
