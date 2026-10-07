import { boot } from '@/lib/api';
import { requireUser } from '@/lib/auth/session';
import { getRuns } from '@/lib/services/articles';
import { handleError, ok } from '@/lib/utils/result';

/** Per-stage model + token + cost telemetry for one article. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await boot();
    const user = await requireUser();
    const { id } = await params;
    return ok({ runs: await getRuns(user.id, id) });
  } catch (e) {
    return handleError(e);
  }
}
