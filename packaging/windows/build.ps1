<#
.SYNOPSIS
  Construye tunedrop-windows-x64.zip (Node + app + web + yt-dlp + ffmpeg/ffprobe + licencias).
.DESCRIPTION
  Compatible con Windows PowerShell 5.1 y PowerShell 7. Solo ASCII; los textos con acentos viven en
  packaging/windows/template. Las descargas se guardan en packaging/windows/.cache y SIEMPRE se
  verifican contra las huellas SHA-256 de versions.json (fallo duro si no coinciden).
.PARAMETER Version
  Version de tunedrop (por defecto, la de backend/package.json). Admite prefijo "v".
.PARAMETER OutDir
  Carpeta de salida (por defecto dist-release en la raiz del repositorio).
.PARAMETER SkipFrontend / SkipBackend
  No ejecuta npm ci + build de esa parte (usa lo ya compilado en frontend/dist o backend/dist).
.PARAMETER Clean
  Borra la carpeta de salida y frontend/dist y backend/dist antes de construir.
#>
[CmdletBinding()]
param(
  [string]$Version,
  [string]$OutDir,
  [switch]$SkipFrontend,
  [switch]$SkipBackend,
  [switch]$Clean
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$RepoRoot = [IO.Path]::GetFullPath([IO.Path]::Combine($PSScriptRoot, '..', '..'))
$Cache = [IO.Path]::Combine($PSScriptRoot, '.cache')
$Template = [IO.Path]::Combine($PSScriptRoot, 'template')
$PackageName = 'tunedrop-windows-x64'
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$Utf8Bom = New-Object System.Text.UTF8Encoding($true)
$Total = [Diagnostics.Stopwatch]::StartNew()
$Timings = [ordered]@{}

function Step([string]$Name, [scriptblock]$Body) {
  Write-Host ""
  Write-Host "==> $Name" -ForegroundColor Cyan
  $sw = [Diagnostics.Stopwatch]::StartNew()
  & $Body
  $sw.Stop()
  $script:Timings[$Name] = $sw.Elapsed
}

function Get-Sha256([string]$Path) { return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant() }

function Format-Size([double]$Bytes) {
  if ($Bytes -ge 1GB) { return ('{0:N2} GB' -f ($Bytes / 1GB)) }
  return ('{0:N1} MB' -f ($Bytes / 1MB))
}

function Invoke-Npm([string]$Dir, [string[]]$NpmArgs) {
  Push-Location -LiteralPath $Dir
  try {
    & npm @NpmArgs
    if ($LASTEXITCODE -ne 0) { throw "npm $($NpmArgs -join ' ') fallo en $Dir (codigo $LASTEXITCODE)" }
  } finally { Pop-Location }
}

# Descarga (o reutiliza de la cache) un archivo y comprueba su SHA-256. Devuelve la ruta en cache.
function Get-Verified([string]$Url, [string]$Sha256, [string]$FileName) {
  New-Item -ItemType Directory -Force -Path $Cache | Out-Null
  $dest = [IO.Path]::Combine($Cache, $FileName)
  if (Test-Path -LiteralPath $dest) {
    if ((Get-Sha256 $dest) -eq $Sha256.ToLowerInvariant()) {
      Write-Host "  cache OK: $FileName"
      return $dest
    }
    Write-Host "  cache con huella distinta, se vuelve a descargar: $FileName"
    Remove-Item -LiteralPath $dest -Force
  }
  $part = "$dest.part"
  $ok = $false
  for ($i = 1; $i -le 3 -and -not $ok; $i++) {
    try {
      Write-Host "  descargando ($i/3): $Url"
      if (Test-Path -LiteralPath $part) { Remove-Item -LiteralPath $part -Force }
      Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $part
      $ok = $true
    } catch {
      Write-Host "  fallo: $($_.Exception.Message)"
      if ($i -eq 3) { throw }
      Start-Sleep -Seconds (3 * $i)
    }
  }
  $got = Get-Sha256 $part
  if ($got -ne $Sha256.ToLowerInvariant()) {
    Remove-Item -LiteralPath $part -Force
    throw "SHA-256 NO COINCIDE para $FileName`n  esperado: $Sha256`n  obtenido: $got`n  origen:   $Url"
  }
  Move-Item -LiteralPath $part -Destination $dest -Force
  Write-Host "  SHA-256 verificado: $FileName ($(Format-Size (Get-Item -LiteralPath $dest).Length))"
  return $dest
}

# Extrae del zip la unica entrada cuyo nombre cumple el patron (regex sobre la ruta con '/').
function Expand-ZipEntry([string]$ZipPath, [string]$Pattern, [string]$Destination) {
  $zip = [IO.Compression.ZipFile]::OpenRead($ZipPath)
  try {
    $matches_ = @($zip.Entries | Where-Object { $_.FullName -match $Pattern -and $_.Name })
    if ($matches_.Count -ne 1) { throw "Se esperaba 1 entrada que cumpla '$Pattern' en $ZipPath y hay $($matches_.Count)." }
    New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($Destination)) | Out-Null
    [IO.Compression.ZipFileExtensions]::ExtractToFile($matches_[0], $Destination, $true)
  } finally { $zip.Dispose() }
}

