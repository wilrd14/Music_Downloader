# Arquitectura

## Componentes

| Componente | Tecnología | Función |
|---|---|---|
| Frontend | React + Vite + Tailwind | UI: pegar enlace, previsualizar, elegir pistas, ver progreso, descargar. |
| API | Node + Fastify (`backend/src/api`) | Resuelve enlaces, crea trabajos, expone estado (JSON y SSE) y entrega el archivo/ZIP. Escucha solo en `127.0.0.1:8787`. |
| Worker | Node (`backend/src/worker`) | Toma trabajos de la cola, descarga y convierte pista a pista, borra trabajos expirados. |
| Cola / estado | SQLite (`node:sqlite`, modo WAL) | Compartida entre API y worker (procesos distintos). Archivo `data/tunedrop.db`. |
| Herramientas | `yt-dlp`, `ffmpeg` | Binarios externos lanzados con `spawn` (sin shell). |
| Exposición | Cloudflare Tunnel + Pages | Ver [deployment-cloudflare.md](deployment-cloudflare.md). |

## Flujo de datos

```
 Navegador                       Cloudflare                    PC del operador
 ─────────                       ──────────                    ───────────────
 React (Pages)  ── HTTPS ──►  (Access opcional) ──► Tunnel ──► API :8787 ──┐
      ▲                                                          │         │ escribe/lee
      │  SSE / descarga                                          │         ▼
      └──────────────────────────────────────────────────────────┘     SQLite (cola)
                                                                           ▲   │
                                                          reclama trabajos │   │
                                                                           │   ▼
                                                                        Worker ──spawn──► yt-dlp / ffmpeg
                                                                           │
                                                                           ▼
                                                              data/jobs/<id>/tracks/*.mp3
                                                              (borrado tras el TTL)
```

1. `POST /api/resolve`: el resolver de la fuente (YouTube) obtiene metadatos con yt-dlp; el resultado se cachea 10 minutos en memoria.
2. `POST /api/jobs`: se crea un trabajo `queued` con sus pistas en SQLite y se devuelve `{ id }`.
3. El worker (sondea cada 1 s) reclama el trabajo de forma atómica, lo pasa a `running` y descarga las pistas a `data/jobs/<id>/tracks/`: hasta `TRACK_CONCURRENCY` (3) a la vez por trabajo y, sumando todos los trabajos, como máximo `MAX_PARALLEL_DOWNLOADS` (4) procesos yt-dlp+ffmpeg simultáneos (semáforo global en `worker/runner.ts`). Una pista que falla no detiene a las demás; el trabajo queda `done` si al menos una salió bien.
4. El navegador sigue el avance con `GET /api/jobs/:id/events` (SSE).
5. Al terminar, `GET /api/jobs/:id/download` entrega el archivo (una pista) o un ZIP generado al vuelo (playlist).
6. Pasado `JOB_TTL_MINUTES`, el worker borra la carpeta del trabajo y lo marca `expired`.

## Ciclo de vida del trabajo

Estados del trabajo (`jobs.status`): `queued` -> `running` -> `done` | `failed` -> `expired`.

```
queued ──(worker reclama)──► running ──(>=1 pista ok)──► done ──(TTL)──► expired
                                 │                                          ▲
                                 └──(0 pistas ok / error interno)─► failed ─┘ (TTL)
```

- Si el worker se cae con trabajos en `running`, al arrancar `recoverInterruptedJobs()` los devuelve a `queued` y reinicia las pistas `downloading`/`converting`. Las pistas ya `done` se conservan.
- Un trabajo es `done` si al menos una pista se descargó; las fallidas quedan con `status = failed` y su mensaje.

Estados de pista (`tracks.status`): `queued` -> `downloading` -> `converting` -> `done` | `failed`.

## Referencia de la API

Todos los errores tienen la forma `{ "error": "mensaje para el usuario" }`.

### `GET /api/health`
Comprueba yt-dlp y ffmpeg (cacheado 30 s).
```json
{ "ok": true, "ytDlp": "2026.09.01", "ffmpeg": true }
```

### `POST /api/resolve`
```json
// request
{ "url": "https://www.youtube.com/playlist?list=PL..." }
// response 200
{
  "provider": "youtube", "kind": "playlist", "title": "Mi playlist",
  "thumbnail": "https://i.ytimg.com/vi/xxxx/mqdefault.jpg",
  "sourceUrl": "https://www.youtube.com/playlist?list=PL...",
  "tracks": [
    { "id": "dQw4w9WgXcQ", "title": "Never Gonna Give You Up", "artist": "Rick Astley",
      "durationSec": 213, "thumbnail": "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg",
      "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }
  ],
  "maxTracksPerJob": 100
}
```
Errores: `400` (enlace vacío o no soportado), `503` (falta yt-dlp).

### `POST /api/jobs`
```json
// request (format: "mp3" | "m4a", por defecto mp3; trackIds opcional)
{ "url": "https://www.youtube.com/playlist?list=PL...", "format": "mp3", "trackIds": ["dQw4w9WgXcQ"] }
// response 200
{ "id": "3b241101-e2bb-4255-8caf-4136c566a962" }
```
Errores `400`: enlace vacío, formato no soportado, ninguna canción seleccionada, más de `MAX_TRACKS_PER_JOB`.

