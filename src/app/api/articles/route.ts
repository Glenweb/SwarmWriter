import { z } from 'zod';
import { boot, readQuery } from '@/lib/api';
import { requireUser } from '@/lib/auth/session';
import { listArticles } from '@/lib/services/articles';
import { handleError, ok } from '@/lib/utils/result';

const query = z.object({
  siteId: z.string().optional(),
  status: z.enum(['queued', 'generating', 'draft', 'scheduled', 'published', 'failed']).optional(),
});

export async function GET(req: Request) {
  try {
    await boot();
    const user = await requireUser();
    const { siteId, status } = readQuery(req, query);
    // The list view does not need article bodies; trim them off the payload.
    const articles = (await listArticles(user.id, siteId, status)).map(({ html, markdown, ...rest }) => rest);
    return ok({ articles });
  } catch (e) {
    return handleError(e);
  }
}
