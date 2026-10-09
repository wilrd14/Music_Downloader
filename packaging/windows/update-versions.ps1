<#
.SYNOPSIS
  Actualiza versions.json con las ultimas versiones de Node.js (LTS), yt-dlp y FFmpeg (BtbN).
.DESCRIPTION
  Obtiene SIEMPRE las huellas SHA-256 de los archivos de sumas oficiales de cada proveedor.
  No se ejecuta en CI: subir de version es una decision deliberada. Despues de ejecutarlo,
  revisa el diff de versions.json, ejecuta build.ps1 y smoke-test.ps1 y haz commit.
  Compatible con Windows PowerShell 5.1 y PowerShell 7. Si defines GITHUB_TOKEN se usa para la API
  de GitHub (evita el limite de 60 peticiones/hora).
.PARAMETER NodeMajor
  Linea de Node.js a seguir (por defecto 24; debe ser LTS).
.PARAMETER FfmpegBranch
  Linea estable de FFmpeg a seguir (por defecto la actual de versions.json, p. ej. 8.1).
#>
[CmdletBinding()]
param(
  [int]$NodeMajor = 24,
  [string]$FfmpegBranch
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}

$VersionsPath = [IO.Path]::Combine($PSScriptRoot, 'versions.json')
$current = Get-Content -Raw -LiteralPath $VersionsPath | ConvertFrom-Json

function Get-Text([string]$Url) {
  $r = Invoke-WebRequest -UseBasicParsing -Uri $Url
  if ($r.Content -is [byte[]]) { return [Text.Encoding]::UTF8.GetString($r.Content) }
  return [string]$r.Content
}

function Get-Json([string]$Url) {
  $h = @{ 'User-Agent' = 'tunedrop-packaging'; 'Accept' = 'application/vnd.github+json' }
  if ($env:GITHUB_TOKEN) { $h['Authorization'] = "Bearer $env:GITHUB_TOKEN" }
  return Invoke-RestMethod -UseBasicParsing -Uri $Url -Headers $h
}

# Devuelve la huella de `fileName` dentro de un archivo de sumas "<hash>  <nombre>".
function Find-Sum([string]$SumsText, [string]$FileName) {
  foreach ($line in ($SumsText -split "`r?`n")) {
    if ($line -match '^\s*([0-9a-fA-F]{64})\s+\*?\.?/?(.+?)\s*$' -and $Matches[2] -eq $FileName) { return $Matches[1].ToLowerInvariant() }
  }
  throw "No hay huella para $FileName en el archivo de sumas."
}

