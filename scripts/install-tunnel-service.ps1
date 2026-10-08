<#
.SYNOPSIS
  Instala cloudflared como servicio de Windows (arranca con el PC, sin iniciar sesion).
.DESCRIPTION
  REQUIERE PowerShell como Administrador. Obtiene el token del tunel con el CLI "cf" y ejecuta
  "cloudflared service install <token>". El token no se muestra, pero cloudflared lo guarda en la
  configuracion del servicio (comportamiento normal de cloudflared); tratalo como un secreto.
.PARAMETER TunnelId
  Id del tunel (por defecto el de tunedrop, ver docs\deployment-cloudflare.md).
.PARAMETER Uninstall
  Detiene y desinstala el servicio.
#>
param(
    [string]$TunnelId = 'ed55d03a-d41a-4474-9e80-6675fb5ce5d8',
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host 'Abre PowerShell como Administrador (clic derecho > Ejecutar como administrador) y vuelve a ejecutar este script.' -ForegroundColor Red
    exit 1
}

$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) { throw 'cloudflared no esta instalado (winget install Cloudflare.cloudflared).' }

if ($Uninstall) {
    cloudflared service uninstall
    Write-Host 'Servicio cloudflared desinstalado.' -ForegroundColor Yellow
    return
}

if (-not (Get-Command cf -ErrorAction SilentlyContinue)) { throw 'No se encontro el CLI "cf" para obtener el token del tunel.' }

# Si cloudflared ya corre como proceso suelto (no como servicio), se detiene para que no haya dos conectores
Get-Process cloudflared -ErrorAction SilentlyContinue | Where-Object { -not (Get-Service Cloudflared -ErrorAction SilentlyContinue) } |
    ForEach-Object { Write-Host "Deteniendo cloudflared suelto (pid $($_.Id))..."; Stop-Process -Id $_.Id -Force }

$raw = (cf tunnels token get $TunnelId 2>&1 | Out-String).Trim()
$token = $raw
try {
    $j = $raw | ConvertFrom-Json
    if ($j -is [string]) { $token = $j } elseif ($j.token) { $token = $j.token } elseif ($j.result) { $token = $j.result }
} catch { }
$token = $token.Trim('"')
if ($token.Length -lt 50) { throw 'No se pudo obtener el token del tunel. Comprueba "cf auth whoami".' }

if (Get-Service Cloudflared -ErrorAction SilentlyContinue) {
    Write-Host 'Ya existe el servicio Cloudflared; se reinstala con el token actual...'
    cloudflared service uninstall
}
cloudflared service install $token
Start-Service Cloudflared -ErrorAction SilentlyContinue
Set-Service Cloudflared -StartupType Automatic

Write-Host 'Servicio Cloudflared instalado y en marcha (inicio automatico).' -ForegroundColor Green
Get-Service Cloudflared | Format-Table Name, Status, StartType -AutoSize
