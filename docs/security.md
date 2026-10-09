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
4 bis. (Windows, añadido en la auditoría de 2026-10-09) Ningún componente de la ruta es un nombre de dispositivo (`CON`, `NUL`, `COM1`, `COM¹`…), termina en punto o espacio, ni contiene `:`; y tampoco es el Menú Inicio de la cuenta (`...\AppData\Roaming\Microsoft\Windows\Start Menu`, que incluye la carpeta Inicio/Startup). Node crea esas carpetas sin la normalización de Win32, y el resultado (`C:\Windows.` junto a `C:\Windows`) confunde a Explorer y a otros programas.
5. Se puede crear (`mkdir -p`) y escribir (se crea y borra un archivo de prueba).
6. Su ruta real (tras resolver enlaces simbólicos, uniones y nombres cortos 8.3 con `realpath.native`) también cumple 3 y 4.

Implementación: `checkDownloadDirShape` (pura, puntos 1 a 4 bis) y `validateDownloadDir` en `backend/src/core/locations.ts`. El resultado se guarda en `<DATA_DIR>/settings.json`.

## Auditoría de seguridad (2026-10-09)

Auditoría defensiva y autorizada del propio repositorio (código, empaquetado, CI, scripts e historial de git). Método: lectura completa del código y de la configuración, y pruebas dinámicas contra instancias propias en `127.0.0.1` (modo local en el puerto 18787 y modo servidor en el 18788, con carpetas temporales y sin claves reales), más pruebas unitarias nuevas. No se tocó ningún servicio real (ni la instancia privada, ni el túnel, ni la web publicada). Para informar de una vulnerabilidad, ver [`SECURITY.md`](../SECURITY.md).

### Modelo de amenazas

| Actor | Qué puede hacer | Qué se protege |
|---|---|---|
| **Página web maliciosa** que la persona visita (modo local) | Enviar peticiones desde el navegador a `127.0.0.1:<puerto>`; apuntar un dominio propio a `127.0.0.1` (DNS rebinding); abrir `EventSource`, formularios, `sendBeacon`… | Que no pueda leer ni cambiar nada de la app local (ajustes, descargas, abrir carpetas, lanzar descargas). |
| **Otro proceso o usuario del mismo PC** (modo local) | Hablar con el puerto de bucle local sin autenticación. | Que no pueda salirse de la carpeta de música ni ejecutar programas. Ver «Riesgos residuales». |
| **Autor de un video o playlist** (títulos, artistas, ids, miniaturas) | Controlar texto que acaba en nombres de archivo, carpetas, la interfaz y argumentos de yt-dlp. | Sin inyección de argumentos, sin salto de directorios, sin XSS, sin nombres engañosos. |
| **Internet / bots** (modo servidor tras Cloudflare) | Muchas peticiones, muchas IPs, IPv6, conexiones largas. | Disponibilidad y topes de recursos (CPU, disco, cola, memoria). |
| **Cadena de suministro** | Dependencias npm, binarios incluidos (Node, yt-dlp, FFmpeg), acciones de GitHub, el propio flujo de Release. | Que el zip publicado solo contenga lo previsto, con huellas verificadas. |
| **Quien lea el repositorio público** | Buscar secretos, claves y datos personales en el árbol y en el historial. | Que no haya secretos. |

Fuera del modelo: un atacante que ya ejecuta código con la cuenta de la persona (puede hacer lo mismo sin tunedrop).

### Hallazgos

Gravedad: Crítica / Alta / Media / Baja / Informativa. «Corregida» = con prueba automática que falla antes y pasa después (salvo indicación). La gravedad de los puntos de modo servidor se indica para una instancia **abierta al público**; hoy es privada (Cloudflare Access), así que en la práctica es menor.