function Get-FileSha256FromUrl([string]$Url) {
  $tmp = [IO.Path]::GetTempFileName()
  try {
    Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $tmp
    return (Get-FileHash -Algorithm SHA256 -LiteralPath $tmp).Hash.ToLowerInvariant()
  } finally { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
}

# --- Node.js (ultima LTS de la linea elegida) --------------------------------
Write-Host "Node.js $NodeMajor ..."
$idx = Get-Json 'https://nodejs.org/dist/index.json'
$node = $idx | Where-Object { $_.version -like "v$NodeMajor.*" -and $_.lts } | Select-Object -First 1
if (-not $node) { throw "No hay una version LTS de Node.js $NodeMajor.x en https://nodejs.org/dist/index.json" }
$nv = $node.version.TrimStart('v')
$nodeFile = "node-v$nv-win-x64.zip"
$nodeSums = Get-Text "https://nodejs.org/dist/v$nv/SHASUMS256.txt"
$nodeSha = Find-Sum $nodeSums $nodeFile

# --- yt-dlp ------------------------------------------------------------------
Write-Host "yt-dlp ..."
$yrel = Get-Json 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest'
$yv = $yrel.tag_name
$ySums = Get-Text "https://github.com/yt-dlp/yt-dlp/releases/download/$yv/SHA2-256SUMS"
$ySha = Find-Sum $ySums 'yt-dlp.exe'
$yLicenses = @()
foreach ($f in @(@('LICENSE', 'yt-dlp-LICENSE.txt'), @('THIRD_PARTY_LICENSES.txt', 'yt-dlp-THIRD_PARTY_LICENSES.txt'))) {
  $u = "https://raw.githubusercontent.com/yt-dlp/yt-dlp/$yv/$($f[0])"
  $yLicenses += [ordered]@{ url = $u; sha256 = (Get-FileSha256FromUrl $u); target = $f[1] }
}

# --- FFmpeg (BtbN: compilacion GPL estatica win64, release con etiqueta fechada) ------
if (-not $FfmpegBranch) {
  if ($current.components.ffmpeg.file -match 'win64-gpl-(\d+\.\d+)\.zip$') { $FfmpegBranch = $Matches[1] } else { throw 'Indica -FfmpegBranch (p. ej. 8.1).' }
}
Write-Host "FFmpeg $FfmpegBranch (BtbN) ..."
$rels = Get-Json 'https://api.github.com/repos/BtbN/FFmpeg-Builds/releases?per_page=30'
$ffRel = $null; $ffAsset = $null
foreach ($r in $rels) {
  if ($r.tag_name -notlike 'autobuild-*') { continue }   # ignora la etiqueta movil "latest"
  $a = $r.assets | Where-Object { $_.name -match "^ffmpeg-n\d+\.\d+(\.\d+)?-\d+-g[0-9a-f]+-win64-gpl-$([regex]::Escape($FfmpegBranch))\.zip$" } | Select-Object -First 1
  if ($a) { $ffRel = $r; $ffAsset = $a; break }
}
if (-not $ffAsset) { throw "No se encontro una compilacion win64-gpl-$FfmpegBranch en las ultimas releases de BtbN/FFmpeg-Builds." }
$ffTag = $ffRel.tag_name
$ffSumsUrl = "https://github.com/BtbN/FFmpeg-Builds/releases/download/$ffTag/checksums.sha256"
$ffSha = Find-Sum (Get-Text $ffSumsUrl) $ffAsset.name
if ($ffAsset.name -notmatch '^ffmpeg-(n\d+\.\d+(\.\d+)?-\d+-g([0-9a-f]+))-win64-gpl') { throw "Nombre inesperado: $($ffAsset.name)" }
$ffVer = $Matches[1]; $ffCommit = $Matches[3]

$doc = [ordered]@{
  schema = 1
  components = [ordered]@{
    node = [ordered]@{
      name = 'Node.js'; version = $nv
      url = "https://nodejs.org/dist/v$nv/$nodeFile"; file = $nodeFile; sha256 = $nodeSha
      sha256Source = "https://nodejs.org/dist/v$nv/SHASUMS256.txt"
      license = 'MIT (y licencias de componentes incluidos, ver LICENSE de Node.js)'
      sourceUrl = "https://github.com/nodejs/node/tree/v$nv"
      licenseFiles = @()
    }
    ytdlp = [ordered]@{
      name = 'yt-dlp'; version = $yv
      url = "https://github.com/yt-dlp/yt-dlp/releases/download/$yv/yt-dlp.exe"; file = 'yt-dlp.exe'; sha256 = $ySha
      sha256Source = "https://github.com/yt-dlp/yt-dlp/releases/download/$yv/SHA2-256SUMS"
      license = 'Unlicense (el ejecutable agrupa Python y bibliotecas con otras licencias, ver yt-dlp-THIRD_PARTY_LICENSES.txt)'
      sourceUrl = "https://github.com/yt-dlp/yt-dlp/tree/$yv"
      licenseFiles = $yLicenses
    }
    ffmpeg = [ordered]@{
      name = 'FFmpeg (compilacion GPL de BtbN/FFmpeg-Builds, estatica, win64)'; version = "$ffVer (rama $FfmpegBranch)"
      url = "https://github.com/BtbN/FFmpeg-Builds/releases/download/$ffTag/$($ffAsset.name)"; file = $ffAsset.name; sha256 = $ffSha
      sha256Source = $ffSumsUrl
      license = 'GPL-3.0-or-later (compilacion con bibliotecas GPL como x264 y x265)'
      sourceUrl = "https://github.com/FFmpeg/FFmpeg/tree/$ffCommit"
      buildScriptsUrl = "https://github.com/BtbN/FFmpeg-Builds/tree/$ffTag"
      licenseFiles = @()
    }
  }
}
$json = ($doc | ConvertTo-Json -Depth 8)
# Windows PowerShell 5.1 escapa < > ' & como \uXXXX: se deshace para que el archivo sea legible.
$json = [regex]::Replace($json, '\\u([0-9a-fA-F]{4})', { param($m) [string][char][Convert]::ToInt32($m.Groups[1].Value, 16) })
[IO.File]::WriteAllText($VersionsPath, ($json -replace "`r`n", "`n") + "`n", (New-Object System.Text.UTF8Encoding($false)))
Write-Host ""
Write-Host "versions.json actualizado:" -ForegroundColor Green
Write-Host "  Node.js $nv | yt-dlp $yv | FFmpeg $ffVer ($ffTag)"
Write-Host "Revisa 'git diff packaging/windows/versions.json', ejecuta build.ps1 y smoke-test.ps1 y haz commit."