function Write-TextFile([string]$Path, [string]$Text, $Encoding, [switch]$Crlf) {
  $t = $Text -replace "`r`n", "`n"
  if ($Crlf) { $t = $t -replace "`n", "`r`n" }
  New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($Path)) | Out-Null
  [IO.File]::WriteAllText($Path, $t, $Encoding)
}

function Read-Template([string]$Name) { return [IO.File]::ReadAllText([IO.Path]::Combine($Template, $Name), $Utf8NoBom) }

# ---------------------------------------------------------------------------
# Parametros
# ---------------------------------------------------------------------------
if (-not $Version) {
  $pkg = Get-Content -Raw -LiteralPath ([IO.Path]::Combine($RepoRoot, 'backend', 'package.json')) | ConvertFrom-Json
  $Version = $pkg.version
}
$Version = $Version.Trim().TrimStart('v')
if ($Version -notmatch '^\d+\.\d+\.\d+([-+][0-9A-Za-z.\-+]+)?$') { throw "Version no valida: '$Version' (se espera algo como 0.1.0)." }
if (-not $OutDir) { $OutDir = [IO.Path]::Combine($RepoRoot, 'dist-release') }
$OutDir = [IO.Path]::GetFullPath($OutDir)
$versions = Get-Content -Raw -LiteralPath ([IO.Path]::Combine($PSScriptRoot, 'versions.json')) | ConvertFrom-Json
$comp = $versions.components

Write-Host "tunedrop $Version -> $OutDir"

if ($Clean) {
  Step 'Limpieza' {
    foreach ($p in @($OutDir, [IO.Path]::Combine($RepoRoot, 'frontend', 'dist'), [IO.Path]::Combine($RepoRoot, 'backend', 'dist'))) {
      if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Recurse -Force; Write-Host "  borrado $p" }
    }
  }
}

# ---------------------------------------------------------------------------
# Compilacion
# ---------------------------------------------------------------------------
$frontendDir = [IO.Path]::Combine($RepoRoot, 'frontend')
$backendDir = [IO.Path]::Combine($RepoRoot, 'backend')
if (-not $SkipFrontend) {
  Step 'Frontend (npm ci + build)' {
    Invoke-Npm $frontendDir @('ci')
    Invoke-Npm $frontendDir @('run', 'build')
  }
}
if (-not $SkipBackend) {
  Step 'Backend (npm ci + build)' {
    Invoke-Npm $backendDir @('ci')
    Invoke-Npm $backendDir @('run', 'build')
  }
}
$bundle = [IO.Path]::Combine($backendDir, 'dist', 'tunedrop.mjs')
$webDist = [IO.Path]::Combine($frontendDir, 'dist')
if (-not (Test-Path -LiteralPath $bundle)) { throw "Falta $bundle (compila el backend)." }
if (-not (Test-Path -LiteralPath ([IO.Path]::Combine($webDist, 'index.html')))) { throw "Falta $webDist\index.html (compila el frontend)." }

# ---------------------------------------------------------------------------
# Componentes de terceros
# ---------------------------------------------------------------------------
$files = @{}
Step 'Descarga y verificacion de componentes' {
  $script:files.node = Get-Verified $comp.node.url $comp.node.sha256 $comp.node.file
  $script:files.ytdlp = Get-Verified $comp.ytdlp.url $comp.ytdlp.sha256 $comp.ytdlp.file
  $script:files.ffmpeg = Get-Verified $comp.ffmpeg.url $comp.ffmpeg.sha256 $comp.ffmpeg.file
  $script:files.lic = @{}
  foreach ($lf in $comp.ytdlp.licenseFiles) {
    $script:files.lic[$lf.target] = Get-Verified $lf.url $lf.sha256 ('ytdlp-' + $lf.target)
  }
}

