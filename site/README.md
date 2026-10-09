# Web de presentación e instalación

Sitio estático (HTML + CSS + un poco de JS, sin dependencias ni build) que presenta tunedrop y explica cómo instalarlo en Windows.

Publicado en **https://tunedrop-local.wilrd14.dev** como un Worker de Cloudflare con *assets* (la vía que sustituye a Cloudflare Pages clásico).

## Vista previa local

```bash
cd site
npx serve .          # o: python -m http.server 8080
```

## Desplegar

La configuración vive en [`../deploy`](../deploy) para no publicar archivos de configuración junto con la web:

```bash
cd deploy
npm install
npm run dry-run      # valida sin subir nada
npm run deploy       # sube site/ y crea el dominio personalizado
```

Necesita una sesión de Cloudflare iniciada (`npx wrangler login`). El primer despliegue crea el registro DNS y el certificado del dominio; el nombre **no puede tener ya un registro CNAME**. Detalles en `deploy/README.md`.

## Qué hay aquí

- `index.html`, `styles.css`, `app.js`, `theme-init.js`: la página (sin scripts en línea, para poder usar una CSP estricta).
- `_headers`: cabeceras de seguridad y de caché; Workers las aplica a los archivos estáticos (hasta 100 reglas).
- `404.html`: página de error (`not_found_handling: "404-page"`).
- `.assetsignore`: archivos que no se publican (este README).
- `robots.txt`, `favicon.svg`.
