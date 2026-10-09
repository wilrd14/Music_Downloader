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
copy .env.example .env                           # si aún no existe
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

## 7. Arranque automático (que no dependa de que lo lances a mano)

Dos piezas, cada una con su script en `scripts/`:

| Pieza | Cómo arranca | Necesita administrador |
|---|---|---|
| **Backend** (API + worker) | Tarea programada `tunedrop-backend` al iniciar sesión en Windows. Un supervisor sin ventana reinicia API y worker si se caen. | No |
| **cloudflared** (túnel) | Servicio de Windows `Cloudflared`, con inicio automático (arranca con el PC, sin iniciar sesión). | **Sí** |

```powershell
# Backend (PowerShell normal, una sola vez)
.\scripts\install-autostart.ps1 -StartNow

# Túnel (PowerShell COMO ADMINISTRADOR, una sola vez)
.\scripts\install-tunnel-service.ps1
```

`install-tunnel-service.ps1` obtiene el token con `cf tunnels token get` y ejecuta `cloudflared service install`. El token queda en la configuración del servicio (así lo hace cloudflared): trátalo como un secreto.

**Qué hace el supervisor** (`scripts/service-backend.ps1`): una sola instancia a la vez; reinicia el proceso que se caiga (con espera de 60 s si falla 3 veces seguidas en menos de 30 s, para no entrar en bucle); al arrancar cierra API o worker huérfanos que hayan quedado de una ejecución anterior; y guarda los logs en `backend/data/logs` (`api.log`, `worker.log`, `*.err.log`, `supervisor.log`, con rotación a 5 MB).

**Comandos útiles**

| Qué | Comando |
|---|---|
| Ver el estado de todo (tarea, procesos, API, túnel y acceso público) | `.\scripts\status.ps1` |
| Detener el backend por completo | `.\scripts\stop-backend.ps1` |
| Volver a arrancarlo | `Start-ScheduledTask -TaskName tunedrop-backend` |
| Quitar el arranque automático del backend | `.\scripts\install-autostart.ps1 -Uninstall` |
| Quitar el servicio del túnel (administrador) | `.\scripts\install-tunnel-service.ps1 -Uninstall` |

> **Importante:** no uses `Stop-ScheduledTask` a secas para apagar el backend: Windows mata el supervisor de golpe y quedan procesos sueltos. Usa `stop-backend.ps1`. (Si pasa, el siguiente arranque los limpia solo.)

**Límites del arranque automático**
- La tarea del backend arranca **al iniciar sesión**, no al encender el PC. Para que el sitio vuelva solo tras un reinicio, el PC debe iniciar sesión automáticamente (o entrar tú). Arrancar antes de iniciar sesión exige una tarea con contraseña o un servicio, ambos con administrador.
- Evita que el PC se **suspenda** mientras el sitio deba estar disponible. Como administrador: `powercfg /change standby-timeout-ac 0` (no suspender con corriente) y `powercfg /change hibernate-timeout-ac 0`. No lo ejecuto yo porque cambia la configuración de energía de tu equipo.

## Comprobación final

1. `https://tunedrop.wilrd14.dev` sin sesión muestra la pantalla de Access; con tu correo carga la interfaz.
2. Resolver un enlace, descargar y ver progreso; el archivo llega a tu carpeta de Descargas.
3. Consola del navegador sin errores de CSP ni de red.
4. Cabeceras: `curl -I https://tunedrop.wilrd14.dev/` (con sesión) muestra `Content-Security-Policy` y `X-Frame-Options`.

## Web pública de presentación (`site/`)

La página que presenta e instala tunedrop (estática, sin servidor) está publicada en **https://tunedrop-local.wilrd14.dev** como Worker con assets; ver [`deploy/README.md`](../deploy/README.md). Es independiente de esta instancia privada: `tunedrop.wilrd14.dev` sigue siendo el backend en modo servidor detrás de Access.

Cloudflare Pages clásico ya no se usa: Cloudflare lo está sustituyendo por Workers con assets (el CLI `cf` lo declara no soportado).
## Estado del despliegue (creado el 2026-10-08 con el CLI `cf`)

Se creó con `cf` (Cloudflare CLI, ya autenticado) en lugar de los pasos manuales 3-6 de arriba. El túnel es de **configuración remota** (se administra en Cloudflare; no hay `config.yml` local) y se conecta con un token.

| Recurso | Identificador |
|---|---|
| Zona | `wilrd14.dev` (`04574d891c025389259d33e5e117ce7a`) |
| Aplicación de Access | `tunedrop (pruebas privadas)` — `60956997-eef3-4873-8068-6485701f0774`; política *Solo William*: permitir únicamente `<tu-correo>` |
| Túnel | `tunedrop` — `ed55d03a-d41a-4474-9e80-6675fb5ce5d8`; ingreso `tunedrop.wilrd14.dev → http://127.0.0.1:8787` |
| DNS | CNAME `tunedrop` → `<id-del-túnel>.cfargotunnel.com` (proxied) |

El token del túnel es un secreto: no se guarda en el repositorio. Se obtiene con `cf tunnels token get <id-del-túnel>` y se pasa a `cloudflared` por la variable de entorno `TUNNEL_TOKEN`.

### Arrancar (cada vez que quieras que esté disponible)

```powershell
# 1) backend (API + worker)
.\scripts\start-backend.ps1 -Mode start

# 2) túnel (en otra terminal)
$env:TUNNEL_TOKEN = (cf tunnels token get ed55d03a-d41a-4474-9e80-6675fb5ce5d8)
cloudflared tunnel --no-autoupdate run
Remove-Item Env:\TUNNEL_TOKEN
```

### Verificado el 2026-10-08

- Sin sesión, `/`, `/api/health` y `/api/jobs/<id>` redirigen (302) al inicio de sesión de Access del equipo de Zero Trust; no se ve nada de la app.
- El túnel registra 3 conexiones y el backend responde en `127.0.0.1:8787`.
- **No verificado:** el inicio de sesión completo con el código del correo y una descarga a través del dominio (requiere que tú inicies sesión).

### Apagar o borrar

- Apagar: cerrar los procesos `cloudflared` y `node`.
- Quitar acceso público: `cf dns records delete` del CNAME `tunedrop`, o borrar la aplicación de Access.
- Borrar todo: `cf tunnels delete ed55d03a-d41a-4474-9e80-6675fb5ce5d8` (tras detener `cloudflared`), el CNAME y la aplicación de Access.
