import { z } from 'zod';
import { boot, readJson } from '@/lib/api';
import { requireUser } from '@/lib/auth/session';
import { research } from '@/lib/services/keywords';
import { handleError, ok } from '@/lib/utils/result';

const schema = z.object({
  siteId: z.string().min(1),
  seeds: z.array(z.string().trim().min(2)).min(1, 'Add at least one seed keyword.').max(10),
  limitPerSeed: z.number().int().min(5).max(100).optional(),
  withSerp: z.number().int().min(0).max(15).optional(),
});

/** Costs 1 credit per 100 keywords returned. Billed after the provider responds. */
export async function POST(req: Request) {
  try {
    await boot();
    const user = await requireUser();
    const input = await readJson(req, schema);
    return ok(await research(user.id, input));
  } catch (e) {
    return handleError(e);
  }
}
