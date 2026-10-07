import { z } from 'zod';
import { boot, readJson } from '@/lib/api';
import { requireUser } from '@/lib/auth/session';
import { getPlan, updatePlan } from '@/lib/services/plans';
import { handleError, ok } from '@/lib/utils/result';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    await boot();
    const user = await requireUser();
    const { id } = await params;
    return ok({ plan: await getPlan(user.id, id) });
  } catch (e) {
    return handleError(e);
  }
}

const outlineSection = z.object({
  heading: z.string().min(1),
  level: z.union([z.literal(2), z.literal(3)]).default(2),
  intent: z.string().default(''),
  wordTarget: z.number().int().positive().default(220),
  keyPoints: z.array(z.string()).default([]),
  subheadings: z.array(z.string()).optional(),
});

const patchSchema = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  angle: z.string().trim().max(600).optional(),
  targetKeyword: z.string().trim().min(2).max(160).optional(),
  secondaryKeywords: z.array(z.string()).max(20).optional(),
  wordTarget: z.number().int().min(300).max(6000).optional(),
  outline: z.array(outlineSection).optional(),
  contentType: z.enum(['guide', 'listicle', 'comparison', 'review', 'how_to', 'news']).optional(),
  priority: z.number().int().min(0).max(100).optional(),
  scheduledFor: z.string().datetime().optional(),
});

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    await boot();
    const user = await requireUser();
    const { id } = await params;
    const patch = await readJson(req, patchSchema);
    return ok({ plan: await updatePlan(user.id, id, patch) });
  } catch (e) {
    return handleError(e);
  }
}
