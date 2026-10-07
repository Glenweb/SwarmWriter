'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  CalendarClock, Code2, ExternalLink, Link2, RefreshCw, Rocket, Save, Search, Sparkles,
} from 'lucide-react';
import {
  Alert, Button, Card, CardHeader, Field, Modal, Pill, StatusPill, TableShell, Toast,
} from '@/components/ui';
import { SeoPanel } from '@/components/app/seo-panel';
import { api, errorMessage } from '@/lib/client';
import type { Article, PublishJob, SeoReport, StageLog } from '@/lib/types';
import { formatDateTime, formatDateTimeLong, formatNumber, fromDateTimeInput, toDateTimeInput } from '@/lib/utils/format';

type Tab = 'content' | 'seo' | 'links' | 'schema' | 'runs';

export function ArticleEditor({
  article: initial,
  site,
  wordTarget,
  runs,
  job,
  wordpressMode,
}: {
  article: Article;
  site: { id: string; name: string; url: string; postCount: number; cadence: string; rankMathDetected: boolean };
  wordTarget: number;
  runs: StageLog[];
  job: PublishJob | null;
  wordpressMode: string;
}) {
  const router = useRouter();
  const [article, setArticle] = useState(initial);
  const [tab, setTab] = useState<Tab>('content');
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [dirty, setDirty] = useState(false);

  const [form, setForm] = useState({
    title: initial.title,
    html: initial.html,
    metaTitle: initial.metaTitle ?? '',
    metaDescription: initial.metaDescription ?? '',
    focusKeyword: initial.focusKeyword ?? '',
    slug: initial.slug,
    excerpt: initial.excerpt ?? '',
  });

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  };

  // Warn before losing unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const [scheduleAt, setScheduleAt] = useState(() =>
    toDateTimeInput(job ? new Date(job.scheduledFor) : nextSlot(site.cadence)),
  );
  const [dryRun, setDryRun] = useState(wordpressMode === 'dry-run');

  async function save() {
    setBusy('save');
    try {
      const data = await api.patch<{ article: Article }>(`/api/articles/${article.id}`, {
        title: form.title,
        html: form.html,
        metaTitle: form.metaTitle,
        metaDescription: form.metaDescription,
        focusKeyword: form.focusKeyword,
        slug: form.slug,
        excerpt: form.excerpt,
      });
      setArticle(data.article);
      setDirty(false);
      setToast({ message: `Saved. SEO score ${data.article.seoScore}/100.`, tone: 'success' });
      router.refresh();
    } catch (e) {
      setToast({ message: errorMessage(e), tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function rescore() {
    setBusy('score');
    try {
      const data = await api.post<{ seoScore: number; report: SeoReport }>(`/api/articles/${article.id}/score`);
      setArticle((a) => ({ ...a, seoScore: data.seoScore, seoReport: data.report }));
      setTab('seo');
      setToast({ message: `Re-scored: ${data.seoScore}/100.`, tone: 'success' });
    } catch (e) {
      setToast({ message: errorMessage(e), tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function relink() {
    setBusy('relink');
    try {
      const data = await api.post<{ article: Article; count: number }>(`/api/articles/${article.id}/relink`);
      setArticle(data.article);
      setForm((f) => ({ ...f, html: data.article.html }));
      setDirty(false);
      setTab('links');
      setToast({
        message: data.count
          ? `${data.count} internal link${data.count === 1 ? '' : 's'} placed into existing posts.`
          : 'No strong link candidates found. Try syncing the site posts again.',
        tone: 'success',
      });
      router.refresh();
    } catch (e) {
      setToast({ message: errorMessage(e), tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function publish(when?: string) {
    setBusy('publish');
    try {
      const data = await api.post<any>(`/api/articles/${article.id}/publish`, {
        scheduledFor: when,
        dryRun,
      });
      setPublishOpen(false);
      setScheduleOpen(false);
      if (data.mode === 'published') {
        setArticle(data.article);
        setToast({
          message: `Published to WordPress as post ${data.wpPostId}${data.dryRun ? ' (dry run — nothing written)' : ''}.`,
          tone: 'success',
        });
      } else {
        setArticle((a) => ({ ...a, status: 'scheduled' }));
        setToast({
          message: `Scheduled for ${formatDateTime(data.job.scheduledFor)}.`,
          tone: 'success',
        });
      }
      router.refresh();
    } catch (e) {
      setToast({ message: errorMessage(e), tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  const metaTitleLen = form.metaTitle.length;
  const metaDescLen = form.metaDescription.length;
  const costTotal = runs.reduce((s, r) => s + r.costUsd, 0);

  const TABS: Array<{ key: Tab; label: string; count?: number }> = [
    { key: 'content', label: 'Content' },
    { key: 'seo', label: 'SEO' },
    { key: 'links', label: 'Links', count: article.internalLinks.length },
    { key: 'schema', label: 'Schema' },
    { key: 'runs', label: 'Swarm run', count: runs.length },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <nav className="mb-1.5 text-xs muted">
            <Link href={`/articles?siteId=${site.id}`} className="hover:underline">Articles</Link>
            <span className="mx-1.5">/</span>
            <span>{site.name}</span>
          </nav>
          <h1 className="text-xl font-bold leading-tight tracking-tight">{form.title}</h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs muted">
            <StatusPill status={article.status} />
            <span>{formatNumber(article.wordCount)} words</span>
            <span>·</span>
            <span>{article.readingMinutes} min read</span>
            <span>·</span>
            <span className="tabular-nums">${Number(article.costUsd).toFixed(5)} to generate</span>
            {article.wpUrl ? (
              <>
                <span>·</span>
                <a
                  href={article.wpUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-swarm-600 hover:underline dark:text-swarm-400"
                >
                  View live <ExternalLink className="h-3 w-3" />
                </a>
              </>
            ) : null}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" loading={busy === 'relink'} onClick={relink} title="Recompute internal links against the live site">
            <Link2 className="h-4 w-4" /> Re-link
          </Button>
          <Button variant="ghost" loading={busy === 'score'} onClick={rescore}>
            <RefreshCw className="h-4 w-4" /> Re-score
          </Button>
          <Button variant="outline" loading={busy === 'save'} disabled={!dirty} onClick={save}>
            <Save className="h-4 w-4" /> {dirty ? 'Save changes' : 'Saved'}
          </Button>
          <Button variant="outline" onClick={() => setScheduleOpen(true)}>
            <CalendarClock className="h-4 w-4" /> Schedule
          </Button>
          <Button onClick={() => setPublishOpen(true)}>
            <Rocket className="h-4 w-4" /> Publish
          </Button>
        </div>
      </div>

      {article.error ? <Alert tone="error" title="Last run failed">{article.error}</Alert> : null}
      {job ? (
        <Alert tone="info" title="Scheduled">
          Queued for {formatDateTimeLong(job.scheduledFor)} (UTC).
          n8n drains the queue every 15 minutes.
        </Alert>
      ) : null}
      {!site.rankMathDetected ? (
        <Alert tone="warn" title="RankMath meta was not detected over REST on this site">
          Swarm Writer will still send the fields on publish, and the JSON-LD ships in the body either way —
          but the RankMath panel in WordPress may not pick them up until its REST fields are exposed.
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_340px]">
        {/* Main column */}
        <div className="min-w-0 space-y-5">
          <Card>
            <div className="flex gap-1 overflow-x-auto border-b px-3 py-2">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                    tab === t.key ? 'bg-swarm-600 text-white' : 'hover:bg-black/[0.05] dark:hover:bg-white/[0.07]'
                  }`}
                >
                  {t.label}
                  {t.count !== undefined ? <span className="ml-1 opacity-70">{t.count}</span> : null}
                </button>
              ))}
            </div>

            {tab === 'content' ? (
              <div className="space-y-4 px-5 py-4">
                <Field label="Title">
                  <input className="input" value={form.title} onChange={(e) => set('title', e.target.value)} />
                </Field>

                <Field label="Body (HTML)" hint="Edited HTML is published as-is. Re-score after editing.">
                  <textarea
                    className="input h-[420px] resize-y font-mono text-xs leading-5"
                    value={form.html}
                    onChange={(e) => set('html', e.target.value)}
                    spellCheck={false}
                  />
                </Field>

                <details className="rounded-lg border">
                  <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold">Preview</summary>
                  <div
                    className="prose-swarm max-w-none px-5 py-4"
                    dangerouslySetInnerHTML={{ __html: form.html }}
                  />
                </details>
              </div>
            ) : null}

            {tab === 'seo' ? (
              <div className="space-y-4 px-5 py-4">
                <Field label="Focus keyword">
                  <input className="input" value={form.focusKeyword} onChange={(e) => set('focusKeyword', e.target.value)} />
                </Field>

                <Field
                  label="Meta title"
                  hint={`${metaTitleLen} characters — target 50 to 60.`}
                  error={metaTitleLen > 60 ? `${metaTitleLen - 60} characters over; Google will truncate it.` : undefined}
                >
                  <input className="input" value={form.metaTitle} onChange={(e) => set('metaTitle', e.target.value)} />
                </Field>

                <Field
                  label="Meta description"
                  hint={`${metaDescLen} characters — target 140 to 160.`}
                  error={metaDescLen > 160 ? `${metaDescLen - 160} characters over.` : undefined}
                >
                  <textarea
                    className="input h-20 resize-y"
                    value={form.metaDescription}
                    onChange={(e) => set('metaDescription', e.target.value)}
                  />
                </Field>

                <Field label="Slug" hint={`Canonical: ${site.url.replace(/\/+$/, '')}/${form.slug}/`}>
                  <input className="input font-mono text-xs" value={form.slug} onChange={(e) => set('slug', e.target.value)} />
                </Field>

                <Field label="Excerpt">
                  <textarea className="input h-16 resize-y" value={form.excerpt} onChange={(e) => set('excerpt', e.target.value)} />
                </Field>

                {/* SERP preview — what this will actually look like */}
                <div className="rounded-lg border px-4 py-3.5">
                  <p className="label">Search result preview</p>
                  <p className="truncate text-xs text-[#4d5156] dark:text-[#9aa0a6]">
                    {site.url.replace(/^https?:\/\//, '')} › {form.slug}
                  </p>
                  <p className="mt-0.5 truncate text-lg leading-snug text-[#1a0dab] dark:text-[#8ab4f8]">
                    {form.metaTitle || form.title}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-sm text-[#4d5156] dark:text-[#bdc1c6]">
                    {form.metaDescription || form.excerpt || '—'}
                  </p>
                </div>

                <div className="rounded-lg border px-4 py-3.5">
                  <p className="label">RankMath fields written on publish</p>
                  <ul className="space-y-1 font-mono text-[11px]">
                    {[
                      ['rank_math_title', form.metaTitle || form.title],
                      ['rank_math_description', form.metaDescription],
                      ['rank_math_focus_keyword', form.focusKeyword],
                      ['rank_math_canonical_url', `${site.url.replace(/\/+$/, '')}/${form.slug}/`],
                      ['rank_math_robots', 'index, follow'],
                    ].map(([k, v]) => (
                      <li key={k} className="flex flex-wrap gap-1.5">
                        <span className="text-swarm-600 dark:text-swarm-400">{k}:</span>
                        <span className="min-w-0 flex-1 truncate muted">{v || '—'}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}

            {tab === 'links' ? (
              <div>
                <div className="border-b px-5 py-3.5">
                  <p className="text-sm">
                    {article.internalLinks.length} internal link{article.internalLinks.length === 1 ? '' : 's'} into
                    the {site.postCount} posts already on {site.name}.
                  </p>
                  <p className="mt-1 text-xs muted">
                    Candidates are ranked in code by TF-IDF similarity, cluster membership and heading match.
                    The model only picks the anchor phrase, so a link can never point at a URL that does not exist.
                  </p>
                </div>
                {article.internalLinks.length ? (
                  <TableShell
                    head={
                      <tr className="text-left">
                        <th className="px-5 py-2.5 font-semibold">Anchor</th>
                        <th className="px-3 py-2.5 font-semibold">Target</th>
                        <th className="px-3 py-2.5 text-right font-semibold">Section</th>
                        <th className="px-5 py-2.5 text-right font-semibold">Match</th>
                      </tr>
                    }
                  >
                    {article.internalLinks.map((l) => (
                      <tr key={`${l.url}-${l.anchor}`} className="border-b last:border-b-0">
                        <td className="px-5 py-2.5 font-medium">{l.anchor}</td>
                        <td className="px-3 py-2.5">
                          <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-swarm-600 hover:underline dark:text-swarm-400">
                            {l.title}
                          </a>
                          <p className="truncate font-mono text-[11px] muted">{l.url}</p>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums muted">{l.sectionIndex + 1}</td>
                        <td className="px-5 py-2.5 text-right tabular-nums">{l.score.toFixed(3)}</td>
                      </tr>
                    ))}
                  </TableShell>
                ) : (
                  <div className="px-5 py-8 text-center">
                    <p className="text-sm font-semibold">No internal links placed</p>
                    <p className="mx-auto mt-1 max-w-sm text-sm muted">
                      Either the site has no indexed posts, or none scored above the relevance floor. Syncing
                      posts then re-linking usually fixes it.
                    </p>
                    <Button variant="outline" loading={busy === 'relink'} onClick={relink} className="mt-4">
                      <Link2 className="h-4 w-4" /> Re-link now
                    </Button>
                  </div>
                )}

                {article.externalLinks.length ? (
                  <div className="border-t px-5 py-3.5">
                    <p className="label">External citations</p>
                    <ul className="space-y-1 text-xs">
                      {article.externalLinks.map((l) => (
                        <li key={l.url}>
                          <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-swarm-600 hover:underline dark:text-swarm-400">
                            {l.anchor}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}

            {tab === 'schema' ? (
              <div className="px-5 py-4">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Pill tone="green">Article</Pill>
                  {article.faq.length ? <Pill tone="green">FAQPage · {article.faq.length}</Pill> : null}
                  <Pill tone="green">BreadcrumbList</Pill>
                </div>
                <p className="mb-3 text-xs muted">
                  Emitted as a single @graph and injected into the post body as JSON-LD, so structured data
                  works even where RankMath&apos;s schema module is disabled.
                </p>
                <pre className="max-h-[460px] overflow-auto rounded-lg border bg-black/[0.03] p-3.5 font-mono text-[11px] leading-5 dark:bg-white/[0.04]">
                  {JSON.stringify(article.schema, null, 2)}
                </pre>

                {article.faq.length ? (
                  <div className="mt-4">
                    <p className="label">FAQ entries</p>
                    <ul className="divide-y rounded-lg border">
                      {article.faq.map((f) => (
                        <li key={f.question} className="px-3.5 py-2.5">
                          <p className="text-sm font-medium">{f.question}</p>
                          <p className="mt-0.5 text-xs muted">{f.answer}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}

            {tab === 'runs' ? (
              <div>
                <div className="border-b px-5 py-3.5 text-sm">
                  <p>
                    {runs.length} model call{runs.length === 1 ? '' : 's'} ·{' '}
                    <span className="tabular-nums font-semibold">${costTotal.toFixed(5)}</span> measured from real
                    token counts
                  </p>
                  <p className="mt-1 text-xs muted">
                    One row per call. This is why the cost figure on the dashboard is a measurement rather than
                    an estimate.
                  </p>
                </div>
                <TableShell
                  head={
                    <tr className="text-left">
                      <th className="px-5 py-2.5 font-semibold">Stage</th>
                      <th className="px-3 py-2.5 font-semibold">Tier</th>
                      <th className="px-3 py-2.5 text-right font-semibold">In</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Out</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Cost</th>
                      <th className="px-5 py-2.5 text-right font-semibold">Time</th>
                    </tr>
                  }
                >
                  {runs.map((r, i) => (
                    <tr key={`${r.stage}-${i}`} className="border-b last:border-b-0">
                      <td className="px-5 py-2">
                        {r.stage}
                        {r.note ? <span className="ml-1.5 text-[11px] muted">{r.note}</span> : null}
                      </td>
                      <td className="px-3 py-2">
                        <Pill tone={r.tier === 'opus' ? 'amber' : r.tier === 'sonnet' ? 'blue' : 'green'}>{r.tier}</Pill>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(r.inputTokens)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(r.outputTokens)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">${r.costUsd.toFixed(5)}</td>
                      <td className="px-5 py-2 text-right tabular-nums muted">{r.ms}ms</td>
                    </tr>
                  ))}
                </TableShell>
              </div>
            ) : null}
          </Card>
        </div>

        {/* SEO sidebar */}
        <div className="space-y-5">
          <Card>
            <CardHeader
              title="On-page score"
              subtitle={`Target ${formatNumber(wordTarget)} words`}
              actions={
                <Button variant="ghost" loading={busy === 'score'} onClick={rescore} className="text-xs">
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              }
            />
            <SeoPanel report={article.seoReport} />
          </Card>
        </div>
      </div>

      {/* Schedule */}
      <Modal
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        title="Schedule this article"
        footer={
          <>
            <Button variant="outline" onClick={() => setScheduleOpen(false)}>Cancel</Button>
            <Button loading={busy === 'publish'} onClick={() => publish(fromDateTimeInput(scheduleAt).toISOString())}>
              <CalendarClock className="h-4 w-4" /> Schedule
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field
            label="Publish at (UTC)"
            hint={`Your site publishes ${site.cadence.replace('_', ' ')}. Drained by n8n every 15 minutes.`}
          >
            <input
              type="datetime-local"
              className="input"
              value={scheduleAt}
              onChange={(e) => setScheduleAt(e.target.value)}
            />
          </Field>
          <label className="flex cursor-pointer items-start gap-2.5 text-sm">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-swarm-600" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
            <span>
              Dry run
              <span className="block text-xs muted">Records the exact payload without writing to WordPress.</span>
            </span>
          </label>
          {job ? <Alert tone="info">This replaces the existing scheduled job.</Alert> : null}
        </div>
      </Modal>

      {/* Publish now */}
      <Modal
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        title="Publish to WordPress now"
        footer={
          <>
            <Button variant="outline" onClick={() => setPublishOpen(false)}>Cancel</Button>
            <Button loading={busy === 'publish'} onClick={() => publish()}>
              <Rocket className="h-4 w-4" /> Publish now
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p>
            This creates a published post on <strong>{site.name}</strong> at{' '}
            <code className="font-mono text-xs">
              {site.url.replace(/^https?:\/\//, '')}/{form.slug}/
            </code>
            .
          </p>
          <ul className="space-y-1.5 rounded-lg border px-4 py-3 text-xs">
            <li>· RankMath title, description, focus keyword, canonical and robots are written as post meta.</li>
            <li>· JSON-LD ships inside the body.</li>
            <li>· {article.internalLinks.length} internal link{article.internalLinks.length === 1 ? '' : 's'} already placed.</li>
          </ul>
          {dirty ? <Alert tone="warn">You have unsaved edits. Save first or they will not be published.</Alert> : null}
          {article.seoScore < 70 ? (
            <Alert tone="warn" title={`SEO score is ${article.seoScore}/100`}>
              The panel lists the specific fixes. Publishing below 70 is allowed, but it is leaving points on the table.
            </Alert>
          ) : null}
          <label className="flex cursor-pointer items-start gap-2.5">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-swarm-600" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
            <span>
              Dry run
              <span className="block text-xs muted">Rehearse without writing anything to the site.</span>
            </span>
          </label>
        </div>
      </Modal>

      {toast ? <Toast message={toast.message} tone={toast.tone} onDone={() => setToast(null)} /> : null}
    </div>
  );
}

/**
 * Next sensible publishing slot: 09:30 UTC, stepped by the site's cadence.
 * UTC throughout so the editor, the calendar and the stored job all agree.
 */
function nextSlot(cadence: string): Date {
  const step = { daily: 1, '3x_week': 2, weekly: 7, biweekly: 14 }[cadence] ?? 7;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + Math.min(step, 7));
  d.setUTCHours(9, 30, 0, 0);
  return d;
}
