# Despliegue de la web (site/)

La web de presentación (`../site`) se publica como un **Worker de Cloudflare con *assets*** en <https://tunedrop-local.wilrd14.dev>.

> Cloudflare está sustituyendo Pages clásico por Workers con assets: el CLI `cf` responde «Legacy Pages is not supported in `cf`» y remite a `cf deploy`. Por eso no se usa Pages.

## Archivos

- `wrangler.jsonc`: nombre del Worker (`tunedrop-local`), carpeta de assets (`../site`), página 404 y el dominio personalizado.
- `package.json`: solo declara `wrangler` y los scripts. La configuración vive aquí y no dentro de `site/` para no publicarla como archivo público.

## Desplegar

```bash
cd deploy
npm install
npm run dry-run      # valida la configuración sin subir nada
npm run deploy       # sube site/ y crea/actualiza el dominio
```

Hace falta una sesión de Cloudflare iniciada con permiso de escritura en Workers (`npx wrangler login`; `npx wrangler whoami` muestra la cuenta y los permisos).

## Notas verificadas

- **`cf deploy` falla en Windows** con `spawn EFTYPE` (delega en wrangler y no consigue lanzarlo). Usa `npm run deploy`.
- **Dominio personalizado:** Cloudflare crea el registro DNS y el certificado por ti, pero **no permite crearlo en un nombre que ya tenga un registro CNAME**. Por eso la web va en `tunedrop-local.wilrd14.dev` y no en `tunedrop.wilrd14.dev`, que sigue siendo la instancia privada (túnel + Access).
- **`_headers`** (en `site/`) lo interpreta Workers y se aplica a los archivos estáticos; no se sirve como archivo (devuelve 404). Límite: 100 reglas.
- **`site/.assetsignore`** deja fuera `README.md`.
- **Analítica:** Cloudflare puede inyectar su script de *Web Analytics*; la CSP de la web lo bloquea (aparece un aviso en la consola, inofensivo). Para quitar el aviso, desactiva la inyección automática en el panel (Analytics → Web analytics).
- Plan gratuito: hasta 20 000 archivos por versión y 25 MiB por archivo; las peticiones a archivos estáticos no consumen cuota de Workers.

## Deshacer

```bash
cd deploy
npx wrangler delete          # borra el Worker; el registro DNS del dominio personalizado se retira con él
```
