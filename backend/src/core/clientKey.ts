import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';

/**
 * Huella anónima de la IP del cliente para contar trabajos por IP sin guardar nunca la IP:
 * los 16 primeros hex de HMAC-SHA256(IP) con un secreto aleatorio que se genera una vez y
 * se guarda en `<DATA_DIR>/ip-secret`. El secreto no se registra en logs.
 */

const SECRET_RE = /^[0-9a-f]{64}$/;
const cache = new Map<string, Buffer>();

function loadSecret(dataDir: string): Buffer {
  const hit = cache.get(dataDir);
  if (hit) return hit;
  const file = path.join(dataDir, 'ip-secret');
  fs.mkdirSync(dataDir, { recursive: true });

  const read = (): string | null => {
    try {
      const text = fs.readFileSync(file, 'utf8').trim();
      return SECRET_RE.test(text) ? text : null;
    } catch {
      return null;
    }
  };

  let hex = read();
  if (!hex) {
    const fresh = crypto.randomBytes(32).toString('hex');
    try {
      // 'wx': no pisa un secreto creado a la vez por otro proceso. 0o600: solo el dueño (en Windows se ignora).
      fs.writeFileSync(file, fresh + '\n', { flag: 'wx', mode: 0o600 });
      hex = fresh;
    } catch {
      // Ya existía (carrera, o archivo corrupto): si es válido se usa; si no, se regenera.
      hex = read();
      if (!hex) {
        fs.writeFileSync(file, fresh + '\n', { mode: 0o600 });
        hex = fresh;
      }
    }
  }
  const secret = Buffer.from(hex, 'hex');
  cache.set(dataDir, secret);
  return secret;
}

/** Huella de 16 caracteres hexadecimales de una IP. */
export function clientKeyFor(ip: string, dataDir: string = config.dataDir): string {
  return crypto.createHmac('sha256', loadSecret(dataDir)).update(ip).digest('hex').slice(0, 16);
}
