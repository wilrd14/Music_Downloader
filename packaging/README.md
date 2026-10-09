# Empaquetado de tunedrop

Aquí vive todo lo necesario para producir las descargas oficiales. Por ahora, solo **Windows x64**.

## Qué es el paquete

`tunedrop-windows-x64.zip` se extrae en una carpeta `tunedrop-windows-x64/` con todo incluido (no hay que instalar nada ni tener Node, Python o ffmpeg):

```
tunedrop-windows-x64/
  Iniciar tunedrop.bat     lanzador (doble clic)
  LEEME.txt                instrucciones, aviso de SmartScreen, aviso legal
  VERSION
  app/
    tunedrop.mjs           backend + worker en un solo archivo (npm run build)
    web/                   interfaz (frontend/dist)
    bin/                   yt-dlp.exe, ffmpeg.exe, ffprobe.exe
  runtime/node.exe         Node.js 24 LTS oficial (solo el ejecutable)
  licenses/                GPL-3.0 de tunedrop, licencias de terceros, THIRD_PARTY_NOTICES.md
```

Medidas de la primera construcción: zip de 172-177 MB, 423 MB extraído (casi todo son `ffmpeg.exe` y `ffprobe.exe`, ~157 MB cada uno). «~400 MB libres» en la web es una estimación correcta.

## Construir en local

Requisitos: Windows, Node 24 y `npm` en el PATH, internet. Funciona con Windows PowerShell 5.1 y con PowerShell 7.

```powershell
./packaging/windows/build.ps1                 # versión de backend/package.json
./packaging/windows/build.ps1 -Version 0.2.0  # versión explícita
./packaging/windows/build.ps1 -SkipFrontend -SkipBackend   # reutiliza frontend/dist y backend/dist
./packaging/windows/build.ps1 -Clean          # borra salida y compilaciones antes
```

Salida en `dist-release/` (ignorada por git): `tunedrop-windows-x64.zip`, `tunedrop-windows-x64.zip.sha256` y `SHA256SUMS.txt`. Las descargas se guardan en `packaging/windows/.cache/` (también ignorada) y se reutilizan si su SHA-256 coincide. **Si una huella no coincide, la construcción falla.** Nunca se suben binarios al repositorio.

### Prueba de humo

```powershell
./packaging/windows/smoke-test.ps1                 # con descarga real de un video corto
./packaging/windows/smoke-test.ps1 -SkipDownload   # sin descarga (lo que hace CI)
./packaging/windows/smoke-test.ps1 -UseLauncher    # arranca con «Iniciar tunedrop.bat»
```

Extrae el zip en una carpeta temporal con espacios y acentos, arranca la app con un PATH sin yt-dlp/ffmpeg (para que solo puedan salir del paquete), comprueba `/api/config`, `/api/health`, la interfaz, el rechazo (403) de un `Host` ajeno y, sin `-SkipDownload`, descarga de verdad y revisa el mp3 (audio, título, artista y portada) con el `ffprobe` incluido. Al terminar detiene el árbol de procesos y borra la carpeta temporal.

## Subir versiones de los componentes

Las versiones están fijadas en `packaging/windows/versions.json` (URL, SHA-256, licencia y origen del código fuente). Para subirlas a propósito:

```powershell
./packaging/windows/update-versions.ps1            # Node 24 LTS, yt-dlp último, FFmpeg de la rama actual
./packaging/windows/update-versions.ps1 -FfmpegBranch 9.0
git diff packaging/windows/versions.json
```

Las huellas se leen siempre de los archivos de sumas oficiales (`SHASUMS256.txt` de Node, `SHA2-256SUMS` de yt-dlp, `checksums.sha256` de BtbN). Después: `build.ps1`, `smoke-test.ps1` con descarga real y commit. No se ejecuta en CI: así ninguna versión nueva entra sin revisión.

Elecciones actuales:
- **Node.js 24 LTS** (`win-x64.zip` oficial; se usa solo `node.exe` y su LICENSE).
- **yt-dlp** `yt-dlp.exe` de la última release. Se actualiza solo en la máquina del usuario (como mucho una vez al día).
- **FFmpeg**: compilación GPL estática de **BtbN/FFmpeg-Builds**, rama estable 8.1, desde una release con etiqueta fechada (`autobuild-AAAA-MM-DD-HH-MM`), que es inmutable, a diferencia de la etiqueta móvil `latest`. Publica `checksums.sha256` por release (la huella viene del proveedor), trae `ffmpeg`, `ffprobe` y la licencia, y permite fijar una versión concreta con su código fuente y scripts de compilación en GitHub. No se evaluó a fondo Gyan.dev ni los builds propios de yt-dlp; cambiar de proveedor solo exige actualizar `versions.json` y los nombres de archivo en `build.ps1` si el zip tiene otra estructura.

## Cómo se publica una versión

1. Actualiza `CHANGELOG.md` y la versión de `backend/package.json` si procede.
2. Etiqueta y sube: `git tag v0.1.0 && git push origin v0.1.0`.
3. El workflow `.github/workflows/release.yml` (en `windows-latest`) construye el zip, ejecuta la prueba de humo con `-SkipDownload` (las IP de los runners están bloqueadas por YouTube, así que no hay descarga real en CI), sube los artefactos y crea la Release con `gh` y el `GITHUB_TOKEN` integrado (sin acciones de terceros ni otros secretos). Mientras la versión empiece por `0.` se marca como *pre-release*. También se puede lanzar a mano (`workflow_dispatch`) indicando la versión.
4. Antes de anunciar, descarga el zip de la Release y repite `smoke-test.ps1` con descarga real en tu PC.

La web enlaza a `releases/latest/download/tunedrop-windows-x64.zip`. GitHub ignora las pre-releases en ese enlace, por eso el workflow publica una Release normal (no `--prerelease`); la primera versión se anuncia como versión de pruebas en las notas.

## Qué NO está hecho

- **Firma de código**: el zip y los `.exe` no están firmados; SmartScreen/antivirus pueden avisar (explicado en `LEEME.txt` y en las notas de la Release). Mitigación actual: sumas SHA-256.
- Instalador `.exe` (Inno Setup), paquetes para macOS y Linux, ARM64 y actualización automática de la propia app.
- Construcción reproducible bit a bit del zip (las fechas de los archivos varían).
- La prueba de CI no prueba descargas reales.

## Licencias

tunedrop es **GPL-3.0**. Distribuir en el mismo zip yt-dlp (Unlicense), Node.js (MIT) y FFmpeg (compilación GPL) es compatible con la GPL-3.0: se ejecutan como programas separados. Al construir, `build.ps1` genera `licenses/THIRD_PARTY_NOTICES.md` desde `versions.json` y `template/THIRD_PARTY_NOTICES.md` con cada componente, versión, URL, SHA-256, licencia y enlaces al código fuente (para FFmpeg: el commit exacto de FFmpeg y los scripts de compilación de BtbN en la etiqueta usada), y copia los textos de licencia (`LICENSE` de tunedrop, Node, yt-dlp y su `THIRD_PARTY_LICENSES.txt`, FFmpeg). Si cambias de proveedor de FFmpeg, actualiza `sourceUrl`/`buildScriptsUrl` en `versions.json` para seguir cumpliendo con la disponibilidad del código fuente.
