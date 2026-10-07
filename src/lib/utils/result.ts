import { NextResponse } from 'next/server';

export type ApiError = { code: string; message: string; details?: unknown };

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, data }, { status });
}

export function fail(code: string, message: string, status = 400, details?: unknown) {
  return NextResponse.json({ ok: false, error: { code, message, details } }, { status });
}

/** Thrown by services; route handlers convert it to a clean response. */
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function handleError(e: unknown) {
  if (e instanceof AppError) return fail(e.code, e.message, e.status, e.details);
  const message = e instanceof Error ? e.message : 'Unexpected error';
  console.error('[swarm-writer]', e);
  return fail('internal_error', message, 500);
}
