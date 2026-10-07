import { z } from 'zod';
import { boot, readJson } from '@/lib/api';
import { requireUser } from '@/lib/auth/session';
import { generateArticle } from '@/lib/services/articles';
import { handleError, ok } from '@/lib/utils/result';

const schema = z.object({
  planId: z.string().min(1),
  forceOpus: z.boolean().optional(),
  escalateBelow: z.number().int().min(0).max(100).optional(),
});

/** Runs the 7-stage swarm. Costs 1 credit, refunded automatically on failure. */
export async function POST(req: Request) {
  try {
    await boot();
    const user = await requireUser();
    const { planId, forceOpus, escalateBelow } = await readJson(req, schema);
    const { article, output, balance } = await generateArticle(user.id, planId, { forceOpus, escalateBelow });
    return ok(
      {
        article,
        balance,
        generation: {
          seoScore: output.seoScore,
          costUsd: output.costUsd,
          tierSummary: output.tierSummary,
          stages: output.stageLogs,
          internalLinks: output.internalLinks,
          escalated: output.escalated,
          factsReview: output.factsReview,
          wordCount: output.wordCount,
        },
      },
      201,
    );
  } catch (e) {
    return handleError(e);
  }
}

// The swarm makes a dozen model calls; give it room on serverless.
export const maxDuration = 300;
