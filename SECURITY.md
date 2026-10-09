# Política de seguridad

tunedrop es un proyecto libre (GPL-3.0) mantenido por una sola persona en su tiempo libre. Se toma la seguridad en serio, pero los plazos de abajo son los de un mantenedor individual, no los de una empresa.

## Versiones con soporte

| Versión | Soporte de seguridad |
|---|---|
| Última versión publicada en [Releases](https://github.com/wilrd14/Music_Downloader/releases/latest) | Sí |
| Rama `main` | Sí (es de donde sale la siguiente versión) |
| Versiones anteriores | No. Actualiza a la última |

Mientras el proyecto esté en la serie `0.x` no hay ramas de mantenimiento: las correcciones salen en una versión nueva. El componente que habla con YouTube (`yt-dlp`) se actualiza solo en la app local; las demás piezas empaquetadas (Node.js, FFmpeg) se actualizan al publicar una versión nueva.

## Cómo informar de una vulnerabilidad

**No abras una incidencia pública** con los detalles de una vulnerabilidad. Usa el informe privado de GitHub:

1. Entra en <https://github.com/wilrd14/Music_Downloader/security/advisories/new>.
2. Describe qué has encontrado, en qué versión o commit, cómo reproducirlo y qué impacto crees que tiene. Una prueba de concepto mínima ayuda mucho. Puedes escribir en español o en inglés.
3. No incluyas datos personales ni secretos de otras personas.

Si por algún motivo no puedes usar ese formulario, abre una incidencia pública que diga solo «necesito informar de un problema de seguridad» (sin detalles) y te daré un canal privado.

## Qué esperar

Son objetivos razonables, no garantías:

- **Acuse de recibo:** en unos 7 días.
- **Valoración inicial** (si lo considero un problema real y su gravedad): en unos 14 días.
- **Corrección:** según la gravedad y la complejidad. Para problemas graves intentaré publicar una versión corregida en 30 días; para el resto, en la siguiente versión razonable.
- **Aviso público:** cuando haya una versión corregida publicaré un aviso (GitHub Security Advisory) y una nota en el [CHANGELOG](CHANGELOG.md), y daré crédito a quien informó si lo desea. Te pido que esperes a esa publicación, o a 90 días desde tu informe, lo que ocurra primero, antes de divulgarlo.

## Alcance

**Dentro de alcance**

- El código de este repositorio: `backend/` (modo local y modo servidor), `frontend/`, `site/`, `packaging/`, `scripts/`, `deploy/` y `.github/`.
- El zip de Windows publicado en Releases: contenido, integridad, lanzador y cómo se construye.
- Problemas que permitan, desde una **página web ajena** que la persona visita, leer o cambiar algo de la app local (DNS rebinding, CSRF, lectura de eventos, etc.), escribir fuera de la carpeta de música, ejecutar programas con datos controlados por un tercero (títulos, URLs, nombres de archivo), o denegar el servicio de forma desproporcionada.
- Fugas de secretos o datos personales en el repositorio o en sus artefactos.
- Vulnerabilidades en las dependencias que afecten de verdad a tunedrop.

**Fuera de alcance**

- Un atacante que **ya ejecuta código en el PC** de la persona o tiene control de su cuenta de Windows: puede hacer lo mismo sin tunedrop. (Los usuarios locales distintos que comparten el mismo PC sí son un caso que me interesa; ver «Riesgos conocidos» en [`docs/security.md`](docs/security.md).)
- Vulnerabilidades de `yt-dlp`, FFmpeg, Node.js, Cloudflare, GitHub o YouTube en sí: infórmalas a sus proyectos (avísame si afectan al empaquetado de tunedrop).
- La instancia privada del mantenedor (`tunedrop.wilrd14.dev`) y su infraestructura: no es un servicio público ni se ofrece para pruebas. **No la ataques, escanees ni hagas pruebas de carga.** La web `tunedrop-local.wilrd14.dev` es estática; informar de fallos de sus cabeceras o de su contenido está bien, pero sin pruebas de carga.
- Ingeniería social, ataques físicos, spam, denegación de servicio por volumen masivo contra servicios de terceros.
- Que el zip no esté firmado digitalmente (SmartScreen avisará): es una limitación conocida y está documentada.
- Informes automáticos de escáneres sin una explicación de cómo se explota en este proyecto.
- Cuestiones legales sobre descargar contenido de YouTube (no son de seguridad).

## Puerto seguro para la investigación de buena fe

Si investigas de buena fe y respetas esta política, considero tu actividad autorizada y no emprenderé ni apoyaré acciones legales contra ti por ella. Concretamente, te pido que:

- Pruebes **solo contra instancias que tú mismo ejecutes** (la app local en tu PC, o una instancia en modo servidor en `127.0.0.1` con datos de prueba), no contra sistemas de terceros ni contra la instancia privada del mantenedor.
- No accedas, modifiques ni borres datos que no sean tuyos, ni degrades el servicio de otras personas.
- Informes de forma privada y me des un plazo razonable para corregir antes de divulgar.
- No exijas pagos ni amenaces con divulgar.

Este compromiso es del mantenedor del proyecto y no obliga a terceros (GitHub, Cloudflare, proveedores de los binarios incluidos); respeta también sus condiciones. No hay programa de recompensas, pero agradeceré públicamente tu ayuda si quieres.
