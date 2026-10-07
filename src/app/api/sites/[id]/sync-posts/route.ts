import { boot } from '@/lib/api';
import { requireUser } from '@/lib/auth/session';
import { syncPosts } from '@/lib/services/sites';
import { handleError, ok } from '@/lib/utils/result';

/** Rebuilds the internal-link index from the live site. Free — run it often. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await boot();
    const user = await requireUser();
    const { id } = await params;
    return ok(await syncPosts(user.id, id));
  } catch (e) {
    return handleError(e);
  }
}