# ---------------------------------------------------------------------------
# Ensamblado
# ---------------------------------------------------------------------------
$stageRoot = [IO.Path]::Combine($OutDir, 'stage')
$pkgDir = [IO.Path]::Combine($stageRoot, $PackageName)
Step 'Ensamblado de la carpeta' {
  if (Test-Path -LiteralPath $stageRoot) { Remove-Item -LiteralPath $stageRoot -Recurse -Force }
  foreach ($d in @('app\bin', 'app\web', 'runtime', 'licenses')) { New-Item -ItemType Directory -Force -Path ([IO.Path]::Combine($pkgDir, $d)) | Out-Null }

  Copy-Item -LiteralPath $bundle -Destination ([IO.Path]::Combine($pkgDir, 'app', 'tunedrop.mjs'))
  Copy-Item -Path ([IO.Path]::Combine($webDist, '*')) -Destination ([IO.Path]::Combine($pkgDir, 'app', 'web')) -Recurse
  Copy-Item -LiteralPath $files.ytdlp -Destination ([IO.Path]::Combine($pkgDir, 'app', 'bin', 'yt-dlp.exe'))

  # Node: solo node.exe y su LICENSE, del zip oficial.
  Expand-ZipEntry $files.node '^[^/]+/node\.exe$' ([IO.Path]::Combine($pkgDir, 'runtime', 'node.exe'))
  Expand-ZipEntry $files.node '^[^/]+/LICENSE$' ([IO.Path]::Combine($pkgDir, 'licenses', 'node-LICENSE.txt'))

  # FFmpeg: ffmpeg.exe y ffprobe.exe (yt-dlp necesita ambos) y los textos de licencia del archivo.
  Expand-ZipEntry $files.ffmpeg '^[^/]+/bin/ffmpeg\.exe$' ([IO.Path]::Combine($pkgDir, 'app', 'bin', 'ffmpeg.exe'))
  Expand-ZipEntry $files.ffmpeg '^[^/]+/bin/ffprobe\.exe$' ([IO.Path]::Combine($pkgDir, 'app', 'bin', 'ffprobe.exe'))
  Expand-ZipEntry $files.ffmpeg '^[^/]+/LICENSE\.txt$' ([IO.Path]::Combine($pkgDir, 'licenses', 'ffmpeg-LICENSE.txt'))
  $ffzip = [IO.Compression.ZipFile]::OpenRead($files.ffmpeg)
  try { $hasReadme = [bool]($ffzip.Entries | Where-Object { $_.FullName -match '^[^/]+/README\.txt$' }) } finally { $ffzip.Dispose() }
  if ($hasReadme) { Expand-ZipEntry $files.ffmpeg '^[^/]+/README\.txt$' ([IO.Path]::Combine($pkgDir, 'licenses', 'ffmpeg-README.txt')) }

  foreach ($t in $files.lic.Keys) { Copy-Item -LiteralPath $files.lic[$t] -Destination ([IO.Path]::Combine($pkgDir, 'licenses', $t)) }
  Copy-Item -LiteralPath ([IO.Path]::Combine($RepoRoot, 'LICENSE')) -Destination ([IO.Path]::Combine($pkgDir, 'licenses', 'LICENSE-tunedrop.txt'))

  # Textos: lanzador (CRLF), LEEME (CRLF, UTF-8 con BOM para el Bloc de notas), avisos de terceros.
  Write-TextFile ([IO.Path]::Combine($pkgDir, 'Iniciar tunedrop.bat')) (Read-Template 'Iniciar tunedrop.bat') $Utf8NoBom -Crlf
  Write-TextFile ([IO.Path]::Combine($pkgDir, 'LEEME.txt')) ((Read-Template 'LEEME.txt').Replace('{{VERSION}}', $Version)) $Utf8Bom -Crlf
  Write-TextFile ([IO.Path]::Combine($pkgDir, 'VERSION')) ("$Version`n") $Utf8NoBom

  # THIRD_PARTY_NOTICES.md con la tabla de componentes generada desde versions.json.
  $rows = New-Object System.Collections.Generic.List[string]
  $rows.Add('| Componente | Version | Licencia | Origen | SHA-256 del archivo descargado | Codigo fuente |')
  $rows.Add('|---|---|---|---|---|---|')
  $rows.Add("| tunedrop (esta aplicacion: ``app/tunedrop.mjs`` y ``app/web``) | $Version | GPL-3.0-or-later | https://github.com/wilrd14/Music_Downloader | (va dentro del zip; huella del zip en SHA256SUMS.txt) | https://github.com/wilrd14/Music_Downloader/tree/v$Version |")
  foreach ($key in @('node', 'ytdlp', 'ffmpeg')) {
    $c = $comp.$key
    $hashNote = $c.sha256 + ' (' + 'verificada contra ' + $c.sha256Source + ')'
    if (($c.PSObject.Properties.Name -contains 'sha256Computed') -and $c.sha256Computed) { $hashNote = $c.sha256 + ' (calculada por el proyecto; el proveedor no publica sumas)' }
    $src = $c.sourceUrl
    if ($c.PSObject.Properties.Name -contains 'buildScriptsUrl') { $src = "$src ; scripts de compilacion: $($c.buildScriptsUrl)" }
    $rows.Add("| $($c.name) | $($c.version) | $($c.license) | $($c.url) | ``$hashNote`` | $src |")
  }
  $notices = (Read-Template 'THIRD_PARTY_NOTICES.md').Replace('{{VERSION}}', $Version).Replace('{{COMPONENTS}}', ($rows -join "`n")).Replace('{{TUNEDROP_SOURCE}}', "https://github.com/wilrd14/Music_Downloader/tree/v$Version")
  Write-TextFile ([IO.Path]::Combine($pkgDir, 'licenses', 'THIRD_PARTY_NOTICES.md')) $notices $Utf8NoBom
}

