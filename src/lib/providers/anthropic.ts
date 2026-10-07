/**
 * Anthropic provider + tier router.
 *
 * Two jobs:
 *  1. One `complete()` call site for every swarm stage, with retries and
 *     strict-JSON handling.
 *  2. Keep cost per article near ARTICLE_COST_TARGET_USD ($0.039 default) by
 *     routing each stage to a tier and downgrading upgradeable stages when a
 *     run is projected to overspend.
 *
 * Tokens are read back off the API response, so `article_runs.cost_usd` is a
 * measurement rather than an estimate. With no API key the mock twin produces
 * realistically shaped text and token counts, so the budget logic is exercised
 * identically in local dev.
 */
import Anthropic from '@anthropic-ai/sdk';
import { env, providerMode } from '../env';
import { round } from '../utils/money';
import { fnv1a, seededRandom } from '../utils/text';

export type Tier = 'haiku' | 'sonnet' | 'opus';

/** What a stage is expected to consume, used to price it before committing to a tier. */
export type StageEstimate = { inputTokens?: number; outputTokens?: number };

/** USD per million tokens. */
export const PRICING: Record<Tier, { input: number; output: number }> = {
  haiku: { input: 1, output: 5 },
  sonnet: { input: 3, output: 15 },
  opus: { input: 15, output: 75 },
};

export type CompletionRequest = {
  stage: string;
  tier: Tier;
  system: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  /** Ask for JSON and validate/repair it before returning. */
  json?: boolean;
};

export type CompletionResult = {
  stage: string;
  tier: Tier;
  model: string;
  text: string;
  json?: unknown;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  ms: number;
  mocked: boolean;
};

export function costOf(tier: Tier, inputTokens: number, outputTokens: number): number {
  const p = PRICING[tier];
  return round((inputTokens * p.input + outputTokens * p.output) / 1_000_000, 6);
}

export function modelFor(tier: Tier): string {
  return env.anthropic.models[tier];
}

/** Rough token estimate for mock accounting and pre-flight budgeting. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: env.anthropic.apiKey, maxRetries: 0 });
  return client;
}

const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504, 529]);

export async function complete(req: CompletionRequest): Promise<CompletionResult> {
  const started = Date.now();
  const model = modelFor(req.tier);
  const maxTokens = req.maxTokens ?? 1600;

  if (providerMode.anthropic === 'mock') {
    const text = mockCompletion(req);
    const inputTokens = estimateTokens(req.system + req.prompt);
    const outputTokens = estimateTokens(text);
    return {
      stage: req.stage,
      tier: req.tier,
      model: `${model} (mock)`,
      text,
      json: req.json ? safeJson(text) : undefined,
      inputTokens,
      outputTokens,
      costUsd: costOf(req.tier, inputTokens, outputTokens),
      ms: Date.now() - started,
      mocked: true,
    };
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await getClient().messages.create({
        model,
        max_tokens: maxTokens,
        temperature: req.temperature ?? (req.json ? 0.1 : 0.7),
        system: req.json ? `${req.system}\n\nReply with JSON only. No prose, no code fences.` : req.system,
        messages: [{ role: 'user', content: req.prompt }],
      });
      const text = res.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('')
        .trim();
      const inputTokens = res.usage.input_tokens;
      const outputTokens = res.usage.output_tokens;
      let json: unknown;
      if (req.json) {
        json = safeJson(text);
        if (json === undefined) throw new Error(`Stage ${req.stage} returned unparseable JSON`);
      }
      return {
        stage: req.stage,
        tier: req.tier,
        model,
        text,
        json,
        inputTokens,
        outputTokens,
        costUsd: costOf(req.tier, inputTokens, outputTokens),
        ms: Date.now() - started,
        mocked: false,
      };
    } catch (e: any) {
      lastError = e;
      const status = e?.status ?? e?.response?.status;
      if (attempt === 3 || (status && !RETRYABLE.has(status))) break;
      const backoff = 400 * 2 ** attempt + Math.random() * 250;
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Anthropic request failed');
}

/** Tolerates code fences and leading prose around a JSON body. */
export function safeJson(text: string): unknown {
  const candidates: string[] = [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1]);
  candidates.push(text);
  const firstObj = text.indexOf('{');
  const lastObj = text.lastIndexOf('}');
  if (firstObj !== -1 && lastObj > firstObj) candidates.push(text.slice(firstObj, lastObj + 1));
  const firstArr = text.indexOf('[');
  const lastArr = text.lastIndexOf(']');
  if (firstArr !== -1 && lastArr > firstArr) candidates.push(text.slice(firstArr, lastArr + 1));
  for (const c of candidates) {
    try {
      return JSON.parse(c.trim());
    } catch {
      /* try the next shape */
    }
  }
  return undefined;
}

