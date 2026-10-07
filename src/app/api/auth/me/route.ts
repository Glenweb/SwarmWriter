import { boot } from '@/lib/api';
import { getSessionUser } from '@/lib/auth/session';
import { handleError, ok } from '@/lib/utils/result';

export async function GET() {
  try {
    await boot();
    return ok({ user: await getSessionUser() });
  } catch (e) {
    return handleError(e);
  }
}
