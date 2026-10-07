/**
 * Stripe credit packs. One-off Checkout sessions, fulfilled by webhook.
 * With no secret key, a mock session is returned that the app fulfils locally —
 * so the billing flow is clickable on day one without a Stripe account.
 */
import { env, providerMode } from '../env';
import { newId } from '../utils/ids';

export type CreditPackId = 'starter' | 'growth' | 'agency';

export type CreditPack = {
  id: CreditPackId;
  name: string;
  credits: number;
  priceUsd: number;
  perArticleUsd: number;
  blurb: string;
  popular?: boolean;
};

export const CREDIT_PACKS: CreditPack[] = [
  {
    id: 'starter',
    name: 'Starter',
    credits: 25,
    priceUsd: 19,
    perArticleUsd: 0.76,
    blurb: 'One site, a post or two a week. Good for proving the engine on your own blog.',
  },
  {
    id: 'growth',
    name: 'Growth',
    credits: 100,
    priceUsd: 59,
    perArticleUsd: 0.59,
    blurb: 'Three sites, daily publishing. The affiliate operator tier.',
    popular: true,
  },
  {
    id: 'agency',
    name: 'Agency',
    credits: 500,
    priceUsd: 229,
    perArticleUsd: 0.46,
    blurb: 'Unlimited sites, white-label exports, priority generation queue.',
  },
];

export function packById(id: string): CreditPack | undefined {
  return CREDIT_PACKS.find((p) => p.id === id);
}

export type CheckoutSession = { id: string; url: string; mocked: boolean };

export async function createCheckoutSession(args: {
  pack: CreditPack;
  userId: string;
  email: string;
}): Promise<CheckoutSession> {
  if (providerMode.stripe === 'mock') {
    const id = `cs_mock_${newId('s').split('_')[1]}`;
    // Local fulfilment route — grants the credits and returns to billing.
    return {
      id,
      url: `${env.appUrl}/api/credits/mock-fulfil?session_id=${id}&pack=${args.pack.id}`,
      mocked: true,
    };
  }

  const { default: Stripe } = await import('stripe');
  const stripe = new Stripe(env.stripe.secretKey);
  const configuredPrice = env.stripe.prices[args.pack.id];

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: args.email,
    client_reference_id: args.userId,
    success_url: `${env.appUrl}/billing?purchase=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.appUrl}/billing?purchase=cancelled`,
    metadata: { userId: args.userId, packId: args.pack.id, credits: String(args.pack.credits) },
    line_items: [
      configuredPrice
        ? { price: configuredPrice, quantity: 1 }
        : {
            quantity: 1,
            price_data: {
              currency: 'usd',
              unit_amount: args.pack.priceUsd * 100,
              product_data: {
                name: `Swarm Writer — ${args.pack.name} (${args.pack.credits} credits)`,
                description: args.pack.blurb,
              },
            },
          },
    ],
  });

  return { id: session.id, url: session.url ?? `${env.appUrl}/billing`, mocked: false };
}

export type WebhookOutcome =
  | { kind: 'credit_grant'; userId: string; credits: number; sessionId: string; packId: string }
  | { kind: 'ignored'; type: string };

/** Verifies the signature when a webhook secret is configured. */
export async function parseWebhook(rawBody: string, signature: string | null): Promise<WebhookOutcome> {
  let event: any;
  if (env.stripe.secretKey && env.stripe.webhookSecret) {
    const { default: Stripe } = await import('stripe');
    const stripe = new Stripe(env.stripe.secretKey);
    if (!signature) throw new Error('Missing stripe-signature header');
    event = stripe.webhooks.constructEvent(rawBody, signature, env.stripe.webhookSecret);
  } else {
    event = JSON.parse(rawBody);
  }

  if (event.type !== 'checkout.session.completed') return { kind: 'ignored', type: String(event.type) };

  const session = event.data.object;
  const userId = String(session.metadata?.userId ?? session.client_reference_id ?? '');
  const credits = Number(session.metadata?.credits ?? 0);
  const packId = String(session.metadata?.packId ?? 'unknown');
  if (!userId || !credits) return { kind: 'ignored', type: 'checkout.session.completed (no metadata)' };

  return { kind: 'credit_grant', userId, credits, sessionId: String(session.id), packId };
}
