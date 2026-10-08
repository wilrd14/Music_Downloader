export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
/** Longitud máxima de un token según la documentación de Cloudflare. */
export const MAX_TOKEN_LENGTH = 2048;

export type TurnstileResult = 'ok' | 'invalid' | 'unavailable';

export interface VerifyOptions {
  secret: string;
  token: string;
  ip?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** Errores de Cloudflare que no son culpa del visitante (configuración o fallo interno): se falla cerrado con 503. */
const SERVER_SIDE_CODES = new Set(['missing-input-secret', 'invalid-input-secret', 'internal-error']);

/**
 * Valida un token de Turnstile contra siteverify.
 * - 'ok': token válido.
 * - 'invalid': token inválido, caducado o reutilizado.
 * - 'unavailable': red, tiempo de espera o fallo del lado del servidor/Cloudflare (falla cerrado).
 */
export async function verifyTurnstile(opts: VerifyOptions): Promise<TurnstileResult> {
  const { secret, token, ip } = opts;
  if (!token || token.length > MAX_TOKEN_LENGTH) return 'invalid';
  const doFetch = opts.fetch ?? fetch;

  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set('remoteip', ip);

  try {
    const res = await doFetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 5000),
    });
    if (!res.ok) return 'unavailable';
    const data = (await res.json()) as { success?: unknown; 'error-codes'?: unknown };
    if (data.success === true) return 'ok';
    const codes = Array.isArray(data['error-codes']) ? (data['error-codes'] as unknown[]) : [];
    if (codes.some((c) => typeof c === 'string' && SERVER_SIDE_CODES.has(c))) return 'unavailable';
    return 'invalid';
  } catch {
    return 'unavailable';
  }
}
