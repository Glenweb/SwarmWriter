/**
 * Spend share per model tier against the design target.
 * Spend share, not call count — a single Sonnet call costs as much as several
 * Haiku ones, so counting calls would flatter the mix.
 */
export function TierMixBar({
  actual,
  target,
  totalUsd,
}: {
  actual: { haiku: number; sonnet: number; opus: number };
  target: { haiku: number; sonnet: number; opus: number };
  totalUsd: number;
}) {
  const rows = [
    { key: 'haiku' as const, label: 'Haiku', colour: 'bg-signal-500' },
    { key: 'sonnet' as const, label: 'Sonnet', colour: 'bg-swarm-500' },
    { key: 'opus' as const, label: 'Opus', colour: 'bg-warn-500' },
  ];
  const hasData = totalUsd > 0;

  return (
    <div className="space-y-3">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-black/[0.08] dark:bg-white/[0.1]">
        {hasData
          ? rows.map((r) => (
              <div
                key={r.key}
                className={r.colour}
                style={{ width: `${Math.max(actual[r.key] * 100, 0)}%` }}
                title={`${r.label}: ${Math.round(actual[r.key] * 100)}% of spend`}
              />
            ))
          : null}
      </div>

      <ul className="space-y-1.5 text-xs">
        {rows.map((r) => {
          const a = actual[r.key];
          const t = target[r.key];
          const drift = a - t;
          return (
            <li key={r.key} className="flex items-center gap-2">
              <span className={`h-2 w-2 shrink-0 rounded-full ${r.colour}`} />
              <span className="flex-1">{r.label}</span>
              <span className="tabular-nums font-medium">{hasData ? `${Math.round(a * 100)}%` : '—'}</span>
              <span className="w-24 text-right tabular-nums muted">
                target {Math.round(t * 100)}%
                {hasData && Math.abs(drift) >= 0.05 ? (
                  <span className={drift > 0 ? ' text-warn-500' : ' text-signal-600 dark:text-signal-400'}>
                    {' '}
                    {drift > 0 ? '+' : ''}
                    {Math.round(drift * 100)}
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="text-xs muted">
        {hasData ? (
          <>
            ${totalUsd.toFixed(4)} spent in total. Opus is an exception path — it only runs when an article
            scores below threshold, so a low number here is the system working.
          </>
        ) : (
          <>No model spend yet. Generate an article and the real mix appears here.</>
        )}
      </p>
    </div>
  );
}
