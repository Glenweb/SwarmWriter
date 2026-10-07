import { z } from 'zod';
import { one, sql } from '@/lib/db/client';
import { boot, readJson } from '@/lib/api';
import { hashPassword } from '@/lib/auth/password';
import { createSession, setSessionCookie } from '@/lib/auth/session';
import { newId } from '@/lib/utils/ids';
import { grant } from '@/lib/services/credits';
import { AppError, handleError, ok } from '@/lib/utils/result';

const schema = z.object({
  email: z.string().email('Enter a valid email address.'),
  password: z.string().min(8, 'Use at least 8 characters.'),
  name: z.string().trim().max(120).optional(),
});

/** New accounts get 5 free credits — enough to take one keyword to a live post. */
const WELCOME_CREDITS = 5;

export async function POST(req: Request) {
  try {
    await boot();
    const { email, password, name } = await readJson(req, schema);
    const normalised = email.trim().toLowerCase();

    const existing = await one`SELECT id FROM users WHERE email = ${normalised}`;
    if (existing) throw new AppError('email_taken', 'An account with that email already exists.', 409);

    const id = newId('usr');
    await sql`
      INSERT INTO users (id, email, name, password_hash, plan, credits_balance)
      VALUES (${id}, ${normalised}, ${name ?? null}, ${await hashPassword(password)}, 'free', 0)
    `;
    await grant({ userId: id, amount: WELCOME_CREDITS, reason: 'welcome credits' });

    const token = await createSession(id, req.headers.get('user-agent'));
    await setSessionCookie(token);

    return ok({ id, email: normalised, name: name ?? null, creditsBalance: WELCOME_CREDITS }, 201);
  } catch (e) {
    return handleError(e);
  }
}
