import { useEffect, useRef } from 'react';
import type { JobState } from '../types';
import { downloadUrl } from '../api/client';
import { plural, toPercent } from '../lib/format';
import Thumb from './Thumb';
import JobTrackRow from './JobTrackRow';
import { AlertIcon, DownloadIcon, ResetIcon } from './icons';

interface Props {
  job: JobState;
  onNew: () => void;
}

function statusText(job: JobState): string {
  const total = job.tracks.length;
  const finished = job.tracks.filter((t) => t.status === 'done' || t.status === 'failed').length;
  switch (job.status) {
    case 'queued':
      return job.queuePosition != null ? `En cola · posición ${job.queuePosition}` : 'En cola';
    case 'running': {
      const current = Math.min(finished + 1, total);
      return total > 1 ? `Descargando ${current} de ${total}` : 'Descargando';
    }
    case 'done':
      return job.downloadReady ? 'Listo' : 'Preparando archivo…';
    case 'failed':
      return 'La descarga falló';
    case 'expired':
      return 'La descarga expiró';
  }
}

export default function JobProgress({ job, onNew }: Props) {
  const pct = job.status === 'done' ? 100 : toPercent(job.progress);
  const autoTriggered = useRef<string | null>(null);
  const linkRef = useRef<HTMLAnchorElement>(null);

  const ready = job.status === 'done' && job.downloadReady;
  const failedTracks = job.tracks.filter((t) => t.status === 'failed');
  const okCount = job.tracks.filter((t) => t.status === 'done').length;
  const isZip = job.kind === 'playlist';

  // Trigger the download exactly once per job.
  useEffect(() => {
    if (ready && autoTriggered.current !== job.id) {
      autoTriggered.current = job.id;
      linkRef.current?.click();
    }
  }, [ready, job.id]);

  const terminalError = job.status === 'failed' || job.status === 'expired';

  return (
    <section
      aria-labelledby="job-title"
      className="td-in overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-900/5 dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex items-center gap-4 border-b border-slate-100 bg-gradient-to-r from-violet-50 to-fuchsia-50 p-4 dark:border-slate-800 dark:from-violet-950/40 dark:to-fuchsia-950/30 sm:p-5">
        <Thumb src={job.thumbnail} className="h-14 w-14 sm:h-16 sm:w-16" />
        <div className="min-w-0 flex-1">
          <h2 id="job-title" className="line-clamp-2 text-lg font-bold leading-snug">
            {job.title}
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {job.tracks.length} {plural(job.tracks.length, 'canción', 'canciones')} &middot;{' '}
            {job.format.toUpperCase()}
          </p>
        </div>
      </div>

      <div className="space-y-4 p-4 sm:p-5">
        {!terminalError && (
          <div>
            <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
              <p className="font-semibold" role="status" aria-live="polite">
                {statusText(job)}
              </p>
              <span className="tabular-nums text-slate-600 dark:text-slate-400">{pct}%</span>
            </div>
            <div
              className="h-3 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
              role="progressbar"
              aria-label="Progreso total"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-[width] duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}

        {terminalError && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-2xl border border-rose-300 bg-rose-50 p-4 text-rose-900 dark:border-rose-500/40 dark:bg-rose-950/60 dark:text-rose-100"
          >
            <AlertIcon className="mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold">
                {job.status === 'expired' ? 'Esta descarga ha expirado' : 'No se pudo completar la descarga'}
              </p>
              <p className="text-sm">
                {job.status === 'expired'
                  ? 'Los archivos ya no están disponibles. Inicia una nueva descarga.'
                  : job.error || 'Ocurrió un error inesperado. Inténtalo de nuevo.'}
              </p>
            </div>
          </div>
        )}

        {ready && (
          <div className="td-in rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-center dark:border-emerald-500/40 dark:bg-emerald-950/40">
            <p className="mb-3 text-sm text-emerald-900 dark:text-emerald-100" role="status">
              {okCount} {plural(okCount, 'canción lista', 'canciones listas')}. Tu descarga debería iniciarse sola.
            </p>
            <a
              ref={linkRef}
              href={downloadUrl(job.id)}
              download
              className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-8 text-base font-semibold text-white shadow-lg shadow-violet-600/25 transition hover:from-violet-700 hover:to-fuchsia-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 sm:w-auto"
            >
              <DownloadIcon />
              {isZip ? 'Descargar ZIP' : 'Descargar archivo'}
            </a>
          </div>
        )}

        {failedTracks.length > 0 && (job.status === 'done' || terminalError) && (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/50 dark:text-amber-100">
            <p className="font-semibold">
              {failedTracks.length} {plural(failedTracks.length, 'canción no se pudo', 'canciones no se pudieron')}{' '}
              descargar
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {failedTracks.map((t) => (
                <li key={t.id}>
                  <span className="font-medium">{t.title}</span>
                  {t.error ? `: ${t.error}` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}

        {job.tracks.length > 0 && (
          <ul
            className="max-h-96 space-y-0.5 overflow-y-auto overscroll-contain rounded-2xl border border-slate-100 p-1 dark:border-slate-800"
            aria-label="Estado de cada canción"
          >
            {job.tracks.map((t) => (
              <JobTrackRow key={t.id} track={t} />
            ))}
          </ul>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onNew}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-slate-300 px-6 font-semibold text-slate-700 transition hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 sm:w-auto"
          >
            <ResetIcon />
            Nueva descarga
          </button>
        </div>
      </div>
    </section>
  );
}
