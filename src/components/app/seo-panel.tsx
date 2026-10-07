'use client';

import { AlertTriangle, Check } from 'lucide-react';
import { Progress, ScoreChip } from '@/components/ui';
import type { SeoReport } from '@/lib/types';
import { formatNumber } from '@/lib/utils/format';

/**
 * The SEO score panel. Every failing signal shows the specific fix — a number
 * on its own tells the writer nothing actionable.
 */
export function SeoPanel({ report }: { report: SeoReport | null }) {
  if (!report) {
    return <p className="px-5 py-4 text-sm muted">Not scored yet. Save the article to score it.</p>;
  }

  const failing = report.signals.filter((s) => !s.pass).sort((a, b) => b.weight - a.weight);
  const passing = report.signals.filter((s) => s.pass);
  const gradeLabel = { excellent: 'Excellent', good: 'Good', 'needs-work': 'Needs work', poor: 'Poor' }[report.grade];

  return (
    <div>
      <div className="flex items-center gap-4 border-b px-5 py-4">
        <ScoreChip score={report.score} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{gradeLabel}</p>
          <p className="text-xs muted">
            {passing.length} of {report.signals.length} signals passing
          </p>
          <div className="mt-2">
            <Progress
              value={report.score}
              tone={report.score >= 85 ? 'green' : report.score >= 70 ? 'blue' : 'amber'}
            />
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 border-b px-5 py-3.5 text-xs">
        {[
          ['Words', formatNumber(report.stats.wordCount)],
          ['Readability', `Flesch ${report.stats.readability}`],
          ['Keyword density', `${report.stats.keywordDensity}%`],
          ['Headings', `${report.stats.h2Count} H2 · ${report.stats.h3Count} H3`],
          ['Internal links', String(report.stats.internalLinks)],
          ['External links', String(report.stats.externalLinks)],
          ['Images with alt', `${report.stats.imagesWithAlt}/${report.stats.imagesTotal}`],
        ].map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-2">
            <dt className="muted">{label}</dt>
            <dd className="font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      {failing.length ? (
        <div className="border-b">
          <p className="px-5 pb-1.5 pt-3.5 text-[11px] font-bold uppercase tracking-wide muted">
            {failing.length} fix{failing.length === 1 ? '' : 'es'} available
          </p>
          <ul className="divide-y">
            {failing.map((s) => (
              <li key={s.id} className="px-5 py-3">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle
                    className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${s.earned > 0 ? 'text-warn-500' : 'text-danger-500'}`}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-baseline justify-between gap-2 text-sm font-medium">
                      {s.label}
                      <span className="shrink-0 text-xs tabular-nums muted">
                        {s.earned}/{s.weight}
                      </span>
                    </p>
                    <p className="mt-0.5 text-xs muted">{s.detail}</p>
                    {s.fix ? <p className="mt-1 text-xs font-medium text-swarm-600 dark:text-swarm-400">{s.fix}</p> : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {passing.length ? (
        <ul className="divide-y">
          {passing.map((s) => (
            <li key={s.id} className="flex items-start gap-2.5 px-5 py-2.5">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-signal-500" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="flex items-baseline justify-between gap-2 text-sm">
                  {s.label}
                  <span className="shrink-0 text-xs tabular-nums muted">{s.weight}</span>
                </p>
                <p className="text-xs muted">{s.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
