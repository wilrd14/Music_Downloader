import type { TrackState } from '../types';
import { toPercent } from '../lib/format';
import { AlertIcon, CheckIcon, ClockIcon, SwapIcon, Spinner } from './icons';

const LABEL: Record<TrackState['status'], string> = {
  queued: 'En cola',
  downloading: 'Descargando',
  converting: 'Convirtiendo',
  done: 'Listo',
  failed: 'Falló',
};

function StatusIcon({ status }: { status: TrackState['status'] }) {
  const cls = 'h-5 w-5 shrink-0';
  switch (status) {
    case 'done':
      return <CheckIcon className={`${cls} text-emerald-600 dark:text-emerald-400`} />;
    case 'failed':
      return <AlertIcon className={`${cls} text-rose-600 dark:text-rose-400`} />;
    case 'downloading':
      return <Spinner className={`${cls} text-violet-600 dark:text-violet-400`} />;
    case 'converting':
      return <SwapIcon className={`${cls} animate-pulse text-fuchsia-600 dark:text-fuchsia-400`} />;
    default:
      return <ClockIcon className={`${cls} text-slate-500 dark:text-slate-400`} />;
  }
}

export default function JobTrackRow({ track }: { track: TrackState }) {
  const pct = toPercent(track.progress);
  const active = track.status === 'downloading' || track.status === 'converting';
  return (
    <li className="flex items-start gap-3 rounded-xl px-2 py-2">
      <span className="mt-0.5">
        <StatusIcon status={track.status} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{track.title}</p>
        <p className="truncate text-xs text-slate-600 dark:text-slate-400">{track.artist}</p>
        {active && (
          <div
            className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
            role="progressbar"
            aria-label={`Progreso de ${track.title}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-[width] duration-300"
              style={{ width: `${track.status === 'converting' ? 100 : pct}%` }}
            />
          </div>
        )}
        {track.status === 'failed' && (
          <p className="mt-1 text-xs text-rose-700 dark:text-rose-300">
            {track.error || 'No se pudo descargar esta canción.'}
          </p>
        )}
      </div>
      <span
        className={`shrink-0 text-xs font-medium tabular-nums ${
          track.status === 'failed'
            ? 'text-rose-700 dark:text-rose-300'
            : track.status === 'done'
              ? 'text-emerald-700 dark:text-emerald-300'
              : 'text-slate-600 dark:text-slate-400'
        }`}
      >
        {track.status === 'downloading' ? `${pct}%` : LABEL[track.status]}
      </span>
    </li>
  );
}
