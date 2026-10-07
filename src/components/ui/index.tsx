'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Check, ChevronDown, Info, Loader2, X } from 'lucide-react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card ${className}`}>{children}</div>;
}

export function CardHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Button({
  variant = 'primary',
  loading = false,
  children,
  className = '',
  ...rest
}: {
  variant?: 'primary' | 'ghost' | 'outline' | 'danger';
  loading?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = { primary: 'btn-primary', ghost: 'btn-ghost', outline: 'btn-outline', danger: 'btn-danger' }[variant];
  return (
    <button {...rest} disabled={rest.disabled || loading} className={`${cls} ${className}`}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs text-danger-500">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs muted">{hint}</span>
      ) : null}
    </label>
  );
}

const TONE: Record<string, string> = {
  neutral: 'bg-black/[0.06] text-[var(--muted)] dark:bg-white/[0.08]',
  blue: 'bg-swarm-500/12 text-swarm-700 dark:text-swarm-300',
  green: 'bg-signal-500/15 text-signal-600 dark:text-signal-400',
  amber: 'bg-warn-500/15 text-warn-500',
  red: 'bg-danger-500/15 text-danger-500',
};

export function Pill({ tone = 'neutral', children }: { tone?: keyof typeof TONE | string; children: ReactNode }) {
  return <span className={`pill ${TONE[tone] ?? TONE.neutral}`}>{children}</span>;
}

/** Status pill shared by plans, articles and publish jobs. */
export function StatusPill({ status }: { status: string }) {
  const map: Record<string, { tone: string; label: string }> = {
    new: { tone: 'neutral', label: 'New' },
    selected: { tone: 'blue', label: 'Selected' },
    planned: { tone: 'blue', label: 'Planned' },
    rejected: { tone: 'red', label: 'Rejected' },
    draft: { tone: 'amber', label: 'Draft' },
    approved: { tone: 'green', label: 'Approved' },
    generated: { tone: 'blue', label: 'Generated' },
    queued: { tone: 'neutral', label: 'Queued' },
    generating: { tone: 'blue', label: 'Generating' },
    scheduled: { tone: 'blue', label: 'Scheduled' },
    published: { tone: 'green', label: 'Published' },
    failed: { tone: 'red', label: 'Failed' },
    pending: { tone: 'amber', label: 'Pending' },
    running: { tone: 'blue', label: 'Running' },
    cancelled: { tone: 'neutral', label: 'Cancelled' },
    connected: { tone: 'green', label: 'Connected' },
    error: { tone: 'red', label: 'Error' },
  };
  const entry = map[status] ?? { tone: 'neutral', label: status };
  return <Pill tone={entry.tone}>{entry.label}</Pill>;
}

/** 0–100 score chip. Colour carries the same thresholds as the SEO grade. */
export function ScoreChip({ score, size = 'md' }: { score: number; size?: 'sm' | 'md' | 'lg' }) {
  const tone =
    score >= 85 ? 'text-signal-600 dark:text-signal-400 bg-signal-500/12'
    : score >= 70 ? 'text-swarm-700 dark:text-swarm-300 bg-swarm-500/12'
    : score >= 50 ? 'text-warn-500 bg-warn-500/15'
    : 'text-danger-500 bg-danger-500/15';
  const dims = { sm: 'h-7 w-7 text-[11px]', md: 'h-9 w-9 text-xs', lg: 'h-14 w-14 text-lg' }[size];
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold tabular-nums ${tone} ${dims}`}
      title={`SEO score ${score}/100`}
    >
      {score}
    </span>
  );
}

export function Alert({
  tone = 'info',
  title,
  children,
  onDismiss,
}: {
  tone?: 'info' | 'success' | 'warn' | 'error';
  title?: string;
  children?: ReactNode;
  onDismiss?: () => void;
}) {
  const style = {
    info: { cls: 'border-swarm-500/30 bg-swarm-500/[0.07]', Icon: Info },
    success: { cls: 'border-signal-500/30 bg-signal-500/[0.08]', Icon: Check },
    warn: { cls: 'border-warn-500/35 bg-warn-500/[0.09]', Icon: AlertTriangle },
    error: { cls: 'border-danger-500/35 bg-danger-500/[0.08]', Icon: AlertTriangle },
  }[tone];
  return (
    <div className={`flex gap-3 rounded-lg border px-4 py-3 text-sm ${style.cls}`} role={tone === 'error' ? 'alert' : undefined}>
      <style.Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={title ? 'mt-1 muted' : ''}>{children}</div> : null}
      </div>
      {onDismiss ? (
        <button onClick={onDismiss} className="shrink-0 rounded p-0.5 hover:bg-black/10 dark:hover:bg-white/10" aria-label="Dismiss">
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon ? <div className="mb-3 muted">{icon}</div> : null}
      <p className="text-sm font-semibold">{title}</p>
      {children ? <p className="mt-1 max-w-md text-sm muted">{children}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm muted">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      {label}
    </span>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'good' | 'warn' | 'bad';
}) {
  const valueTone =
    tone === 'good' ? 'text-signal-600 dark:text-signal-400'
    : tone === 'warn' ? 'text-warn-500'
    : tone === 'bad' ? 'text-danger-500'
    : '';
  return (
    <div className="card px-4 py-3.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide muted">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums tracking-tight ${valueTone}`}>{value}</p>
      {sub ? <p className="mt-0.5 text-xs muted">{sub}</p> : null}
    </div>
  );
}

export function Progress({ value, tone = 'blue' }: { value: number; tone?: 'blue' | 'green' | 'amber' }) {
  const bar = { blue: 'bg-swarm-500', green: 'bg-signal-500', amber: 'bg-warn-500' }[tone];
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/[0.08] dark:bg-white/[0.1]">
      <div
        className={`h-full rounded-full transition-all duration-500 ${bar}`}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-4 sm:items-center">
      <div
        className="absolute inset-0"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative z-10 w-full animate-fade-up card ${wide ? 'max-w-3xl' : 'max-w-lg'}`}
      >
        <div className="flex items-center justify-between border-b px-5 py-3.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-black/[0.06] dark:hover:bg-white/10" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer ? <div className="flex justify-end gap-2 border-t px-5 py-3.5">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Disclosure({ summary, children, defaultOpen }: { summary: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  return (
    <div className="border-b last:border-b-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left text-sm hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
        aria-expanded={open}
      >
        <span className="min-w-0">{summary}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open ? <div className="px-5 pb-4">{children}</div> : null}
    </div>
  );
}

/** Lightweight toast. Renders fixed, bottom-right, auto-dismissing. */
export function Toast({ message, tone = 'info', onDone }: { message: string; tone?: 'info' | 'success' | 'error'; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, tone === 'error' ? 7000 : 3800);
    return () => clearTimeout(t);
  }, [onDone, tone]);
  const cls =
    tone === 'error' ? 'border-danger-500/40 bg-danger-500/[0.12]'
    : tone === 'success' ? 'border-signal-500/40 bg-signal-500/[0.12]'
    : 'border-swarm-500/40 bg-swarm-500/[0.12]';
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[60] max-w-sm animate-fade-up" role="status" aria-live="polite">
      <div className={`card pointer-events-auto flex items-start gap-2.5 border px-4 py-3 text-sm ${cls}`}>
        {tone === 'error' ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <Check className="mt-0.5 h-4 w-4 shrink-0" />}
        <span className="min-w-0">{message}</span>
      </div>
    </div>
  );
}

export function TableShell({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b text-[11px] font-semibold uppercase tracking-wide muted">{head}</thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
