import { boot } from '@/lib/api';
import { clearSessionCookie } from '@/lib/auth/session';
import { handleError, ok } from '@/lib/utils/result';

export async function POST() {
  try {
    await boot();
    await clearSessionCookie();
    return ok({ loggedOut: true });
  } catch (e) {
    return handleError(e);
  }
}
