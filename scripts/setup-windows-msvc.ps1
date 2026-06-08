# Erstellt src-tauri/.cargo/config.toml mit den korrekten MSVC- und Windows-SDK-Pfaden.
# Notwendig wenn Git-for-Windows link.exe den MSVC-Linker im PATH überdeckt.
# Einmalig ausführen, danach ist "npm run tauri:build" direkt nutzbar.
#
# Verwendung: PowerShell -ExecutionPolicy Bypass -File scripts/setup-windows-msvc.ps1

$ErrorActionPreference = "Stop"

function Find-LatestDir([string]$base) {
    if (-not (Test-Path $base)) { return $null }
    Get-ChildItem $base -Directory | Sort-Object Name -Descending | Select-Object -First 1 -ExpandProperty FullName
}

# MSVC-Compiler-Tools suchen
$msvcBase = "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC"
$msvcVer = Find-LatestDir $msvcBase
if (-not $msvcVer) {
    Write-Error "MSVC nicht gefunden. Bitte VS Build Tools mit 'C++ Desktopentwicklung' installieren."
    exit 1
}
$msvcLink = "$msvcVer\bin\Hostx64\x64\link.exe"
if (-not (Test-Path $msvcLink)) {
    Write-Error "link.exe nicht gefunden: $msvcLink"
    exit 1
}

# Windows SDK suchen
$sdkLibBase = "C:\Program Files (x86)\Windows Kits\10\Lib"
$sdkVer = Find-LatestDir $sdkLibBase
if (-not $sdkVer -or -not (Test-Path "$sdkVer\um\x64")) {
    Write-Error "Windows SDK nicht gefunden. Bitte Windows 10/11 SDK installieren."
    exit 1
}
$sdkVersion = Split-Path $sdkVer -Leaf

$msvcVersion = Split-Path $msvcVer -Leaf

Write-Host "MSVC: $msvcVersion"
Write-Host "SDK:  $sdkVersion"

$configDir = "$PSScriptRoot\..\src-tauri\.cargo"
New-Item -ItemType Directory -Path $configDir -Force | Out-Null

$config = @"
# Automatisch generiert von scripts/setup-windows-msvc.ps1
# Explizite MSVC-Pfade damit Git-for-Windows link.exe nicht vorgeht.
# Bei MSVC-Update: Skript erneut ausführen.

[target.x86_64-pc-windows-msvc]
linker = "$(($msvcLink).Replace('\','\\'))"

[env]
LIB = "$(($msvcVer).Replace('\','\\'))\\lib\\x64;C:\\Program Files (x86)\\Windows Kits\\10\\Lib\\$sdkVersion\\um\\x64;C:\\Program Files (x86)\\Windows Kits\\10\\Lib\\$sdkVersion\\ucrt\\x64"
INCLUDE = "$(($msvcVer).Replace('\','\\'))\\include;C:\\Program Files (x86)\\Windows Kits\\10\\Include\\$sdkVersion\\um;C:\\Program Files (x86)\\Windows Kits\\10\\Include\\$sdkVersion\\ucrt;C:\\Program Files (x86)\\Windows Kits\\10\\Include\\$sdkVersion\\shared;C:\\Program Files (x86)\\Windows Kits\\10\\Include\\$sdkVersion\\winrt"
"@

$config | Out-File -Encoding utf8 "$configDir\config.toml"
Write-Host "Erstellt: src-tauri/.cargo/config.toml"
Write-Host "Jetzt 'npm run tauri:build' in traxel/ ausführen."
