/**
 * Credit metering. The balance on `users` is the fast read; `usage_credits` is
 * the ledger of record. Every movement writes both, and a debit is conditional
 * on sufficient balance in SQL, so two concurrent generations cannot overdraw.
 */
import { one, sql } from '../db/client';
import { newId } from '../utils/ids';
import { AppError } from '../utils/result';

export const CREDIT_COST = {
  /** One article = one credit. */
  article: 1,
  /** Keyword research is billed per 100 keywords returned, minimum 1. */
  researchPer100: 1,
} as const;

export type LedgerEntry = {
  id: string;
  delta: number;
  reason: string;
  balanceAfter: number;
  refId: string | null;
  createdAt: string;
};

export async function getBalance(userId: string): Promise<number> {
  const row = await one`SELECT credits_balance FROM users WHERE id = ${userId}`;
  return Number(row?.credits_balance ?? 0);
}

/**
 * Atomic debit. The UPDATE only matches when the balance covers the amount,
 * so an overdraw returns zero rows rather than a negative balance.
 */
export async function debit(args: {
  userId: string;
  amount: number;
  reason: string;
  refId?: string;
}): Promise<number> {
  const { userId, amount, reason, refId } = args;
  if (amount <= 0) return getBalance(userId);

  const updated = await sql`
    UPDATE users
       SET credits_balance = credits_balance - ${amount},
           updated_at = now()
     WHERE id = ${userId} AND credits_balance >= ${amount}
    RETURNING credits_balance
  `;
  if (!updated.length) {
    const have = await getBalance(userId);
    throw new AppError(
      'insufficient_credits',
      `This needs ${amount} credit${amount === 1 ? '' : 's'} and you have ${have}. Top up on the billing page.`,
      402,
      { required: amount, balance: have },
    );
  }
  const balanceAfter = Number(updated[0].credits_balance);
  await sql`
    INSERT INTO usage_credits (id, user_id, delta, reason, balance_after, ref_id)
    VALUES (${newId('uc')}, ${userId}, ${-amount}, ${reason}, ${balanceAfter}, ${refId ?? null})
  `;
  return balanceAfter;
}

/** Idempotent on stripeSessionId — a replayed webhook grants nothing twice. */
export async function grant(args: {
  userId: string;
  amount: number;
  reason: string;
  stripeSessionId?: string;
  refId?: string;
}): Promise<{ balance: number; granted: boolean }> {
  const { userId, amount, reason, stripeSessionId, refId } = args;
  if (amount <= 0) return { balance: await getBalance(userId), granted: false };

  if (stripeSessionId) {
    const existing = await one`SELECT id FROM usage_credits WHERE stripe_session_id = ${stripeSessionId}`;
    if (existing) return { balance: await getBalance(userId), granted: false };
  }

  const updated = await sql`
    UPDATE users SET credits_balance = credits_balance + ${amount}, updated_at = now()
     WHERE id = ${userId}
    RETURNING credits_balance
  `;
  if (!updated.length) throw new AppError('not_found', 'User not found', 404);
  const balanceAfter = Number(updated[0].credits_balance);

  await sql`
    INSERT INTO usage_credits (id, user_id, delta, reason, balance_after, ref_id, stripe_session_id)
    VALUES (${newId('uc')}, ${userId}, ${amount}, ${reason}, ${balanceAfter}, ${refId ?? null}, ${stripeSessionId ?? null})
  `;
  return { balance: balanceAfter, granted: true };
}

/** Return a debit when the work it paid for failed. */
export async function refund(args: { userId: string; amount: number; reason: string; refId?: string }): Promise<number> {
  const { balance } = await grant({ ...args, reason: `refund: ${args.reason}` });
  return balance;
}

export async function ledger(userId: string, limit = 50): Promise<LedgerEntry[]> {
  const rows = await sql`
    SELECT id, delta, reason, balance_after, ref_id, created_at
      FROM usage_credits WHERE user_id = ${userId}
     ORDER BY created_at DESC LIMIT ${limit}
  `;
  return rows.map((r) => ({
    id: r.id,
    delta: Number(r.delta),
    reason: r.reason,
    balanceAfter: Number(r.balance_after),
    refId: r.ref_id,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

export function researchCost(keywordCount: number): number {
  return Math.max(1, Math.ceil(keywordCount / 100));
}