| ID | Gravedad | Componente | Descripción | Evidencia / cómo se verificó | Estado |
|---|---|---|---|---|---|
| S-01 | Baja | Modo local, `localGuard` / `app.ts` | `isApi` se calculaba con `req.url.startsWith('/api/')`; Fastify decodifica los `%xx` antes de enrutar, así que `GET /%61pi/settings` llegaba a `/api/settings` **sin** las comprobaciones de `Origin` y `Sec-Fetch-Site`. La comprobación de `Host` (la que frena el DNS rebinding) sí se aplicaba y un `POST` cruzado sigue necesitando un preflight sin CORS, por lo que no hubo vía de explotación completa: era un hueco de defensa en profundidad. | Dinámica: con `Origin: http://evil.com` + `Sec-Fetch-Site: cross-site`, `/api/settings` daba 403 y `/%61pi/settings` daba 200. Tras el arreglo, 403. | **Corregida** (`isApiRequest`: ruta cruda, decodificada y enrutada). Prueba: `app.hardening.test.ts`. |
| S-02 | Media | Descarga (`naming.ts` + yt-dlp) | Integridad de archivos de la persona. yt-dlp toma por «ya descargado» cualquier archivo existente `<nombre>.<ext original>` y, al convertir, lo **borra**. Si ya existía `Artista - Tema.m4a` (o `.webm`, `.opus`, la miniatura `.jpg`/`.webp`…) y se descargaba `Artista - Tema` como MP3, la app elegía el mismo nombre (solo miraba `.mp3`) y yt-dlp consumía el archivo ajeno. Contradecía «los archivos nunca se borran». | Dinámica y local (fuente en `127.0.0.1`, no YouTube): con un `.m4a` válido preexistente, yt-dlp 2026.08.19 imprimió «has already been downloaded», convirtió y «Deleting original file …m4a». | **Corregida**: el nombre `(1)` también esquiva esos archivos intermedios (`SIBLING_EXTENSIONS`) y la reserva es por nombre base. Pruebas: `naming.test.ts`. |
| S-03 | Baja | Modo local, `PUT /api/settings` (`locations.ts`) | La validación de la carpeta de música aceptaba, en Windows, nombres de dispositivo (`C:\CON`, `C:\nul`) y componentes con punto final: `C:\Windows.` creaba una carpeta real distinta de `C:\Windows` (Node usa rutas sin normalizar), que Explorer confunde con ella y que esquivaba la lista de zonas del sistema. Tampoco se bloqueaba la carpeta Inicio (Startup) del usuario. Solo lo alcanza quien ya habla con el puerto local (otro proceso/usuario); los archivos que escribe la app son solo audio. | Dinámica: `PUT` con `C:\CON`, `C:\nul` y `C:\Windows.` devolvió 200 y creó esas carpetas, vacías, en la raíz del disco (hay que borrarlas con una ruta `\\?\`, p. ej. `rmdir \\?\C:\Windows.`). Con ADS (`dir:stream`), UNC, `\\?\`, `..`, uniones hacia `System32`: ya se rechazaban. | **Corregida** (reglas «4 bis» y `realpath.native`, que además expande `PROGRA~1`). Pruebas: `locations.test.ts`. |
| S-04 | Media (servidor) / Baja (local) | `GET /api/jobs/:id/events` | Sin tope de conexiones SSE: cada una consulta SQLite cada 600 ms hasta que termina el trabajo. Un solo cliente con cientos de conexiones deja sin respuesta al servidor (aunque el rate limit cuenta peticiones, no conexiones abiertas). | Dinámica: 800 conexiones abiertas -> `/api/health` tardó 2788 ms. Tras el arreglo: 200 aceptadas, resto 429, `/api/health` en 8 ms. | **Corregida**: `MAX_SSE_TOTAL` (200) y `MAX_SSE_PER_IP` (10, solo servidor), 429 con `Retry-After`. Pruebas: `app.hardening.test.ts`. |
| S-05 | Media (servidor público) | Límites por IP (`clientIp.ts`, `app.ts`) | Los límites y el tope de descargas activas contaban por dirección exacta: con IPv6 cada persona controla un /64 (2^64 direcciones) y `::ffff:a.b.c.d` es otra clave distinta de `a.b.c.d`; rotando direcciones se evadía el límite. (Que la cabecera `CF-Connecting-IP` se pueda falsificar solo importa si se llega al puerto sin pasar por Cloudflare; ver A-06.) | Dinámica: 30 peticiones desde 30 direcciones de un mismo /64 -> 30 aceptadas (límite 20/min). Tras el arreglo: 20 aceptadas, 10 con 429; igual para la forma mapeada. | **Corregida** (`rateLimitKey`: /64 en IPv6, IPv4 mapeada -> IPv4; también para el tope por cliente). Pruebas: `clientIp.test.ts`, `app.hardening.test.ts`. |
| S-06 | Baja | `POST /api/resolve` y `POST /api/jobs` | Caché de resolución sin tope de entradas (la clave la elige quien llama, cada valor pesa hasta cientos de KB) y sin límite de procesos yt-dlp simultáneos; peticiones iguales simultáneas lanzaban un proceso cada una. | Lectura de código; comportamiento verificado con pruebas. | **Corregida**: 200 entradas máx., consultas iguales compartidas, `MAX_CONCURRENT_RESOLVES` (8) con 503. Pruebas: `app.hardening.test.ts`. |
| S-07 | Baja | `sanitizeFileName` | No quitaba caracteres de dirección ni invisibles: U+202E (RLO) hace que un archivo `Tema\u202Egpj.mp3` se muestre como «Tema 3pm.jpg» (extensión disfrazada). La extensión real la fija la app (`.mp3`/`.m4a`), así que no hay ejecución, solo engaño visual. Tampoco reservaba `COM¹`/`LPT²`. | Lectura de código + pruebas. | **Corregida**. Pruebas: `files.test.ts`. |
| S-08 | Baja | Ejecución de yt-dlp | yt-dlp carga `yt-dlp.conf` de la carpeta actual, de la del ejecutable y del perfil; una línea `--exec` ahí ejecutaría un programa en cada descarga. Alcanzable si la persona lanza tunedrop desde una carpeta (p. ej. Descargas) donde otro contenido plantó ese archivo. | Lectura de código y de la documentación de yt-dlp; `--ignore-config` comprobado con el yt-dlp real. | **Corregida**: `--ignore-config` con el yt-dlp empaquetado (los usuarios que ejecutan desde el código fuente con su yt-dlp mantienen su configuración) y el `.bat` hace `pushd` a su carpeta. Pruebas: `youtube.test.ts`. |
| S-09 | Baja | `explorer.exe` y `taskkill` | Se lanzaban por nombre; Windows (libuv) busca primero en la carpeta actual, así que un `explorer.exe` plantado allí se ejecutaría. | Lectura de código. | **Corregida** (`windowsSystemFile`, ruta absoluta desde `%SystemRoot%`). Pruebas: `platform.test.ts`. |
| S-10 | Baja | `youtube.ts` | Los enlaces con puerto (`youtube.com:8080`) o credenciales (`usuario:clave@`) llegaban a yt-dlp; los ids de pista (que salen de la salida de yt-dlp) se insertaban sin validar en la URL y en la ruta de la miniatura. No es SSRF (el anfitrión debe ser de YouTube) ni inyección (hay `--`), pero se cierra. | 26 formas de URL probadas (`@`, `\`, `%2f`, punto final, mayúsculas, IDN, `file:`, `javascript:`…): solo hosts de YouTube pasan. | **Corregida**. Pruebas: `youtube.test.ts`. |
| S-11 | Informativa | Cabeceras | La API no marcaba `Cache-Control: no-store`; la CSP de la interfaz en modo local abría `challenges.cloudflare.com` aunque no hay Turnstile; el SSE repetía `Cache-Control`. | Dinámica y pruebas. | **Corregida**. Pruebas: `app.hardening.test.ts`. |
| S-12 | Informativa | CI / Dependabot | `checkout` guardaba credenciales en el repositorio local; `deploy/` no estaba en la auditoría de CI ni en Dependabot. | Lectura. | **Corregida** (`persist-credentials: false`, auditoría y Dependabot de `deploy/`). Sin prueba automática. |
| A-01 | Media (solo PC compartido) | Modo local | La API local no tiene autenticación: cualquier proceso o **usuario del mismo PC** puede hablar con `127.0.0.1:<puerto>` (el bucle local es común a todas las cuentas de Windows). Puede lanzar descargas (solo YouTube, solo audio), cambiar la carpeta de música a otra que la víctima pueda escribir (pasa por las reglas de arriba), leer el estado de los trabajos y la ruta de la carpeta, y abrir el Explorador en la sesión de la víctima. No puede ejecutar programas, escribir fuera de la carpeta de música ni leer archivos. | Dinámica (peticiones sin `Origin` se aceptan por diseño) y lectura de código. | **Riesgo aceptado** para PC de una sola persona. Recomendación si se quiere cerrarlo: un secreto por sesión que solo conozca el navegador abierto por la app (p. ej. en el fragmento de la URL que abre el Explorador, enviado luego como cabecera) y exigirlo en `/api/*`; no protege de un malware con la misma cuenta. |
| A-02 | Baja | Cadena de suministro | `yt-dlp -U` descarga la última versión de GitHub al arrancar (como mucho cada 24 h), así que el yt-dlp en uso no es el que fijan las huellas del zip. yt-dlp verifica su propia actualización (SHA-2-256 de la versión publicada), pero se confía en el proyecto y en su cuenta de GitHub. | Lectura de `update.ts` y de la documentación de yt-dlp. | **Riesgo aceptado**: YouTube cambia a menudo y una versión fija se rompería en semanas. Quien no lo quiera: `YT_DLP_AUTO_UPDATE=0`. |
| A-03 | Baja | Release | El zip no está firmado (SmartScreen avisa) y la Release no publica atestaciones de procedencia (SLSA). La huella SHA-256 está en el mismo sitio (la Release) que el zip, así que solo detecta corrupción, no una Release manipulada. | Lectura de `release.yml`. | **Abierta**. Recomendación: `actions/attest-build-provenance` (verificable con `gh attestation verify`) y, si hay presupuesto, firma Authenticode; publicar la huella también en la web o en el CHANGELOG (otro canal). |
| A-04 | Baja | `release.yml` | Cualquier persona con permiso de escritura puede lanzar una Release desde cualquier rama (`workflow_dispatch`) o subiendo una etiqueta `v*`; el trabajo no depende de que pasen los tests. Un PR de un fork **no** puede dispararla (solo `push` de etiquetas y `workflow_dispatch`) ni ve secretos; la versión se valida con una expresión regular y no se interpola en `run:`. | Lectura. | **Abierta** (depende de ajustes de GitHub). Recomendación: protección de etiquetas `v*`, entorno `release` con aprobación y comprobar que el commit está en `main` (ver lista de ajustes). |
| A-05 | Baja (servidor) | Turnstile | Sin `TURNSTILE_SECRET_KEY` no se verifica nada (solo un aviso en el log). Es el comportamiento documentado para desarrollo, pero abre el servicio a bots si se olvida la clave al exponerlo. Con clave, el flujo falla cerrado (token ausente, inválido, red caída o error de configuración -> 400/403/503) y el secreto no se registra. | Pruebas existentes (`app.limits.test.ts`) y lectura. | **Riesgo aceptado** mientras el servicio sea privado (Access). Recomendación: al abrirlo al público, negarse a arrancar en modo servidor sin la clave. |
| A-06 | Baja (servidor) | `CF-Connecting-IP` | Se confía en la cabecera porque la API solo escucha en `127.0.0.1` y solo `cloudflared` llega ahí. Quien alcance el puerto sin pasar por Cloudflare (otro proceso del servidor) puede falsificar su IP y esquivar límites. Además, Cloudflare Access no se comprueba en la propia API. | Dinámica: con la cabecera falsificada cada petición cuenta como una IP nueva. | **Riesgo aceptado** por diseño. Recomendación: mantener `127.0.0.1`, no exponer el puerto, y si se abre al público validar el JWT de Access (`Cf-Access-Jwt-Assertion`). |
| A-07 | Informativa | Repositorio | Búsqueda en todo el historial (42 commits): **ninguna clave, token, `.env` ni contraseña**; `backend/.env.example` está vacío. Hay identificadores de Cloudflare (ID de zona, de aplicación de Access y del túnel) en `docs/deployment-cloudflare.md` y `scripts/install-tunnel-service.ps1`, y el correo personal del autor en los metadatos de 31 commits (y, en un commit antiguo, en la documentación). No aparece la IP del VPS. Los identificadores no son secretos y no permiten acceder a nada sin credenciales. | `git log --all -p` con patrones (`BEGIN … PRIVATE KEY`, `eyJ…`, `ghp_`, `AKIA`, `xox`, `sk-`, hex/base64 largos, IPs y correos). | **Informativa**; no se reescribe el historial. Recomendación: activar «Keep my email address private» en GitHub para los commits nuevos. |
| A-08 | Informativa | Varios | `GET /api/health` devuelve la versión de yt-dlp; CSP con `style-src 'unsafe-inline'` (estilos en línea de React; los scripts son estrictos: `'self'` y, en servidor, Turnstile); carpeta `web/` del zip incluye el archivo `_headers` (sin efecto, el servidor local no lo sirve); `.env` junto a `tunedrop.mjs` se carga si existe (quien puede escribir ahí ya puede sustituir los binarios). | Dinámica y lectura. | **Riesgo aceptado**. |
| A-09 | Informativa | `scripts/` | `install-tunnel-service.ps1` pasa el token del túnel a `cloudflared service install <token>` (comportamiento de cloudflared: el token queda en la configuración del servicio, legible por administradores y visible un instante en la lista de procesos); `stop-backend.ps1`/`service-backend.ps1` cierran cualquier `node`/`cmd` cuya línea de comandos contenga la ruta del backend; las tareas programadas corren con el usuario, sin elevar, y sin guardar secretos. No se encontraron rutas sin comillas ni inyección con espacios. | Lectura. | **Riesgo aceptado** (PC personal). |

Resultados sin hallazgos (cómo se comprobó):

- **DNS rebinding y `Host`**: 17 variantes (`localhost.`, `127.0.0.1.nip.io`, mayúsculas, puerto ajeno, sin puerto, `usuario@`, `0x7f.1`, `2130706433`, `127.1`, lista, vacío, HTTP/1.0 sin `Host`) -> solo `localhost`, `127.0.0.1` y `[::1]` con el puerto real dan 200.
- **CSRF / `Origin` / `Sec-Fetch-Site` / preflight**: `Origin: null`, `Origin` ajeno, `same-site`, `cross-site`, `OPTIONS` -> 403; `Content-Type` `text/plain`, formulario, `multipart`, sin tipo -> 415; no hay ninguna cabecera `Access-Control-*` en modo local, no hay WebSocket ni `GET` con efectos.
- **Archivos estáticos**: 20 rutas de salto de directorios (`..`, `%2e%2e`, `%2f`, `\`, `%00`, doble codificación, unidad `C:`) -> ninguna sirve un archivo fuera de la carpeta de la interfaz; `_headers` no se expone. Los ids de `/api/jobs/:id*` solo aceptan UUID.
- **Inyección de comandos**: todos los `spawn` usan arreglo de argumentos y sin shell; las URLs van tras `--`; el `%` de la plantilla `-o` se escapa; las rutas de `open-folder` salen del servidor y se resuelven con enlaces simbólicos contra la carpeta de música; no hay `exec`/`shell:true`.
- **SSRF**: solo hosts de YouTube (26 formas de URL probadas, ver S-10); la URL de cada pista se construye desde el id, no desde la entrada.
- **ReDoS**: la única expresión regular sobre la entrada (`/shorts|live/…`) tardó 0 ms con 200 000 caracteres.
- **SQL**: consultas con parámetros; la única SQL dinámica usa claves tipadas del código. Base y `settings.json` en `%LOCALAPPDATA%\tunedrop` (privada de la cuenta); escritura atómica.
- **XSS y frontend**: sin `dangerouslySetInnerHTML`, `innerHTML` ni `eval`; sin `target="_blank"`; el único `localStorage` guarda el tema y el id del trabajo; Turnstile es el único script de terceros (solo en servidor).
- **Cabeceras de ZIP**: `Content-Disposition` solo ASCII sin comillas, `;` ni `%` más `filename*` codificado; las entradas del zip salen de rutas de la base dentro de `data/jobs`.
- **Dependencias**: `npm audit` -> 0 vulnerabilidades en `backend`, `frontend` y `deploy`; todo viene de `registry.npmjs.org` con `integrity`; solo `esbuild`, `fsevents` y `workerd` tienen scripts de instalación (legítimos); rangos con `^` pero `npm ci` con lockfile.
- **Empaquetado**: `build.ps1` descarga solo por HTTPS, verifica SHA-256 contra `versions.json` y falla duro; las huellas de Node, yt-dlp y FFmpeg de `versions.json` **coinciden con los archivos de sumas oficiales** (nodejs.org, GitHub de yt-dlp y de BtbN, comprobado el 2026-10-09); las extracciones van a rutas fijas (sin zip-slip); el `.js` empaquetado no contiene mapas de fuentes ni rutas del desarrollador.
- **CI/CD**: sin `pull_request_target`; permisos mínimos (`contents: read`, `contents: write` solo en el trabajo de Release); sin expresiones `${{ github.* }}` dentro de `run:` (la versión entra por variable de entorno y se valida); solo acciones de GitHub (`actions/*`) con etiqueta mayor.

No verificado: Linux y macOS (`xdg-open`, `open`) solo por lectura de código; una descarga real de YouTube (por reglas de la auditoría solo se usó una fuente local para reproducir S-02); la validación real de Turnstile (sin clave); la entrega del ZIP con trabajos reales en modo servidor.

### Riesgos residuales de la app local

- **Otros usuarios o procesos del mismo PC** pueden usar la API (A-01). Un malware con la cuenta de la persona puede hacer más sin tunedrop.
- **Confianza en terceros**: yt-dlp (que se actualiza solo), FFmpeg y Node.js incluidos; yt-dlp y FFmpeg procesan contenido remoto no confiable (un fallo de FFmpeg al convertir audio de YouTube sería explotable con la cuenta de la persona). Se mitiga actualizando tunedrop y yt-dlp.
- **Sin firma de código** (A-03): hay que comprobar la huella.
- **Un navegador desactualizado** o extensiones maliciosas pueden saltarse las protecciones del navegador en las que se apoya la defensa (Host/Origin/Sec-Fetch).
- La **carpeta de música** puede apuntar a cualquier carpeta propia de la persona; los archivos solo son audio con extensión fija (`.mp3`/`.m4a`) y no se sobrescriben.

### Lista de ajustes recomendados en GitHub (solo el dueño puede cambiarlos)

- [ ] **Secret scanning** y **push protection** activados (Settings > Code security).
- [ ] **Dependabot alerts** y **Dependabot security updates** activados (el archivo `dependabot.yml` ya cubre `backend`, `frontend`, `deploy` y las acciones).
- [ ] **Private vulnerability reporting** activado (Settings > Code security) para que funcione el enlace de `SECURITY.md`.
- [ ] **Code scanning** (CodeQL, configuración por defecto) para JavaScript/TypeScript.
- [ ] **Protección de la rama `main`**: PR obligatorio, comprobaciones requeridas (`Backend`, `Frontend`), rama al día, sin push forzado ni borrado, resolver conversaciones.
- [ ] **Protección de etiquetas** (Rulesets > Tag) para `v*`: solo el dueño las crea, sin borrar ni mover.
- [ ] **Entorno `release`** con aprobación manual requerida y usar `environment: release` en `release.yml`; limitar la rama de despliegue a `main`/etiquetas.
- [ ] Commits firmados obligatorios (opcional pero recomendable) y «Keep my email address private».
- [ ] **Actions**: permitir solo acciones de GitHub y de creadores verificados (Settings > Actions > General); permisos por defecto del `GITHUB_TOKEN` en «solo lectura»; exigir aprobación para ejecutar workflows de colaboradores externos; no permitir que Actions cree PRs.
- [ ] Activar 2FA con llave de seguridad en la cuenta de GitHub y en la de Cloudflare.

### Cómo repetir las pruebas

`cd backend && npm run typecheck && npm test` (las pruebas nuevas están en `src/api/app.hardening.test.ts`, `clientIp.test.ts`, `naming.test.ts`, `files.test.ts`, `locations.test.ts`, `youtube.test.ts` y `platform.test.ts`). Para repetir las pruebas dinámicas: arrancar `TUNEDROP_NO_BROWSER=1 DATA_DIR=<temp> DOWNLOAD_DIR=<temp> API_PORT=<libre> npm run start:local` y atacar solo esa instancia.
