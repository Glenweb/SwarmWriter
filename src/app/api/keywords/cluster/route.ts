import { z } from 'zod';
import { boot, readJson } from '@/lib/api';
import { requireUser } from '@/lib/auth/session';
import { clusterSite } from '@/lib/services/clustering';
import { handleError, ok } from '@/lib/utils/result';

const schema = z.object({
  siteId: z.string().min(1),
  threshold: z.number().min(0.1).max(0.9).optional(),
  onlySelected: z.boolean().optional(),
});

/** Free and instant — clustering runs in code, not through a model. */
export async function POST(req: Request) {
  try {
    await boot();
    const user = await requireUser();
    const { siteId, threshold, onlySelected } = await readJson(req, schema);
    const clusters = await clusterSite(user.id, siteId, { threshold, onlySelected });
    return ok({ clusters, count: clusters.length });
  } catch (e) {
    return handleError(e);
  }
}
