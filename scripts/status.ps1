<#
.SYNOPSIS
  Muestra de un vistazo si tunedrop esta funcionando: tarea, procesos, API local, tunel y acceso publico.
#>
param([string]$Hostname = 'tunedrop.wilrd14.dev')

$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
function Row($ok, $label, $detail) {
    $mark = if ($ok -eq $true) { '[ OK ]' } elseif ($ok -eq $false) { '[FALLA]' } else { '[ -- ]' }
    $color = if ($ok -eq $true) { 'Green' } elseif ($ok -eq $false) { 'Red' } else { 'DarkGray' }
    Write-Host ("{0} {1,-34} {2}" -f $mark, $label, $detail) -ForegroundColor $color
}

Write-Host "`ntunedrop - estado`n" -ForegroundColor Cyan

# 1) Tarea programada del backend
$task = Get-ScheduledTask -TaskName 'tunedrop-backend' -ErrorAction SilentlyContinue
if ($task) { Row ($task.State -eq 'Running') 'Tarea tunedrop-backend' "estado: $($task.State)" }
else { Row $null 'Tarea tunedrop-backend' 'no instalada (scripts\install-autostart.ps1)' }

# 2) Procesos del backend
$node = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'start:(api|worker)|src[\\/](api|worker)[\\/]index' })
Row ($node.Count -ge 2) 'Procesos node (API + worker)' "$($node.Count) encontrados"

# 3) API local
try {
    $h = Invoke-RestMethod 'http://127.0.0.1:8787/api/health' -TimeoutSec 20
    Row ($h.ok -eq $true) 'API local :8787' "yt-dlp $($h.ytDlp) | ffmpeg $($h.ffmpeg)"
} catch { Row $false 'API local :8787' 'sin respuesta' }

# 4) cloudflared (servicio o proceso)
$svc = Get-Service Cloudflared -ErrorAction SilentlyContinue
$proc = Get-Process cloudflared -ErrorAction SilentlyContinue
if ($svc) { Row ($svc.Status -eq 'Running') 'cloudflared (servicio)' "$($svc.Status), inicio: $($svc.StartType)" }
elseif ($proc) { Row $true 'cloudflared (proceso suelto)' 'corre, pero NO arrancara solo (install-tunnel-service.ps1)' }
else { Row $false 'cloudflared' 'no esta corriendo' }

# 5) Acceso publico: sin sesion debe redirigir a Cloudflare Access (HttpWebRequest sirve en PS 5.1 y 7)
try {
    $req = [System.Net.HttpWebRequest]::Create("https://$Hostname/")
    $req.AllowAutoRedirect = $false
    $req.Timeout = 15000
    try { $resp = $req.GetResponse() } catch [System.Net.WebException] { $resp = $_.Exception.Response; if (-not $resp) { throw } }
    $code = [int]$resp.StatusCode
    $loc = [string]$resp.Headers['Location']
    $resp.Close()
    if ($code -eq 302 -and $loc -match 'cloudflareaccess\.com') { Row $true "Publico https://$Hostname" 'protegido por Access (302 al login)' }
    elseif ($code -ge 500) { Row $false "Publico https://$Hostname" "HTTP ${code}: el tunel no llega al backend" }
    else { Row $false "Publico https://$Hostname" "HTTP ${code}: REVISA Access, no redirige al login" }
} catch { Row $false "Publico https://$Hostname" $_.Exception.Message }

Write-Host ''
