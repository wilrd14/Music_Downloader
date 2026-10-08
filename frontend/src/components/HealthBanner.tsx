import type { HealthStatus } from '../hooks/useHealth';
import { AlertIcon } from './icons';

export default function HealthBanner({ status }: { status: HealthStatus }) {
  if (status.state === 'loading') return null;

  let message: string | null = null;
  if (status.state === 'offline') {
    message = 'Servicio fuera de línea. Puede que las descargas no funcionen por ahora.';
  } else if (!status.health.ok) {
    const missing: string[] = [];
    if (!status.health.ytDlp) missing.push('yt-dlp');
    if (!status.health.ffmpeg) missing.push('ffmpeg');
    message =
      missing.length > 0
        ? `El servicio no está completo: falta ${missing.join(' y ')}. Las descargas pueden fallar.`
        : 'El servicio reporta un problema. Las descargas pueden fallar.';
  }
  if (!message) return null;

  return (
    <div
      role="status"
      className="mx-auto mb-2 flex w-full max-w-3xl items-start gap-2 px-4"
    >
      <div className="flex w-full items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/60 dark:text-amber-100">
        <AlertIcon className="mt-0.5 shrink-0" width={18} height={18} />
        <span>{message}</span>
      </div>
    </div>
  );
}
