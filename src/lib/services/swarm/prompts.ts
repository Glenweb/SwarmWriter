/**
 * Stage prompts. Each carries machine-readable hints (FOCUS_KEYWORD:, HEADING:,
 * CANDIDATES_JSON: …) that both the live model and the mock twin read, so a
 * local run exercises the same contract as production.
 */
import type { OutlineSection } from '../plans';
import type { LinkCandidate } from '../internal-links';

export const VOICE = `You write for an operator audience: people who will act on what they read.
Rules you never break:
- Lead with the answer. No "in today's fast-paced world", no restating the question.
- One idea per paragraph, two to four sentences each.
- Name specifics: numbers, constraints, trade-offs. If you cannot be specific, be honest that it depends and say on what.
- No filler transitions ("Furthermore", "Moreover", "It's worth noting that").
- No em-dash-heavy style, no rhetorical questions as section openers.
- British English spelling unless the site brief says otherwise.
- Never invent statistics, prices, dates, study results or quotes.`;

export function researchPrompt(args: {
  focusKeyword: string;
  secondary: string[];
  intent: string;
  serp: { results: Array<{ title: string; description: string; headings: string[]; domain: string }>; peopleAlsoAsk: string[]; avgWordCount: number } | null;
  niche: string | null;
  audience: string | null;
}): string {
  const serpBlock = args.serp
    ? args.serp.results
        .slice(0, 8)
        .map((r, i) => `${i + 1}. [${r.domain}] ${r.title}\n   ${r.description}\n   Headings: ${r.headings.slice(0, 6).join(' | ') || 'n/a'}`)
        .join('\n')
    : 'No SERP data available — infer from the keyword.';

  return `Analyse the search results below and produce a content brief.

FOCUS_KEYWORD: ${args.focusKeyword}
SECONDARY_KEYWORDS: ${args.secondary.join(', ') || 'none'}
INTENT: ${args.intent}
NICHE: ${args.niche ?? 'general'}
AUDIENCE: ${args.audience ?? 'general readers'}
AVG_COMPETITOR_WORDS: ${args.serp?.avgWordCount ?? 'unknown'}

TOP RESULTS:
${serpBlock}

PEOPLE ALSO ASK:
${(args.serp?.peopleAlsoAsk ?? []).map((q) => `- ${q}`).join('\n') || '- none'}

Return JSON:
{
  "searchIntent": "informational|commercial|transactional|navigational",
  "audienceQuestions": ["4-6 questions a reader lands with"],
  "competitorAngles": ["3-5 angles the top results take"],
  "contentGaps": ["3-5 things none of them answer properly"],
  "mustCoverEntities": ["specific products, terms or concepts to name"],
  "recommendedAngle": "one sentence: the angle that beats these results"
}`;
}

export function outlinePrompt(args: {
  focusKeyword: string;
  title: string;
  secondary: string[];
  intent: string;
  contentType: string;
  wordTarget: number;
  brief: unknown;
  tone: string;
}): string {
  return `Build the outline for this article.

TITLE: ${args.title}
FOCUS_KEYWORD: ${args.focusKeyword}
SECONDARY_KEYWORDS: ${args.secondary.join(', ') || 'none'}
INTENT: ${args.intent}
CONTENT_TYPE: ${args.contentType}
WORD_TARGET: ${args.wordTarget}
TONE: ${args.tone}

BRIEF:
${JSON.stringify(args.brief, null, 2)}

Requirements:
- 5 to 9 H2 sections. The first defines or frames; the last resolves with a recommendation.
- Every section gets a word budget; they must sum to roughly WORD_TARGET.
- Headings state a claim or answer a question. Never one-word labels like "Introduction" or "Conclusion".
- Cover each content gap from the brief in a named section.
- 3 to 5 FAQ entries drawn from the reader's actual questions, each answered in 2-3 sentences.

Return JSON:
{
  "h1": "the H1, <= 70 chars, focus keyword included naturally",
  "sections": [{ "heading": "", "level": 2, "intent": "", "wordTarget": 0, "keyPoints": [""], "subheadings": [""] }],
  "faq": [{ "question": "", "answer": "" }]
}`;
}

