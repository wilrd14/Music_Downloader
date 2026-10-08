export function formatDuration(sec: number | null): string {
  if (sec == null || !isFinite(sec) || sec < 0) return '--:--';
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Normalizes a progress value to an integer percentage. Accepts 0..1 or 0..100. */
export function toPercent(p: number): number {
  if (!isFinite(p)) return 0;
  const v = p <= 1 ? p * 100 : p;
  return Math.max(0, Math.min(100, Math.round(v)));
}

export function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}
