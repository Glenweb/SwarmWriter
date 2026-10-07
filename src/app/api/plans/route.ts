import { z } from 'zod';
import { boot, readQuery } from '@/lib/api';
import { requireUser } from '@/lib/auth/session';
import { listPlans } from '@/lib/services/plans';
import { handleError, ok } from '@/lib/utils/result';

const query = z.object({
  siteId: z.string().min(1, 'siteId is required.'),
  status: z.enum(['draft', 'approved', 'rejected', 'generated']).optional(),
});

export async function GET(req: Request) {
  try {
    await boot();
    const user = await requireUser();
    const { siteId, status } = readQuery(req, query);
    return ok({ plans: await listPlans(user.id, siteId, status) });
  } catch (e) {
    return handleError(e);
  }
}
