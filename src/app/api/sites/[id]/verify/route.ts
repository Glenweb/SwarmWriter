import { boot } from '@/lib/api';
import { requireUser } from '@/lib/auth/session';
import { verifySite } from '@/lib/services/sites';
import { handleError, ok } from '@/lib/utils/result';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await boot();
    const user = await requireUser();
    const { id } = await params;
    return ok({ verify: await verifySite(user.id, id) });
  } catch (e) {
    return handleError(e);
  }
}
