/** Shared helpers for route handlers. */
import { z } from 'zod';
import { ensureSchema } from './db/client';
import { AppError } from './utils/result';

export async function readJson<S extends z.ZodTypeAny>(req: Request, schema: S): Promise<z.output<S>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new AppError('bad_json', 'Request body must be valid JSON.', 400);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new AppError('validation_failed', firstIssue(parsed.error), 400, parsed.error.flatten());
  }
  return parsed.data;
}

export function readQuery<S extends z.ZodTypeAny>(req: Request, schema: S): z.output<S> {
  const url = new URL(req.url);
  const raw: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    raw[k] = v;
  });
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError('validation_failed', firstIssue(parsed.error), 400, parsed.error.flatten());
  }
  return parsed.data;
}

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Invalid request.';
  const path = issue.path.join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}

/** Every handler calls this first — makes a cold start self-migrating. */
export async function boot(): Promise<void> {
  await ensureSchema();
}

/** Bearer-token gate for the n8n cron endpoints. */
export function assertCronAuth(req: Request, secret: string): void {
  if (!secret) {
    // No secret configured: allow only from the local machine, for dev.
    const host = new URL(req.url).hostname;
    if (host === 'localhost' || host === '127.0.0.1') return;
    throw new AppError('cron_unconfigured', 'CRON_SECRET is not set on this deployment.', 503);
  }
  const header = req.headers.get('authorization') ?? '';
  const provided = header.replace(/^Bearer\s+/i, '').trim() || (req.headers.get('x-cron-secret') ?? '').trim();
  if (provided !== secret) throw new AppError('unauthorized', 'Invalid cron credentials.', 401);
}
