<#
.SYNOPSIS
  Prueba de humo del zip de Windows: lo extrae, arranca tunedrop y comprueba que todo funciona.
.DESCRIPTION
  1. Extrae el zip en una carpeta temporal con espacios y acentos en el nombre.
  2. Arranca la app (con node.exe del paquete, o con "Iniciar tunedrop.bat" si usas -UseLauncher)
     con TUNEDROP_NO_BROWSER=1 y DATA_DIR / DOWNLOAD_DIR temporales, con un PATH SIN yt-dlp/ffmpeg
     (asi solo pueden salir de app\bin).
  3. Comprueba /api/config (modo local), /api/health (ok:true con el yt-dlp del paquete), la
     interfaz web y que un Host ajeno recibe 403.
  4. Salvo -SkipDownload, descarga de verdad https://www.youtube.com/watch?v=jNQXAC9IVRw y revisa el
     mp3 (audio, titulo, artista y portada) con el ffprobe del paquete.
  5. Detiene todo el arbol de procesos y borra la carpeta temporal. Codigo de salida != 0 si algo falla.
.PARAMETER ZipPath
  Por defecto dist-release\tunedrop-windows-x64.zip en la raiz del repositorio.
.PARAMETER SkipDownload
  No hace la descarga real (en CI, las IP de los runners estan bloqueadas por YouTube).
.PARAMETER Port
  Puerto inicial (por defecto 8791); la app usa el siguiente libre si esta ocupado.
.PARAMETER UseLauncher
  Arranca mediante "Iniciar tunedrop.bat" en lugar de llamar a node.exe directamente.
.PARAMETER KeepTemp
  No borra la carpeta temporal (para depurar).
#>
[CmdletBinding()]
param(
  [string]$ZipPath,
  [switch]$SkipDownload,
  [int]$Port = 8791,
  [switch]$UseLauncher,
  [switch]$KeepTemp
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$RepoRoot = [IO.Path]::GetFullPath([IO.Path]::Combine($PSScriptRoot, '..', '..'))
if (-not $ZipPath) { $ZipPath = [IO.Path]::Combine($RepoRoot, 'dist-release', 'tunedrop-windows-x64.zip') }
$ZipPath = [IO.Path]::GetFullPath($ZipPath)
if (-not (Test-Path -LiteralPath $ZipPath)) { throw "No existe $ZipPath (ejecuta build.ps1 antes)." }
$versions = Get-Content -Raw -LiteralPath ([IO.Path]::Combine($PSScriptRoot, 'versions.json')) | ConvertFrom-Json
$expectedYtDlp = $versions.components.ytdlp.version

$script:Failures = New-Object System.Collections.Generic.List[string]
function Check([string]$Name, [bool]$Ok, [string]$Detail = '') {
  if ($Ok) { Write-Host "  [OK]    $Name $Detail" -ForegroundColor Green }
  else { Write-Host "  [FALLO] $Name $Detail" -ForegroundColor Red; $script:Failures.Add($Name) }
}

function Get-Descendants([int]$RootPid) {
  $all = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId)
  $out = New-Object System.Collections.Generic.List[int]
  $queue = New-Object System.Collections.Generic.Queue[int]
  $queue.Enqueue($RootPid)
  while ($queue.Count -gt 0) {
    $p = $queue.Dequeue()
    foreach ($c in ($all | Where-Object { $_.ParentProcessId -eq $p })) {
      if (-not $out.Contains([int]$c.ProcessId)) { $out.Add([int]$c.ProcessId); $queue.Enqueue([int]$c.ProcessId) }
    }
  }
  return $out.ToArray()
}

function Stop-Tree([int]$RootPid) {
  $ids = @(Get-Descendants $RootPid) + @($RootPid)
  [array]::Reverse($ids)
  foreach ($id in $ids) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
}

# Peticion HTTP cruda con la cabecera Host que queramos (Invoke-WebRequest no deja cambiarla en PS 5.1).
function Send-RawHttp([int]$ServerPort, [string]$HostHeader, [string]$Path = '/api/config') {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $client.Connect('127.0.0.1', $ServerPort)
    $stream = $client.GetStream()
    $stream.ReadTimeout = 10000
    $req = "GET $Path HTTP/1.1`r`nHost: $HostHeader`r`nConnection: close`r`n`r`n"
    $bytes = [Text.Encoding]::ASCII.GetBytes($req)
    $stream.Write($bytes, 0, $bytes.Length)
    $reader = New-Object IO.StreamReader($stream, [Text.Encoding]::UTF8)
    $statusLine = $reader.ReadLine()
    if ($statusLine -match '^HTTP/\d\.\d (\d{3})') { return [int]$Matches[1] }
    return 0
  } finally { $client.Close() }
}

