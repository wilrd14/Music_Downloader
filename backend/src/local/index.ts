// Modo local: API + worker en UN solo proceso, escuchando solo en 127.0.0.1, y abre el navegador.
// `npm run start:local` (desarrollo) o `node dist/tunedrop.mjs` (empaquetado).

import fs from 'node:fs';
import path from 'node:path';

// El modo local es el de esta entrada aunque el entorno diga otra cosa (config se evalúa al importarla,
// por eso los módulos del proyecto se importan dinámicamente después de fijar la variable).
process.env.TUNEDROP_MODE = 'local';

const { config } = await import('../core');
const { buildApp } = await import('../api/app');
const { startWorker } = await import('../worker/start');
const { maybeUpdateYtDlp } = await import('../resolvers/update');
const { openWithSystem } = await import('../core/opener');
const { listenOnFreePort } = await import('./port');

const app = await buildApp({ mode: 'local', logger: { level: 'warn' } });

let port: number;
try {
  port = await listenOnFreePort((p) => app.listen({ port: p, host: '127.0.0.1' }), config.apiPort, 10);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
const url = `http://127.0.0.1:${port}`;

if (!config.staticDir || !fs.existsSync(path.join(config.staticDir, 'index.html'))) {
  console.warn(`Aviso: no se encontró la interfaz (${config.staticDir}). Solo está disponible la API. Define STATIC_DIR o compila el frontend.`);
}
console.log(`tunedrop listo en ${url}`);
console.log(`Datos: ${config.dataDir}`);

const worker = startWorker({ mode: 'local' });

// yt-dlp envejece rápido: se actualiza en segundo plano (solo el empaquetado, como mucho una vez al día).
void maybeUpdateYtDlp().catch(() => {});

if (!config.noBrowser) {
  openWithSystem(url).catch((err) => console.warn(`No se pudo abrir el navegador (${err instanceof Error ? err.message : err}). Abre ${url} a mano.`));
}

let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  worker.stop();
  try {
    await app.close();
  } finally {
    process.exit(0);
  }
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
