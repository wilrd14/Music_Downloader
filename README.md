# tunedrop

Aplicación web gratuita para descargar canciones y playlists de YouTube como audio (MP3 o M4A). Pegas un enlace, eliges las pistas y descargas el resultado desde tu navegador: un archivo suelto o un ZIP. Está previsto soportar Spotify más adelante (se leen los metadatos y se busca el equivalente en YouTube).

## Estado

**Fase 1 (en desarrollo):** pista y playlist de YouTube -> archivo o ZIP, con progreso en vivo por SSE. Ver el plan completo en [docs/phases.md](docs/phases.md).

Nada se guarda de forma permanente en el servidor: los archivos generados se eliminan automáticamente pasado un TTL (30 minutos por defecto).

## Estructura del repositorio

No es un monorepo: son dos proyectos independientes, cada uno con su propio `package.json`.

```
Music_Downloader/
├── README.md
├── backend/              Node + TypeScript + Fastify (API y worker)
│   ├── .env.example
│   └── src/
│       ├── api/          Servidor HTTP (rutas /api/*)
│       ├── worker/       Procesa la cola y limpia archivos expirados
│       ├── core/         Config, SQLite (cola), tipos, utilidades
│       └── resolvers/    Una fuente por archivo (youtube.ts, ...)
├── frontend/             React + Vite + Tailwind
├── docs/
│   ├── architecture.md
│   ├── deployment-cloudflare.md
│   └── phases.md
└── scripts/              Scripts de PowerShell (Windows)
    ├── start-backend.ps1
    ├── start-frontend.ps1
    └── check-tools.ps1
```

## Requisitos previos

- **Node.js >= 22.13** (el backend usa `node:sqlite`; se desarrolla con Node 24).
- **yt-dlp** y **ffmpeg**, ejecutados como binarios externos.

En Windows 11 con winget:

```powershell
winget install yt-dlp.yt-dlp
winget install Gyan.FFmpeg
```

Después **cierra y vuelve a abrir la terminal** para que el PATH se actualice. Si prefieres no usar el PATH, define `YT_DLP_PATH` y `FFMPEG_PATH` en `backend/.env` (ver tabla abajo).

Comprueba todo con:

```powershell
.\scripts\check-tools.ps1
```

## Inicio rápido

Backend (API en `127.0.0.1:8787` + worker):

```powershell
cd backend
copy .env.example .env
npm install
npm run dev
```

Frontend (en otra terminal):

```powershell
cd frontend
npm install
npm run dev
```

Abre <http://localhost:5173>. El servidor de Vite reenvía `/api` al backend.

Scripts de `backend/`: `npm run dev` (API + worker con recarga), `dev:api`, `dev:worker`, `start:api`, `start:worker`, `typecheck`.

## Variables de entorno (`backend/.env`)

| Variable | Por defecto | Descripción |
|---|---|---|
| `API_PORT` | `8787` | Puerto de la API. Siempre escucha en `127.0.0.1`. |
| `STATIC_DIR` | `../frontend/dist` | Carpeta de la interfaz compilada que sirve el backend |
| `MAX_TRACKS_PER_JOB` | `100` | Máximo de canciones por descarga. |
| `JOB_TTL_MINUTES` | `30` | Minutos que se conserva un trabajo terminado antes de borrar sus archivos. |
| `WORKER_CONCURRENCY` | `2` | Trabajos que el worker procesa en paralelo. |
| `CORS_ORIGIN` | (sin definir) | Origen permitido por CORS. Solo hace falta si el frontend se sirve desde otro dominio. |
| `DATA_DIR` | `backend/data` | Carpeta de la base SQLite (`tunedrop.db`) y de los archivos temporales (`jobs/`). |
| `YT_DLP_PATH` | `yt-dlp` | Ruta al binario de yt-dlp si no está en el PATH. |
| `FFMPEG_PATH` | (PATH) | Ruta a `ffmpeg.exe` o a la carpeta que lo contiene. |

## Despliegue

Frontend en Cloudflare Pages y backend en tu PC expuesto con Cloudflare Tunnel durante la fase de pruebas. Guía paso a paso: [docs/deployment-cloudflare.md](docs/deployment-cloudflare.md). Diseño interno y API: [docs/architecture.md](docs/architecture.md).

## Aviso legal

tunedrop es una herramienta para **uso personal** y para contenido que tienes derecho a descargar (tus propias obras, contenido con licencia libre o dominio público, o con permiso del titular). Descargar material protegido por derechos de autor sin autorización puede infringir la ley y los términos de servicio de YouTube y otras plataformas. **La responsabilidad del uso y de la operación de cualquier instancia desplegada recae en quien la opera y en quien la utiliza**; los autores no se hacen responsables del uso indebido.

## Seguridad
Reglas, estado y checklist previa al lanzamiento público: [docs/security.md](docs/security.md).
