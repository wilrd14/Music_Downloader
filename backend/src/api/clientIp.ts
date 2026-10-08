import net from 'node:net';

interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  ip: string;
}

/**
 * IP real del cliente. Cloudflare Tunnel (cloudflared) añade `CF-Connecting-IP`; se confía en ella
 * porque la API solo escucha en 127.0.0.1 y únicamente cloudflared llega hasta ahí. Si la cabecera
 * falta o no es una IP válida (basura, demasiado larga, lista), se usa la IP de la conexión.
 */
export function clientIp(req: RequestLike): string {
  const raw = req.headers['cf-connecting-ip'];
  if (typeof raw === 'string') {
    const value = raw.trim();
    if (value.length > 0 && value.length <= 45 && net.isIP(value) !== 0) return value.toLowerCase();
  }
  return req.ip;
}
