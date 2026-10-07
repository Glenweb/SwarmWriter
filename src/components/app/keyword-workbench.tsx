'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  ArrowRight, Check, Layers, Plus, Search, SlidersHorizontal, Trash2, TrendingUp, X,
} from 'lucide-react';
import {
  Alert, Button, Card, CardHeader, Disclosure, EmptyState, Field, Modal, Pill, Spinner, TableShell, Toast,
} from '@/components/ui';
import { api, errorMessage } from '@/lib/client';
import type { Cluster, ContentPlan, Keyword } from '@/lib/types';
import { formatNumber } from '@/lib/utils/format';

const INTENT_TONE: Record<string, string> = {
  transactional: 'green',
  commercial: 'blue',
  informational: 'neutral',
  navigational: 'amber',
};

export function KeywordWorkbench({
  site,
  initialKeywords,
  initialClusters,
  creditsBalance,
}: {
  site: { id: string; name: string; niche: string | null };
  initialKeywords: Keyword[];
  initialClusters: Cluster[];
  creditsBalance: number;
}) {
  const router = useRouter();
  const [keywords, setKeywords] = useState(initialKeywords);
  const [clusters, setClusters] = useState(initialClusters);
  const [view, setView] = useState<'clusters' | 'keywords'>(initialClusters.length ? 'clusters' : 'keywords');
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
  const [researchOpen, setResearchOpen] = useState(!initialKeywords.length);
  const [busy, setBusy] = useState<string | null>(null);

  // research form
  const [seedText, setSeedText] = useState(site.niche?.split(/,\s*/)[0] ?? '');
  const [limitPerSeed, setLimitPerSeed] = useState(40);
  const [withSerp, setWithSerp] = useState(5);

  // filters
  const [query, setQuery] = useState('');
  const [intentFilter, setIntentFilter] = useState<string>('all');
  const [maxDifficulty, setMaxDifficulty] = useState(100);
  const [minVolume, setMinVolume] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const seeds = useMemo(
    () => seedText.split(/[\n,]/).map((s) => s.trim()).filter(Boolean).slice(0, 10),
    [seedText],
  );
  const estimatedCredits = Math.max(1, Math.ceil((seeds.length * limitPerSeed) / 100));

  const filtered = useMemo(
    () =>
      keywords.filter(
        (k) =>
          (intentFilter === 'all' || k.intent === intentFilter) &&
          k.difficulty <= maxDifficulty &&
          k.volume >= minVolume &&
          (!query || k.keyword.includes(query.toLowerCase())),
      ),
    [keywords, intentFilter, maxDifficulty, minVolume, query],
  );

  const totals = useMemo(
    () => ({
      volume: keywords.reduce((s, k) => s + k.volume, 0),
      avgDifficulty: keywords.length ? Math.round(keywords.reduce((s, k) => s + k.difficulty, 0) / keywords.length) : 0,
      commercial: keywords.filter((k) => k.intent === 'commercial' || k.intent === 'transactional').length,
    }),
    [keywords],
  );

  async function runResearch() {
    if (!seeds.length) return;
    setBusy('research');
    try {
      const data = await api.post<{ total: number; inserted: number; creditsSpent: number; balance: number; keywords: Keyword[] }>(
        '/api/keywords/research',
        { siteId: site.id, seeds, limitPerSeed, withSerp },
      );
      setKeywords(data.keywords);
      setResearchOpen(false);
      setToast({
        message: `${data.total} keywords (${data.inserted} new) for ${data.creditsSpent} credit${data.creditsSpent === 1 ? '' : 's'}. ${data.balance} left.`,
        tone: 'success',
      });
      router.refresh();
    } catch (e) {
      setToast({ message: errorMessage(e), tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function runCluster() {
    setBusy('cluster');
    try {
      const data = await api.post<{ clusters: Cluster[]; count: number }>('/api/keywords/cluster', { siteId: site.id });
      setClusters(data.clusters);
      setKeywords(data.clusters.flatMap((c) => c.keywords));
      setView('clusters');
      setToast({ message: `Grouped into ${data.count} topic clusters.`, tone: 'success' });
    } catch (e) {
      setToast({ message: errorMessage(e), tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function setStatus(id: string, status: Keyword['status']) {
    const previous = keywords;
    setKeywords((ks) => ks.map((k) => (k.id === id ? { ...k, status } : k)));
    try {
      await api.patch(`/api/keywords/${id}`, { status });
    } catch (e) {
      setKeywords(previous); // roll the optimistic update back
      setToast({ message: errorMessage(e), tone: 'error' });
    }
  }

  async function planClusters(clusterIds: string[]) {
    setBusy('plans');
    try {
      const data = await api.post<{ plans: ContentPlan[]; count: number }>('/api/plans/generate', {
        siteId: site.id,
        clusterIds,
        maxPerCluster: 3,
      });
      setToast({
        message: data.count
          ? `${data.count} content plan${data.count === 1 ? '' : 's'} drafted. Approve them to generate.`
          : 'Those clusters already have plans.',
        tone: 'success',
      });
      if (data.count) router.push(`/plans?siteId=${site.id}`);
    } catch (e) {
      setToast({ message: errorMessage(e), tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Keywords</h1>
          <p className="mt-1 text-sm muted">
            {site.name} · {keywords.length} keywords · {formatNumber(totals.volume)} combined monthly volume
            {totals.commercial ? ` · ${totals.commercial} with buying intent` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setResearchOpen(true)}>
            <Plus className="h-4 w-4" /> Research
          </Button>
          <Button variant="outline" loading={busy === 'cluster'} disabled={!keywords.length} onClick={runCluster}>
            <Layers className="h-4 w-4" /> {clusters.length ? 'Re-cluster' : 'Cluster'}
          </Button>
          <Button
            loading={busy === 'plans'}
            disabled={!clusters.length}
            onClick={() => planClusters(clusters.slice(0, 8).map((c) => c.id))}
          >
            Build content plans <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {!keywords.length ? (
        <Card>
          <EmptyState
            icon={<Search className="h-8 w-8" />}
            title="No keywords yet"
            action={<Button onClick={() => setResearchOpen(true)}><Plus className="h-4 w-4" /> Run keyword research</Button>}
          >
            Give Swarm Writer a seed term or two. It pulls volume, CPC and difficulty, classifies intent, and
            takes SERP snapshots of the best terms for the research stage to read later.
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border p-0.5">
              {(['clusters', 'keywords'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition ${
                    view === v ? 'bg-swarm-600 text-white' : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                  }`}
                >
                  {v} {v === 'clusters' ? `(${clusters.length})` : `(${keywords.length})`}
                </button>
              ))}
            </div>

            {view === 'keywords' ? (
              <>
                <div className="relative flex-1 min-w-[180px]">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 muted" />
                  <input
                    className="input pl-8 py-1.5 text-xs"
                    placeholder="Filter keywords"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <select
                  className="input w-auto py-1.5 text-xs"
                  value={intentFilter}
                  onChange={(e) => setIntentFilter(e.target.value)}
                  aria-label="Filter by intent"
                >
                  <option value="all">All intents</option>
                  <option value="informational">Informational</option>
                  <option value="commercial">Commercial</option>
                  <option value="transactional">Transactional</option>
                  <option value="navigational">Navigational</option>
                </select>
                <label className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs">
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  KD ≤
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={maxDifficulty}
                    onChange={(e) => setMaxDifficulty(Number(e.target.value) || 100)}
                    className="w-12 bg-transparent text-right outline-none"
                  />
                </label>
                <label className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs">
                  Vol ≥
                  <input
                    type="number"
                    min={0}
                    step={100}
                    value={minVolume}
                    onChange={(e) => setMinVolume(Number(e.target.value) || 0)}
                    className="w-16 bg-transparent text-right outline-none"
                  />
                </label>
              </>
            ) : null}
          </div>

          {view === 'clusters' ? (
            clusters.length ? (
              <div className="space-y-3">
                {selected.size ? (
                  <div className="flex flex-wrap items-center gap-3 rounded-lg border border-swarm-500/35 bg-swarm-500/[0.07] px-4 py-2.5 text-sm">
                    <span className="font-semibold">{selected.size} cluster{selected.size === 1 ? '' : 's'} selected</span>
                    <Button loading={busy === 'plans'} onClick={() => planClusters([...selected])} className="text-xs">
                      Build plans for these
                    </Button>
                    <button onClick={() => setSelected(new Set())} className="text-xs muted hover:underline">
                      Clear
                    </button>
                  </div>
                ) : null}

                {clusters.map((cluster) => (
                  <Card key={cluster.id}>
                    <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                      <label className="flex min-w-0 cursor-pointer items-start gap-3">
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 shrink-0 accent-swarm-600"
                          checked={selected.has(cluster.id)}
                          onChange={() => toggle(cluster.id)}
                        />
                        <div className="min-w-0">
                          <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                            {cluster.label}
                            <Pill tone={INTENT_TONE[cluster.intent] ?? 'neutral'}>{cluster.intent}</Pill>
                          </h3>
                          <p className="mt-0.5 text-xs muted">
                            Pillar: <span className="font-medium">{cluster.pillarKeyword}</span> ·{' '}
                            {cluster.keywordCount} keyword{cluster.keywordCount === 1 ? '' : 's'}
                          </p>
                        </div>
                      </label>
                      <div className="flex shrink-0 gap-4 text-right">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wide muted">Volume</p>
                          <p className="text-sm font-bold tabular-nums">{formatNumber(cluster.totalVolume)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wide muted">Avg KD</p>
                          <p className="text-sm font-bold tabular-nums">{Math.round(cluster.avgDifficulty)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wide muted">Opportunity</p>
                          <p className="inline-flex items-center gap-1 text-sm font-bold tabular-nums text-swarm-600 dark:text-swarm-400">
                            <TrendingUp className="h-3.5 w-3.5" />
                            {Math.round(cluster.opportunity)}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="border-t">
                      <Disclosure summary={<span className="text-xs muted">Show the {cluster.keywordCount} keywords</span>}>
                        <TableShell
                          head={
                            <tr className="text-left">
                              <th className="py-2 pr-3 font-semibold">Keyword</th>
                              <th className="py-2 pr-3 text-right font-semibold">Volume</th>
                              <th className="py-2 pr-3 text-right font-semibold">KD</th>
                              <th className="py-2 pr-3 text-right font-semibold">CPC</th>
                              <th className="py-2 pr-3 font-semibold">Intent</th>
                            </tr>
                          }
                        >
                          {cluster.keywords.map((k) => (
                            <tr key={k.id} className="border-b last:border-b-0">
                              <td className="py-1.5 pr-3">{k.keyword}</td>
                              <td className="py-1.5 pr-3 text-right tabular-nums">{formatNumber(k.volume)}</td>
                              <td className="py-1.5 pr-3 text-right tabular-nums">{k.difficulty}</td>
                              <td className="py-1.5 pr-3 text-right tabular-nums">${k.cpc.toFixed(2)}</td>
                              <td className="py-1.5 pr-3">
                                <Pill tone={INTENT_TONE[k.intent] ?? 'neutral'}>{k.intent.slice(0, 4)}</Pill>
                              </td>
                            </tr>
                          ))}
                        </TableShell>
                      </Disclosure>
                    </div>
                  </Card>
                ))}
              </div>
            ) : (
              <Card>
                <EmptyState
                  icon={<Layers className="h-8 w-8" />}
                  title="Not clustered yet"
                  action={<Button loading={busy === 'cluster'} onClick={runCluster}><Layers className="h-4 w-4" /> Cluster keywords</Button>}
                >
                  Clustering groups keywords that can share one page, and nominates the highest-volume term as
                  the pillar. It runs in code, so it is instant and costs nothing.
                </EmptyState>
              </Card>
            )
          ) : (
            <Card>
              <CardHeader
                title={`${filtered.length} of ${keywords.length} keywords`}
                subtitle={`Average difficulty ${totals.avgDifficulty}. Opportunity weights volume, difficulty, CPC and intent.`}
              />
              <TableShell
                head={
                  <tr className="text-left">
                    <th className="px-5 py-2.5 font-semibold">Keyword</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Volume</th>
                    <th className="px-3 py-2.5 text-right font-semibold">KD</th>
                    <th className="px-3 py-2.5 text-right font-semibold">CPC</th>
                    <th className="px-3 py-2.5 font-semibold">Intent</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Opp.</th>
                    <th className="px-5 py-2.5 text-right font-semibold">Status</th>
                  </tr>
                }
              >
                {filtered.map((k) => (
                  <tr key={k.id} className="border-b last:border-b-0 hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
                    <td className="px-5 py-2">
                      <span className={k.status === 'rejected' ? 'line-through opacity-50' : ''}>{k.keyword}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatNumber(k.volume)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <span className={k.difficulty > 60 ? 'text-danger-500' : k.difficulty > 35 ? 'text-warn-500' : 'text-signal-600 dark:text-signal-400'}>
                        {k.difficulty}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">${k.cpc.toFixed(2)}</td>
                    <td className="px-3 py-2">
                      <Pill tone={INTENT_TONE[k.intent] ?? 'neutral'}>{k.intent}</Pill>
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{k.opportunity}</td>
                    <td className="px-5 py-2">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => setStatus(k.id, k.status === 'selected' ? 'new' : 'selected')}
                          className={`rounded p-1 transition ${
                            k.status === 'selected' ? 'bg-signal-500/15 text-signal-600' : 'hover:bg-black/[0.06] dark:hover:bg-white/10'
                          }`}
                          title="Select"
                          aria-label={`Select ${k.keyword}`}
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setStatus(k.id, k.status === 'rejected' ? 'new' : 'rejected')}
                          className={`rounded p-1 transition ${
                            k.status === 'rejected' ? 'bg-danger-500/15 text-danger-500' : 'hover:bg-black/[0.06] dark:hover:bg-white/10'
                          }`}
                          title="Reject"
                          aria-label={`Reject ${k.keyword}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </TableShell>
              {!filtered.length ? <EmptyState title="No keywords match those filters" /> : null}
            </Card>
          )}
        </>
      )}

      <Modal
        open={researchOpen}
        onClose={() => setResearchOpen(false)}
        title="Keyword research"
        footer={
          <>
            <Button variant="outline" onClick={() => setResearchOpen(false)}>Cancel</Button>
            <Button loading={busy === 'research'} disabled={!seeds.length} onClick={runResearch}>
              Research · {estimatedCredits} credit{estimatedCredits === 1 ? '' : 's'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Seed keywords" hint="One per line, or comma separated. Up to 10.">
            <textarea
              className="input h-24 resize-y font-mono text-xs"
              value={seedText}
              onChange={(e) => setSeedText(e.target.value)}
              placeholder={'carry on luggage\nchecked luggage\ntravel backpack'}
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Ideas per seed" hint="5–100.">
              <input
                type="number"
                min={5}
                max={100}
                className="input"
                value={limitPerSeed}
                onChange={(e) => setLimitPerSeed(Math.min(100, Math.max(5, Number(e.target.value) || 40)))}
              />
            </Field>
            <Field label="SERP snapshots" hint="Taken for the best terms only.">
              <input
                type="number"
                min={0}
                max={15}
                className="input"
                value={withSerp}
                onChange={(e) => setWithSerp(Math.min(15, Math.max(0, Number(e.target.value) || 0)))}
              />
            </Field>
          </div>

          <Alert tone="info">
            Billed at 1 credit per 100 unique keywords returned, charged only after the provider responds —
            a failed lookup costs nothing. You have {creditsBalance} credits.
          </Alert>

          {seeds.length ? (
            <p className="text-xs muted">
              {seeds.length} seed{seeds.length === 1 ? '' : 's'} × up to {limitPerSeed} ideas ≈{' '}
              {estimatedCredits} credit{estimatedCredits === 1 ? '' : 's'}.
            </p>
          ) : null}
        </div>
      </Modal>

      {toast ? <Toast message={toast.message} tone={toast.tone} onDone={() => setToast(null)} /> : null}
    </div>
  );
}
