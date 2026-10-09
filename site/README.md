# tunedrop · página de presentación

Sitio estático (HTML + CSS + JS, sin frameworks, sin build y sin peticiones a
terceros) que presenta tunedrop y explica cómo instalarlo en Windows.

## Archivos

- `index.html`, `styles.css`, `app.js`, `theme-init.js` — la página.
- `404.html` — página de error amigable.
- `_headers` — cabeceras de Cloudflare Pages (CSP estricta, caché, etc.).
- `favicon.svg`, `robots.txt`.

No hay scripts ni estilos en línea: la CSP solo permite recursos del propio
dominio. Si añades algo, mantenlo en archivos propios.

## Previsualizar en local

```bash
cd site
python -m http.server 8080
# o: npx serve .
```

Abre http://localhost:8080. Ojo: estos servidores no aplican `_headers`; para
probar la CSP usa un servidor que añada esas cabeceras.

## Desplegar en Cloudflare Pages

1. Cloudflare → Workers & Pages → Create → Pages → Connect to Git → repo
   `wilrd14/Music_Downloader`.
2. Configuración de build:
   - Root directory: `site`
   - Build command: (vacío)
   - Build output directory: `/`
3. Custom domains → `tunedrop.wilrd14.dev`.

Cada push a `main` que toque `site/` redespliega la página.
