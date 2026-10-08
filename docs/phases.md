# Fases del proyecto

## Fase 1: YouTube (MVP)
- [x] Backend: API Fastify + worker + cola SQLite
- [x] Resolver de YouTube con yt-dlp (pista y playlist)
- [x] Conversión a MP3 / M4A con ffmpeg
- [x] Progreso en vivo por SSE
- [x] Descarga de archivo suelto o ZIP desde el navegador
- [x] Borrado automático tras TTL
- [x] Frontend React + Vite + Tailwind
- [x] Documentación y scripts de operación

- [ ] Probar playlists de YouTube **y de YouTube Music** (`music.youtube.com/playlist?list=...`) con ZIP real

## Fase 2: Despliegue de pruebas
- [x] El backend sirve la interfaz compilada en el mismo origen (probado)
- [x] Cloudflare Tunnel creado (remoto, vía `cf`) y conectado al backend
- [x] Backend con arranque automático (tarea programada + supervisor que reinicia si se cae)
- [ ] Túnel como servicio de Windows (`scripts/install-tunnel-service.ps1`, requiere administrador)
- [ ] (Opcional, fase pública) Frontend en Cloudflare Pages
- [ ] (Solo si se usa Pages) Variable `VITE_API_BASE` en el frontend y `CORS_ORIGIN` en el backend
- [x] Cloudflare Access (solo tu correo) delante del dominio; comprobado que bloquea sin sesión

## Fase 3: Otras fuentes (descartada)
Se probó una fuente adicional y se retiró: su API ya no permite leer playlists con credenciales de aplicación. tunedrop se queda en YouTube y YouTube Music. Detalle en el [CHANGELOG](../CHANGELOG.md).

## Fase 4: Endurecimiento para uso público
> La lista completa de requisitos de seguridad está en [security.md](security.md). No se abre al público sin completar su checklist.
- [ ] Rate limiting por IP
- [ ] Cloudflare Turnstile en la creación de trabajos
- [ ] Límites de tamaño/duración y cuotas
- [ ] Retirar Access y abrir el acceso
- [ ] Monitoreo básico y manejo de actualizaciones de yt-dlp

## Fase 5: Operación continua
- [ ] Migrar a un host gratuito siempre encendido (evaluar opciones)
- [ ] Actualización automática de yt-dlp
- [ ] Métricas y alertas
- [ ] Revisión legal y términos de uso
