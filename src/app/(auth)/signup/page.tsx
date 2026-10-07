import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { AuthForm } from '@/components/app/auth-form';

// Reads the session cookie, so this segment is never prerendered.
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Create an account — Swarm Writer' };

export default async function SignupPage() {
  if (await getSessionUser()) redirect('/dashboard');

  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Create your account</h1>
      <p className="mt-1.5 text-sm muted">
        Already have one?{' '}
        <Link href="/login" className="font-medium text-swarm-600 hover:underline dark:text-swarm-400">
          Sign in
        </Link>
      </p>
      <p className="mt-4 rounded-lg border border-signal-500/30 bg-signal-500/[0.08] px-3.5 py-2.5 text-sm">
        You start with <strong>5 credits</strong> — five articles, or one taken all the way to a live post.
      </p>

      <AuthForm mode="signup" demo={null} />
    </>
  );
}
