import { useCallback, useMemo, useState } from 'react';
import type { AudioFormat, ResolveResponse } from '../types';
import { plural } from '../lib/format';
import Thumb from './Thumb';
import TrackRow from './TrackRow';
import TurnstileWidget from './TurnstileWidget';
import { AlertIcon, DownloadIcon, FolderIcon, ListIcon, MusicIcon, Spinner, XIcon } from './icons';

interface Props {
  source: ResolveResponse;
  format: AudioFormat;
  onFormatChange: (f: AudioFormat) => void;
  submitting: boolean;
  error: string | null;
  onDismissError: () => void;
  onConfirm: (trackIds: string[] | undefined, turnstileToken: string | null) => void;
  onCancel: () => void;
  theme: 'light' | 'dark';
  /** Cambia tras cada envío para que el anti-bots pida un token nuevo (son de un solo uso). */
  captchaResetSignal: number;
  /** Modo local: sin anti-bots; se muestra la carpeta donde se guardará. */
  local?: boolean;
  downloadDir?: string | null;
}

const FORMATS: { value: AudioFormat; label: string; hint: string }[] = [
  { value: 'mp3', label: 'MP3', hint: 'Compatible con todo' },
  { value: 'm4a', label: 'M4A', hint: 'Mejor calidad por tamaño' },
];

