import { z } from 'zod';
import { boot, readJson } from '@/lib/api';
import { requireUser } from '@/lib/auth/session';
import { createCheckoutSession, packById } from '@/lib/providers/stripe';
import { AppError, handleError, ok } from '@/lib/utils/result';

const schema = z.object({ packId: z.enum(['starter', 'growth', 'agency']) });

export async function POST(req: Request) {
  try {
    await boot();
    const user = await requireUser();
    const { packId } = await readJson(req, schema);
    const pack = packById(packId);
    if (!pack) throw new AppError('not_found', 'Unknown credit pack.', 404);
    const session = await createCheckoutSession({ pack, userId: user.id, email: user.email });
    return ok({ session, pack });
  } catch (e) {
    return handleError(e);
  }
}
