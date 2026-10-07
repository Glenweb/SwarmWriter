'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ExternalLink, KeyRound, Loader2 } from 'lucide-react';
import { Alert, Button, Card, Field } from '@/components/ui';
import { api, errorMessage } from '@/lib/client';
import type { Site, VerifyResult } from '@/lib/types';

type Step = 1 | 2 | 3;

export function ConnectWizard() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ site: Site; verify: VerifyResult | null } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [synced, setSynced] = useState<number | null>(null);

  const [form, setForm] = useState({
    name: '',
    url: '',
    wpUsername: '',
    wpAppPassword: '',
    niche: '',
    audience: '',
    tone: 'expert, direct, practical — British English',
    publishCadence: 'weekly' as 'daily' | '3x_week' | 'weekly' | 'biweekly',
    autoPublish: false,
  });

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const step1Valid = form.name.trim().length > 0 && form.url.trim().length > 3;
  const step2Valid = form.wpUsername.trim().length > 0 && form.wpAppPassword.trim().length >= 8;

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const data = await api.post<{ site: Site; verify: VerifyResult | null }>('/api/sites', {
        name: form.name.trim(),
        url: form.url.trim(),
        wpUsername: form.wpUsername.trim(),
        wpAppPassword: form.wpAppPassword.trim(),
        niche: form.niche.trim() || undefined,
        audience: form.audience.trim() || undefined,
        tone: form.tone.trim() || undefined,
        publishCadence: form.publishCadence,
        autoPublish: form.autoPublish,
      });
      setResult(data);
      setStep(3);
      // The link index is the whole point, so build it immediately.
      void syncPosts(data.site.id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function syncPosts(siteId: string) {
    setSyncing(true);
    try {
      const data = await api.post<{ count: number }>(`/api/sites/${siteId}/sync-posts`);
      setSynced(data.count);
    } catch {
      setSynced(0);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <Card className="mt-6">
      {/* Step rail */}
      <ol className="flex items-center gap-2 border-b px-5 py-3.5 text-xs">
        {(['Site', 'Credentials', 'Done'] as const).map((label, i) => {
          const n = (i + 1) as Step;
          const done = step > n;
          const active = step === n;
          return (
            <li key={label} className="flex items-center gap-2">
              <span
                className={`grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold ${
                  done ? 'bg-signal-500 text-white' : active ? 'bg-swarm-600 text-white' : 'bg-black/[0.08] dark:bg-white/[0.12]'
                }`}
              >
                {done ? <Check className="h-3 w-3" /> : n}
              </span>
              <span className={active ? 'font-semibold' : 'muted'}>{label}</span>
              {i < 2 ? <span className="mx-1 h-px w-6 bg-[var(--border)]" /> : null}
            </li>
          );
        })}
      </ol>

      <div className="space-y-4 px-5 py-5">
        {error ? <Alert tone="error" title="Could not connect" onDismiss={() => setError(null)}>{error}</Alert> : null}

        {step === 1 ? (
          <>
            <Field label="Site name" hint="For your own reference across the app.">
              <input
                className="input"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="Luggage For Travel"
                autoFocus
              />
            </Field>

            <Field label="Site URL" hint="The site root. Swarm Writer finds /wp-json itself.">
              <input
                className="input"
                value={form.url}
                onChange={(e) => set('url', e.target.value)}
                placeholder="https://luggagefortravel.com"
                inputMode="url"
              />
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Niche" hint="Shapes research and the writing brief.">
                <input
                  className="input"
                  value={form.niche}
                  onChange={(e) => set('niche', e.target.value)}
                  placeholder="travel luggage, affiliate reviews"
                />
              </Field>
              <Field label="Audience">
                <input
                  className="input"
                  value={form.audience}
                  onChange={(e) => set('audience', e.target.value)}
                  placeholder="frequent flyers choosing cabin bags"
                />
              </Field>
            </div>

            <Field label="Voice" hint="Passed to every drafting call.">
              <input className="input" value={form.tone} onChange={(e) => set('tone', e.target.value)} />
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Publishing cadence" hint="Used to space the calendar.">
                <select
                  className="input"
                  value={form.publishCadence}
                  onChange={(e) => set('publishCadence', e.target.value as typeof form.publishCadence)}
                >
                  <option value="daily">Daily</option>
                  <option value="3x_week">3× a week</option>
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Fortnightly</option>
                </select>
              </Field>
              <div className="flex items-end">
                <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-swarm-600"
                    checked={form.autoPublish}
                    onChange={(e) => set('autoPublish', e.target.checked)}
                  />
                  <span>
                    Auto-publish on schedule
                    <span className="block text-xs muted">Off means jobs wait for you to confirm.</span>
                  </span>
                </label>
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <Button disabled={!step1Valid} onClick={() => setStep(2)}>
                Next <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <div className="rounded-lg border px-4 py-3.5 text-sm">
              <p className="flex items-center gap-2 font-semibold">
                <KeyRound className="h-4 w-4" /> Generating an application password
              </p>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs muted">
                <li>In WordPress, go to <strong>Users → Profile</strong> (or Users → your account).</li>
                <li>Scroll to <strong>Application Passwords</strong>.</li>
                <li>Name it <code className="font-mono">Swarm Writer</code> and click Add.</li>
                <li>Copy the generated password — spaces are fine, they get stripped.</li>
              </ol>
              <a
                href={`${form.url.replace(/\/+$/, '')}/wp-admin/profile.php`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2.5 inline-flex items-center gap-1 text-xs font-semibold text-swarm-600 hover:underline dark:text-swarm-400"
              >
                Open your WordPress profile <ExternalLink className="h-3 w-3" />
              </a>
              <p className="mt-3 text-xs muted">
                Application passwords can be revoked individually and never expose your account password. The
                value is encrypted with AES-256-GCM before it reaches the database.
              </p>
            </div>

            <Field label="WordPress username" hint="The login name, not the display name.">
              <input
                className="input"
                value={form.wpUsername}
                onChange={(e) => set('wpUsername', e.target.value)}
                placeholder="admin"
                autoComplete="off"
                autoFocus
              />
            </Field>

            <Field label="Application password" hint="Needs Author role or above to publish.">
              <input
                className="input font-mono"
                value={form.wpAppPassword}
                onChange={(e) => set('wpAppPassword', e.target.value)}
                placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
                autoComplete="off"
                type="password"
              />
            </Field>

            <div className="flex items-center justify-between pt-1">
              <Button variant="ghost" onClick={() => setStep(1)}>
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
              <Button disabled={!step2Valid} loading={busy} onClick={connect}>
                Verify and connect
              </Button>
            </div>
          </>
        ) : null}

        {step === 3 && result ? (
          <>
            <Alert tone="success" title={`${result.site.name} is connected`}>
              {result.verify?.userName ? (
                <>
                  Authenticated as <strong>{result.verify.userName}</strong>
                  {result.verify.roles?.length ? ` (${result.verify.roles.join(', ')})` : ''}.
                </>
              ) : (
                'Credentials saved.'
              )}
            </Alert>

            <ul className="divide-y rounded-lg border text-sm">
              <li className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span>Can publish posts</span>
                {result.verify?.canPublish ? (
                  <Check className="h-4 w-4 text-signal-500" />
                ) : (
                  <span className="text-xs text-warn-500">Needs Author or above</span>
                )}
              </li>
              <li className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span>RankMath meta exposed over REST</span>
                {result.verify?.rankMathDetected ? (
                  <Check className="h-4 w-4 text-signal-500" />
                ) : (
                  <span className="text-xs text-warn-500">Not detected</span>
                )}
              </li>
              <li className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span>Existing posts indexed for internal linking</span>
                {syncing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : synced !== null ? (
                  <span className="text-xs font-semibold tabular-nums">{synced} posts</span>
                ) : (
                  <span className="text-xs muted">pending</span>
                )}
              </li>
            </ul>

            {result.verify?.warnings.length ? (
              <div className="space-y-2">
                {result.verify.warnings.map((w) => (
                  <Alert key={w} tone="warn">{w}</Alert>
                ))}
              </div>
            ) : null}

            {synced === 0 && !syncing ? (
              <Alert tone="warn" title="No existing posts found">
                Internal linking needs published posts to link into. On a brand-new site that is expected —
                re-run Sync posts from the Sites page once you have a few published.
              </Alert>
            ) : null}

            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => router.push('/sites')}>All sites</Button>
              <Button onClick={() => router.push(`/keywords?siteId=${result.site.id}`)}>
                Research keywords <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </Card>
  );
}
