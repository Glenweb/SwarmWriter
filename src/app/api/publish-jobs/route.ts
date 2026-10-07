import { z } from 'zod';
import { boot, readQuery } from '@/lib/api';
import { requireUser } from '@/lib/auth/session';
import { listJobs } from '@/lib/services/publish';
import { handleError, ok } from '@/lib/utils/result';

const query = z.object({
  siteId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

/** Calendar feed. */
export async function GET(req: Request) {
  try {
    await boot();
    const user = await requireUser();
    const { siteId, from, to } = readQuery(req, query);
    const jobs = await listJobs(user.id, {
      siteId,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    });
    return ok({ jobs });
  } catch (e) {
    return handleError(e);
  }
}
