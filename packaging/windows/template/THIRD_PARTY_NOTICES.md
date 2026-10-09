# Avisos de terceros (tunedrop {{VERSION}}, Windows x64)

Este paquete reúne tunedrop con programas de terceros ejecutados como procesos
independientes. Cada uno conserva su propia licencia; los textos completos están en
esta carpeta (`licenses/`). Las huellas SHA-256 son las del archivo descargado,
verificadas durante la construcción contra el archivo de sumas que publica el
propio proveedor (cuando se indica «calculada por el proyecto», el proveedor no
publica sumas y la huella se calculó una vez y quedó fijada en `versions.json`).

## Componentes

{{COMPONENTS}}

## Cumplimiento de la GPL (código fuente)

- **tunedrop** es software libre bajo GPL-3.0 (`LICENSE-tunedrop.txt`). Su código
  fuente completo, de la versión de este paquete, está en
  {{TUNEDROP_SOURCE}}.
- **FFmpeg** se incluye como ejecutables (`ffmpeg.exe`, `ffprobe.exe`) de la
  compilación GPL estática de **BtbN/FFmpeg-Builds** (no de FFmpeg.org, que solo
  distribuye código fuente). Esa compilación enlaza bibliotecas GPL (por ejemplo
  x264 y x265), por lo que el conjunto se distribuye bajo GPL. El código fuente
  correspondiente es: el de FFmpeg en el commit indicado arriba, más los parches y
  versiones de bibliotecas definidos por los scripts de compilación de BtbN en la
  etiqueta indicada (`patches/` y `scripts.d/`), que construyen exactamente esos
  binarios. Si no puedes obtenerlo de esos enlaces, pídelo abriendo una incidencia
  en https://github.com/wilrd14/Music_Downloader/issues y se te facilitará.
- **yt-dlp** es de dominio público (Unlicense); su `.exe` incorpora Python y
  bibliotecas de código abierto con licencias propias, recogidas en
  `yt-dlp-THIRD_PARTY_LICENSES.txt`.
- **Node.js** es MIT; su `LICENSE` incluye las licencias de sus dependencias.

Distribuir estos programas juntos es compatible con la GPL-3.0 de tunedrop, que
solo los invoca como programas separados (no los enlaza).
