<#
.SYNOPSIS
  Detiene por completo el backend de tunedrop: la tarea programada y todos sus procesos (API y worker).
.DESCRIPTION
  Stop-ScheduledTask por si solo deja procesos huerfanos; este script los cierra tambien.
  No toca cloudflared (para eso: Stop-Service Cloudflared, como administrador).
#>
$backend = Join-Path (Split-Path -Parent $PSScriptRoot) 'backend'

Stop-ScheduledTask -TaskName 'tunedrop-backend' -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

$procs = @(Get-CimInstance Win32_Process |
    Where-Object { $_.Name -in 'node.exe', 'cmd.exe' -and $_.CommandLine -and $_.CommandLine.Contains($backend) })
foreach ($p in $procs) { & taskkill.exe /PID $p.ProcessId /T /F 2>&1 | Out-Null }

Write-Host "Backend detenido ($($procs.Count) proceso(s) cerrado(s))." -ForegroundColor Yellow