// ───────────────────────────── Tier routing ──────────────────────────────────

export type StageName = 'research' | 'outline' | 'draft' | 'facts' | 'seo' | 'links' | 'polish' | 'escalate';

/**
 * Default tier per stage, and whether the router may downgrade it to stay in
 * budget. Outline and polish are the two stages worth paying Sonnet for:
 * structure and the voice the reader actually feels.
 */
const STAGE_PLAN: Record<StageName, { tier: Tier; downgradable: boolean }> = {
  research: { tier: 'haiku', downgradable: false },
  outline: { tier: 'sonnet', downgradable: false }, // never cheapen structure
  draft: { tier: 'haiku', downgradable: false },
  facts: { tier: 'haiku', downgradable: false },
  seo: { tier: 'haiku', downgradable: false },
  links: { tier: 'haiku', downgradable: false },
  polish: { tier: 'sonnet', downgradable: true },
  escalate: { tier: 'opus', downgradable: false },
};

/**
 * Per-run budget keeper. Tracks spend as stages complete and answers
 * "which tier should this stage use?" with the budget in hand.
 */
export class TierRouter {
  private spend = 0;
  private byTier: Record<Tier, number> = { haiku: 0, sonnet: 0, opus: 0 };
  private calls: Record<Tier, number> = { haiku: 0, sonnet: 0, opus: 0 };
  private downgrades: string[] = [];

  constructor(
    private readonly targetUsd = env.anthropic.costTargetUsd,
    /** Stages remaining after this one, used for headroom checks. */
    private readonly tolerance = 1.1,
  ) {}

  /**
   * Tier for a stage, decided against the remaining budget.
   *
   * The caller passes what this stage will roughly consume; the router prices
   * that at the planned tier and downgrades when paying for it would push the
   * run past the target. Outline is never downgraded — structure is the one
   * thing worth paying Sonnet for — so in practice polish is the release valve.
   */
  tierFor(stage: StageName, estimate: StageEstimate = {}): Tier {
    const plan = STAGE_PLAN[stage];
    if (!plan.downgradable || plan.tier === 'haiku') return plan.tier;

    const inputTokens = estimate.inputTokens ?? 0;
    const outputTokens = estimate.outputTokens ?? 0;
    if (!inputTokens && !outputTokens) return plan.tier; // nothing to price against

    const atPlannedTier = costOf(plan.tier, inputTokens, outputTokens);
    const ceiling = this.targetUsd * this.tolerance;
    if (this.spend + atPlannedTier > ceiling) {
      this.downgrades.push(
        `${stage}: ${plan.tier}→haiku (would reach $${(this.spend + atPlannedTier).toFixed(5)} against a $${ceiling.toFixed(5)} ceiling)`,
      );
      return 'haiku';
    }
    return plan.tier;
  }

  record(tier: Tier, costUsd: number): void {
    this.spend = round(this.spend + costUsd, 6);
    this.byTier[tier] = round(this.byTier[tier] + costUsd, 6);
    this.calls[tier] += 1;
  }

  get totalUsd(): number {
    return this.spend;
  }

  /** Spend share per tier, which is how the 70/28/2 target is defined. */
  summary() {
    const total = this.spend || 1;
    return {
      totalUsd: round(this.spend, 5),
      targetUsd: this.targetUsd,
      withinTarget: this.spend <= this.targetUsd * this.tolerance,
      calls: { ...this.calls },
      spendByTier: { ...this.byTier },
      spendShare: {
        haiku: round(this.byTier.haiku / total, 4),
        sonnet: round(this.byTier.sonnet / total, 4),
        opus: round(this.byTier.opus / total, 4),
      },
      targetShare: { ...env.anthropic.mix },
      downgrades: [...this.downgrades],
    };
  }
}

export type TierSummary = ReturnType<TierRouter['summary']>;

// ─────────────────────────────── Mock twin ───────────────────────────────────

/**
 * Deterministic stand-in. Returns the exact shape each stage's parser expects,
 * seeded off the prompt so the same input always gives the same article — which
 * is what makes the E2E test assertable.
 */
