import { boot } from '@/lib/api';
import { parseWebhook } from '@/lib/providers/stripe';
import { grant } from '@/lib/services/credits';
import { packById } from '@/lib/providers/stripe';
import { handleError, ok } from '@/lib/utils/result';

/**
 * Stripe fulfilment. Idempotent on the session id, so a replayed webhook — which
 * Stripe will do — grants the credits exactly once.
 */
export async function POST(req: Request) {
  try {
    await boot();
    const raw = await req.text();
    const outcome = await parseWebhook(raw, req.headers.get('stripe-signature'));
    if (outcome.kind === 'ignored') return ok({ handled: false, type: outcome.type });

    const pack = packById(outcome.packId);
    const result = await grant({
      userId: outcome.userId,
      amount: outcome.credits,
      reason: `credit pack — ${pack?.name ?? outcome.packId}`,
      stripeSessionId: outcome.sessionId,
    });
    return ok({ handled: true, granted: result.granted, balance: result.balance });
  } catch (e) {
    return handleError(e);
  }
}
