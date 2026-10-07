'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Play, Plus, X } from 'lucide-react';
import {
  Alert, Button, Card, CardHeader, EmptyState, Field, Modal, ScoreChip, StatusPill, Toast,
} from '@/components/ui';
import { api, errorMessage } from '@/lib/client';
import type { PublishJob } from '@/lib/types';
import {
  dayKeyUtc, formatDateTime, formatMonthYear, formatTime, fromDateTimeInput, toDateTimeInput,
} from '@/lib/utils/format';

const CADENCE_DAYS: Record<string, number> = { daily: 1, '3x_week': 2, weekly: 7, biweekly: 14 };

export function PublishCalendar({
  site,
  initialJobs,
  schedulable,
  n8n,
}: {
  site: { id: string; name: string; cadence: string };
  initialJobs: PublishJob[];
  schedulable: Array<{ id: string; title: string; seoScore: number }>;
  n8n: { baseUrl: string; secretSet: boolean; appUrl: string };
}) {
  const router = useRouter();
  const [jobs, setJobs] = useState(initialJobs);
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [moving, setMoving] = useState<PublishJob | null>(null);

  const [pickArticle, setPickArticle] = useState(schedulable[0]?.id ?? '');
  const [pickWhen, setPickWhen] = useState(() => toDateTimeInput(nextSlot(site.cadence)));
  const [moveWhen, setMoveWhen] = useState('');

  const byDay = useMemo(() => {
    const map = new Map<string, PublishJob[]>();
    for (const j of jobs) {
      const key = dayKeyUtc(j.scheduledFor);
      map.set(key, [...(map.get(key) ?? []), j]);
    }
    return map;
  }, [jobs]);

  const grid = useMemo(() => buildMonthGrid(cursor), [cursor]);

  // Resolved after mount: "today" depends on the clock, so computing it during
  // SSR would mismatch on hydration.
  const [today, setToday] = useState('');
  useEffect(() => setToday(dayKeyUtc(new Date())), []);
  const monthLabel = formatMonthYear(cursor);

  async function schedule() {
    if (!pickArticle) return;
    setBusy('add');
    try {
      const data = await api.post<{ mode: string; job: PublishJob }>(`/api/articles/${pickArticle}/publish`, {
        scheduledFor: fromDateTimeInput(pickWhen).toISOString(),
      });
      setJobs((js) => [...js.filter((j) => j.id !== data.job.id), data.job]);
      setAddOpen(false);
      setToast({ message: 'Scheduled.', tone: 'success' });
      router.refresh();
    } catch (e) {
      setToast({ message: errorMessage(e), tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function reschedule() {
    if (!moving || !moveWhen) return;
    setBusy('move');
    try {
      const data = await api.patch<{ job: PublishJob }>(`/api/publish-jobs/${moving.id}`, {
        action: 'reschedule',
        scheduledFor: fromDateTimeInput(moveWhen).toISOString(),
      });
      setJobs((js) => js.map((j) => (j.id === data.job.id ? data.job : j)));
      setMoving(null);
      setToast({ message: 'Moved.', tone: 'success' });
      router.refresh();
    } catch (e) {
      setToast({ message: errorMessage(e), tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function cancel(job: PublishJob) {
    setBusy(`cancel-${job.id}`);
    try {
      const data = await api.patch<{ job: PublishJob }>(`/api/publish-jobs/${job.id}`, { action: 'cancel' });
      setJobs((js) => js.map((j) => (j.id === data.job.id ? data.job : j)));
      setMoving(null);
      setToast({ message: 'Cancelled — the article is back to draft.', tone: 'success' });
      router.refresh();
    } catch (e) {
      setToast({ message: errorMessage(e), tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  /** Same endpoint n8n calls, so "run now" exercises the real path. */
  async function drainNow() {
    setBusy('drain');
    try {
      const data = await api.post<{ claimed: number; published: number; failed: number }>('/api/cron/publish');
      setToast({
        message: data.claimed
          ? `${data.published} published, ${data.failed} failed out of ${data.claimed} due.`
          : 'Nothing due right now.',
        tone: data.failed ? 'error' : 'success',
      });
      router.refresh();
    } catch (e) {
      setToast({ message: errorMessage(e), tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  const pending = jobs.filter((j) => j.status === 'pending');
  const failed = jobs.filter((j) => j.status === 'failed');

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Publishing calendar</h1>
          <p className="mt-1 text-sm muted">
            {site.name} · {pending.length} queued · publishing {site.cadence.replace('_', ' ')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" loading={busy === 'drain'} onClick={drainNow} title="Runs the same endpoint n8n calls">
            <Play className="h-4 w-4" /> Run queue now
          </Button>
          <Button disabled={!schedulable.length} onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" /> Schedule an article
          </Button>
        </div>
      </div>

      {failed.length ? (
        <Alert tone="error" title={`${failed.length} publish job${failed.length === 1 ? '' : 's'} failed`}>
          {failed[0].lastError ?? 'See the job below for the error.'} Jobs retry twice at 15-minute intervals
          before they are marked failed.
        </Alert>
      ) : null}

      <Card>
        <CardHeader
          title={monthLabel}
          actions={
            <>
              <Button variant="ghost" onClick={() => setCursor(addMonths(cursor, -1))} aria-label="Previous month">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="ghost" onClick={() => setCursor(startOfMonth(new Date()))} className="text-xs">
                Today
              </Button>
              <Button variant="ghost" onClick={() => setCursor(addMonths(cursor, 1))} aria-label="Next month">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </>
          }
        />

        <div className="grid grid-cols-7 border-b text-center text-[11px] font-semibold uppercase tracking-wide muted">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
            <div key={d} className="py-2">{d}</div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {grid.map((day) => {
            const key = dayKeyUtc(day.date);
            const dayJobs = byDay.get(key) ?? [];
            const isToday = key === today;
            return (
              <div
                key={key}
                className={`min-h-[96px] min-w-0 overflow-hidden border-b border-r p-1.5 ${day.inMonth ? '' : 'opacity-40'} ${
                  isToday ? 'bg-swarm-500/[0.06]' : ''
                }`}
              >
                <div className="mb-1 flex items-center justify-between px-0.5">
                  <span className={`text-xs tabular-nums ${isToday ? 'font-bold text-swarm-600 dark:text-swarm-400' : 'muted'}`}>
                    {day.date.getUTCDate()}
                  </span>
                  {dayJobs.length > 1 ? <span className="text-[10px] font-semibold muted">{dayJobs.length}</span> : null}
                </div>
                <ul className="space-y-1">
                  {dayJobs.slice(0, 3).map((j) => (
                    <li key={j.id}>
                      <button
                        onClick={() => {
                          setMoving(j);
                          setMoveWhen(toDateTimeInput(j.scheduledFor));
                        }}
                        className={`block w-full truncate rounded px-1.5 py-1 text-left text-[11px] font-medium transition hover:opacity-80 ${
                          j.status === 'published' ? 'bg-signal-500/15 text-signal-700 dark:text-signal-400'
                          : j.status === 'failed' ? 'bg-danger-500/15 text-danger-500'
                          : j.status === 'cancelled' ? 'bg-black/[0.06] line-through muted dark:bg-white/[0.08]'
                          : 'bg-swarm-500/15 text-swarm-700 dark:text-swarm-300'
                        }`}
                        title={`${j.articleTitle} — ${formatTime(j.scheduledFor)}`}
                      >
                        {formatTime(j.scheduledFor)} {j.articleTitle}
                      </button>
                    </li>
                  ))}
                  {dayJobs.length > 3 ? (
                    <li className="px-1.5 text-[10px] muted">+{dayJobs.length - 3} more</li>
                  ) : null}
                </ul>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Queue" subtitle="Oldest due first" />
          {jobs.length ? (
            <ul className="divide-y">
              {jobs.slice(0, 12).map((j) => (
                <li key={j.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <Link href={`/articles/${j.articleId}`} className="block truncate text-sm font-medium hover:underline">
                      {j.articleTitle}
                    </Link>
                    <p className="text-xs muted">
                      {formatDateTime(j.scheduledFor)}
                      {j.attempts > 0 ? ` · ${j.attempts} attempt${j.attempts === 1 ? '' : 's'}` : ''}
                      {j.dryRun ? ' · dry run' : ''}
                    </p>
                    {j.lastError ? <p className="mt-0.5 text-xs text-danger-500">{j.lastError}</p> : null}
                  </div>
                  <StatusPill status={j.status} />
                  {j.status === 'pending' || j.status === 'failed' ? (
                    <Button
                      variant="ghost"
                      loading={busy === `cancel-${j.id}`}
                      onClick={() => cancel(j)}
                      className="px-1.5 py-1 text-danger-500"
                      aria-label="Cancel job"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={<CalendarDays className="h-8 w-8" />}
              title="Nothing scheduled"
              action={
                schedulable.length ? (
                  <Button onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Schedule an article</Button>
                ) : (
                  <Link href={`/plans?siteId=${site.id}`} className="btn-primary">Generate an article first</Link>
                )
              }
            >
              Scheduled jobs appear here and on the calendar above.
            </EmptyState>
          )}
        </Card>

        <Card>
          <CardHeader title="Automation" subtitle="How the queue gets drained in production" />
          <div className="space-y-3 px-5 py-4 text-sm">
            <p className="break-words muted">
              n8n at <code className="font-mono text-xs">{n8n.baseUrl.replace(/^https?:\/\//, '')}</code> calls the
              publish endpoint every 15 minutes. The endpoint claims each job with a conditional update, so two
              overlapping runs can never publish the same article twice.
            </p>
            <div className="overflow-x-auto rounded-lg border px-3.5 py-3 font-mono text-[11px] leading-5">
              <p className="whitespace-nowrap muted">POST {n8n.appUrl}/api/cron/publish</p>
              <p className="whitespace-nowrap muted">Authorization: Bearer $CRON_SECRET</p>
            </div>
            {n8n.secretSet ? (
              <Alert tone="success">CRON_SECRET is set, so the endpoint is authenticated.</Alert>
            ) : (
              <Alert tone="warn" title="CRON_SECRET is not set">
                The cron endpoints only accept localhost calls until you set it. Add it to your environment and
                to the n8n credential before going live.
              </Alert>
            )}
            <p className="text-xs muted">
              Importable workflows ship in <code className="font-mono">n8n/swarm-writer-workflows.json</code>.
            </p>
          </div>
        </Card>
      </div>

      {/* Schedule modal */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Schedule an article"
        footer={
          <>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button loading={busy === 'add'} disabled={!pickArticle} onClick={schedule}>Schedule</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Article" hint="Only drafts without a pending job are listed.">
            <select className="input" value={pickArticle} onChange={(e) => setPickArticle(e.target.value)}>
              {schedulable.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title} — SEO {a.seoScore}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Publish at (UTC)">
            <input type="datetime-local" className="input" value={pickWhen} onChange={(e) => setPickWhen(e.target.value)} />
          </Field>
          {(() => {
            const chosen = schedulable.find((a) => a.id === pickArticle);
            return chosen && chosen.seoScore < 70 ? (
              <Alert tone="warn">
                That article scores {chosen.seoScore}/100. Worth opening the editor and clearing the fixes first.
              </Alert>
            ) : null;
          })()}
        </div>
      </Modal>

      {/* Move / cancel modal */}
      <Modal
        open={!!moving}
        onClose={() => setMoving(null)}
        title={moving?.articleTitle ?? ''}
        footer={
          moving && (moving.status === 'pending' || moving.status === 'failed') ? (
            <>
              <Button variant="danger" loading={busy === `cancel-${moving.id}`} onClick={() => cancel(moving)}>
                Cancel job
              </Button>
              <Button loading={busy === 'move'} onClick={reschedule}>Move</Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => setMoving(null)}>Close</Button>
          )
        }
      >
        {moving ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <StatusPill status={moving.status} />
              <ScoreChip score={moving.articleSeoScore ?? 0} size="sm" />
              <Link href={`/articles/${moving.articleId}`} className="text-xs font-semibold text-swarm-600 hover:underline dark:text-swarm-400">
                Open in editor
              </Link>
            </div>

            {moving.status === 'published' ? (
              <Alert tone="success" title="Published">
                WordPress post {moving.wpPostId}.{' '}
                {moving.wpUrl ? (
                  <a href={moving.wpUrl} target="_blank" rel="noopener noreferrer" className="font-semibold underline">
                    View live
                  </a>
                ) : null}
              </Alert>
            ) : null}

            {moving.lastError ? <Alert tone="error" title="Last error">{moving.lastError}</Alert> : null}

            {moving.status === 'pending' || moving.status === 'failed' ? (
              <Field label="Move to (UTC)">
                <input type="datetime-local" className="input" value={moveWhen} onChange={(e) => setMoveWhen(e.target.value)} />
              </Field>
            ) : null}
          </div>
        ) : null}
      </Modal>

      {toast ? <Toast message={toast.message} tone={toast.tone} onDone={() => setToast(null)} /> : null}
    </div>
  );
}

/**
 * The whole calendar works in UTC.
 *
 * The grid is rendered on the server and hydrated on the client, so any
 * local-time arithmetic would put a job in a different cell on each side and
 * break hydration. UTC is the one frame both agree on, and publish times are
 * stored in UTC anyway.
 */
function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}

/** Monday-first grid covering the whole month. */
function buildMonthGrid(monthStart: Date): Array<{ date: Date; inMonth: boolean }> {
  const offset = (monthStart.getUTCDay() + 6) % 7; // Monday = 0
  const start = new Date(monthStart);
  start.setUTCDate(monthStart.getUTCDate() - offset);

  const cells: Array<{ date: Date; inMonth: boolean }> = [];
  for (let i = 0; i < 42; i++) {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + i);
    cells.push({ date, inMonth: date.getUTCMonth() === monthStart.getUTCMonth() });
    // Stop after the week that completes the month.
    if (i >= 27 && date.getUTCMonth() !== monthStart.getUTCMonth() && date.getUTCDay() === 0) break;
  }
  return cells;
}

function nextSlot(cadence: string): Date {
  const step = CADENCE_DAYS[cadence] ?? 7;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + Math.min(step, 7));
  d.setUTCHours(9, 30, 0, 0);
  return d;
}
