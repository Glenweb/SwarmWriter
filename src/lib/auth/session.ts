/**
 * Session handling: signed JWT in an httpOnly cookie, backed by a `sessions`
 * row so a session can be revoked server-side (logout, password change).
 */
import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';
import { env } from '../env';
import { ensureSchema, one, sql } from '../db/client';
import { newId, randomToken } from '../utils/ids';
import { sha256 } from './crypto';
import { AppError } from '../utils/result';

export const SESSION_COOKIE = 'sw_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  plan: string;
  creditsBalance: number;
};

function secret(): Uint8Array {
  return new TextEncoder().encode(env.authSecret);
}

export async function createSession(userId: string, userAgent?: string | null): Promise<string> {
  await ensureSchema();
  const raw = randomToken(32);
  const expiresAt = new Date(Date.now() + MAX_AGE_SECONDS * 1000);
  await sql`
    INSERT INTO sessions (id, user_id, token_hash, user_agent, expires_at)
    VALUES (${newId('ses')}, ${userId}, ${sha256(raw)}, ${userAgent ?? null}, ${expiresAt})
  `;
  return await new SignJWT({ sub: userId, jti: raw })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secret());
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    try {
      const { payload } = await jwtVerify(token, secret());
      const jti = String(payload.jti ?? '');
      if (jti) await sql`DELETE FROM sessions WHERE token_hash = ${sha256(jti)}`;
    } catch {
      /* already invalid — clearing the cookie is enough */
    }
  }
  store.delete(SESSION_COOKIE);
}

/** Null when there is no valid session. Never throws. */
export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    await ensureSchema();
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, secret());
    const userId = String(payload.sub ?? '');
    const jti = String(payload.jti ?? '');
    if (!userId || !jti) return null;

    const session = await one`
      SELECT id FROM sessions
      WHERE token_hash = ${sha256(jti)} AND user_id = ${userId} AND expires_at > now()
    `;
    if (!session) return null;

    const user = await one`
      SELECT id, email, name, plan, credits_balance FROM users WHERE id = ${userId}
    `;
    if (!user) return null;
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      plan: user.plan,
      creditsBalance: Number(user.credits_balance),
    };
  } catch {
    return null;
  }
}

/** Use in API routes that require a user. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AppError('unauthorized', 'Sign in to continue.', 401);
  return user;
}