export function sectionPrompt(args: {
  section: OutlineSection;
  index: number;
  total: number;
  focusKeyword: string;
  secondary: string[];
  title: string;
  previousHeading: string | null;
  nextHeading: string | null;
  brief: unknown;
  tone: string;
  shouldUseKeyword: boolean;
}): string {
  return `Write one section of an article. Prose only — no heading, no markdown fences, no preamble.

TITLE: ${args.title}
HEADING: ${args.section.heading}
INTENT: ${args.section.intent}
WORD_TARGET: ${args.section.wordTarget}
FOCUS_KEYWORD: ${args.focusKeyword}
SECONDARY_KEYWORDS: ${args.secondary.join(', ') || 'none'}
TONE: ${args.tone}
SECTION: ${args.index + 1} of ${args.total}
PREVIOUS_HEADING: ${args.previousHeading ?? 'none (this is the opening section)'}
NEXT_HEADING: ${args.nextHeading ?? 'none (this is the final section)'}
${args.shouldUseKeyword ? 'USE_FOCUS_KEYWORD: yes, once, naturally' : 'USE_FOCUS_KEYWORD: no — avoid repeating it here'}

KEY POINTS TO COVER:
${args.section.keyPoints.map((p) => `- ${p}`).join('\n') || '- use your judgement from the heading and intent'}

${args.section.subheadings?.length ? `SUBHEADINGS to use as H3 (write "### Text" on its own line):\n${args.section.subheadings.map((s) => `- ${s}`).join('\n')}` : ''}

Write ${args.section.wordTarget} words (±15%). Plain paragraphs separated by blank lines.
Use a markdown bullet list only where a list genuinely reads better than prose.
Do not open with the heading restated. Do not write a mini-conclusion unless this is the final section.`;
}

export function factsPrompt(args: { html: string; focusKeyword: string; brief: unknown }): string {
  return `Review this draft for claims that are not supportable.

FOCUS_KEYWORD: ${args.focusKeyword}

BRIEF (the only source material available):
${JSON.stringify(args.brief, null, 2)}

DRAFT:
${args.html.slice(0, 12_000)}

Flag any statistic, price, date, study reference, quote or absolute claim ("the fastest",
"all experts agree") that the brief does not support. For each, give the fix: hedge it,
attribute it, or cut it.

Return JSON:
{ "flagged": [{ "claim": "", "severity": "low|medium|high", "fix": "" }], "verdict": "pass|pass_with_edits|fail" }`;
}

export function seoPrompt(args: {
  title: string;
  focusKeyword: string;
  secondary: string[];
  headings: string[];
  firstParagraph: string;
  siteName: string;
}): string {
  return `Produce the SEO metadata for this article.

TITLE: ${args.title}
FOCUS_KEYWORD: ${args.focusKeyword}
SECONDARY_KEYWORDS: ${args.secondary.join(', ') || 'none'}
HEADINGS: ${args.headings.join(' | ')}
SITE: ${args.siteName}
OPENING: ${args.firstParagraph.slice(0, 500)}

Hard constraints:
- metaTitle: 50-60 characters inclusive, focus keyword near the front. Count the characters.
- metaDescription: 140-160 characters inclusive, focus keyword present, ends with a reason to click.
- slug: lowercase, hyphenated, 3-6 words, no stop words, no year.
- imageAlts: one per heading, describing what the image shows, focus keyword in at most one.

Return JSON:
{ "metaTitle": "", "metaDescription": "", "focusKeyword": "", "slug": "", "excerpt": "",
  "imageAlts": [""], "keywordPlacementNotes": [""] }`;
}

export function linksPrompt(args: {
  focusKeyword: string;
  headings: string[];
  candidatesBySection: Array<{ sectionIndex: number; heading: string; candidates: LinkCandidate[] }>;
  budget: number;
}): string {
  const flat = args.candidatesBySection.flatMap((s) =>
    s.candidates.map((c) => ({ url: c.url, title: c.title, sectionIndex: s.sectionIndex, section: s.heading, score: c.score })),
  );
  return `Choose internal links for this article from the candidates below.

FOCUS_KEYWORD: ${args.focusKeyword}
HEADINGS: ${args.headings.join(' | ')}
LINK_BUDGET: ${args.budget}

These are the only URLs that exist on this site. Never return a URL that is not in this list.

CANDIDATES_JSON: ${JSON.stringify(flat)}

For each link you choose, give the anchor phrase. The anchor must:
- be 2-6 words that would plausibly appear in that section's prose,
- describe the destination, not the action ("carry-on size limits", never "click here"),
- not be the focus keyword of this article (that would compete with this page).

Choose at most ${args.budget}, at most 2 per section, never two to the same URL.
Skip any candidate that is only a weak topical match — fewer, better links beat filling the budget.

Return JSON:
{ "links": [{ "url": "", "anchor": "", "sectionIndex": 0, "reason": "" }] }`;
}

export function polishPrompt(args: {
  title: string;
  focusKeyword: string;
  headings: string[];
  currentIntro: string;
  currentConclusion: string;
  tone: string;
}): string {
  return `Rewrite the opening and closing of this article, and supply section transitions.

TITLE: ${args.title}
FOCUS_KEYWORD: ${args.focusKeyword}
HEADINGS: ${args.headings.join(' | ')}
TONE: ${args.tone}

CURRENT OPENING:
${args.currentIntro.slice(0, 1500)}

CURRENT CLOSING:
${args.currentConclusion.slice(0, 1500)}

The opening must answer the query in the first two sentences, contain the focus keyword
once, and give the reader a reason to keep reading that is not a promise of more content.
The closing must resolve with a specific recommendation, not a summary of what was said.
Transitions are single sentences that could open a section — supply one per gap between sections.

Return JSON:
{ "intro": "", "conclusion": "", "transitions": [""], "titleSuggestion": "" }`;
}
