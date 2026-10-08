<#
.SYNOPSIS
  Arranca el servidor de desarrollo del frontend (Vite, http://localhost:5173).
#>
$ErrorActionPreference = 'Stop'
$frontend = Join-Path (Split-Path -Parent $PSScriptRoot) 'frontend'

if (-not (Test-Path (Join-Path $frontend 'package.json'))) {
    Write-Host "No se encontro frontend/package.json en $frontend" -ForegroundColor Red
    exit 1
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host 'npm no esta disponible. Instala Node.js >= 22.13.' -ForegroundColor Red
    exit 1
}

Push-Location $frontend
try {
    if (-not (Test-Path 'node_modules')) {
        Write-Host 'Falta node_modules. Ejecuta primero: cd frontend; npm install' -ForegroundColor Yellow
        exit 1
    }
    Write-Host 'Frontend en http://localhost:5173 (el backend debe estar en 127.0.0.1:8787)' -ForegroundColor Cyan
    npm run dev
} finally {
    Pop-Location
}
