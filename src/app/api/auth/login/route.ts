import { z } from 'zod';
import { one } from '@/lib/db/client';
import { boot, readJson } from '@/lib/api';
import { verifyPassword } from '@/lib/auth/password';
import { createSession, setSessionCookie } from '@/lib/auth/session';
import { AppError, handleError, ok } from '@/lib/utils/result';

const schema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function POST(req: Request) {
  try {
    await boot();
    const { email, password } = await readJson(req, schema);
    const user = await one`SELECT id, email, name, password_hash, credits_balance FROM users WHERE email = ${email.trim().toLowerCase()}`;
    // Same message either way — do not confirm which emails exist.
    const invalid = new AppError('invalid_credentials', 'That email and password do not match.', 401);
    if (!user) throw invalid;
    if (!(await verifyPassword(password, user.password_hash))) throw invalid;

    const token = await createSession(user.id, req.headers.get('user-agent'));
    await setSessionCookie(token);
    return ok({ id: user.id, email: user.email, name: user.name, creditsBalance: Number(user.credits_balance) });
  } catch (e) {
    return handleError(e);
  }
}
