<#
.SYNOPSIS
  Muestra las versiones de node, npm, yt-dlp, ffmpeg y cloudflared. No instala nada.
#>
$ErrorActionPreference = 'Continue'

function Show-Tool {
    param([string]$Name, [string[]]$VersionArgs, [string]$Hint, [bool]$Required = $true)
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $cmd) {
        $label = if ($Required) { 'FALTA' } else { 'no encontrado (opcional)' }
        $color = if ($Required) { 'Red' } else { 'Yellow' }
        Write-Host ("{0,-12} {1}. {2}" -f $Name, $label, $Hint) -ForegroundColor $color
        return $false
    }
    $out = & $cmd.Source @VersionArgs 2>&1 | Select-Object -First 1
    Write-Host ("{0,-12} {1}" -f $Name, $out) -ForegroundColor Green
    return $true
}

$ok = $true
$ok = (Show-Tool 'node' @('--version') 'Instala Node >= 22.13 desde https://nodejs.org') -and $ok
$ok = (Show-Tool 'npm' @('--version') 'Viene con Node.js') -and $ok
$ok = (Show-Tool 'yt-dlp' @('--version') 'winget install yt-dlp.yt-dlp (luego reabre la terminal, o define YT_DLP_PATH en backend/.env)') -and $ok
$ok = (Show-Tool 'ffmpeg' @('-version') 'winget install Gyan.FFmpeg (luego reabre la terminal, o define FFMPEG_PATH en backend/.env)') -and $ok
Show-Tool 'cloudflared' @('--version') 'Solo necesario para el despliegue (docs/deployment-cloudflare.md)' $false | Out-Null

$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
    $v = [version](& node --version).TrimStart('v')
    if ($v -lt [version]'22.13') {
        Write-Host "Node $v es menor que 22.13 (requerido)." -ForegroundColor Red
        $ok = $false
    }
}

if ($ok) { Write-Host "`nTodo lo necesario esta disponible." -ForegroundColor Green; exit 0 }
Write-Host "`nFaltan requisitos (ver arriba)." -ForegroundColor Red
exit 1