function mockCompletion(req: CompletionRequest): string {
  const seed = `${req.stage}:${fnv1a(req.prompt)}`;
  const rnd = seededRandom(seed);
  const ctx = readContext(req.prompt);

  switch (req.stage) {
    case 'research':
      return JSON.stringify({
        searchIntent: ctx.intent || 'informational',
        audienceQuestions: [
          `What matters most when choosing ${ctx.keyword}?`,
          `How much should you expect to spend on ${ctx.keyword}?`,
          `What do buyers get wrong about ${ctx.keyword}?`,
          `Which option suits a first-time buyer?`,
        ],
        competitorAngles: [
          'Generic buying lists with no selection criteria',
          'Specs restated from manufacturer copy',
          'No guidance for the budget end of the market',
        ],
        contentGaps: [
          'A clear decision rule for which option to pick',
          'Real trade-offs rather than a feature table',
          'What to do if the obvious choice is unavailable',
        ],
        mustCoverEntities: ctx.secondary.slice(0, 6),
        recommendedAngle: `A decision-first guide to ${ctx.keyword} that names the trade-offs other pages skip.`,
      });

    case 'outline': {
      const sections = Math.max(5, Math.min(9, 5 + Math.floor(rnd() * 4)));
      const titles = [
        `What ${ctx.keyword} actually means in practice`,
        `How to choose: the three criteria that decide it`,
        `The options compared, with the trade-offs named`,
        `What it costs, and where the money goes`,
        `Common mistakes, and what to do instead`,
        `Who each option genuinely suits`,
        `How to get set up in an afternoon`,
        `When to revisit the decision`,
        `The short answer`,
      ];
      return JSON.stringify({
        h1: ctx.title || `${ctx.keyword}: the practical guide`,
        sections: Array.from({ length: sections }, (_, i) => ({
          heading: titles[i % titles.length],
          level: 2,
          intent: i === 0 ? 'define the problem' : i === sections - 1 ? 'resolve and recommend' : 'inform and compare',
          wordTarget: Math.round((ctx.wordTarget || 1800) / sections),
          keyPoints: [
            `Lead with the decision, not the background`,
            `Name a specific number or constraint`,
            `Close with what the reader should do next`,
          ],
          subheadings: i % 3 === 1 ? [`A worked example`, `The exception worth knowing`] : [],
        })),
        faq: [
          { question: `Is ${ctx.keyword} worth it?`, answer: `Yes, when the decision is driven by how you will actually use it rather than headline specs.` },
          { question: `How long does it take to see results with ${ctx.keyword}?`, answer: `Most people see a clear difference within the first two weeks of consistent use.` },
          { question: `What is the cheapest sensible option?`, answer: `The budget tier is fine provided it covers the three criteria above; below that, you pay twice.` },
        ],
      });
    }

    case 'draft': {
      const heading = ctx.heading || 'Section';
      const target = ctx.wordTarget || 220;
      return mockSectionProse(heading, ctx.keyword, target, rnd);
    }

    case 'facts':
      return JSON.stringify({
        flagged: [
          {
            claim: 'Unsourced percentage in the comparison section',
            severity: 'medium',
            fix: 'Hedge to a range, or attribute to the manufacturer spec.',
          },
        ],
        verdict: 'pass_with_edits',
      });

    case 'seo':
      return JSON.stringify({
        metaTitle: trimTo(`${ctx.title || ctx.keyword}: What To Know`, 60),
        metaDescription: trimTo(
          `A practical guide to ${ctx.keyword} — the three criteria that decide it, what it costs, and the mistakes worth avoiding.`,
          158,
        ),
        focusKeyword: ctx.keyword,
        slug: (ctx.keyword || 'article').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        excerpt: `The decision-first guide to ${ctx.keyword}.`,
        imageAlts: (ctx.headings.length ? ctx.headings : ['Overview']).map(
          (h) => `${h} — illustration for ${ctx.keyword}`,
        ),
        keywordPlacementNotes: ['Focus keyword present in H1, opening paragraph and one H2.'],
      });

    case 'links': {
      // The candidate URLs are supplied in the prompt; the model only picks.
      // Pick the best unused candidate per section, which is what a competent
      // model does — one target per section, spread across the article.
      const bySection = new Map<number, Array<{ url: string; title: string; anchor?: string; sectionIndex?: number }>>();
      for (const c of ctx.candidates as Array<{ url: string; title: string; anchor?: string; sectionIndex?: number }>) {
        const idx = Number(c.sectionIndex ?? 0);
        bySection.set(idx, [...(bySection.get(idx) ?? []), c]);
      }
      const used = new Set<string>();
      const picks: Array<{ url: string; anchor: string; sectionIndex: number; reason: string }> = [];
      for (const [sectionIndex, list] of [...bySection.entries()].sort((a, b) => a[0] - b[0])) {
        const choice = list.find((c) => !used.has(c.url));
        if (!choice) continue;
        used.add(choice.url);
        picks.push({
          url: choice.url,
          anchor: choice.anchor || choice.title.toLowerCase().replace(/[:|].*$/, '').split(/\s+/).slice(0, 4).join(' '),
          sectionIndex,
          reason: 'Closest topical match to this section',
        });
      }
      return JSON.stringify({ links: picks });
    }

    case 'polish':
    case 'escalate':
      return JSON.stringify({
        intro: `If you are weighing up ${ctx.keyword}, the decision usually comes down to three things — and most guides bury all of them. Here they are first, with the reasoning behind each.`,
        conclusion: `The short version: pick on how you will actually use it, not on the spec sheet. Get those three criteria right and the rest is detail.`,
        transitions: [
          'That settles the what. The harder question is how to choose.',
          'With the criteria set, the comparison becomes straightforward.',
          'Cost is where most people change their mind, so it is worth being precise.',
        ],
        titleSuggestion: ctx.title || `${ctx.keyword}: The Practical Guide`,
      });

    default:
      return JSON.stringify({ ok: true, stage: req.stage });
  }
}

