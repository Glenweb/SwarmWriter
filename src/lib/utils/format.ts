/**
 * Deterministic number and date formatting.
 *
 * `toLocaleString` is not safe in a component that renders on both the server
 * and the client: Node and the browser ship different ICU data, so
 * `dateStyle: 'full'` gives "Friday 9 October 2026" on Node and
 * "Friday, 9 October 2026" in Chromium. React sees that one-character
 * difference as a hydration mismatch and throws away the server-rendered tree.
 *
 * These helpers build every string from explicit parts, so server and client
 * always agree. Dates are rendered in UTC for the same reason — the server has
 * no way to know the viewer's timezone during SSR.
 */

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const pad = (n: number) => String(n).padStart(2, '0');

/** Thousands separators without Intl. */
export function formatNumber(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '0';
  const negative = n < 0;
  const [whole, fraction] = Math.abs(n).toString().split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}${fraction ? `.${fraction}` : ''}`;
}

function toDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

/** "9 Oct 2026" */
export function formatDate(value: Date | string | number): string {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "Friday 9 October 2026" */
export function formatDateLong(value: Date | string | number): string {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return '—';
  return `${DAYS_LONG[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "October 2026" */
export function formatMonthYear(value: Date | string | number): string {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return '—';
  return `${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "09:30" */
export function formatTime(value: Date | string | number): string {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return '—';
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** "9 Oct 2026, 09:30" */
export function formatDateTime(value: Date | string | number): string {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return '—';
  return `${formatDate(d)}, ${formatTime(d)}`;
}

/** "Friday 9 October 2026 at 09:30" */
export function formatDateTimeLong(value: Date | string | number): string {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return '—';
  return `${formatDateLong(d)} at ${formatTime(d)}`;
}

/** UTC calendar-day key, used to bucket publish jobs on the calendar grid. */
export function dayKeyUtc(value: Date | string | number): string {
  const d = toDate(value);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Value for <input type="datetime-local">, in UTC so it matches what we display. */
export function toDateTimeInput(value: Date | string | number): string {
  const d = toDate(value);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** Parse that input back, interpreting it as UTC rather than browser-local. */
export function fromDateTimeInput(value: string): Date {
  return new Date(`${value}${/Z|[+-]\d{2}:\d{2}$/.test(value) ? '' : ':00Z'}`);
}
