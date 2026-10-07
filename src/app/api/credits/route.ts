import { boot } from '@/lib/api';
import { requireUser } from '@/lib/auth/session';
import { getBalance, ledger } from '@/lib/services/credits';
import { CREDIT_PACKS } from '@/lib/providers/stripe';
import { providerMode } from '@/lib/env';
import { handleError, ok } from '@/lib/utils/result';

export async function GET() {
  try {
    await boot();
    const user = await requireUser();
    return ok({
      balance: await getBalance(user.id),
      ledger: await ledger(user.id, 50),
      packs: CREDIT_PACKS,
      stripeMode: providerMode.stripe,
    });
  } catch (e) {
    return handleError(e);
  }
}
