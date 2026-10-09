import ThemeToggle from './ThemeToggle';
import { DownloadIcon, GearIcon } from './icons';

interface Props {
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  /** Modo local: muestra la insignia y el botón de ajustes. */
  local?: boolean;
  onOpenSettings?: () => void;
}

export default function Header({ theme, onToggleTheme, local = false, onOpenSettings }: Props) {
  return (
    <header className="mx-auto flex w-full max-w-3xl items-center justify-between gap-2 px-4 py-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-md shadow-violet-500/30">
          <DownloadIcon width={20} height={20} strokeWidth={2.5} />
        </span>
        <span className="text-xl font-bold tracking-tight">tunedrop</span>
        {local && (
          <span
            title="Las descargas salen desde tu PC y se guardan en tu carpeta"
            className="inline-flex shrink-0 cursor-help items-center rounded-full border border-violet-300 bg-violet-50 px-2.5 py-0.5 text-xs font-semibold text-violet-800 dark:border-violet-500/40 dark:bg-violet-950/60 dark:text-violet-200"
          >
            Modo local
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {local && onOpenSettings && (
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Ajustes: carpeta de descargas"
            aria-haspopup="dialog"
            title="Ajustes"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:focus-visible:outline-violet-400"
          >
            <GearIcon />
          </button>
        )}
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </div>
    </header>
  );
}
