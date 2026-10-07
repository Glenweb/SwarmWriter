'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Field } from '@/components/ui';
import { api, errorMessage } from '@/lib/client';

export function AuthForm({
  mode,
  demo,
}: {
  mode: 'login' | 'signup';
  /** Shown only when running on the embedded database, i.e. local dev. */
  demo: { email: string; password: string } | null;
}) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'signup') {
        await api.post('/api/auth/signup', { email, password, name: name || undefined });
      } else {
        await api.post('/api/auth/login', { email, password });
      }
      // Full navigation so the server components pick up the new session cookie.
      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  function useDemo() {
    if (!demo) return;
    setEmail(demo.email);
    setPassword(demo.password);
  }

  return (
    <form onSubmit={submit} className="mt-7 space-y-4">
      {error ? <Alert tone="error">{error}</Alert> : null}

      {mode === 'signup' ? (
        <Field label="Name" hint="Optional — used as the author name on schema.">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Glen" />
        </Field>
      ) : null}

      <Field label="Email">
        <input
          className="input"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          placeholder="you@company.com"
        />
      </Field>

      <Field label="Password" hint={mode === 'signup' ? 'At least 8 characters.' : undefined}>
        <input
          className="input"
          type="password"
          required
          minLength={mode === 'signup' ? 8 : 1}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          placeholder="••••••••"
        />
      </Field>

      <Button type="submit" loading={busy} className="w-full py-2.5">
        {mode === 'signup' ? 'Create account' : 'Sign in'}
      </Button>

      {demo ? (
        <div className="rounded-lg border px-3.5 py-3 text-xs">
          <p className="font-semibold">Demo workspace seeded</p>
          <p className="mt-1 muted">
            <code className="font-mono">{demo.email}</code> / <code className="font-mono">{demo.password}</code>
          </p>
          <button type="button" onClick={useDemo} className="mt-2 font-semibold text-swarm-600 hover:underline dark:text-swarm-400">
            Fill these in
          </button>
        </div>
      ) : null}
    </form>
  );
}
