# Seguridad

Basado en la guía de MDN [Seguridad de sitios web](https://developer.mozilla.org/es/docs/Learn_web_development/Extensions/Server-side/First_steps/Website_security) y adaptado a tunedrop.

**Regla principal:** nunca confiar en nada que venga del navegador ni de servicios externos (URLs, cuerpo de peticiones, cabeceras, títulos y artistas de YouTube). Todo se valida o se trata como texto.

Leyenda: ✅ cumplido en el código (con tests) · ⚠️ cumplido a medias · ⬜ pendiente (con la fase donde se hace).

## Amenazas y estado

| Amenaza | Riesgo en tunedrop | Estado | Pendiente |
|---|---|---|---|
| **XSS** | Títulos y artistas vienen de YouTube y se muestran en la interfaz. | ✅ React escapa el texto; no hay `dangerouslySetInnerHTML`, `innerHTML` ni `eval`. CSP estricta en `frontend/public/_headers` (sin scripts en línea; imágenes solo de `i.ytimg.com`; `script-src` y `frame-src` abiertos únicamente a `https://challenges.cloudflare.com` para Turnstile, igual en `app.ts`). | ⬜ Verificar la CSP ya desplegada en Pages y añadir el origen de la API a `connect-src` si es otro dominio. Regla: nunca insertar HTML de terceros. |
| **Inyección SQL** | SQLite compartido por API y worker. | ✅ Consultas con parámetros. La única SQL dinámica (`updateTrack`) arma columnas desde claves tipadas del código, nunca desde la petición. | Regla: nunca concatenar datos de usuario en SQL. |
| **CSRF** | Hoy no hay cookies ni sesión; con Cloudflare Access (fase privada) sí viaja una cookie. | ✅ Los POST solo se aceptan como `application/json` (415 en otro caso: obliga al preflight de CORS y frena formularios cruzados). CORS cerrado por defecto. `POST /api/jobs` exige además un token de Turnstile de un solo uso (anti-bots). | ⬜ Poner `CORS_ORIGIN` con el origen exacto al desplegar (nunca `*`). Si algún día hay cuentas: token anti-CSRF y cookies `SameSite=Strict`, `HttpOnly`, `Secure`. |
| **Clickjacking** | Alguien podría incrustar la web en un iframe. | ✅ `X-Frame-Options: DENY` y `frame-ancestors 'none'` en la API (`onRequest`) y en `_headers` del frontend. | — |
| **DoS** | yt-dlp y ffmpeg gastan CPU, disco y ancho de banda; es el riesgo principal al abrirlo al público. | ⚠️ **Límites por IP** (`@fastify/rate-limit`, IP de `CF-Connecting-IP`): 120/min en `/api/*`, 20 en `resolve`, 6 en `POST /api/jobs`, 30 en descargas. **Topes**: 30 trabajos en cola, 2 activos por IP, 4096 MB en `data/jobs`. **Turnstile** en `POST /api/jobs` (falla cerrado). Máx. 100 pistas por trabajo, concurrencia del worker limitada, borrado automático en 30 min, `bodyLimit` de 16 KB, `requestTimeout` y `connectionTimeout`, timeout de 60 s al resolver y de 10 min por pista (`TRACK_TIMEOUT_MINUTES`; en Windows se mata el árbol de procesos), API solo en `127.0.0.1`. | ⬜ Crear el widget de Turnstile y poner las claves en `backend/.env` (sin clave secreta no se verifica). Añadir reglas de rate limiting y WAF en Cloudflare como primera barrera. |
| **Salto de directorios** | Los nombres de archivo salen de títulos externos; la descarga sirve archivos del disco. | ✅ `sanitizeFileName` (quita `/ \ : ..`, nombres reservados de Windows). Los ids de `/api/jobs/:id*` deben ser UUID (404 si no). Solo se sirven archivos que estén dentro de `data/jobs`. Las rutas salen de la base de datos, nunca de la petición. | — |
| **Inclusión de archivos** | No hay subidas ni rutas elegidas por el usuario. | ✅ No aplica hoy. | Regla: no aceptar nunca rutas o nombres de archivo del cliente. |
| **Inyección de comandos** | Se ejecutan `yt-dlp` y `ffmpeg` con datos externos. | ✅ `spawn` con arreglo de argumentos y sin shell. Las URLs pasan por lista de hosts permitidos (YouTube y YouTube Music) y van detrás de `--` para que nunca se lean como opciones. | — |

## Recomendaciones generales

- **Secretos:** solo en `backend/.env` (ignorado por git). `.env.example` siempre vacío. Si un secreto se filtra, rotarlo de inmediato. Nunca registrar tokens ni secretos en logs ni en errores.
- **Contraseñas / 2FA:** no hay cuentas. Mientras sea privado, el acceso lo protege Cloudflare Access (lista de correos, con 2FA en tu cuenta de Cloudflare). Si más adelante hay cuentas, usar un proveedor de identidad en vez de guardar contraseñas.
- **HTTPS y HSTS:** Cloudflare termina TLS; activar *Always Use HTTPS* y HSTS en la zona `wilrd14.dev`. La API escucha solo en `127.0.0.1` y se expone únicamente por el túnel.
- **Minimizar datos:** no hay cuentas ni analítica personal. Los archivos y las pistas se borran a los 30 minutos. No se guardan IPs: los trabajos solo llevan una huella (16 hex de HMAC-SHA256 con un secreto aleatorio en `data/ip-secret`, que no se registra en logs) para contar descargas por IP, y el worker borra las filas de trabajos terminados a las 24 h. El rate limit mantiene las IPs solo en memoria.
- **Priorizar con OWASP:** revisar el [OWASP Top 10](https://owasp.org/www-project-top-ten/) antes de abrirlo al público (control de acceso, configuración insegura, componentes desactualizados, registro y monitoreo).
- **Dependencias:** `npm audit` en `backend/` y `frontend/` antes de cada despliegue; activar Dependabot cuando el código esté en GitHub. **Mantener yt-dlp actualizado**: es la pieza que más cambia.
- **Pruebas:** escáner de cabeceras (securityheaders.com) y, opcionalmente, OWASP ZAP contra el entorno de pruebas antes de abrir el acceso.
- **Usar frameworks:** seguir apoyándose en React (escape por defecto) y Fastify (validación) en lugar de reinventar.

## Checklist para abrir al público (Fase 4)

- [x] CSP, `X-Frame-Options`/`frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy` (API y `_headers`). HSTS: lo da Cloudflare, falta activarlo.
- [ ] CORS con origen exacto (`CORS_ORIGIN`) al desplegar.
- [x] POST solo `application/json`.
- [x] Rate limiting en la API (Fastify, por `CF-Connecting-IP`) y Turnstile en `POST /api/jobs` (falta crear el widget y poner las claves; reglas de Cloudflare opcionales).
- [x] Tope de cola global y por IP; cuota de disco.
- [x] `bodyLimit`, timeouts del servidor y timeout por pista.
- [x] `--` antes de las URLs en yt-dlp; UUID validado en `/api/jobs/:id*`; rutas servidas dentro de `data/jobs`.
- [ ] `npm audit` limpio y yt-dlp actualizado.
- [ ] Revisión del OWASP Top 10 y escaneo de cabeceras en el entorno real.
- [ ] Términos de uso y decisión legal tomada.

## Modo local: amenazas de una app en `127.0.0.1`

En modo local la API escucha solo en `127.0.0.1`, pero **cualquier página web que la persona visite** puede intentar llegar a ella desde su navegador. Las defensas (`backend/src/api/localGuard.ts`, probadas en `localGuard.test.ts` y `app.local.test.ts`):

| Amenaza | Defensa |
|---|---|
| **DNS rebinding**: un dominio atacante resuelve a `127.0.0.1` y la web lo usa como si fuera su propio origen. | Se rechaza (403) toda petición, también la de la interfaz, cuyo `Host` no sea `localhost`, `127.0.0.1` o `[::1]` **con el puerto real** de la app. |
| **Peticiones desde otras webs** (`fetch`, formularios, `EventSource`). | En `/api/*`, si hay `Origin` debe ser exactamente `http://<Host>` (el origen de la propia app); si hay `Sec-Fetch-Site` debe ser `same-origin` o `none`. Los `POST`/`PUT` solo aceptan `application/json`. Sin CORS: no se emite ninguna cabecera `Access-Control-*`, así que el navegador no deja leer respuestas de otro origen y el preflight recibe 403. |
| **Escribir fuera de la carpeta de música**. | Nombres saneados con `sanitizeFileName`; la subcarpeta de playlist se comprueba con `isInside`; `POST /api/open-folder` resuelve enlaces simbólicos y solo abre rutas iguales o dentro de la carpeta de música. Los archivos nunca se borran. |
| **Lanzar procesos con datos de usuario**. | `yt-dlp`, `ffmpeg`, `explorer.exe`/`open`/`xdg-open` se ejecutan con `spawn` **sin shell**; la ruta abierta sale del servidor, nunca del texto del cliente. |
| **Actualizar un binario ajeno**. | `yt-dlp -U` solo se ejecuta si el binario está en la carpeta `bin` empaquetada. |

Las peticiones sin `Origin` ni `Sec-Fetch-Site` (curl, scripts locales) se permiten: no provienen de un navegador ajeno y pueden fijar cualquier cabecera de todos modos. Un programa malicioso que ya corra en el PC de la persona queda fuera del modelo de amenazas.

### Regla de `PUT /api/settings` (carpeta de música)

Tras normalizar la ruta (`path.resolve`, que colapsa `..`), se acepta solo si:

1. Es texto no vacío, de hasta 1024 caracteres, sin NUL ni caracteres de control.
2. Es absoluta de verdad: en Windows empieza por unidad y separador (`C:\...`; se rechazan relativas, sin unidad como `\x` o `C:x`, UNC `\\servidor\recurso` y prefijos `\\?\` y `\\.\`); en macOS/Linux empieza por `/` (no se expande `~`).
3. No es la raíz del sistema de archivos (`/`, `C:\`).
4. No es la carpeta personal completa ni un contenedor de cuentas o montajes (`C:\Users`, `/home`, `/Users`, `/mnt`, `/media`, `/Volumes`, `/tmp`, `/opt`, `/srv`, `/var`), ni cuelga de una zona del sistema: Windows (`Windows`, `Program Files`, `Program Files (x86)`, `ProgramData`, `$Recycle.Bin`, `System Volume Information`, `Recovery`, `Boot`); Linux (`/bin /boot /dev /etc /lib* /proc /root /run /sbin /sys /usr /snap /var/{lib,log,run,spool,cache,mail,db}`); macOS (`/System /Library /Applications /cores /private/etc`).
5. Se puede crear (`mkdir -p`) y escribir (se crea y borra un archivo de prueba).
6. Su ruta real (tras resolver enlaces simbólicos) también cumple 3 y 4.

Implementación: `checkDownloadDirShape` (pura, puntos 1 a 4) y `validateDownloadDir` en `backend/src/core/locations.ts`. El resultado se guarda en `<DATA_DIR>/settings.json`.
