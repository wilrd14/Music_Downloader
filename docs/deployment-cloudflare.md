# Despliegue con Cloudflare (fase de pruebas)

Arquitectura: frontend estático en **Cloudflare Pages**, backend en tu PC (Windows) expuesto con **Cloudflare Tunnel**, y opcionalmente **Cloudflare Access** delante para restringir por correo durante las pruebas privadas.

Nombres usados en esta guía (provisionales, cámbialos a gusto):

| Pieza | Hostname |
|---|---|
| Frontend (Pages) | `tunedrop.wilrd14.dev` |
| API (túnel) | `tunedrop-api.wilrd14.dev` |
| Nombre del túnel | `tunedrop` |

> **Verificación.** Los comandos de `cloudflared` (login, create, route dns, run, servicio de Windows), el formato de `config.yml` y la creación de aplicaciones de Access con política por correo se contrastaron con la documentación oficial de Cloudflare (developers.cloudflare.com, consultada vía búsqueda de documentación). **No se ejecutó nada** de lo descrito aquí. Los puntos marcados **[no verificado]** no pudieron confirmarse.

## 1. Instalar cloudflared en Windows

```powershell
winget install --id Cloudflare.cloudflared
```
**[no verificado]**: el id exacto del paquete en winget. Alternativa: descargar `cloudflared-windows-amd64.exe` desde <https://developers.cloudflare.com/tunnel/downloads/>. Cierra y reabre la terminal y comprueba con `cloudflared --version` (o `.\scripts\check-tools.ps1`).

## 2. Crear un túnel con nombre (gestionado localmente)

```powershell
cloudflared tunnel login                    # abre el navegador; elige la zona wilrd14.dev
cloudflared tunnel create tunedrop          # genera <UUID>.json en %USERPROFILE%\.cloudflared
cloudflared tunnel list
```
Anota el UUID y la ruta del archivo de credenciales.

## 3. config.yml

Crea `%USERPROFILE%\.cloudflared\config.yml`:

```yaml
tunnel: <UUID-DEL-TUNEL>
credentials-file: C:\Users\<TU-USUARIO>\.cloudflared\<UUID-DEL-TUNEL>.json

ingress:
  - hostname: tunedrop-api.wilrd14.dev
    service: http://127.0.0.1:8787
  - service: http_status:404
```

Valida con `cloudflared tunnel ingress validate`. La última regla (`http_status:404`) es obligatoria como "catch-all".

## 4. Ruta DNS

```powershell
cloudflared tunnel route dns tunedrop tunedrop-api.wilrd14.dev
```
Crea un CNAME proxied hacia `<UUID>.cfargotunnel.com`.

## 5. Probar en primer plano

Con el backend corriendo (`npm run start:api` y `npm run start:worker`, o `scripts\start-backend.ps1`):

```powershell
cloudflared tunnel run tunedrop
```
Prueba <https://tunedrop-api.wilrd14.dev/api/health>.

## 6. Ejecutar cloudflared como servicio de Windows

Según la guía oficial (CMD como administrador):

1. Coloca `cloudflared.exe` en `C:\Cloudflared\bin` y ejecuta `cloudflared.exe service install`.
2. Crea `C:\Windows\System32\config\systemprofile\.cloudflared` y copia ahí `cert.pem`, el `<UUID>.json` y `config.yml` (el servicio corre como SYSTEM y no lee tu perfil).
3. En `config.yml` apunta `credentials-file` a `C:\Windows\System32\config\systemprofile\.cloudflared\<UUID>.json`.
4. Si el servicio no usa tu config, edita en el registro `HKLM\SYSTEM\CurrentControlSet\Services\Cloudflared` el valor `ImagePath` a:
   `C:\Cloudflared\bin\cloudflared.exe --config=C:\Windows\System32\config\systemprofile\.cloudflared\config.yml tunnel run`
5. `sc start cloudflared`.

Para cambios posteriores de configuración, reinicia el servicio. **Ojo:** el túnel solo sirve mientras el PC esté encendido y los procesos del backend corriendo; el backend (API + worker) **no** es un servicio, hay que lanzarlo (ver `scripts\start-backend.ps1`).

## 7. Cloudflare Access (lista de correos) para la fase privada

En el panel de Cloudflare: **Zero Trust > Access controls > Applications > Create new application > Self-hosted**.

1. Añade el hostname público a proteger.
2. Crea una política **Allow** con regla *Include > Emails* y tus correos permitidos (una aplicación sin política deniega todo).
3. Guarda.

