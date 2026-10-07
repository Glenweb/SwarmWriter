'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Check, FileText, ListChecks, Pencil, Sparkles, X } from 'lucide-react';
import {
  Alert, Button, Card, CardHeader, EmptyState, Field, Modal, Pill, Spinner, StatusPill, Toast,
} from '@/components/ui';
import { api, errorMessage } from '@/lib/client';
import type { Article, ContentPlan, OutlineSection } from '@/lib/types';
import { formatNumber } from '@/lib/utils/format';

type Column = 'draft' | 'approved' | 'generated' | 'rejected';

const COLUMNS: Array<{ key: Column; label: string; hint: string }> = [
  { key: 'draft', label: 'Awaiting approval', hint: 'Nothing is charged until you approve' },
  { key: 'approved', label: 'Approved', hint: 'Ready to generate — 1 credit each' },
  { key: 'generated', label: 'Generated', hint: 'Article created, open to review' },
  { key: 'rejected', label: 'Rejected', hint: 'Keyword marked rejected too' },
];

export function PlanBoard({
  site,
  initialPlans,
  hasClusters,
  creditsBalance,
}: {
  site: { id: string; name: string; postCount: number; postsSynced: boolean };
  initialPlans: ContentPlan[];
  hasClusters: boolean;
  creditsBalance: number;
}) {
  const router = useRouter();
  const [plans, setPlans] = useState(initialPlans);
  const [balance, setBalance] = useState(creditsBalance);
  const [busy, setBusy] = useState<string | null>(null);
  const [generating, setGenerating] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
  const [editing, setEditing] = useState<ContentPlan | null>(null);
  const [detail, setDetail] = useState<ContentPlan | null>(null);

  const byColumn = useMemo(() => {
    const map: Record<Column, ContentPlan[]> = { draft: [], approved: [], generated: [], rejected: [] };
    for (const p of plans) map[p.status as Column]?.push(p);
    return map;
  }, [plans]);

  async function decide(plan: ContentPlan, decision: 'approved' | 'rejected' | 'draft') {
    const previous = plans;
    setPlans((ps) => ps.map((p) => (p.id === plan.id ? { ...p, status: decision } : p)));
    try {
      await api.post(`/api/plans/${plan.id}/approve`, { decision });
    } catch (e) {
      setPlans(previous);
      setToast({ message: errorMessage(e), tone: 'error' });
    }
  }

  async function approveAll() {
    setBusy('approve-all');
    const drafts = byColumn.draft;
    try {
      for (const p of drafts) await api.post(`/api/plans/${p.id}/approve`, { decision: 'approved' });
      setPlans((ps) => ps.map((p) => (p.status === 'draft' ? { ...p, status: 'approved' } : p)));
      setToast({ message: `${drafts.length} plan${drafts.length === 1 ? '' : 's'} approved.`, tone: 'success' });
    } catch (e) {
      setToast({ message: errorMessage(e), tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function generate(plan: ContentPlan) {
    if (balance < 1) {
      setToast({ message: 'No credits left. Top up on the billing page.', tone: 'error' });
      return;
    }
    setGenerating((g) => new Set(g).add(plan.id));
    try {
      const data = await api.post<{
        article: Article;
        balance: number;
        generation: { seoScore: number; costUsd: number; internalLinks: unknown[]; escalated: boolean };
      }>('/api/articles/generate', { planId: plan.id });

      setBalance(data.balance);
      setPlans((ps) => ps.map((p) => (p.id === plan.id ? { ...p, status: 'generated' } : p)));
      setToast({
        message: `"${data.article.title}" — SEO ${data.generation.seoScore}/100, ${data.generation.internalLinks.length} internal links, $${data.generation.costUsd.toFixed(4)}${data.generation.escalated ? ' (escalated to Opus)' : ''}.`,
        tone: 'success',
      });
      router.refresh();
    } catch (e) {
      setToast({ message: errorMessage(e), tone: 'error' });
    } finally {
      setGenerating((g) => {
        const next = new Set(g);
        next.delete(plan.id);
        return next;
      });
    }
  }

  async function generateAllApproved() {
    const queue = byColumn.approved;
    if (!queue.length) return;
    if (balance < queue.length) {
      setToast({ message: `That needs ${queue.length} credits and you have ${balance}.`, tone: 'error' });
      return;
    }
    setBusy('generate-all');
    for (const plan of queue) await generate(plan);
    setBusy(null);
  }

  async function savePlan(updated: ContentPlan) {
    setBusy('save');
    try {
      const data = await api.patch<{ plan: ContentPlan }>(`/api/plans/${updated.id}`, {
        title: updated.title,
        angle: updated.angle ?? undefined,
        targetKeyword: updated.targetKeyword,
        secondaryKeywords: updated.secondaryKeywords,
        wordTarget: updated.wordTarget,
        contentType: updated.contentType,
        outline: updated.outline,
      });
      setPlans((ps) => ps.map((p) => (p.id === data.plan.id ? data.plan : p)));
      setEditing(null);
      setToast({ message: 'Plan updated.', tone: 'success' });
    } catch (e) {
      setToast({ message: errorMessage(e), tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  if (!plans.length) {
    return (
      <Card>
        <EmptyState
          icon={<ListChecks className="h-8 w-8" />}
          title="No content plans yet"
          action={
            hasClusters ? (
              <Link href={`/keywords?siteId=${site.id}`} className="btn-primary">Build plans from clusters</Link>
            ) : (
              <Link href={`/keywords?siteId=${site.id}`} className="btn-primary">Research keywords first</Link>
            )
          }
        >
          A plan is the brief: title, angle, target keyword, word count and outline. You approve it before any
          credit is spent, which is what stops an automated pipeline writing things nobody wanted.
        </EmptyState>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Content plans</h1>
          <p className="mt-1 text-sm muted">
            {site.name} · {byColumn.draft.length} awaiting approval · {byColumn.approved.length} ready to
            generate · {balance} credits
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {byColumn.draft.length ? (
            <Button variant="outline" loading={busy === 'approve-all'} onClick={approveAll}>
              <Check className="h-4 w-4" /> Approve all {byColumn.draft.length}
            </Button>
          ) : null}
          {byColumn.approved.length ? (
            <Button loading={busy === 'generate-all'} onClick={generateAllApproved}>
              <Sparkles className="h-4 w-4" /> Generate {byColumn.approved.length} ({byColumn.approved.length} credits)
            </Button>
          ) : null}
        </div>
      </div>

      {!site.postsSynced ? (
        <Alert tone="warn" title="This site has no post index yet">
          Internal linking needs your existing posts. Open{' '}
          <Link href="/sites" className="font-semibold underline">Sites</Link> and run Sync posts, or articles
          will generate with no internal links.
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
        {COLUMNS.map((col) => (
          <div key={col.key} className="min-w-0">
            <div className="mb-2 flex items-baseline justify-between gap-2 px-1">
              <h2 className="text-xs font-bold uppercase tracking-wide">{col.label}</h2>
              <span className="text-xs font-semibold tabular-nums muted">{byColumn[col.key].length}</span>
            </div>
            <p className="mb-2.5 px-1 text-[11px] muted">{col.hint}</p>

            <div className="space-y-2.5">
              {byColumn[col.key].map((plan) => (
                <Card key={plan.id} className="p-3.5">
                  <button onClick={() => setDetail(plan)} className="block w-full text-left">
                    <p className="text-sm font-semibold leading-snug">{plan.title}</p>
                    <p className="mt-1 truncate text-xs muted">
                      <span className="font-medium">{plan.targetKeyword}</span>
                      {plan.estVolume ? ` · ${formatNumber(plan.estVolume)}/mo` : ''}
                      {plan.estDifficulty ? ` · KD ${plan.estDifficulty}` : ''}
                    </p>
                  </button>

                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    <Pill tone="neutral">{plan.contentType.replace('_', ' ')}</Pill>
                    <Pill tone="neutral">{formatNumber(plan.wordTarget)}w</Pill>
                    <Pill tone="neutral">{plan.outline.length} sections</Pill>
                  </div>

                  <div className="mt-3 flex items-center gap-1.5">
                    {col.key === 'draft' ? (
                      <>
                        <Button onClick={() => decide(plan, 'approved')} className="flex-1 px-2 py-1.5 text-xs">
                          <Check className="h-3.5 w-3.5" /> Approve
                        </Button>
                        <Button variant="ghost" onClick={() => setEditing(plan)} className="px-2 py-1.5 text-xs" aria-label="Edit plan">
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => decide(plan, 'rejected')}
                          className="px-2 py-1.5 text-xs text-danger-500"
                          aria-label="Reject plan"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    ) : null}

                    {col.key === 'approved' ? (
                      generating.has(plan.id) ? (
                        <div className="flex-1 py-1"><Spinner label="Running the swarm…" /></div>
                      ) : (
                        <>
                          <Button onClick={() => generate(plan)} className="flex-1 px-2 py-1.5 text-xs">
                            <Sparkles className="h-3.5 w-3.5" /> Generate
                          </Button>
                          <Button variant="ghost" onClick={() => decide(plan, 'draft')} className="px-2 py-1.5 text-xs">
                            Undo
                          </Button>
                        </>
                      )
                    ) : null}

                    {col.key === 'generated' ? (
                      <Link href={`/articles?siteId=${site.id}`} className="btn-outline flex-1 px-2 py-1.5 text-xs">
                        <FileText className="h-3.5 w-3.5" /> Open article
                      </Link>
                    ) : null}

                    {col.key === 'rejected' ? (
                      <Button variant="ghost" onClick={() => decide(plan, 'draft')} className="flex-1 px-2 py-1.5 text-xs">
                        Restore
                      </Button>
                    ) : null}
                  </div>
                </Card>
              ))}

              {!byColumn[col.key].length ? (
                <div className="rounded-lg border border-dashed px-3 py-6 text-center text-xs muted">Nothing here</div>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {/* Plan detail */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.title ?? ''} wide>
        {detail ? (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-2">
              <StatusPill status={detail.status} />
              <Pill tone="neutral">{detail.contentType.replace('_', ' ')}</Pill>
              <Pill tone="blue">{detail.searchIntent}</Pill>
              <Pill tone="neutral">{formatNumber(detail.wordTarget)} words</Pill>
              <Pill tone="neutral">priority {detail.priority}</Pill>
            </div>

            {detail.angle ? (
              <div>
                <p className="label">Angle</p>
                <p>{detail.angle}</p>
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <p className="label">Target keyword</p>
                <p className="font-medium">{detail.targetKeyword}</p>
                <p className="mt-0.5 text-xs muted">
                  {formatNumber(detail.estVolume)}/mo · KD {detail.estDifficulty}
                </p>
              </div>
              <div>
                <p className="label">Secondary keywords</p>
                {detail.secondaryKeywords.length ? (
                  <ul className="flex flex-wrap gap-1">
                    {detail.secondaryKeywords.map((k) => (
                      <li key={k}><Pill tone="neutral">{k}</Pill></li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs muted">None</p>
                )}
              </div>
            </div>

            <div>
              <p className="label">Outline ({detail.outline.length} sections)</p>
              <ol className="divide-y rounded-lg border">
                {detail.outline.map((s, i) => (
                  <li key={`${s.heading}-${i}`} className="px-3.5 py-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-medium">{s.heading}</p>
                      <span className="shrink-0 text-xs tabular-nums muted">{s.wordTarget}w</span>
                    </div>
                    {s.intent ? <p className="mt-0.5 text-xs muted">{s.intent}</p> : null}
                    {s.keyPoints.length ? (
                      <ul className="mt-1 list-disc pl-4 text-xs muted">
                        {s.keyPoints.map((k) => <li key={k}>{k}</li>)}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ol>
            </div>

            {detail.linkIntents.length ? (
              <div>
                <p className="label">Internal link intents</p>
                <ul className="list-disc pl-5 text-xs muted">
                  {detail.linkIntents.map((l) => <li key={l}>{l}</li>)}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      {/* Plan editor */}
      {editing ? (
        <PlanEditor
          plan={editing}
          busy={busy === 'save'}
          onCancel={() => setEditing(null)}
          onSave={savePlan}
        />
      ) : null}

      {toast ? <Toast message={toast.message} tone={toast.tone} onDone={() => setToast(null)} /> : null}
    </div>
  );
}

function PlanEditor({
  plan,
  busy,
  onCancel,
  onSave,
}: {
  plan: ContentPlan;
  busy: boolean;
  onCancel: () => void;
  onSave: (plan: ContentPlan) => void;
}) {
  const [draft, setDraft] = useState<ContentPlan>(plan);

  function setSection(index: number, patch: Partial<OutlineSection>) {
    setDraft((d) => ({
      ...d,
      outline: d.outline.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    }));
  }

  function removeSection(index: number) {
    setDraft((d) => ({ ...d, outline: d.outline.filter((_, i) => i !== index) }));
  }

  function addSection() {
    setDraft((d) => ({
      ...d,
      outline: [
        ...d.outline,
        { heading: 'New section', level: 2, intent: '', wordTarget: Math.round(d.wordTarget / (d.outline.length + 1)), keyPoints: [] },
      ],
    }));
  }

  const outlineTotal = draft.outline.reduce((s, x) => s + (x.wordTarget || 0), 0);

  return (
    <Modal
      open
      onClose={onCancel}
      title="Edit plan"
      wide
      footer={
        <>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button loading={busy} onClick={() => onSave(draft)}>Save plan</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Title">
          <input className="input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        </Field>

        <Field label="Angle" hint="The instruction that keeps this page from reading like every other result.">
          <textarea
            className="input h-20 resize-y"
            value={draft.angle ?? ''}
            onChange={(e) => setDraft({ ...draft, angle: e.target.value })}
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Target keyword">
            <input
              className="input"
              value={draft.targetKeyword}
              onChange={(e) => setDraft({ ...draft, targetKeyword: e.target.value })}
            />
          </Field>
          <Field label="Content type">
            <select
              className="input"
              value={draft.contentType}
              onChange={(e) => setDraft({ ...draft, contentType: e.target.value })}
            >
              {['guide', 'listicle', 'comparison', 'review', 'how_to', 'news'].map((t) => (
                <option key={t} value={t}>{t.replace('_', ' ')}</option>
              ))}
            </select>
          </Field>
          <Field label="Word target" hint={`Outline sums to ${formatNumber(outlineTotal)}`}>
            <input
              type="number"
              min={300}
              max={6000}
              step={100}
              className="input"
              value={draft.wordTarget}
              onChange={(e) => setDraft({ ...draft, wordTarget: Number(e.target.value) || 1800 })}
            />
          </Field>
        </div>

        <Field label="Secondary keywords" hint="Comma separated.">
          <input
            className="input"
            value={draft.secondaryKeywords.join(', ')}
            onChange={(e) =>
              setDraft({ ...draft, secondaryKeywords: e.target.value.split(/\s*,\s*/).filter(Boolean) })
            }
          />
        </Field>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="label mb-0">Outline</span>
            <button onClick={addSection} className="text-xs font-semibold text-swarm-600 hover:underline dark:text-swarm-400">
              + Add section
            </button>
          </div>
          <ol className="space-y-2">
            {draft.outline.map((s, i) => (
              <li key={i} className="flex items-start gap-2 rounded-lg border px-3 py-2">
                <span className="mt-2 text-xs font-bold tabular-nums muted">{i + 1}</span>
                <div className="flex-1 space-y-1.5">
                  <input
                    className="input py-1.5 text-sm"
                    value={s.heading}
                    onChange={(e) => setSection(i, { heading: e.target.value })}
                    placeholder="Heading"
                  />
                  <div className="flex gap-1.5">
                    <input
                      className="input flex-1 py-1 text-xs"
                      value={s.intent}
                      onChange={(e) => setSection(i, { intent: e.target.value })}
                      placeholder="What this section is for"
                    />
                    <input
                      type="number"
                      className="input w-20 py-1 text-xs"
                      value={s.wordTarget}
                      onChange={(e) => setSection(i, { wordTarget: Number(e.target.value) || 200 })}
                      aria-label="Word target for this section"
                    />
                  </div>
                </div>
                <button
                  onClick={() => removeSection(i)}
                  className="mt-1.5 rounded p-1 text-danger-500 hover:bg-danger-500/10"
                  aria-label={`Remove section ${i + 1}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </Modal>
  );
}
