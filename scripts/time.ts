export function formatJstYmd(date: Date): string {
  // en-CA yields YYYY-MM-DD ordering; specify Asia/Tokyo to avoid runner locale drift.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value ?? '0000';
  const m = parts.find((p) => p.type === 'month')?.value ?? '00';
  const d = parts.find((p) => p.type === 'day')?.value ?? '00';
  return `${y}-${m}-${d}`;
}

export function getTargetDateInTz(now: Date, timeZone: string, target: 'yesterday' | 'today'): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);

  const [y, m, d] = ymd.split('-').map((v) => Number(v));
  const utcMidnight = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  if (target === 'today') return utcMidnight;
  return new Date(utcMidnight.getTime() - 24 * 60 * 60 * 1000);
}

export function getYmdInTz(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