Etiquetas exactas del panel pueden variar ligeramente. Hay que proteger **tanto el frontend como la API**, pero véase la advertencia de CORS más abajo.

## 8. Frontend en Cloudflare Pages

Conecta el repositorio de Git y configura:

| Campo | Valor |
|---|---|
| Root directory | `frontend` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Variable de entorno | `VITE_API_BASE=https://tunedrop-api.wilrd14.dev` (ver TODO) |

Después, en el proyecto de Pages: **Custom domains** -> `tunedrop.wilrd14.dev`. La documentación oficial indica que el *root directory* sirve para proyectos donde el contenido no está en la raíz del repositorio, que es nuestro caso. Nota: Cloudflare está empujando la migración de Pages a Workers con static assets (existe una guía oficial de migración); Pages sigue documentado, pero conviene revisarlo al desplegar. **[no verificado]**: el estado de soporte/deprecación de Pages a la fecha.

## 9. Mismo hostname vs. API en subdominio separado

El frontend llama a rutas **relativas** `/api/...`. Hay dos formas de hacerlas llegar a la API:

**Opción A: mismo hostname.** `tunedrop.wilrd14.dev` sirve Pages y las rutas `/api/*` van al túnel. Requiere un Worker o Pages Function que haga proxy de `/api/*` hacia el hostname del túnel (y que soporte SSE y descargas largas/ZIP sin buffering), o una regla de ruta de Workers delante de Pages. No hay CORS ni cookies cross-site, y Access se configura una sola vez. Contras: más piezas, límites de CPU/tiempo de los Workers para streaming largo **[no verificado]**, y el tráfico de descarga pasa por el Worker.

**Opción B: API en subdominio separado** (`tunedrop-api.wilrd14.dev`) con `CORS_ORIGIN=https://tunedrop.wilrd14.dev` en `backend/.env`. Sin Workers; el navegador habla directo con el túnel. Contras: CORS, hay que cambiar el frontend, y con Access delante hay fricción (ver abajo).

**Recomendación: Opción B**, por simplicidad y porque el tráfico de descargas/SSE va directo al túnel. Usa un subdominio de primer nivel (`tunedrop-api`, no `api.tunedrop`): el certificado universal gratuito de Cloudflare cubre solo un nivel de subdominio **[no verificado, conocimiento general]**.

Backend `.env`:
```
CORS_ORIGIN=https://tunedrop.wilrd14.dev
```
(`@fastify/cors` está configurado con ese único origen; no se envía `credentials`, así que cookies cross-site no se aceptan desde el backend.)

### Advertencia: Access + CORS

Si proteges la API con Access y el frontend está en otro origen, las peticiones `fetch`/`EventSource` cross-origin necesitan la cookie de Access y las peticiones de preflight `OPTIONS` no la llevan, por lo que Access las bloquea. Opciones: (1) usar la Opción A (mismo origen); (2) en la política/aplicación de la API, habilitar la omisión de peticiones `OPTIONS` (ajuste "bypass OPTIONS" de CORS en Access) y que el frontend use `credentials: 'include'`, lo cual además exigiría que el backend envíe `Access-Control-Allow-Credentials` (hoy no lo hace); (3) durante la prueba privada proteger solo el frontend con Access y confiar en que el id de trabajo es un UUID no adivinable (la API quedaría pública pero sin listado). **[no verificado]**: el nombre exacto del ajuste de CORS en Access y su comportamiento con EventSource. Esta es la parte más incierta del despliegue; pruébala antes de invitar a nadie.

## TODO para el frontend

El frontend hoy llama a `/api` relativo (y en desarrollo Vite lo reenvía al backend). Para la Opción B hace falta:

- [ ] Definir `VITE_API_BASE` (vacío en desarrollo; `https://tunedrop-api.wilrd14.dev` en producción) y anteponerlo a **todas** las URL: `fetch`, `EventSource` (`/api/jobs/:id/events`) y el enlace de descarga (`/api/jobs/:id/download`).
- [ ] Si se usa Access cross-origin: `credentials: 'include'` / `new EventSource(url, { withCredentials: true })`, y `Access-Control-Allow-Credentials` en el backend.
- [ ] Añadir el archivo `.env.production` o la variable en el panel de Pages.

## Comprobación final

1. `https://tunedrop-api.wilrd14.dev/api/health` devuelve `{"ok":true,...}`.
2. Desde `https://tunedrop.wilrd14.dev`, resolver un enlace, crear un trabajo, ver progreso y descargar.
3. Revisar la consola del navegador por errores de CORS.