### `GET /api/jobs/:id`
```json
{
  "id": "3b24...", "status": "running", "kind": "playlist", "title": "Mi playlist",
  "thumbnail": "https://...", "format": "mp3", "progress": 42, "queuePosition": null,
  "error": null, "downloadReady": false,
  "tracks": [ { "id": "dQw4w9WgXcQ", "title": "...", "artist": "...", "status": "downloading", "progress": 63, "error": null } ]
}
```
`404` si no existe. `queuePosition` solo tiene valor en `queued`.

### `GET /api/jobs/:id/events`
Server-Sent Events. Cada evento `data:` contiene el mismo JSON que `GET /api/jobs/:id`, solo cuando cambia (se comprueba cada 600 ms); hay un comentario `: ping` de latido. El servidor cierra el stream al llegar a `done`, `failed` o `expired`.

### `GET /api/jobs/:id/download`
- Pista suelta: `audio/mpeg` (mp3) o `audio/mp4` (m4a), con `Content-Disposition: attachment`.
- Playlist o varias pistas: `application/zip` (sin compresión), carpeta interna con el título.
- Errores: `404` no existe, `410` expirado, `409` aún no listo.

## Tablas SQLite

```sql
jobs(
  id TEXT PRIMARY KEY,        -- UUID v4
  provider TEXT, source_url TEXT, title TEXT,
  kind TEXT,                  -- 'track' | 'playlist'
  format TEXT,                -- 'mp3' | 'm4a'
  thumbnail TEXT,
  status TEXT,                -- queued | running | done | failed | expired
  error TEXT,
  created_at INTEGER, started_at INTEGER, finished_at INTEGER   -- epoch ms
);                            -- índice idx_jobs_status(status, created_at)

tracks(
  job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE,
  idx INTEGER,                -- orden dentro del trabajo
  track_id TEXT, title TEXT, artist TEXT, duration_sec INTEGER,
  thumbnail TEXT, url TEXT,
  status TEXT,                -- queued | downloading | converting | done | failed
  progress REAL DEFAULT 0, error TEXT,
  file_path TEXT,             -- NULL tras expirar
  PRIMARY KEY (job_id, idx)
);
```

## Añadir un nuevo Resolver (p. ej. Spotify)

La interfaz está en `backend/src/core/types.ts`:

```ts
interface Resolver {
  readonly name: string;                       // se guarda en jobs.provider
  canHandle(url: string): boolean;
  resolve(url: string): Promise<ResolvedSource>; // metadatos + lista de pistas
  download(track: TrackInfo, opts: DownloadOptions): Promise<string>; // devuelve ruta del archivo
}
```

Pasos:
1. Crear `backend/src/resolvers/spotify.ts` que exporte un objeto `Resolver` con `name: 'spotify'`.
2. `canHandle`: aceptar hosts `open.spotify.com` (track/album/playlist).
3. `resolve`: obtener metadatos de Spotify y devolver `TrackInfo[]` con `artist`, `title`, `durationSec`. Como `download` recibe el `TrackInfo`, el campo `url` puede guardar una consulta o el enlace de Spotify.
4. `download`: buscar en YouTube (p. ej. `ytsearch1:artista título`) reutilizando la lógica de `youtube.ts` y llamar a `onProgress`; devolver la ruta final. Verificar la duración para evitar coincidencias erróneas.
5. Registrarlo en el arreglo `resolvers` de `backend/src/resolvers/index.ts`. API y worker lo resuelven por `findResolver(url)` / `getResolver(name)`; no hay que tocar rutas ni la cola.
6. Actualizar el mensaje de "Enlace no soportado" en `findResolver`.

Pendiente de decidir: cómo obtener metadatos de Spotify (API oficial con credenciales de cliente vs. scraping de la página embebida).

## Notas de seguridad

- **El id del trabajo es una capacidad**: es un UUID v4 aleatorio (`crypto.randomUUID()`); quien lo conoce puede ver el estado y descargar. No hay listado de trabajos ni cuentas. No lo compartas ni lo registres en logs públicos.
- **TTL y limpieza**: el worker borra cada minuto las carpetas de trabajos terminados con más de `JOB_TTL_MINUTES`, y al arrancar. No queda audio en el servidor a largo plazo.
- **Sin shell**: yt-dlp y ffmpeg se lanzan con `child_process.spawn(cmd, args)` sin shell (`backend/src/resolvers/proc.ts`), por lo que una URL maliciosa no puede inyectar comandos. Aun así, las URL se validan por host/ruta antes de pasarlas.
- **Nombres de archivo** saneados con `sanitizeFileName` antes de escribir a disco y de construir el ZIP.
- **Red**: la API solo escucha en `127.0.0.1`; la única entrada pública es el túnel. CORS está desactivado salvo que se defina `CORS_ORIGIN`.
- **Pendiente (Fase 4)**: rate limiting, Cloudflare Turnstile, límites por IP y Cloudflare Access durante las pruebas privadas.
