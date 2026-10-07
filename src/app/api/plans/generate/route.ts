import { z } from 'zod';
import { boot, readJson } from '@/lib/api';
import { requireUser } from '@/lib/auth/session';
import { generatePlans } from '@/lib/services/plans';
import { handleError, ok } from '@/lib/utils/result';

const schema = z.object({
  siteId: z.string().min(1),
  clusterIds: z.array(z.string()).optional(),
  maxPerCluster: z.number().int().min(1).max(10).optional(),
});

/** Free. Plans are drafts until a human approves them. */
export async function POST(req: Request) {
  try {
    await boot();
    const user = await requireUser();
    const input = await readJson(req, schema);
    const plans = await generatePlans(user.id, input);
    return ok({ plans, count: plans.length }, 201);
  } catch (e) {
    return handleError(e);
  }
}
