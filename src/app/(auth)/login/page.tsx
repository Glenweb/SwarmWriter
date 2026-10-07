import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { env, providerMode } from '@/lib/env';
import { AuthForm } from '@/components/app/auth-form';

// Reads the session cookie, so this segment is never prerendered.
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Sign in — Swarm Writer' };

export default async function LoginPage() {
  if (await getSessionUser()) redirect('/dashboard');

  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Sign in</h1>
      <p className="mt-1.5 text-sm muted">
        New here?{' '}
        <Link href="/signup" className="font-medium text-swarm-600 hover:underline dark:text-swarm-400">
          Create an account
        </Link>
      </p>

      <AuthForm
        mode="login"
        demo={providerMode.db === 'embedded' ? { email: env.seed.email, password: env.seed.password } : null}
      />
    </>
  );
}
