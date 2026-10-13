// Julian dates. The engine runs on TDB; the UI shows UTC.

const TDB_MINUS_UTC_S = 69.184;
const UNIX_EPOCH_JD = 2440587.5;

export function jdToDate(jd: number): Date {
  return new Date((jd - UNIX_EPOCH_JD) * 86400000 - TDB_MINUS_UTC_S * 1000);
}

export function dateToJd(d: Date): number {
  return UNIX_EPOCH_JD + (d.getTime() + TDB_MINUS_UTC_S * 1000) / 86400000;
}

const pad = (n: number, w = 2) => String(Math.trunc(n)).padStart(w, '0');

/** 2029-04-13 */
export function formatDate(jd: number): string {
  const d = jdToDate(jd);
  if (isNaN(d.getTime())) return '—';
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** 21:46 or 21:46:07 */
export function formatTime(jd: number, seconds = false): string {
  const d = jdToDate(jd);
  if (isNaN(d.getTime())) return '—';
  const base = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return seconds ? `${base}:${pad(d.getUTCSeconds())}` : base;
}

export function formatDateTime(jd: number): string {
  return `${formatDate(jd)} ${formatTime(jd)} UTC`;
}

/** Value for <input type="datetime-local"> interpreted as UTC. */
export function jdToInputValue(jd: number): string {
  const d = jdToDate(jd);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function inputValueToJd(v: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(v);
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
  return dateToJd(new Date(ms));
}

/** Parse "2029-Apr-13 21:46" (JPL CAD style) or ISO-ish dates. */
export function parseLooseDate(s: string): number | null {
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  const m = /^(\d{4})-([A-Za-z]{3})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/.exec(s.trim());
  if (m) {
    const mon = months[m[2].toLowerCase()];
    if (mon === undefined) return null;
    return dateToJd(new Date(Date.UTC(+m[1], mon, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0)));
  }
  // Sentry style: 2122-01-26.73 (fractional day)
  const f = /^(\d{4})-(\d{2})-(\d{2})(\.\d+)?$/.exec(s.trim());
  if (f) {
    const base = Date.UTC(+f[1], +f[2] - 1, +f[3]);
    const frac = f[4] ? parseFloat(f[4]) : 0;
    return dateToJd(new Date(base + frac * 86400000));
  }
  return inputValueToJd(s);
}

export const nowJd = () => dateToJd(new Date());