# ---------------------------------------------------------------------------
# Zip y sumas
# ---------------------------------------------------------------------------
$zipPath = [IO.Path]::Combine($OutDir, "$PackageName.zip")
Step 'Creacion del zip' {
  if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
  $fs = [IO.File]::Open($zipPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
  try {
    $zip = New-Object IO.Compression.ZipArchive($fs, [IO.Compression.ZipArchiveMode]::Create, $false)
    try {
      $base = (Get-Item -LiteralPath $pkgDir).Parent.FullName.TrimEnd('\') + '\'
      $all = Get-ChildItem -LiteralPath $pkgDir -Recurse -File | Sort-Object FullName
      foreach ($f in $all) {
        $name = $f.FullName.Substring($base.Length).Replace('\', '/')
        $entry = $zip.CreateEntry($name, [IO.Compression.CompressionLevel]::Optimal)
        $entry.LastWriteTime = $f.LastWriteTime
        $es = $entry.Open()
        try {
          $in = [IO.File]::OpenRead($f.FullName)
          try { $in.CopyTo($es) } finally { $in.Dispose() }
        } finally { $es.Dispose() }
      }
    } finally { $zip.Dispose() }
  } finally { $fs.Dispose() }
}

Step 'Sumas SHA-256' {
  $hash = Get-Sha256 $zipPath
  $line = "$hash  $PackageName.zip`n"
  Write-TextFile ([IO.Path]::Combine($OutDir, "$PackageName.zip.sha256")) $line $Utf8NoBom
  Write-TextFile ([IO.Path]::Combine($OutDir, 'SHA256SUMS.txt')) $line $Utf8NoBom
  Write-Host "  $hash  $PackageName.zip"
}

# ---------------------------------------------------------------------------
# Resumen
# ---------------------------------------------------------------------------
$Total.Stop()
$extracted = (Get-ChildItem -LiteralPath $pkgDir -Recurse -File | Measure-Object -Property Length -Sum).Sum
Write-Host ""
Write-Host "==> Resumen" -ForegroundColor Green
Write-Host ("  Version:          {0}" -f $Version)
Write-Host ("  Zip:              {0}  ({1})" -f $zipPath, (Format-Size (Get-Item -LiteralPath $zipPath).Length))
Write-Host ("  Extraido (carpeta): {0}" -f (Format-Size $extracted))
foreach ($k in $Timings.Keys) { Write-Host ("  {0,-42} {1:N1} s" -f $k, $Timings[$k].TotalSeconds) }
Write-Host ("  Total:            {0:N1} s" -f $Total.Elapsed.TotalSeconds)