export default function SourcePreview({
  source,
  format,
  onFormatChange,
  submitting,
  error,
  onDismissError,
  onConfirm,
  onCancel,
  theme,
  captchaResetSignal,
  local = false,
  downloadDir = null,
}: Props) {
  const [token, setToken] = useState<string | null>(null);
  // Hasta saber si hay clave de Turnstile se asume que hace falta (el botón espera). En local nunca.
  const [captchaRequired, setCaptchaRequired] = useState(!local);
  const isPlaylist = source.kind === 'playlist';
  const limit = Math.max(1, source.maxTracksPerJob);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(source.tracks.slice(0, limit).map((t) => t.id)),
  );

  const toggle = useCallback(
    (id: string) => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else if (next.size < limit) next.add(id);
        return next;
      });
    },
    [limit],
  );

  const selectAll = () => setSelected(new Set(source.tracks.slice(0, limit).map((t) => t.id)));
  const selectNone = () => setSelected(new Set());

  const count = isPlaylist ? selected.size : 1;
  const atLimit = selected.size >= limit;
  const overLimitAvailable = isPlaylist && source.tracks.length > limit;
  const canSubmit = !submitting && count > 0 && (local || !captchaRequired || token !== null);

  const orderedSelection = useMemo(
    () => source.tracks.filter((t) => selected.has(t.id)).map((t) => t.id),
    [source.tracks, selected],
  );

  return (
    <section
      aria-labelledby="preview-title"
      className="td-in overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-900/5 dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex items-center gap-4 border-b border-slate-100 bg-gradient-to-r from-violet-50 to-fuchsia-50 p-4 dark:border-slate-800 dark:from-violet-950/40 dark:to-fuchsia-950/30 sm:p-5">
        <Thumb src={source.thumbnail} className="h-16 w-16 sm:h-20 sm:w-20" />
        <div className="min-w-0 flex-1">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-600 px-2.5 py-0.5 text-xs font-semibold text-white">
            {isPlaylist ? <ListIcon width={14} height={14} /> : <MusicIcon width={14} height={14} />}
            {isPlaylist ? 'Playlist' : 'Canción'}
          </span>
          <h2 id="preview-title" className="mt-1 line-clamp-2 text-lg font-bold leading-snug sm:text-xl">
            {source.title}
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {source.tracks.length} {plural(source.tracks.length, 'canción', 'canciones')}
          </p>
        </div>
      </div>

      {isPlaylist && (
        <div className="p-4 sm:p-5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium" aria-live="polite">
              {selected.size} de {limit} {plural(limit, 'seleccionada', 'seleccionadas')}
              <span className="font-normal text-slate-600 dark:text-slate-400">
                {' '}
                (máximo {limit} por descarga)
              </span>
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={selectAll}
                className="rounded-lg px-2.5 py-1 text-sm font-medium text-violet-700 hover:bg-violet-50 focus-visible:outline-2 focus-visible:outline-violet-600 dark:text-violet-300 dark:hover:bg-violet-950/60"
              >
                Seleccionar todo
              </button>
              <button
                type="button"
                onClick={selectNone}
                className="rounded-lg px-2.5 py-1 text-sm font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-violet-600 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Ninguna
              </button>
            </div>
          </div>
          {overLimitAvailable && (
            <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/50 dark:text-amber-100">
              Esta playlist tiene {source.tracks.length} canciones, pero solo puedes descargar {limit} a la vez.
              {atLimit ? ' Desmarca alguna para elegir otra.' : ''}
            </p>
          )}
          <ul
            className="max-h-80 space-y-0.5 overflow-y-auto overscroll-contain rounded-2xl border border-slate-100 p-1 dark:border-slate-800"
            aria-label="Canciones de la playlist"
          >
            {source.tracks.map((t) => {
              const checked = selected.has(t.id);
              return (
                <TrackRow
                  key={t.id}
                  track={t}
                  checked={checked}
                  disabled={!checked && atLimit}
                  onToggle={toggle}
                />
              );
            })}
          </ul>
        </div>
      )}

      <div className="space-y-4 p-4 pt-0 sm:p-5 sm:pt-0">
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Formato de audio</legend>
          <div className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1 dark:bg-slate-800" role="radiogroup">
            {FORMATS.map((f) => (
              <label
                key={f.value}
                className={`relative flex cursor-pointer flex-col items-center rounded-xl px-3 py-2 text-center transition focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-violet-600 ${
                  format === f.value
                    ? 'bg-white text-violet-700 shadow dark:bg-slate-950 dark:text-violet-300'
                    : 'text-slate-700 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                }`}
              >
                <input
                  type="radio"
                  name="format"
                  value={f.value}
                  checked={format === f.value}
                  onChange={() => onFormatChange(f.value)}
                  className="sr-only"
                />
                <span className="text-sm font-bold">{f.label}</span>
                <span className="text-xs text-slate-600 dark:text-slate-400">{f.hint}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {local ? (
          downloadDir && (
            <p className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-400">
              <FolderIcon className="mt-0.5 shrink-0" width={16} height={16} />
              <span className="min-w-0">
                Se guardará en <span className="break-all font-mono text-[0.8125rem]">{downloadDir}</span>
              </span>
            </p>
          )
        ) : (
          <TurnstileWidget
            theme={theme}
            resetSignal={captchaResetSignal}
            onToken={setToken}
            onRequiredChange={setCaptchaRequired}
          />
        )}

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2.5 text-sm text-rose-900 dark:border-rose-500/40 dark:bg-rose-950/60 dark:text-rose-100"
          >
            <AlertIcon className="mt-0.5 shrink-0" width={18} height={18} />
            <span className="flex-1">{error}</span>
            <button
              type="button"
              onClick={onDismissError}
              aria-label="Cerrar mensaje de error"
              className="-m-1 rounded-md p-1 hover:bg-rose-100 dark:hover:bg-rose-900/60"
            >
              <XIcon width={16} height={16} />
            </button>
          </div>
        )}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="inline-flex h-12 items-center justify-center rounded-2xl border border-slate-300 px-6 font-semibold text-slate-700 transition hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => onConfirm(isPlaylist ? orderedSelection : undefined, token)}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-6 font-semibold text-white shadow-lg shadow-violet-600/25 transition hover:from-violet-700 hover:to-fuchsia-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? <Spinner /> : <DownloadIcon />}
            {submitting ? 'Creando descarga…' : `Descargar ${count} ${plural(count, 'canción', 'canciones')}`}
          </button>
        </div>
      </div>
    </section>
  );
}
