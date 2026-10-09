/**
 * Protecciones del modo local. La API escucha en 127.0.0.1, pero cualquier página web que la persona
 * visite puede intentar llegar a ella desde su navegador. Tres defensas (ver docs/security.md):
 *  1. Host: solo se atiende `localhost`, `127.0.0.1` o `[::1]` con el puerto real de la app
 *     (frena el DNS rebinding: un dominio atacante que resuelve a 127.0.0.1 llega con otro `Host`).
 *  2. Origin: en /api, si hay cabecera `Origin` debe ser exactamente el origen de la propia app.
 *  3. Sec-Fetch-Site: en /api, si el navegador la envía, debe ser `same-origin` (la propia interfaz)
 *     o `none` (acción directa de la persona, como escribir la URL).
 * Peticiones sin `Origin` ni `Sec-Fetch-Site` (curl, scripts locales) se permiten: no son un navegador ajeno.
 */

export type GuardDecision = { ok: true } | { ok: false; reason: 'host' | 'origin' | 'sec-fetch-site' };

export interface GuardInput {
  host: string | undefined;
  origin: string | undefined;
  secFetchSite: string | undefined;
  /** Puerto real en el que escucha la app. */
  port: number;
  /** La petición es de /api/* (las comprobaciones 2 y 3 solo aplican ahí). */
  isApi: boolean;
}

/**
 * ¿Es una petición a la API? Se decide por la ruta tal cual llega, por la ruta con los `%xx` ya decodificados y por la
 * ruta que Fastify enrutó. Mirar solo el texto de la URL era un hueco: `/%61pi/settings` llega a `/api/settings`
 * (Fastify decodifica antes de enrutar) pero no empieza por `/api/`, así que se saltaba las comprobaciones 2 y 3.
 */
export function isApiRequest(rawUrl: string, routedUrl?: string): boolean {
  const pathOnly = rawUrl.split(/[?#]/, 1)[0] ?? '';
  let decoded = pathOnly;
  try {
    decoded = decodeURIComponent(pathOnly);
  } catch {
    // %xx mal formado: se queda con el texto original
  }
  const isApiPath = (p: string) => /^\/api(\/|$)/i.test(p);
  return isApiPath(pathOnly) || isApiPath(decoded) || (routedUrl !== undefined && isApiPath(routedUrl));
}

export function allowedHosts(port: number): string[] {
  return [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`];
}

export function checkLocalRequest(input: GuardInput): GuardDecision {
  const host = (input.host ?? '').trim().toLowerCase();
  if (!allowedHosts(input.port).includes(host)) return { ok: false, reason: 'host' };
  if (!input.isApi) return { ok: true };

  if (input.origin !== undefined && input.origin !== `http://${host}`) return { ok: false, reason: 'origin' };

  if (input.secFetchSite !== undefined) {
    const site = input.secFetchSite.trim().toLowerCase();
    if (site !== 'same-origin' && site !== 'none') return { ok: false, reason: 'sec-fetch-site' };
  }
  return { ok: true };
}
