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

/**
 * Clave para los límites por IP y los topes por cliente. Una persona con IPv6 controla como mínimo un /64
 * (2^64 direcciones): contar por dirección exacta permitiría saltarse el límite rotando de dirección.
 * - IPv6 -> su prefijo /64 (p. ej. `2001:0db8:aaaa:bbbb::/64`).
 * - IPv4 mapeada en IPv6 (`::ffff:203.0.113.9`) -> la IPv4 (`203.0.113.9`), para que ambas formas cuenten igual.
 * - IPv4 u otra cosa -> tal cual.
 */
export function rateLimitKey(ip: string): string {
  if (!net.isIPv6(ip)) return ip;
  let host: string;
  try {
    // El analizador de URL normaliza cualquier forma (mayúsculas, `::`, cola IPv4) a hexadecimal comprimido.
    host = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  } catch {
    return ip; // p. ej. con identificador de zona (`fe80::1%eth0`)
  }
  const halves = host.split('::');
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length > 1 && halves[1] ? halves[1].split(':') : [];
  const groups = halves.length > 1 ? [...head, ...Array<string>(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail] : head;
  if (groups.length !== 8) return ip;
  if (groups.slice(0, 5).every((g) => /^0+$/.test(g)) && groups[5] === 'ffff') {
    const hi = parseInt(groups[6] as string, 16);
    const lo = parseInt(groups[7] as string, 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return `${groups.slice(0, 4).map((g) => g.padStart(4, '0')).join(':')}::/64`;
}
