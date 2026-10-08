import { useState, type FormEvent } from 'react';
import { SearchIcon, Spinner, XIcon, AlertIcon } from './icons';

interface Props {
  loading: boolean;
  error: string | null;
  onDismissError: () => void;
  onSubmit: (url: string) => void;
}

export default function UrlForm({ loading, error, onDismissError, onSubmit }: Props) {
  const [url, setUrl] = useState('');
  const [emptyError, setEmptyError] = useState(false);

  const handle = (e: FormEvent) => {
    e.preventDefault();
    const v = url.trim();
    if (!v) {
      setEmptyError(true);
      return;
    }
    setEmptyError(false);
    onSubmit(v);
  };

  const shownError = emptyError ? 'Pega primero un enlace de YouTube o YouTube Music.' : error;

  return (
    <form onSubmit={handle} noValidate className="w-full" aria-busy={loading}>
      <label htmlFor="url" className="sr-only">
        Enlace de YouTube o YouTube Music
      </label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          id="url"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={url}
          disabled={loading}
          onChange={(e) => {
            setUrl(e.target.value);
            if (emptyError) setEmptyError(false);
          }}
          placeholder="Pega un enlace de YouTube o YouTube Music (video o playlist)"
          aria-invalid={shownError ? true : undefined}
          aria-describedby={shownError ? 'url-error' : undefined}
          className="h-14 w-full min-w-0 shrink-0 rounded-2xl sm:flex-1 sm:shrink border border-slate-300 bg-white px-4 text-base text-slate-900 shadow-sm outline-none transition placeholder:text-slate-500 focus:border-violet-600 focus:ring-4 focus:ring-violet-600/20 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-400 dark:focus:border-violet-400 dark:focus:ring-violet-400/25"
        />
        <button
          type="submit"
          disabled={loading}
          className="inline-flex h-14 shrink-0 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-7 text-base font-semibold text-white shadow-lg shadow-violet-600/25 transition hover:from-violet-700 hover:to-fuchsia-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 disabled:cursor-wait disabled:opacity-70 dark:focus-visible:outline-violet-400"
        >
          {loading ? <Spinner /> : <SearchIcon />}
          {loading ? 'Buscando…' : 'Buscar'}
        </button>
      </div>

      {shownError && (
        <div
          id="url-error"
          role="alert"
          className="td-in mt-3 flex items-start gap-2 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2.5 text-sm text-rose-900 dark:border-rose-500/40 dark:bg-rose-950/60 dark:text-rose-100"
        >
          <AlertIcon className="mt-0.5 shrink-0" width={18} height={18} />
          <span className="flex-1">{shownError}</span>
          <button
            type="button"
            onClick={() => {
              setEmptyError(false);
              onDismissError();
            }}
            aria-label="Cerrar mensaje de error"
            className="-m-1 rounded-md p-1 hover:bg-rose-100 focus-visible:outline-2 focus-visible:outline-rose-700 dark:hover:bg-rose-900/60"
          >
            <XIcon width={16} height={16} />
          </button>
        </div>
      )}
    </form>
  );
}
