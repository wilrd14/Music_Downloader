@echo off
rem Lanzador de tunedrop. Doble clic para iniciar. No necesita permisos de administrador.
chcp 65001 >nul
title tunedrop - descargador de musica (cierra esta ventana para salir)
setlocal

rem Trabaja siempre desde la carpeta de tunedrop (aunque se lance desde otra, p. ej. Descargas): Windows busca primero
rem en la carpeta actual los programas que se lanzan por nombre y yt-dlp lee ahi un yt-dlp.conf si existe.
pushd "%~dp0" >nul 2>&1

if not exist "%~dp0runtime\node.exe" goto sin_archivos
if not exist "%~dp0app\tunedrop.mjs" goto sin_archivos

echo.
echo   ========================================
echo     tunedrop
echo   ========================================
echo.
echo   Descarga musica de YouTube y YouTube Music a tu PC.
echo   En unos segundos se abrira tu navegador con la aplicacion.
echo   Si no se abre, copia en el navegador la direccion que aparece abajo.
echo.
echo   Para salir, cierra esta ventana (o pulsa Ctrl+C).
echo.

"%~dp0runtime\node.exe" "%~dp0app\tunedrop.mjs"
set "CODIGO=%ERRORLEVEL%"
if "%CODIGO%"=="0" goto fin

echo.
echo   tunedrop se detuvo con un error (codigo %CODIGO%).
echo   Revisa el mensaje de arriba. Si el problema persiste, abre una incidencia en
echo   https://github.com/wilrd14/Music_Downloader/issues
echo.
pause
exit /b %CODIGO%

:sin_archivos
echo.
echo   No se encuentran los archivos de tunedrop junto a este lanzador.
echo   Si abriste el .bat desde dentro del zip, primero extrae todo el contenido
echo   a una carpeta normal (clic derecho en el zip, "Extraer todo...").
echo.
pause
exit /b 1

:fin
popd >nul 2>&1
endlocal
