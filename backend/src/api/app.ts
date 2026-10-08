import type { OutgoingHttpHeaders } from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ZipArchive } from 'archiver';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyServerOptions } from 'fastify';
import {
  AUDIO_FORMATS,
  config,
  createJob,
  getDb,
  getJobRow,
  getJobState,
  getTrackRows,
  sanitizeFileName,
  UserError,
  type AudioFormat,
  type HealthState,
  type ResolvedSource,
  type Resolver,
} from '../core';
import { checkTools, findResolver, resolvers as defaultResolvers } from '../resolvers';

export interface AppOptions {
  logger?: FastifyServerOptions['logger'];
  /** Resolvers a usar (por defecto los registrados). Útil para pruebas. */
  resolvers?: Resolver[];
  checkTools?: () => Promise<HealthState>;
  /** Carpeta de la interfaz compilada; null/ausente o inexistente = solo API. */
  staticDir?: string | null;
}

const API_CSP = "default-src 'none'; frame-ancestors 'none'";
// Debe coincidir con frontend/public/_headers (que aplica Cloudflare Pages si algún día se usa).
const FRONTEND_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://i.ytimg.com https://i.scdn.co",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export const contentDisposition = (fileName: string) => {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\%;]/g, '_');
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** True si `file` está dentro de `base` (evita servir rutas fuera de la carpeta de trabajos). */
export function isInside(base: string, file: string): boolean {
  const rel = path.relative(path.resolve(base), path.resolve(file));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export async function buildApp(options: AppOptions = {}) {
  const resolverList = options.resolvers ?? defaultResolvers;
  const tools = options.checkTools ?? checkTools;

  getDb();

  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: config.bodyLimitBytes,
    requestTimeout: 30_000,
    connectionTimeout: 60_000,
  });
  await app.register(cors, { origin: config.corsOrigin ?? false });

  app.addHook('onRequest', async (req, reply) => {
    // Cabeceras de seguridad (la API solo devuelve JSON, SSE o archivos: nada que renderizar ni incrustar).
    const isApi = req.url.startsWith('/api/');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Content-Security-Policy', isApi ? API_CSP : FRONTEND_CSP);
    reply.header('Referrer-Policy', isApi ? 'no-referrer' : 'strict-origin-when-cross-origin');
    if (!isApi) reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');

    // Los POST deben ser JSON: obliga al preflight de CORS y frena formularios cruzados (CSRF).
    if (req.method === 'POST' && !String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
      return reply.code(415).send({ error: 'Content-Type debe ser application/json.' });
    }

    // Los identificadores de descarga son UUID; cualquier otra cosa ni se consulta.
    const params = req.params as { id?: string } | undefined;
    if (req.routeOptions.url?.startsWith('/api/jobs/:id') && !UUID_RE.test(params?.id ?? '')) {
      return reply.code(404).send({ error: 'Descarga no encontrada.' });
    }
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    if (err instanceof UserError) return reply.code(err.status).send({ error: err.message });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: 'Petición no válida.' });
    req.log.error(err);
    return reply.code(500).send({ error: 'Error interno del servidor.' });
  });

  // Caché breve para no volver a consultar yt-dlp entre "previsualizar" y "descargar".
  const resolveCache = new Map<string, { at: number; data: ResolvedSource }>();
  const CACHE_MS = 10 * 60_000;

  async function resolveCached(url: string): Promise<ResolvedSource> {
    const now = Date.now();
    for (const [k, v] of resolveCache) if (now - v.at > CACHE_MS) resolveCache.delete(k);
    const hit = resolveCache.get(url);
    if (hit) return hit.data;
    const data = await findResolver(url, resolverList).resolve(url);
    resolveCache.set(url, { at: now, data });
    return data;
  }

  let healthCache: { at: number; data: HealthState } | null = null;
  app.get('/api/health', async () => {
    if (!healthCache || Date.now() - healthCache.at > 30_000) {
      healthCache = { at: Date.now(), data: await tools() };
    }
    return healthCache.data;
  });

  app.post<{ Body: { url?: unknown } }>('/api/resolve', async (req) => {
    const url = asText(req.body?.url);
    if (!url) throw new UserError('Pega un enlace.');
    const source = await resolveCached(url);
    return { ...source, maxTracksPerJob: config.maxTracksPerJob };
  });

  app.post<{ Body: { url?: unknown; format?: AudioFormat; trackIds?: string[] } }>('/api/jobs', async (req) => {
    const url = asText(req.body?.url);
    const format = req.body?.format ?? 'mp3';
    if (!url) throw new UserError('Pega un enlace.');
    if (!AUDIO_FORMATS.includes(format)) throw new UserError('Formato no soportado.');

    const source = await resolveCached(url);
    let tracks = source.tracks;
    const ids = req.body?.trackIds;
    if (Array.isArray(ids)) {
      const wanted = new Set(ids);
      tracks = tracks.filter((t) => wanted.has(t.id));
    }
    if (!tracks.length) throw new UserError('Selecciona al menos una canción.');
    if (tracks.length > config.maxTracksPerJob)
      throw new UserError(`Máximo ${config.maxTracksPerJob} canciones por descarga.`);

    const id = crypto.randomUUID();
    createJob({
      id,
      provider: source.provider,
      sourceUrl: source.sourceUrl,
      title: source.title,
      kind: source.kind,
      format,
      thumbnail: source.thumbnail,
      tracks,
    });
    return { id };
  });

  app.get<{ Params: { id: string } }>('/api/jobs/:id', async (req, reply) => {
    const state = getJobState(req.params.id);
    if (!state) return reply.code(404).send({ error: 'Descarga no encontrada.' });
    return state;
  });

  app.get<{ Params: { id: string } }>('/api/jobs/:id/events', (req, reply) => {
    const { id } = req.params;
    if (!getJobState(id)) return reply.code(404).send({ error: 'Descarga no encontrada.' });

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      ...(reply.getHeaders() as OutgoingHttpHeaders),
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    let last = '';
    let quiet = 0;
    let closed = false;
    const timer: { id?: NodeJS.Timeout } = {};
    const stop = () => {
      closed = true;
      if (timer.id) clearInterval(timer.id);
    };
    /** Devuelve true cuando el stream debe terminar. */
    const push = (): boolean => {
      if (closed) return true;
      try {
        const state = getJobState(id);
        if (!state) return true;
        const json = JSON.stringify(state);
        if (json !== last) {
          last = json;
          quiet = 0;
          res.write(`data: ${json}\n\n`);
        } else if (++quiet >= 25) {
          quiet = 0;
          res.write(': ping\n\n');
        }
        return state.status === 'done' || state.status === 'failed' || state.status === 'expired';
      } catch (err) {
        req.log.error(err);
        return true;
      }
    };
    const tick = () => {
      if (push()) {
        stop();
        res.end();
      }
    };

    // "close" de la respuesta (no de la petición) se emite cuando el cliente se desconecta.
    res.on('close', stop);
    timer.id = setInterval(tick, 600);
    tick();
  });

  app.get<{ Params: { id: string } }>('/api/jobs/:id/download', async (req, reply) => {
    const job = getJobRow(req.params.id);
    if (!job) return reply.code(404).send({ error: 'Descarga no encontrada.' });
    if (job.status === 'expired') return reply.code(410).send({ error: 'La descarga expiró. Vuelve a generarla.' });

    const files = getTrackRows(job.id)
      .filter((t) => t.status === 'done' && t.file_path && isInside(config.jobsDir, t.file_path) && fs.existsSync(t.file_path))
      .map((t) => t.file_path as string);
    if (job.status !== 'done' || !files.length)
      return reply.code(409).send({ error: 'La descarga aún no está lista.' });

    if (job.kind === 'track' && files.length === 1) {
      const file = files[0] as string;
      const mime = job.format === 'mp3' ? 'audio/mpeg' : 'audio/mp4';
      return reply
        .header('Content-Type', mime)
        .header('Content-Length', fs.statSync(file).size)
        .header('Content-Disposition', contentDisposition(path.basename(file)))
        .send(fs.createReadStream(file));
    }

    const folder = sanitizeFileName(job.title);
    const archive = new ZipArchive({ store: true }); // el audio ya está comprimido
    archive.on('error', (err: Error) => req.log.error(err));
    for (const file of files) archive.file(file, { name: `${folder}/${path.basename(file)}` });
    void archive.finalize();
    return reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', contentDisposition(`${folder}.zip`))
      .send(archive);
  });

  // Interfaz compilada en el mismo origen: sin CORS y con una sola política de acceso.
  const staticDir = options.staticDir === undefined ? config.staticDir : options.staticDir;
  if (staticDir && fs.existsSync(path.join(staticDir, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: staticDir,
      wildcard: false,
      allowedPath: (p) => !p.endsWith('/_headers'),
      setHeaders(res, filePath) {
        const hashed = filePath.split(path.sep).includes('assets'); // nombres con hash: cacheables
        res.header('Cache-Control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'No encontrado.' });
    });
  }

  return app;
}
