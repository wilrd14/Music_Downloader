# Despliegue con Cloudflare (fase de pruebas privada)

**Arquitectura elegida:** un solo dominio, `tunedrop.wilrd14.dev`. El backend (API + worker) corre en tu PC con Windows y **también sirve la interfaz compilada** (`frontend/dist`). **Cloudflare Tunnel** lo publica sin abrir puertos, y **Cloudflare Access** lo restringe a tu correo.

```
Navegador ─► Cloudflare (DNS, TLS, Access: solo tu correo)
                 └─ Tunnel ─► PC: http://127.0.0.1:8787  (interfaz + /api, un solo origen)
```

Ventajas: un túnel, un hostname, **sin CORS** y Access protege interfaz y API juntas (evita el problema de Access + CORS entre dos dominios). Inconveniente: sin tu PC encendida no hay interfaz. Pages queda como opción para la fase pública (ver el final).

> **Qué está verificado.** El código que sirve la interfaz con sus cabeceras de seguridad está probado (tests y navegador, en `http://127.0.0.1:8787`). Los pasos de `cloudflared` y Access se contrastaron con la documentación oficial pero **aún no se han ejecutado** en tu cuenta; lo que no se pudo confirmar va marcado **[no verificado]**.

| Pieza | Valor |
|---|---|
| Hostname | `tunedrop.wilrd14.dev` |
| Nombre del túnel | `tunedrop` |
| Origen local | `http://127.0.0.1:8787` |

## 1. Compilar la interfaz y arrancar el backend

```powershell
cd frontend; npm install; npm run build        # genera frontend\dist
cd ..\backend; npm install
copy .env.example .env                           # si aún no existe; rellena SPOTIFY_* en .env
.\..\scripts\start-backend.ps1 -Mode start       # API + worker
```
Comprueba <http://127.0.0.1:8787/> (interfaz) y <http://127.0.0.1:8787/api/health>. Si cambias el frontend, vuelve a ejecutar `npm run build`; no hace falta reiniciar el backend.

## 2. Instalar cloudflared

```powershell
winget install --id Cloudflare.cloudflared
```
**[no verificado]**: el id exacto del paquete. Alternativa: <https://developers.cloudflare.com/tunnel/downloads/>. Cierra y reabre la terminal y comprueba `cloudflared --version`.

## 3. Crear el túnel (necesita tu cuenta de Cloudflare)

```powershell
cloudflared tunnel login                 # abre el navegador: inicia sesión y elige la zona wilrd14.dev
cloudflared tunnel create tunedrop       # crea <UUID>.json en %USERPROFILE%\.cloudflared
cloudflared tunnel list
```
Anota el UUID.

## 4. config.yml

Crea `%USERPROFILE%\.cloudflared\config.yml`:

```yaml
tunnel: <UUID-DEL-TUNEL>
credentials-file: C:\Users\<TU-USUARIO>\.cloudflared\<UUID-DEL-TUNEL>.json

ingress:
  - hostname: tunedrop.wilrd14.dev
    service: http://127.0.0.1:8787
  - service: http_status:404
```
Valida con `cloudflared tunnel ingress validate`. La última regla es obligatoria.

## 5. Ruta DNS y prueba

```powershell
cloudflared tunnel route dns tunedrop tunedrop.wilrd14.dev
cloudflared tunnel run tunedrop
```
Abre <https://tunedrop.wilrd14.dev>. **Haz el paso 6 antes de compartir el enlace**: hasta entonces la URL es pública.

## 6. Cloudflare Access: solo tu correo

Panel de Cloudflare → **Zero Trust → Access controls → Applications → Create new application → Self-hosted**:

1. Hostname: `tunedrop.wilrd14.dev`.
2. Política **Allow** con regla *Include → Emails* y tu correo. Una aplicación sin política lo deniega todo.
3. Guarda y prueba desde una ventana de incógnito: debe pedirte el código por correo antes de mostrar la web.

Etiquetas exactas del panel pueden variar. La primera vez puede pedirte crear la cuenta de Zero Trust (el plan gratuito basta).

## 7. Que no se caiga al reiniciar el PC

- **cloudflared como servicio de Windows** (CMD como administrador): coloca `cloudflared.exe` en `C:\Cloudflared\bin`, ejecuta `cloudflared.exe service install`, copia `cert.pem`, `<UUID>.json` y `config.yml` a `C:\Windows\System32\config\systemprofile\.cloudflared`, apunta `credentials-file` ahí y arranca con `sc start cloudflared`. Si el servicio no toma tu config, ajusta `ImagePath` en el registro (`HKLM\SYSTEM\CurrentControlSet\Services\Cloudflared`) a `...cloudflared.exe --config=C:\Windows\System32\config\systemprofile\.cloudflared\config.yml tunnel run`.
- **Backend** (API + worker): no es un servicio. Para que arranque al iniciar sesión, crea una tarea en el Programador de tareas que ejecute `powershell -File <repo>\scripts\start-backend.ps1 -Mode start`. Hasta entonces hay que lanzarlo a mano.
- Evita que el PC se suspenda mientras el servicio deba estar disponible (Configuración → Energía).

## Comprobación final

1. `https://tunedrop.wilrd14.dev` sin sesión muestra la pantalla de Access; con tu correo carga la interfaz.
2. Resolver un enlace, descargar y ver progreso; el archivo llega a tu carpeta de Descargas.
3. Consola del navegador sin errores de CSP ni de red.
4. Cabeceras: `curl -I https://tunedrop.wilrd14.dev/` (con sesión) muestra `Content-Security-Policy` y `X-Frame-Options`.

## Opción futura: interfaz en Cloudflare Pages (fase pública)

Si más adelante quieres la interfaz siempre disponible aunque el PC esté apagado, puedes alojarla en Pages (`frontend/public/_headers` ya trae las cabeceras) y dejar la API en un hostname aparte (`tunedrop-api.wilrd14.dev`, de un solo nivel por el certificado gratuito **[no verificado]**). Eso requiere: `VITE_API_BASE` en el frontend (anteponerlo a `fetch`, `EventSource` y el enlace de descarga), `CORS_ORIGIN` en `backend/.env`, añadir el origen de la API a `connect-src` de la CSP, y retirar Access o resolver su interacción con CORS y `EventSource` **[no verificado]**. Pages en sí: Cloudflare impulsa migrar a Workers con static assets; revisa el estado actual **[no verificado]**.
