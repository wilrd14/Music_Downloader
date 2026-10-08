import { useCallback, useEffect, useRef, useState } from 'react';
import { getConfig } from '../api/client';
import { AlertIcon, Spinner } from './icons';

interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      theme?: 'auto' | 'light' | 'dark';
      size?: 'normal' | 'flexible' | 'compact';
      language?: string;
      callback?: (token: string) => void;
      'error-callback'?: (code?: string) => void;
      'expired-callback'?: () => void;
      'timeout-callback'?: () => void;
    },
  ) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

let scriptPromise: Promise<TurnstileApi> | null = null;
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise<TurnstileApi>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile no disponible')));
    s.onerror = () => {
      s.remove();
      reject(new Error('no se pudo cargar Turnstile'));
    };
    document.head.appendChild(s);
  }).catch((e) => {
    scriptPromise = null; // permite reintentar
    throw e;
  });
  return scriptPromise;
}

let siteKeyPromise: Promise<string | null> | null = null;
function loadSiteKey(): Promise<string | null> {
  siteKeyPromise ??= getConfig()
    .then((c) => c.turnstileSiteKey ?? null)
    .catch(() => {
      siteKeyPromise = null;
      return null; // sin configuración no se envía token; el servidor decidirá
    });
  return siteKeyPromise;
}

type Status = 'loading' | 'solved' | 'expired' | 'error';

interface Props {
  theme: 'light' | 'dark';
  /** Súbelo tras cada envío o error: los tokens son de un solo uso, así que se pide uno nuevo. */
  resetSignal: number;
  onToken: (token: string | null) => void;
  /** Avisa de si hace falta token (hay clave de sitio) para habilitar o no el botón de descarga. */
  onRequiredChange: (required: boolean) => void;
}

const STATUS_TEXT: Record<Status, string> = {
  loading: 'Verificando que eres una persona…',
  solved: 'Verificación completada.',
  expired: 'La verificación caducó; se está renovando…',
  error: 'No se pudo completar la verificación anti-bots. Comprueba tu conexión o desactiva bloqueadores de contenido.',
};

export default function TurnstileWidget({ theme, resetSignal, onToken, onRequiredChange }: Props) {
  const [siteKey, setSiteKey] = useState<string | null | undefined>(undefined);
  const [status, setStatus] = useState<Status>('loading');
  const [attempt, setAttempt] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const lastSignal = useRef(resetSignal);

  // Los callbacks del padre cambian en cada render; se guardan en refs para no re-crear el widget.
  const tokenCb = useRef(onToken);
  const requiredCb = useRef(onRequiredChange);
  useEffect(() => {
    tokenCb.current = onToken;
    requiredCb.current = onRequiredChange;
  });

  useEffect(() => {
    let alive = true;
    void loadSiteKey().then((key) => {
      if (!alive) return;
      setSiteKey(key);
      requiredCb.current(key !== null);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!siteKey || !container.current) return;
    let alive = true;
    const el = container.current;
    setStatus('loading');
    tokenCb.current(null);
    loadTurnstile()
      .then((ts) => {
        if (!alive) return;
        widgetId.current = ts.render(el, {
          sitekey: siteKey,
          theme,
          size: 'flexible',
          language: 'es',
          callback: (token) => {
            setStatus('solved');
            tokenCb.current(token);
          },
          'expired-callback': () => {
            setStatus('expired');
            tokenCb.current(null);
          },
          'timeout-callback': () => {
            setStatus('expired');
            tokenCb.current(null);
          },
          'error-callback': () => {
            setStatus('error');
            tokenCb.current(null);
          },
        });
      })
      .catch(() => {
        if (!alive) return;
        setStatus('error');
        tokenCb.current(null);
      });
    return () => {
      alive = false;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey, theme, attempt]);

  // Tras cada envío el token ya se gastó: se descarta y se pide otro.
  useEffect(() => {
    if (lastSignal.current === resetSignal) return;
    lastSignal.current = resetSignal;
    tokenCb.current(null);
    if (widgetId.current && window.turnstile) {
      setStatus('loading');
      window.turnstile.reset(widgetId.current);
    }
  }, [resetSignal]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  if (!siteKey) return null;

  return (
    <div className="space-y-2">
      <div ref={container} className="flex min-h-[65px] w-full items-center justify-center" />
      <p
        role="status"
        aria-live="polite"
        className={`flex items-center gap-2 text-xs ${status === 'error' ? 'text-rose-800 dark:text-rose-200' : 'text-slate-600 dark:text-slate-400'}`}
      >
        {status === 'loading' && <Spinner width={14} height={14} />}
        {status === 'error' && <AlertIcon className="shrink-0" width={14} height={14} />}
        <span>{STATUS_TEXT[status]}</span>
        {status === 'error' && (
          <button
            type="button"
            onClick={retry}
            className="rounded-md px-1.5 py-0.5 font-semibold underline focus-visible:outline-2 focus-visible:outline-violet-600"
          >
            Reintentar
          </button>
        )}
      </p>
    </div>
  );
}
