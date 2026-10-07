import { NextResponse } from 'next/server';
import { boot } from '@/lib/api';
import { requireUser } from '@/lib/auth/session';
import { grant } from '@/lib/services/credits';
import { packById } from '@/lib/providers/stripe';
import { env, providerMode } from '@/lib/env';
import { handleError, fail } from '@/lib/utils/result';

/**
 * Local stand-in for Stripe Checkout. Only reachable when no Stripe key is
 * configured, so it cannot be used to mint credits on a live deployment.
 */
export async function GET(req: Request) {
  try {
    await boot();
    if (providerMode.stripe !== 'mock') {
      return fail('not_available', 'Stripe is configured — use the real checkout.', 400);
    }
    const user = await requireUser();
    const url = new URL(req.url);
    const packId = url.searchParams.get('pack') ?? '';
    const sessionId = url.searchParams.get('session_id') ?? '';
    const pack = packById(packId);
    if (!pack) return fail('not_found', 'Unknown credit pack.', 404);

    await grant({
      userId: user.id,
      amount: pack.credits,
      reason: `credit pack — ${pack.name} (local test purchase)`,
      stripeSessionId: sessionId || undefined,
    });
    return NextResponse.redirect(`${env.appUrl}/billing?purchase=success&mock=1&credits=${pack.credits}`);
  } catch (e) {
    return handleError(e);
  }
}