function Invoke-Api([string]$Method, [string]$Path, $Body = $null) {
  $uri = "http://127.0.0.1:$($script:ActualPort)$Path"
  if ($null -ne $Body) {
    return Invoke-RestMethod -UseBasicParsing -Method $Method -Uri $uri -ContentType 'application/json' -Body ($Body | ConvertTo-Json -Compress)
  }
  return Invoke-RestMethod -UseBasicParsing -Method $Method -Uri $uri
}

# --- Entorno temporal ---------------------------------------------------------------
$tempRoot = [IO.Path]::Combine([IO.Path]::GetTempPath(), 'tunedrop-smoke-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
# Nombre con espacio, enie y u con tilde (sin acentos en este archivo: se construyen por codigo).
$folderName = 'prueba ' + [char]0xF1 + 'and' + [char]0xFA
$extractDir = [IO.Path]::Combine($tempRoot, $folderName)
$dataDir = [IO.Path]::Combine($tempRoot, 'data')
$downloadDir = [IO.Path]::Combine($tempRoot, 'musica')
New-Item -ItemType Directory -Force -Path $tempRoot, $dataDir, $downloadDir | Out-Null

$saved = @{}
$envNames = @('TUNEDROP_NO_BROWSER', 'DATA_DIR', 'DOWNLOAD_DIR', 'API_PORT', 'YT_DLP_AUTO_UPDATE', 'YT_DLP_PATH', 'FFMPEG_PATH', 'TUNEDROP_BIN_DIR', 'STATIC_DIR', 'TUNEDROP_MODE', 'PATH')
foreach ($n in $envNames) { $saved[$n] = [Environment]::GetEnvironmentVariable($n, 'Process') }

$proc = $null
$script:ActualPort = $Port
$stdout = [IO.Path]::Combine($tempRoot, 'stdout.log')
$stderr = [IO.Path]::Combine($tempRoot, 'stderr.log')

try {
  Write-Host "==> Extrayendo $ZipPath" -ForegroundColor Cyan
  Write-Host "    en $extractDir"
  New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
  [IO.Compression.ZipFile]::ExtractToDirectory($ZipPath, $extractDir)
  $pkg = [IO.Path]::Combine($extractDir, 'tunedrop-windows-x64')

  Write-Host "==> Contenido del paquete" -ForegroundColor Cyan
  $required = 'Iniciar tunedrop.bat', 'LEEME.txt', 'VERSION', 'app\tunedrop.mjs', 'app\web\index.html', 'app\bin\yt-dlp.exe', 'app\bin\ffmpeg.exe',
    'app\bin\ffprobe.exe', 'runtime\node.exe', 'licenses\LICENSE-tunedrop.txt', 'licenses\node-LICENSE.txt', 'licenses\THIRD_PARTY_NOTICES.md'
  foreach ($r in $required) { Check "existe $r" (Test-Path -LiteralPath ([IO.Path]::Combine($pkg, $r))) }
  $nodeVer = (& ([IO.Path]::Combine($pkg, 'runtime', 'node.exe')) --version)
  Check 'node.exe del paquete es Node 24' ($nodeVer -match '^v24\.') "($nodeVer)"
  if ($script:Failures.Count -gt 0) { throw 'El paquete esta incompleto.' }

  # PATH sin ninguna carpeta que contenga yt-dlp / ffmpeg / ffprobe ni la de WinGet.
  $cleanPath = ($env:PATH -split ';' | Where-Object {
      if (-not $_) { return $false }
      if ($_ -match 'WinGet|ffmpeg|yt-dlp') { return $false }
      try {
        foreach ($exe in 'ffmpeg.exe', 'ffprobe.exe', 'yt-dlp.exe') { if ([IO.File]::Exists([IO.Path]::Combine($_, $exe))) { return $false } }
      } catch {}
      return $true
    }) -join ';'

  $env:TUNEDROP_NO_BROWSER = '1'
  $env:DATA_DIR = $dataDir
  $env:DOWNLOAD_DIR = $downloadDir
  $env:API_PORT = [string]$Port
  $env:YT_DLP_AUTO_UPDATE = '0'
  foreach ($n in 'YT_DLP_PATH', 'FFMPEG_PATH', 'TUNEDROP_BIN_DIR', 'STATIC_DIR', 'TUNEDROP_MODE') { Remove-Item "Env:$n" -ErrorAction SilentlyContinue }
  $env:PATH = $cleanPath

  Write-Host "==> Arrancando tunedrop ($(if ($UseLauncher) { 'Iniciar tunedrop.bat' } else { 'node.exe directo' }))" -ForegroundColor Cyan
  $started = [Diagnostics.Stopwatch]::StartNew()
  if ($UseLauncher) {
    $bat = [IO.Path]::Combine($pkg, 'Iniciar tunedrop.bat')
    $proc = Start-Process -FilePath "$env:SystemRoot\System32\cmd.exe" -ArgumentList ('/d /s /c ""' + $bat + '""') -WorkingDirectory $tempRoot -PassThru -NoNewWindow -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  } else {
    $node = [IO.Path]::Combine($pkg, 'runtime', 'node.exe')
    $mjs = [IO.Path]::Combine($pkg, 'app', 'tunedrop.mjs')
    $proc = Start-Process -FilePath $node -ArgumentList ('"' + $mjs + '"') -WorkingDirectory $tempRoot -PassThru -NoNewWindow -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  }

  # Esperar a que escuche y leer el puerto real del mensaje de arranque.
  $ready = $false
  while ($started.Elapsed.TotalSeconds -lt 90) {
    if ($proc.HasExited) { break }
    if (Test-Path -LiteralPath $stdout) {
      $txt = Get-Content -Raw -LiteralPath $stdout -ErrorAction SilentlyContinue
      if ($txt -and $txt -match 'http://127\.0\.0\.1:(\d+)') {
        $script:ActualPort = [int]$Matches[1]
        try { $cfg0 = Invoke-Api GET '/api/config'; $ready = $true; break } catch {}
      }
    }
    Start-Sleep -Milliseconds 300
  }
  if (-not $ready) {
    Write-Host '--- stdout ---'; if (Test-Path -LiteralPath $stdout) { Get-Content -LiteralPath $stdout }
    Write-Host '--- stderr ---'; if (Test-Path -LiteralPath $stderr) { Get-Content -LiteralPath $stderr }
    throw 'tunedrop no llego a responder en 90 s.'
  }
  Check 'arranque' $true ("en {0:N1} s, puerto {1}" -f $started.Elapsed.TotalSeconds, $script:ActualPort)

  Write-Host "==> Comprobaciones de la API" -ForegroundColor Cyan
  $cfg = Invoke-Api GET '/api/config'
  Check '/api/config mode=local' ($cfg.mode -eq 'local') "(mode=$($cfg.mode))"
  Check '/api/config downloadDir = DOWNLOAD_DIR' ($cfg.downloadDir -eq $downloadDir) "($($cfg.downloadDir))"

  # El primer arranque de un .exe recien extraido puede tardar (antivirus); /api/health se cachea 30 s, asi que se reintenta.
  $health = Invoke-Api GET '/api/health'
  $healthWait = [Diagnostics.Stopwatch]::StartNew()
  while (-not $health.ok -and $healthWait.Elapsed.TotalSeconds -lt 75) {
    Start-Sleep -Seconds 5
    $health = Invoke-Api GET '/api/health'
  }
  Check '/api/health ok:true con yt-dlp y ffmpeg del paquete' ($health.ok -eq $true -and $health.ffmpeg -eq $true) ("(ytDlp=$($health.ytDlp), ffmpeg=$($health.ffmpeg))")
  Check "yt-dlp es la version fijada ($expectedYtDlp)" ($health.ytDlp -eq $expectedYtDlp)

  $html = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$($script:ActualPort)/"
  Check 'la interfaz web se sirve (GET /)' ($html.StatusCode -eq 200 -and $html.Content -match '<div id="root"|<title>')

  $badHost = Send-RawHttp $script:ActualPort 'evil.example'
  Check 'Host ajeno -> 403' ($badHost -eq 403) "(recibido $badHost)"
  $badHostPort = Send-RawHttp $script:ActualPort "127.0.0.1:$($script:ActualPort + 1)"
  Check 'Host con otro puerto -> 403' ($badHostPort -eq 403) "(recibido $badHostPort)"
  $goodHost = Send-RawHttp $script:ActualPort "127.0.0.1:$($script:ActualPort)"
  Check 'Host correcto -> 200' ($goodHost -eq 200) "(recibido $goodHost)"

  if ($SkipDownload) {
    Write-Host "==> Descarga real omitida (-SkipDownload)" -ForegroundColor Yellow
  } else {
    Write-Host "==> Descarga real (jNQXAC9IVRw)" -ForegroundColor Cyan
    $videoUrl = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'
    $dl = [Diagnostics.Stopwatch]::StartNew()
    $src = Invoke-Api POST '/api/resolve' @{ url = $videoUrl }
    Check 'resolve devuelve la pista' (@($src.tracks).Count -eq 1) "(titulo: $($src.title))"
    $job = Invoke-Api POST '/api/jobs' @{ url = $videoUrl; format = 'mp3' }
    $state = $null
    while ($dl.Elapsed.TotalSeconds -lt 240) {
      Start-Sleep -Seconds 2
      $state = Invoke-Api GET "/api/jobs/$($job.id)"
      if ($state.status -in 'done', 'failed', 'expired') { break }
    }
    $err = ''
    if ($state.status -ne 'done') { $err = "(estado=$($state.status), error=$($state.error))" }
    Check 'el trabajo termina en done' ($state.status -eq 'done') ("en {0:N1} s {1}" -f $dl.Elapsed.TotalSeconds, $err)
    if ($state.status -eq 'done') {
      Check 'savedTo esta dentro de DOWNLOAD_DIR' ($state.savedTo -and $state.savedTo.StartsWith($downloadDir, [StringComparison]::OrdinalIgnoreCase)) "($($state.savedTo))"
      $mp3 = @(Get-ChildItem -LiteralPath $downloadDir -Recurse -Filter *.mp3 -File)
      Check 'hay un .mp3 en la carpeta de descargas' ($mp3.Count -eq 1) ("(" + (($mp3 | ForEach-Object { $_.Name }) -join ', ') + ")")
      if ($mp3.Count -ge 1) {
        $ffprobe = [IO.Path]::Combine($pkg, 'app', 'bin', 'ffprobe.exe')
        $raw = & $ffprobe -v error -print_format json -show_format -show_streams $mp3[0].FullName
        $probe = ($raw -join "`n") | ConvertFrom-Json
        $audio = @($probe.streams | Where-Object { $_.codec_type -eq 'audio' })
        $cover = @($probe.streams | Where-Object { $_.codec_type -eq 'video' -and $_.disposition.attached_pic -eq 1 })
        $tags = @{}
        if ($probe.format.PSObject.Properties.Name -contains 'tags') { foreach ($p in $probe.format.tags.PSObject.Properties) { $tags[$p.Name.ToLowerInvariant()] = [string]$p.Value } }
        $dur = [double]$probe.format.duration
        $kb = [int]($mp3[0].Length / 1KB)
        Write-Host ("    ffprobe: audio={0} {1} Hz, {2:N1} s, {3} KB, titulo='{4}', artista='{5}', portada={6}" -f $audio[0].codec_name, $audio[0].sample_rate, $dur, $kb, $tags['title'], $tags['artist'], $(if ($cover.Count) { $cover[0].codec_name } else { 'no' }))
        Check 'ffprobe: audio mp3' ($audio.Count -eq 1 -and $audio[0].codec_name -eq 'mp3')
        Check 'ffprobe: duracion plausible (10-40 s)' ($dur -gt 10 -and $dur -lt 40)
        Check 'ffprobe: etiqueta title' ([bool]$tags['title'])
        Check 'ffprobe: etiqueta artist' ([bool]$tags['artist'])
        Check 'ffprobe: portada incrustada' ($cover.Count -ge 1)
      }
    }
  }
} catch {
  Check 'ejecucion de la prueba' $false ("-> " + $_.Exception.Message)
} finally {
  Write-Host "==> Limpieza" -ForegroundColor Cyan
  if ($proc) {
    Stop-Tree $proc.Id
    $proc.WaitForExit(5000) | Out-Null
  }
  # Cualquier proceso que aun use archivos del paquete (por ejemplo un yt-dlp huerfano).
  Start-Sleep -Milliseconds 500
  Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  foreach ($n in $envNames) { [Environment]::SetEnvironmentVariable($n, $saved[$n], 'Process') }
  if (-not $KeepTemp) {
    $deleted = $false
    for ($i = 0; $i -lt 6 -and -not $deleted; $i++) {
      try { if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force }; $deleted = $true }
      catch { Start-Sleep -Seconds 1 }
    }
    Write-Host ("  carpeta temporal " + $(if ($deleted) { 'borrada' } else { "NO se pudo borrar: $tempRoot" }))
    if (-not $deleted) { $script:Failures.Add('limpieza') }
  } else { Write-Host "  se conserva $tempRoot" }
}

Write-Host ""
if ($script:Failures.Count -eq 0) { Write-Host 'PRUEBA DE HUMO CORRECTA' -ForegroundColor Green; exit 0 }
Write-Host ("PRUEBA DE HUMO FALLIDA: " + ($script:Failures -join '; ')) -ForegroundColor Red
exit 1
