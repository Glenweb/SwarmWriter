/**
 * AES-256-GCM for WordPress application passwords at rest.
 * Key is derived from AUTH_SECRET, so rotating AUTH_SECRET invalidates stored
 * credentials by design — the wizard asks the user to reconnect.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../env';

function key(): Buffer {
  return createHash('sha256').update(`${env.authSecret}::wp-credentials`).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${enc.toString('base64url')}.${tag.toString('base64url')}`;
}

export function decryptSecret(payload: string): string {
  const [version, ivB64, encB64, tagB64] = payload.split('.');
  if (version !== 'v1') throw new Error('Unsupported credential envelope');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encB64, 'base64url')), decipher.final()]).toString('utf8');
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Show the user which credential is stored without ever revealing it. */
export function maskSecret(plain: string): string {
  if (plain.length <= 4) return '••••';
  return `${'•'.repeat(Math.min(plain.length - 4, 16))}${plain.slice(-4)}`;
}
