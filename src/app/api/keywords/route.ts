import { z } from 'zod';
import { boot, readQuery } from '@/lib/api';
import { requireUser } from '@/lib/auth/session';
import { listKeywords } from '@/lib/services/keywords';
import { listClusters } from '@/lib/services/clustering';
import { handleError, ok } from '@/lib/utils/result';

const query = z.object({
  siteId: z.string().min(1, 'siteId is required.'),
  status: z.enum(['new', 'selected', 'planned', 'rejected']).optional(),
  clusterId: z.string().optional(),
});

export async function GET(req: Request) {
  try {
    await boot();
    const user = await requireUser();
    const { siteId, status, clusterId } = readQuery(req, query);
    const [keywords, clusters] = await Promise.all([
      listKeywords(user.id, siteId, { status, clusterId }),
      listClusters(user.id, siteId),
    ]);
    return ok({ keywords, clusters });
  } catch (e) {
    return handleError(e);
  }
}
