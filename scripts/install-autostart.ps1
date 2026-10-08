<#
.SYNOPSIS
  Registra la tarea programada "tunedrop-backend": arranca la API y el worker al iniciar sesion.
.DESCRIPTION
  No necesita administrador (es una tarea de tu propio usuario). Arranca al iniciar sesion en Windows,
  asi que para que el sitio vuelva solo tras un reinicio, el PC debe iniciar sesion automaticamente
  (o tu debes entrar). Para que arranque antes de iniciar sesion hace falta una tarea con contrasena
  o un servicio, que requieren permisos de administrador.
.PARAMETER StartNow
  Ademas de registrarla, la inicia ahora.
.PARAMETER Uninstall
  Detiene y elimina la tarea.
#>
param([switch]$StartNow, [switch]$Uninstall)

$ErrorActionPreference = 'Stop'
$taskName = 'tunedrop-backend'

if ($Uninstall) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Tarea '$taskName' eliminada." -ForegroundColor Yellow
    return
}

$script = Join-Path $PSScriptRoot 'service-backend.ps1'
if (-not (Test-Path $script)) { throw "No se encontro $script" }

$user = "$env:USERDOMAIN\$env:USERNAME"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
    -Principal $principal -Description 'tunedrop: API y worker del backend (reinicia si se caen)' -Force | Out-Null
Write-Host "Tarea '$taskName' registrada: arranca al iniciar sesion como $user." -ForegroundColor Green

if ($StartNow) {
    Start-ScheduledTask -TaskName $taskName
    Write-Host 'Iniciada. Logs en backend\data\logs.' -ForegroundColor Green
}
