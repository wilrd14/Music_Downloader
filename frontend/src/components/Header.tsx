import ThemeToggle from './ThemeToggle';
import { DownloadIcon } from './icons';

interface Props {
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

export default function Header({ theme, onToggleTheme }: Props) {
  return (
    <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-4">
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-md shadow-violet-500/30">
          <DownloadIcon width={20} height={20} strokeWidth={2.5} />
        </span>
        <span className="text-xl font-bold tracking-tight">tunedrop</span>
      </div>
      <ThemeToggle theme={theme} onToggle={onToggleTheme} />
    </header>
  );
}
