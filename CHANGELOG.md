# Changelog

Todos los cambios relevantes de este proyecto se documentan aquí.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto aspira a seguir [Versionado Semántico](https://semver.org/lang/es/). Mientras esté en pruebas privadas, las versiones `0.x` pueden cambiar sin aviso.

## [Sin publicar]

### Añadido
- **Página de presentación e instalación** (`site/`, estática, pensada para Cloudflare Pages): qué es tunedrop, cómo funciona, instalación paso a paso en Windows (incluido el aviso de SmartScreen y la verificación SHA-256), requisitos, preguntas frecuentes y aviso legal. Sin dependencias, sin peticiones a otros dominios, con CSP estricta (`site/_headers`). Verificada en escritorio y móvil (375 px), en claro y oscuro.
- **Modo local (backend)**: nuevo `TUNEDROP_MODE` (`local` por defecto, `server` conserva el comportamiento anterior; **quien ya despliega como servicio debe fijar `TUNEDROP_MODE=server`**). En local no hay Turnstile, límites por IP, topes ni ZIP: los archivos se guardan directamente en la carpeta de música (ajuste guardado en `settings.json`, si no `DOWNLOAD_DIR`, si no `<home>/Music/tunedrop`), las playlists en una subcarpeta con su título y nunca se sobrescribe (` (1)`, ` (2)`...). Los archivos no se borran por TTL; solo se purgan filas antiguas de la base de datos. `JobState.savedTo`, `GET /api/config` con `mode` y `downloadDir`, `GET`/`PUT /api/settings` (validación de ruta documentada en `docs/security.md`) y `POST /api/open-folder` (sin shell, solo dentro de la carpeta de música).
- **Un solo proceso**: `npm run start:local` arranca API y worker juntos (`startWorker()`), en el primer puerto libre desde `API_PORT` (hasta 10), solo en `127.0.0.1`, y abre el navegador (`TUNEDROP_NO_BROWSER=1` lo evita). En local los datos van a la carpeta de aplicación del sistema salvo que se defina `DATA_DIR`.
- **Protecciones de la app local**: rechazo (403) de `Host` que no sea loopback con el puerto real (DNS rebinding), de `Origin` ajeno y de `Sec-Fetch-Site` distinto de `same-origin`/`none` en `/api`, sin cabeceras CORS. Los `PUT` también exigen JSON.
- **Binarios empaquetados**: `yt-dlp` y `ffmpeg` se buscan primero en `bin/` (`TUNEDROP_BIN_DIR`), luego en `YT_DLP_PATH`/`FFMPEG_PATH` y por último en el PATH. En local, `yt-dlp -U` se ejecuta al arrancar como mucho una vez cada 24 h y solo sobre el binario de `bin/` (`YT_DLP_AUTO_UPDATE=0` lo desactiva).
- **Empaquetado**: `npm run build` genera `backend/dist/tunedrop.mjs` (un único archivo ESM con esbuild); la interfaz se busca en `<script>/web` y después en `frontend/dist` (`STATIC_DIR` manda).
- **CI en GitHub Actions** (`.github/workflows/ci.yml`): en cada pull request y push a `main` ejecuta typecheck y tests del backend, typecheck y build del frontend, y una auditoría informativa de dependencias. Incluye Dependabot semanal y plantilla de pull request.
- **Arranque automático del backend**: tarea programada `tunedrop-backend` (al iniciar sesión, sin administrador) con un supervisor sin ventana que reinicia la API y el worker si se caen, evita instancias duplicadas, limpia procesos huérfanos al arrancar y guarda logs con rotación en `backend/data/logs`.
- `scripts/install-tunnel-service.ps1`: instala `cloudflared` como servicio de Windows con inicio automático (requiere administrador).
- **Playlists más rápidas**: el worker descarga varias canciones de un trabajo a la vez (`TRACK_CONCURRENCY`, por defecto 3) con un tope global de descargas simultáneas entre todos los trabajos (`MAX_PARALLEL_DOWNLOADS`, por defecto 4). Con 6 canciones reales: 121 s en serie frente a 63 s con 3 en paralelo. Cada pista registra en el log su duración en ms.
- `scripts/status.ps1` (estado de tarea, procesos, API, túnel y acceso público) y `scripts/stop-backend.ps1` (detención completa).
- **Límites por IP** con `@fastify/rate-limit` usando la IP real de `CF-Connecting-IP` (120 peticiones/min a `/api/*`, 20 a `/api/resolve`, 6 a `POST /api/jobs`, 30 a las descargas); respuesta 429 en español con `Retry-After`.
- **Topes**: `MAX_QUEUED_JOBS` (30), `MAX_ACTIVE_JOBS_PER_IP` (2) y `MAX_DISK_MB` (4096, 503 al llenarse). Nueva columna `jobs.client_key` (huella HMAC de la IP, nunca la IP) con migración segura.
- **Cloudflare Turnstile**: `GET /api/config`, verificación del token en `POST /api/jobs` (falla cerrado) y componente `TurnstileWidget` en la interfaz; la CSP permite `challenges.cloudflare.com`.
- **Interfaz del modo local**: la interfaz lee `mode` de `/api/config`; en modo local no hay Turnstile ni descarga del navegador, y al terminar muestra «Guardado en <ruta>» con «Abrir carpeta» (`POST /api/open-folder`). Incluye insignia «Modo local», diálogo de ajustes (engranaje) para cambiar la carpeta de guardado (`/api/settings`) y la línea «Se guardará en …» en la vista previa. El modo servidor no cambia.
- El worker borra las filas de trabajos terminados con más de 24 h (minimización de datos).

### Eliminado
- **Soporte de Spotify**: tunedrop vuelve a ser solo YouTube y YouTube Music. Se quitan el resolver de Spotify, el emparejamiento en YouTube, el etiquetado con datos de Spotify, la descarga de portadas, las variables `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET`, el origen `i.scdn.co` de la CSP y el campo `album`. El motivo: desde 2026 la API de Spotify no permite leer playlists con credenciales de aplicación (exige que cada usuario inicie sesión y limita las apps nuevas a muy pocos usuarios), y mantener el resto (búsqueda, coincidencias, etiquetas) daba demasiados problemas. Los metadatos y la portada de YouTube se incrustan siempre. Las bases de datos existentes siguen funcionando: la columna `album` queda sin usar.

### Cambiado
- El procesamiento de un trabajo salió de `worker/index.ts` a `worker/runner.ts` (con pruebas sin red); el reintento único por pista, el timeout, los nombres numerados y el estado final del trabajo se mantienen.

### Corregido
- Las pruebas ya no leen `backend/.env` (se detectan por `NODE_TEST_CONTEXT`), así que no dependen de la configuración real de la máquina (p. ej. las claves de Turnstile).
- Las pruebas del worker escribían en la base de datos real (`backend/data`) por un `import` estático que cargaba la configuración antes de fijar `DATA_DIR`; ahora usan una carpeta temporal.

### Decisiones y estado (2026-10-08, para retomar en otra sesión)
- **Dirección: local-first.** Cada persona ejecuta en su propio PC la parte que descarga; la web pública solo presenta e instala. Motivo: YouTube bloquea las IPs de servidores (probado en un VPS con 10 clientes distintos de `yt-dlp`: todos piden iniciar sesión; saliendo por una IP de casa mediante un túnel SSH inverso sí funciona), y así ninguna IP concentra las descargas ni se aloja contenido de terceros. La versión «servidor» (límites por IP, Turnstile, ZIP) se conserva como modo opcional.
- **Spotify descartado**: su API ya no permite leer playlists con credenciales de app.
- **Programa de escritorio (instalador, Electron o Tauri): fases posteriores.** Primero un zip con todo incluido; después un instalador `.exe` con Inno Setup; la ventana propia solo si hay demanda real. Todo reutiliza el mismo motor local con la interfaz web.
- **Infraestructura actual (pruebas privadas, en el PC del propietario):** `tunedrop.wilrd14.dev` por Cloudflare Tunnel (túnel `tunedrop`) con Cloudflare Access solo para el propietario; widget de Turnstile `tunedrop` creado; backend como tarea programada `tunedrop-backend`. Ver `docs/deployment-cloudflare.md`.
- **Rama `feat/modo-local`** (sin fusionar a `main`): ya contiene la página `site/`. El modo local (backend y frontend) lo estaba construyendo un agente en una copia de trabajo aparte (`git worktree list`, rama `worktree-agent-…`) y puede no estar fusionado todavía; antes de seguir, comprobar si esa rama existe y qué trae.
- **Aviso al reiniciar con el código nuevo:** el modo por defecto pasa a ser `local`. Para conservar el despliegue privado actual hay que poner `TUNEDROP_MODE=server` en `backend/.env` antes de reiniciar el backend.

### Pendiente (orden sugerido)
1. Fusionar el modo local y comprobarlo: guardar en carpeta, arranque en un solo proceso, protecciones contra peticiones de otras webs, auto-actualización de `yt-dlp` y `npm run build`.
2. Empaquetado para Windows: zip con Node, la app, `yt-dlp` y `ffmpeg`, más `Iniciar tunedrop.bat`, avisos de licencia (GPL-3.0), sumas SHA-256 y un workflow de GitHub Actions que publique la Release (`tunedrop-windows-x64.zip`).
3. Publicar `site/` en Cloudflare Pages (root `site`, sin build). Antes hay que liberar el nombre `tunedrop.wilrd14.dev`, que hoy apunta al túnel con Access (retirar o mover ese túnel y su aplicación de Access).
4. Reescribir el README con el enfoque local-first.
5. Instalador `.exe` (Inno Setup), paquetes para macOS y Linux, y firma de código.
6. Programa de escritorio con ventana propia (Electron o Tauri), solo si hay demanda.
7. Decidir qué hacer con el VPS (descartado para descargar) y con la instancia privada actual; tomar la decisión legal antes de promocionar el proyecto.
8. Menores: limpiar artista y título de videos subidos por canales («… Official YouTube», «(Music Video)»); probar un `yt-dlp` que no sea el `.exe` de un solo archivo para acortar el arranque (≈5-10 s por canción); imagen para las vistas previas al compartir la web; verificar los avisos de macOS y Linux de la página.

## [0.1.0] - 2026-10-08

Primera versión funcional, en pruebas privadas en `tunedrop.wilrd14.dev`.

### Añadido

#### Descarga
- Canciones y playlists de **YouTube** y **YouTube Music** (`music.youtube.com/playlist?...` incluido) mediante yt-dlp.
- Canciones y álbumes de **Spotify**: se leen los metadatos con la API de Spotify, se busca en YouTube la versión que mejor coincide (por duración, título y artista, penalizando en vivo, covers y remixes) y se etiqueta con los datos de Spotify.
- Salida en **MP3 (320 kbps)** o **M4A** con título, artista, álbum y **portada** incrustados.
- Una canción se entrega como archivo suelto y una playlist como **ZIP** con las pistas numeradas.
- Selección de pistas antes de descargar (hasta 100 por descarga).
- Cada pista que falla se **reintenta una vez**; el error real de yt-dlp queda en el log del servidor.
- Los archivos se **borran solos** a los 30 minutos.

#### Backend (`backend/`)
- API con Fastify y **worker** en procesos separados, con una **cola persistente en SQLite** (`node:sqlite`) que sobrevive a reinicios.
- Progreso en tiempo real por **SSE** y entrega de archivo o ZIP en streaming.
- Resolvers como piezas intercambiables (`youtube`, `spotify`) detrás de una interfaz común.
- El backend puede **servir la interfaz compilada** en el mismo origen que la API.
- 86 pruebas con `node:test`, incluida integración real de etiquetado con ffmpeg.

#### Interfaz (`frontend/`)
- React + Vite + Tailwind en español, con tema claro y oscuro, responsive y accesible.
- Vista previa con portada y pistas, selector MP3/M4A, progreso por canción y total, y descarga automática al terminar.
- La descarga en curso se conserva al cerrar la pestaña y se retoma al volver.
- Aviso cuando el servidor no está disponible o falta yt-dlp o ffmpeg.

#### Despliegue y operación
- Túnel de **Cloudflare Tunnel** de configuración remota, registro DNS y aplicación de **Cloudflare Access** que solo permite el correo del propietario, creados con el CLI `cf`.
- Scripts de PowerShell para comprobar herramientas y arrancar backend y frontend.

#### Documentación
- README, arquitectura, guía de despliegue en Cloudflare, fases y política de seguridad.

### Seguridad
- Cabeceras de seguridad y **CSP** estricta (API y frontend, sin scripts en línea).
- Los `POST` solo se aceptan como `application/json`; los identificadores de descarga deben ser **UUID**.
- Solo se sirven archivos dentro de `data/jobs`; los nombres de archivo se sanean (incluidos los nombres reservados de Windows).
- `yt-dlp` y `ffmpeg` se ejecutan **sin shell**, con las URLs detrás de `--` y validadas contra una lista de hosts.
- Las portadas solo se descargan de `i.scdn.co` e `i.ytimg.com`, por `https`, sin redirecciones y con límite de tamaño y tiempo.
- Límite de cuerpo (16 KB), tiempos máximos de petición y de conexión, y 10 minutos máximos por pista (en Windows se detiene todo el árbol de procesos).
- La API escucha solo en `127.0.0.1`; se expone únicamente por el túnel, y las credenciales viven en `backend/.env`, ignorado por git.

### Limitaciones conocidas
- **Las playlists de Spotify no se pueden leer**: su API exige que el usuario inicie sesión para ver las canciones de una lista (401/403 comprobado). Canciones y álbumes sí funcionan.
- El servicio solo está disponible mientras el PC esté encendido y el backend y `cloudflared` estén corriendo.
- `YT_DLP_PATH` no admite archivos `.cmd`, solo `.exe`.
- Al recargar una descarga ya terminada, el navegador puede volver a bajar el archivo una vez.

[Sin publicar]: https://github.com/wilrd14/Music_Downloader/compare/main...HEAD
[0.1.0]: https://github.com/wilrd14/Music_Downloader/pull/1
