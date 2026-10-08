<#
.SYNOPSIS
  Comprueba node, yt-dlp y ffmpeg y arranca el backend (API + worker).
.PARAMETER Mode
  dev   (por defecto): npm run dev, un solo proceso con recarga automatica.
  start: API y worker como dos procesos en segundo plano (npm run start:api / start:worker).
          Ctrl+C en esta ventana detiene ambos.
#>
param([ValidateSet('dev', 'start')][string]$Mode = 'dev')

$ErrorActionPreference = 'Stop'
$backend = Join-Path (Split-Path -Parent $PSScriptRoot) 'backend'

function Fail($msg) { Write-Host $msg -ForegroundColor Red; exit 1 }

if (-not (Test-Path (Join-Path $backend 'package.json'))) { Fail "No se encontro backend/package.json en $backend" }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail 'node no esta instalado. Instala Node.js >= 22.13.' }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Fail 'npm no esta disponible.' }
if ([version](& node --version).TrimStart('v') -lt [version]'22.13') { Fail 'Se requiere Node >= 22.13.' }

# Lee YT_DLP_PATH / FFMPEG_PATH de backend/.env si existen
$envFile = Join-Path $backend '.env'
$envVars = @{}
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([A-Z_]+)\s*=\s*(.+?)\s*$' -and $_ -notmatch '^\s*#') { $envVars[$Matches[1]] = $Matches[2] }
    }
} else {
    Write-Host 'Aviso: no existe backend\.env (copia .env.example a .env). Se usan los valores por defecto.' -ForegroundColor Yellow
}

$yt = if ($envVars['YT_DLP_PATH']) { $envVars['YT_DLP_PATH'] } else { 'yt-dlp' }
$ff = if ($envVars['FFMPEG_PATH']) { $envVars['FFMPEG_PATH'] } else { 'ffmpeg' }
$ffExists = (Test-Path $ff -PathType Container) -or (Test-Path $ff -PathType Leaf) -or (Get-Command $ff -ErrorAction SilentlyContinue)

if (-not (Get-Command $yt -ErrorAction SilentlyContinue) -and -not (Test-Path $yt -PathType Leaf)) {
    Fail 'yt-dlp no encontrado. Ejecuta: winget install yt-dlp.yt-dlp (y reabre la terminal) o define YT_DLP_PATH en backend\.env.'
}
if (-not $ffExists) {
    Fail 'ffmpeg no encontrado. Ejecuta: winget install Gyan.FFmpeg (y reabre la terminal) o define FFMPEG_PATH en backend\.env.'
}
if (-not (Test-Path (Join-Path $backend 'node_modules'))) { Fail 'Faltan dependencias. Ejecuta: cd backend; npm install' }

Push-Location $backend
try {
    if ($Mode -eq 'dev') {
        Write-Host 'Backend en modo desarrollo (API :8787 + worker)...' -ForegroundColor Cyan
        npm run dev
    } else {
        Write-Host 'Iniciando API y worker en segundo plano...' -ForegroundColor Cyan
        $npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
        if (-not $npm) { Fail 'No se encontro npm.cmd' }
        $api = Start-Process -FilePath $npm -ArgumentList 'run', 'start:api' -WorkingDirectory $backend -NoNewWindow -PassThru
        $worker = Start-Process -FilePath $npm -ArgumentList 'run', 'start:worker' -WorkingDirectory $backend -NoNewWindow -PassThru
        Write-Host "API pid $($api.Id), worker pid $($worker.Id). Ctrl+C para detener." -ForegroundColor Green
        try {
            while (-not ($api.HasExited -or $worker.HasExited)) { Start-Sleep -Seconds 2 }
            Write-Host 'Un proceso termino; deteniendo el otro.' -ForegroundColor Yellow
        } finally {
            foreach ($p in @($api, $worker)) {
                if (-not $p.HasExited) { & taskkill /PID $p.Id /T /F | Out-Null }
            }
        }
    }
} finally {
    Pop-Location
}
