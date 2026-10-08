# Changelog

Todos los cambios relevantes de este proyecto se documentan aquí.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto aspira a seguir [Versionado Semántico](https://semver.org/lang/es/). Mientras esté en pruebas privadas, las versiones `0.x` pueden cambiar sin aviso.

## [Sin publicar]

### Añadido
- **CI en GitHub Actions** (`.github/workflows/ci.yml`): en cada pull request y push a `main` ejecuta typecheck y tests del backend, typecheck y build del frontend, y una auditoría informativa de dependencias. Incluye Dependabot semanal y plantilla de pull request.
- **Arranque automático del backend**: tarea programada `tunedrop-backend` (al iniciar sesión, sin administrador) con un supervisor sin ventana que reinicia la API y el worker si se caen, evita instancias duplicadas, limpia procesos huérfanos al arrancar y guarda logs con rotación en `backend/data/logs`.
- `scripts/install-tunnel-service.ps1`: instala `cloudflared` como servicio de Windows con inicio automático (requiere administrador).
- `scripts/status.ps1` (estado de tarea, procesos, API, túnel y acceso público) y `scripts/stop-backend.ps1` (detención completa).

### Pendiente
- Instalar el servicio del túnel (`install-tunnel-service.ps1`) con permisos de administrador y desactivar la suspensión del PC.
- Límite de peticiones por IP, Cloudflare Turnstile, tope de cola y cuota de disco (ver `docs/security.md`).
- Procesar varias canciones de una playlist a la vez (hoy son unos 19 s por canción).
- Probar un álbum de Spotify de varias canciones y limpiar artista y título de videos subidos por canales (p. ej. «… Official YouTube», «(Music Video)»).
- Decisión legal y host siempre encendido antes de abrirlo al público.

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
