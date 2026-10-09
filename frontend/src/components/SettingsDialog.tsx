import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, getSettings, putSettings } from '../api/client';
import { AlertIcon, CheckIcon, Spinner, XIcon } from './icons';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Carpeta actual conocida (de /api/config o de un guardado previo). */
  downloadDir: string | null;
  onSaved: (dir: string) => void;
}

/**
 * Diálogo modal nativo (<dialog>.showModal): el navegador gestiona la trampa de foco,
 * Esc para cerrar, inertizar el resto de la página y devolver el foco al botón que lo abrió.
 */
export default function SettingsDialog({ open, onClose, downloadDir, onSaved }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(downloadDir ?? '');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  // Al abrir: parte de lo último conocido y refresca desde el servidor.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setError(null);
    setSaved(false);
    setValue(downloadDir ?? '');
    setLoading(true);
    getSettings()
      .then((s) => {
        if (!alive) return;
        setValue(s.downloadDir);
        onSaved(s.downloadDir);
      })
      .catch(() => {
        /* se queda con el valor conocido */
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // Solo al abrir; downloadDir/onSaved se leen en ese momento.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = value.trim();
    if (!v) {
      setError('Escribe la ruta de la carpeta donde guardar las canciones.');
      inputRef.current?.focus();
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await putSettings(v);
      setValue(res.downloadDir);
      setSaved(true);
      onSaved(res.downloadDir);
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'No se pudo guardar la carpeta.');
      inputRef.current?.focus();
    } finally {
      setSaving(false);
    }
  };

  const unchanged = value.trim() === (downloadDir ?? '');

  return (
    <dialog
      ref={ref}
      aria-labelledby="settings-title"
      aria-describedby="settings-help"
      onClose={onClose}
      onClick={(e) => {
        // Clic en el fondo (fuera de la tarjeta) cierra.
        if (e.target === e.currentTarget) onClose();
      }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-3xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/60 backdrop:backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
    >
      <form onSubmit={submit} noValidate className="space-y-4 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <h2 id="settings-title" className="text-xl font-bold tracking-tight">
            Ajustes
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar ajustes"
            className="-m-1.5 rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-violet-600 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <XIcon />
          </button>
        </div>

        <div>
          <label htmlFor="download-dir" className="mb-1.5 block text-sm font-semibold">
            Carpeta de descargas
          </label>
          <input
            ref={inputRef}
            id="download-dir"
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={value}
            disabled={saving}
            onChange={(e) => {
              setValue(e.target.value);
              setSaved(false);
              if (error) setError(null);
            }}
            placeholder={loading ? 'Cargando…' : 'C:\\Users\\TuUsuario\\Music\\tunedrop'}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'settings-help settings-error' : 'settings-help'}
            className="h-12 w-full rounded-xl border border-slate-300 bg-white px-3.5 font-mono text-sm text-slate-900 outline-none transition placeholder:text-slate-500 focus:border-violet-600 focus:ring-4 focus:ring-violet-600/20 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-400 dark:focus:border-violet-400 dark:focus:ring-violet-400/25"
          />
          <p id="settings-help" className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            Una página web no puede abrir el selector de carpetas de tu equipo, así que escribe o pega la ruta
            completa, por ejemplo <span className="font-mono">C:\Users\TuUsuario\Music\tunedrop</span>. Se
            aplica a las próximas descargas.
          </p>
        </div>

        <div aria-live="polite" className="empty:hidden">
          {error && (
            <div
              id="settings-error"
              role="alert"
              className="td-in flex items-start gap-2 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2.5 text-sm text-rose-900 dark:border-rose-500/40 dark:bg-rose-950/60 dark:text-rose-100"
            >
              <AlertIcon className="mt-0.5 shrink-0" width={18} height={18} />
              <span className="min-w-0 flex-1 break-words">{error}</span>
            </div>
          )}
          {saved && !error && (
            <div
              role="status"
              className="td-in flex items-start gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-950/40 dark:text-emerald-100"
            >
              <CheckIcon className="mt-0.5 shrink-0" width={18} height={18} />
              <span className="min-w-0 flex-1">Carpeta guardada. Las próximas descargas irán allí.</span>
            </div>
          )}
        </div>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-12 items-center justify-center rounded-2xl border border-slate-300 px-6 font-semibold text-slate-700 transition hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {saved ? 'Cerrar' : 'Cancelar'}
          </button>
          <button
            type="submit"
            disabled={saving || loading || unchanged}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-6 font-semibold text-white shadow-lg shadow-violet-600/25 transition hover:from-violet-700 hover:to-fuchsia-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving && <Spinner />}
            {saving ? 'Guardando…' : 'Guardar carpeta'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
