import type { RangeSpec } from '../data/stats.ts';

export { formatDuration } from '../monitor/logic.ts';

export function host(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** 99.98%, 100%, 97.4%; em dash when unknown. */
export function pct(v: number | null): string {
  if (v === null) return '—';
  if (v >= 1) return '100%';
  const p = v * 100;
  return `${p >= 99.9 ? p.toFixed(2) : p.toFixed(1)}%`;
}

export function ms(v: number | null): string {
  if (v === null) return '—';
  return v >= 10_000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v).toLocaleString('en-CA')} ms`;
}

export function relative(ts: number | null, now: number): string {
  if (ts === null) return 'never';
  const s = Math.round((now - ts) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function makeFormatters(timeZone: string) {
  const time = new Intl.DateTimeFormat('en-CA', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false });
  const dayTime = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const weekday = new Intl.DateTimeFormat('en-CA', { timeZone, weekday: 'short', day: 'numeric' });
  const day = new Intl.DateTimeFormat('en-CA', { timeZone, month: 'short', day: 'numeric' });
  const full = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const partsFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  });
  return {
    /** Local calendar parts, for snapping axis marks to whole hours/days. */
    parts: (t: number) => {
      const p = Object.fromEntries(partsFmt.formatToParts(t).map((x) => [x.type, x.value]));
      return { hour: Number(p.hour) % 24, day: Number(p.day), date: `${p.year}-${p.month}-${p.day}` };
    },
    time: (t: number) => time.format(t),
    dayTime: (t: number) => dayTime.format(t),
    day: (t: number) => day.format(t),
    full: (t: number) => full.format(t),
    /** Axis label suited to the range. */
    axis: (t: number, range: RangeSpec) =>
      range.key === '24h' ? time.format(t) : range.key === '7d' ? weekday.format(t) : day.format(t),
    /** Bucket readout: "14:35" for single checks, "Oct 3 06:00–12:00" for rollups. */
    bucket: (start: number, range: RangeSpec) => {
      if (range.key === '24h') return dayTime.format(start);
      if (range.key === '90d') return day.format(start);
      return `${dayTime.format(start)}–${time.format(start + range.bucketMs)}`;
    },
  };
}

export type Formatters = ReturnType<typeof makeFormatters>;
