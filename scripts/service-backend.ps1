<#
.SYNOPSIS
  Mantiene vivos la API y el worker del backend (sin ventana) y los reinicia si se caen.
.DESCRIPTION
  Pensado para que lo lance la tarea programada "tunedrop-backend" (ver install-autostart.ps1),
  pero tambien se puede ejecutar a mano. Solo corre una instancia a la vez.
  Los logs quedan en backend\data\logs (api.log, worker.log y sus .err.log, con rotacion a 5 MB).
  Para detenerlo: Stop-ScheduledTask -TaskName tunedrop-backend  (o cerrar este proceso).
#>
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root 'backend'
$logDir = Join-Path $backend 'data\logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# Una sola instancia
$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Global\tunedrop-backend', [ref]$created)
if (-not $created) { Write-Host 'Ya hay una instancia de service-backend corriendo.'; exit 0 }

# winget actualiza el PATH de usuario/maquina; una tarea al iniciar sesion puede no verlo todavia
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')

$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
if (-not (Test-Path (Join-Path $backend 'node_modules'))) { throw "Faltan dependencias: ejecuta 'npm install' en $backend" }

function Write-Log([string]$msg) {
    $line = '{0} {1}' -f (Get-Date -Format 's'), $msg
    Add-Content -LiteralPath (Join-Path $logDir 'supervisor.log') -Value $line
}

function Rotate([string]$file) {
    if ((Test-Path -LiteralPath $file) -and ((Get-Item -LiteralPath $file).Length -gt 5MB)) {
        Move-Item -LiteralPath $file -Destination "$file.old" -Force
    }
}

function Start-Backend([string]$name) {
    $out = Join-Path $logDir "$name.log"
    $err = Join-Path $logDir "$name.err.log"
    Rotate $out; Rotate $err
    Start-Process -FilePath $npm -ArgumentList 'run', "start:$name" -WorkingDirectory $backend `
        -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err -PassThru
}

function Stop-Tree($proc) {
    if ($proc -and -not $proc.HasExited) { & taskkill.exe /PID $proc.Id /T /F 2>&1 | Out-Null }
}

# Si el supervisor anterior murio de golpe (p. ej. Stop-ScheduledTask), pueden quedar API/worker huerfanos
# ocupando el puerto. Se cierran antes de empezar.
function Stop-Stale {
    $mine = $PID
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -in 'node.exe', 'cmd.exe' -and $_.CommandLine -and $_.CommandLine.Contains($backend) -and $_.ProcessId -ne $mine } |
        ForEach-Object {
            Write-Log "cerrando proceso huerfano $($_.Name) pid $($_.ProcessId)"
            & taskkill.exe /PID $_.ProcessId /T /F 2>&1 | Out-Null
        }
}

$names = 'api', 'worker'
$procs = @{}
$startedAt = @{}
$quickFails = @{}
foreach ($n in $names) { $quickFails[$n] = 0 }

Write-Log 'supervisor iniciado'
Stop-Stale
Start-Sleep -Seconds 1
try {
    while ($true) {
        foreach ($n in $names) {
            $p = $procs[$n]
            if ($p -and -not $p.HasExited) { continue }

            if ($p) {
                # Se cayo: si lo hizo enseguida, espera mas antes de reintentar para no entrar en bucle rapido
                $ranFor = ((Get-Date) - $startedAt[$n]).TotalSeconds
                $quickFails[$n] = if ($ranFor -lt 30) { $quickFails[$n] + 1 } else { 0 }
                Write-Log "$n termino (codigo $($p.ExitCode), vivio $([int]$ranFor) s)"
                if ($quickFails[$n] -ge 3) { Start-Sleep -Seconds 60 } else { Start-Sleep -Seconds 3 }
            }
            $procs[$n] = Start-Backend $n
            $startedAt[$n] = Get-Date
            Write-Log "$n iniciado (pid $($procs[$n].Id))"
        }
        Start-Sleep -Seconds 5
    }
}
finally {
    Write-Log 'supervisor detenido; cerrando API y worker'
    foreach ($n in $names) { Stop-Tree $procs[$n] }
    $mutex.ReleaseMutex()
}
