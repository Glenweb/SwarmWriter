import { boot } from '@/lib/api';
import { requireUser } from '@/lib/auth/session';
import { relink } from '@/lib/services/articles';
import { handleError, ok } from '@/lib/utils/result';

/** Free: candidates are computed in code, no model call. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await boot();
    const user = await requireUser();
    const { id } = await params;
    const { article, placed } = await relink(user.id, id);
    return ok({ article, placed, count: placed.length });
  } catch (e) {
    return handleError(e);
  }
}
