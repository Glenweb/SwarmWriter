import { z } from 'zod';

/**
 * Strict shapes for the JSON stages. Validated on the way out of the model so a
 * malformed response fails at the boundary rather than three stages later.
 */

export const briefSchema = z.object({
  searchIntent: z.string().default('informational'),
  audienceQuestions: z.array(z.string()).default([]),
  competitorAngles: z.array(z.string()).default([]),
  contentGaps: z.array(z.string()).default([]),
  mustCoverEntities: z.array(z.string()).default([]),
  recommendedAngle: z.string().default(''),
});
export type Brief = z.infer<typeof briefSchema>;

export const outlineSectionSchema = z.object({
  heading: z.string().min(1),
  level: z.union([z.literal(2), z.literal(3)]).default(2),
  intent: z.string().default(''),
  wordTarget: z.coerce.number().int().positive().default(220),
  keyPoints: z.array(z.string()).default([]),
  subheadings: z.array(z.string()).default([]),
});

export const outlineSchema = z.object({
  h1: z.string().min(1),
  sections: z.array(outlineSectionSchema).min(1),
  faq: z.array(z.object({ question: z.string(), answer: z.string() })).default([]),
});
export type Outline = z.infer<typeof outlineSchema>;

export const factsSchema = z.object({
  flagged: z
    .array(
      z.object({
        claim: z.string(),
        severity: z.enum(['low', 'medium', 'high']).default('medium'),
        fix: z.string().default(''),
      }),
    )
    .default([]),
  verdict: z.enum(['pass', 'pass_with_edits', 'fail']).default('pass'),
});
export type FactsReview = z.infer<typeof factsSchema>;

export const seoMetaSchema = z.object({
  metaTitle: z.string().default(''),
  metaDescription: z.string().default(''),
  focusKeyword: z.string().default(''),
  slug: z.string().default(''),
  excerpt: z.string().default(''),
  imageAlts: z.array(z.string()).default([]),
  keywordPlacementNotes: z.array(z.string()).default([]),
});
export type SeoMeta = z.infer<typeof seoMetaSchema>;

export const linkPicksSchema = z.object({
  links: z
    .array(
      z.object({
        url: z.string(),
        anchor: z.string(),
        sectionIndex: z.coerce.number().int().min(0).default(0),
        reason: z.string().default(''),
      }),
    )
    .default([]),
});
export type LinkPicks = z.infer<typeof linkPicksSchema>;

export const polishSchema = z.object({
  intro: z.string().default(''),
  conclusion: z.string().default(''),
  transitions: z.array(z.string()).default([]),
  titleSuggestion: z.string().default(''),
});
export type Polish = z.infer<typeof polishSchema>;

export type StageLog = {
  stage: string;
  tier: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  ms: number;
  ok: boolean;
  note?: string;
};

export type SwarmProgress = (event: { stage: string; message: string; pct: number }) => void;
