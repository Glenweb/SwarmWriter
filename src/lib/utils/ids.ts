import { randomBytes, randomUUID } from 'node:crypto';

/** Prefixed, sortable-enough id. Prefix makes logs and URLs self-describing. */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