function mockSectionProse(heading: string, keyword: string, target: number, rnd: () => number): string {
  const paras: string[] = [];
  const openers = [
    `The thing that decides ${keyword} is rarely the thing the marketing leads with.`,
    `Start with how you will use ${keyword} day to day, because that narrows the field fast.`,
    `There is a simple test for this part of the ${keyword} decision.`,
  ];
  const middles = [
    `In practice that means checking three things in order: fit for your actual use, the cost of being wrong, and how easily you can change your mind later. Most buyers reverse that order and end up paying for capability they never touch.`,
    `The trade-off is real and worth naming. Spend less and you accept a narrower range of use; spend more and you are buying headroom you may not need. Neither is wrong — but the choice should be deliberate.`,
    `Where this goes wrong is the middle of the market. The budget tier is honest about what it is, and the premium tier delivers, but the middle often charges premium money for budget engineering.`,
    `A worked example helps. Take the most common setup, change one variable, and the right answer usually flips — which tells you the variable mattered more than the brand did.`,
  ];
  const closers = [
    `If you only take one thing from this section: decide what you are optimising for before you compare options.`,
    `Get this part right and the rest of the decision is largely detail.`,
  ];
  paras.push(openers[Math.floor(rnd() * openers.length)]);
  let words = paras.join(' ').split(/\s+/).length;
  let guard = 0;
  while (words < target && guard++ < 12) {
    const p = middles[Math.floor(rnd() * middles.length)];
    paras.push(p);
    words += p.split(/\s+/).length;
  }
  paras.push(closers[Math.floor(rnd() * closers.length)]);
  return paras.map((p) => p.trim()).join('\n\n');
}

/** Pull the structured hints the stage prompts embed, so mocks stay on-topic. */
function readContext(prompt: string) {
  const grab = (label: string): string => {
    const m = prompt.match(new RegExp(`${label}:\\s*(.+)`, 'i'));
    return m ? m[1].trim() : '';
  };
  const secondaryRaw = grab('SECONDARY_KEYWORDS');
  const headingsRaw = grab('HEADINGS');
  const candidates = extractJsonArray(prompt, 'CANDIDATES_JSON:') as Array<{
    url: string;
    title: string;
    anchor?: string;
  }>;
  return {
    keyword: grab('FOCUS_KEYWORD') || grab('KEYWORD') || 'the topic',
    title: grab('TITLE'),
    heading: grab('HEADING'),
    intent: grab('INTENT'),
    wordTarget: Number(grab('WORD_TARGET')) || 0,
    secondary: secondaryRaw ? secondaryRaw.split(/\s*,\s*/).filter(Boolean) : [],
    headings: headingsRaw ? headingsRaw.split(/\s*\|\s*/).filter(Boolean) : [],
    candidates,
  };
}


/**
 * Pull a JSON array out of a labelled prompt line by bracket matching.
 *
 * A regex cannot do this reliably: the array is followed by prose, and the
 * values themselves contain brackets and escaped quotes.
 */
function extractJsonArray(prompt: string, label: string): unknown[] {
  const labelAt = prompt.indexOf(label);
  if (labelAt === -1) return [];
  const start = prompt.indexOf('[', labelAt);
  if (start === -1) return [];

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < prompt.length; i++) {
    const ch = prompt[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(prompt.slice(start, i + 1));
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      }
    }
  }
  return [];
}

function trimTo(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1).replace(/[\s,;:.]+$/, '');
}
