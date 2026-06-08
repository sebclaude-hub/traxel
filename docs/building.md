# Traxel — Build-Anleitung

Erfahrungen aus dem ersten Windows-Build (Juni 2026). Ziel: `npm run tauri:build`
produziert einen `Traxel_x.y.z_x64-setup.exe`-Installer.

---

## Kurzfassung: Was braucht man?

| Werkzeug | Zweck | Quelle |
|---|---|---|
| Node.js + npm | Frontend-Build (Vite/React) | winget `OpenJS.NodeJS.LTS` |
| Rust + rustup | Tauri-Backend kompilieren | rustup.rs |
| VS Build Tools 2022 | MSVC C++-Compiler + Linker | winget `Microsoft.VisualStudio.2022.BuildTools` |
| MSVC-Komponente `VC.Tools.x86.x64` | `cl.exe`, `link.exe` | VS-Installer (s.u.) |
| Windows SDK 10.0.26100+ | `kernel32.lib`, Windows-Headers | winget `Microsoft.WindowsSDK.10.0.26100` |
| MSYS2 + MinGW-w64 | *Fallback* — nur nötig wenn MSVC nicht funktioniert | winget `MSYS2.MSYS2` |

---

## Schritt-für-Schritt

### 1 — Rust installieren

```powershell
# Von rustup.rs herunterladen oder:
winget install Rustlang.Rustup
rustup default stable-x86_64-pc-windows-msvc
```

### 2 — VS Build Tools mit C++-Compiler installieren

**Kritisch:** Der Installer installiert standardmäßig **nicht** den C++-Compiler.
`includeRecommended` muss erzwungen werden, oder die Komponente muss explizit gewählt werden.

```powershell
# Option A: winget mit expliziter Komponente
winget install Microsoft.VisualStudio.2022.BuildTools `
  --override "--add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 --quiet --norestart"

# Option B: VS Installer nachträglich (als Admin):
$installer = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\setup.exe"
Start-Process $installer -ArgumentList @(
  "modify",
  "--installPath", "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools",
  "--add", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
  "--quiet", "--norestart"
) -Verb RunAs -Wait
```

**Prüfen:** `C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\` muss existieren
und einen Unterordner wie `14.44.xxxxx` mit `bin\Hostx64\x64\link.exe` enthalten.

### 3 — Windows SDK installieren

Das SDK wird **nicht** automatisch mitinstalliert, auch nicht durch die C++-Workload.

```powershell
winget install Microsoft.WindowsSDK.10.0.26100
```

**Prüfen:** `C:\Program Files (x86)\Windows Kits\10\Lib\10.0.26100.0\um\x64\kernel32.lib` muss existieren.

### 4 — Cargo-Konfiguration generieren

Git for Windows installiert ein eigenes `link.exe` (GNU-Hardlink-Tool) unter
`C:\...\Git\usr\bin\link.exe`, das den MSVC-Linker im PATH überdeckt. Cargo
findet dann das falsche Tool und bricht mit `link: extra operand` ab.

Das Setup-Skript im Repo erkennt die installierten MSVC- und SDK-Versionen
automatisch und schreibt `src-tauri/.cargo/config.toml` mit expliziten Pfaden:

```powershell
cd traxel
PowerShell -ExecutionPolicy Bypass -File scripts/setup-windows-msvc.ps1
```

Diese Datei ist in `.gitignore` — sie ist maschinenspezifisch und muss auf
jedem Entwicklungsrechner neu erzeugt werden.

### 5 — Node-Abhängigkeiten installieren

```powershell
cd traxel
npm install
```

### 6 — Share-Bundle bauen (für den Export-Knopf)

```powershell
npm run build:share
```

Das Bundle (`share-dist/share-viewer.js`) wird in den HTML-Export eingebettet.
Ohne diesen Schritt zeigt die App beim Klick auf "Exportieren" einen Fehler.
Der Dev-Server (`npm run dev`) startet auch ohne das Bundle — der Fehler tritt
erst beim Klick auf Export auf.

### 7 — Bauen

```powershell
# Entwicklung (startet Dev-Server + Tauri-Fenster):
npm run tauri:dev

# Release-Build + Installer:
npm run tauri:build
```

Output: `src-tauri/target/release/bundle/nsis/Traxel_x.y.z_x64-setup.exe`

---

## Was hat warum nicht funktioniert

### Problem 1: `link: extra operand` (der erste Fehler)

```
error: linker `link.exe` failed: exit code: 1
link: extra operand '...'
```

**Ursache:** Git for Windows liefert `C:\...\Git\usr\bin\link.exe`, ein POSIX-Tool
zum Erstellen von Hardlinks. Es hat nichts mit dem MSVC-Linker zu tun, antwortet
aber auf `-help` — deshalb erkennt Cargo es nicht sofort als falsch, sondern
scheitert erst beim ersten echten Link-Aufruf.

**Lösung:** Expliziten Linker-Pfad in `src-tauri/.cargo/config.toml` setzen
(dafür ist das Setup-Skript da). Den Git-Eintrag aus dem PATH zu entfernen
wäre zu invasiv und würde andere Git-Funktionen brechen.

### Problem 2: `LINK: fatal error LNK1181: cannot open input file 'kernel32.lib'`

**Ursache:** Der MSVC-Linker war korrekt gefunden, aber die Windows-SDK-Bibliotheken
fehlten. `kernel32.lib` liegt im Windows SDK, nicht im MSVC-Compiler-Paket.
Die Umgebungsvariable `LIB` muss auf die SDK-Lib-Pfade zeigen.

Die VS-Komponente `Microsoft.VisualStudio.Component.Windows11SDK.22000` hat die
Bibliotheken in diesem Fall **nicht** installiert (nur `Redist\ucrt` war vorhanden).
Das Windows SDK muss separat über `winget install Microsoft.WindowsSDK.10.0.26100`
installiert werden.

**Lösung:** SDK separat installieren + SDK-Pfade in `LIB`/`INCLUDE` setzen
(das Setup-Skript erledigt das).

### Problem 3: VS Build Tools ohne C++-Compiler

**Ursache:** Der VS-Installer wurde mit `includeRecommended: 0` ausgeführt.
Das bedeutet: nur Kern-Build-Infrastruktur (MSBuild etc.), aber kein C++-Compiler.
`VC\Tools\MSVC\` existiert dann nicht — nur `VC\Tools\Llvm\`.

**Erkennung:** `vswhere -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64`
gibt ein leeres Array zurück.

**Lösung:** VS-Installer als Admin mit `--add Microsoft.VisualStudio.Component.VC.Tools.x86.x64`.

### Problem 4: GNU-Toolchain-Fallback (Ordinal-Limit)

Als Workaround wurde MSYS2 + MinGW-w64 GCC installiert und `rustup target add x86_64-pc-windows-gnu`
versucht. Das scheiterte mit:

```
ld.exe: error: export ordinal too large: 90444
```

**Ursache:** Das PE-Format auf Windows limitiert DLL-Export-Ordinals auf 16 Bit (max 65535).
Tauri + alle Abhängigkeiten zusammen überschreiten dieses Limit im GNU-Linker.
Der MSVC-Linker hat diese Einschränkung nicht.

**Fazit:** GNU-Toolchain ist für Tauri auf Windows **nicht verwendbar**. MSVC ist Pflicht.

### Problem 5: WIX MSI-Installer (`LGHT0217`, Fehlercode 2738)

```
light.exe: error LGHT0217: Error executing ICE action 'ICE09'.
The error code is 2738.
```

**Ursache:** WIX führt ICE-Validierungsscripts aus, die VBScript benötigen.
Ab Windows 11 22H2 ist VBScript standardmäßig deaktiviert oder nicht mehr
registriert — Microsoft hat VBScript als veraltet erklärt.

`regsvr32 /s vbscript.dll` hat das Problem in diesem Fall nicht behoben.

**Workaround:** NSIS statt WIX als Bundle-Target (`tauri.conf.json`: `"targets": ["nsis"]`).
NSIS erzeugt einen EXE-Installer ohne VBScript-Abhängigkeit. Tauri lädt NSIS
automatisch herunter.

**Langfristig:** Für einen MSI-Installer (Microsoft Store, Enterprise) müsste
VBScript über DISM reaktiviert oder ein aktuelleres WIX-Tool (WIX 4) verwendet
werden. WIX 4 löst dieses Problem.

---

## MSYS2 / MinGW-w64: Status nach diesem Build

Wurde installiert (`winget install MSYS2.MSYS2`) und GCC wurde nachgezogen
(`pacman -S mingw-w64-x86_64-gcc`). Kann gelöscht werden — für Tauri braucht
man es nicht. Bleibt aber harmlos auf dem System.

---

## Nächste Plattformen

### macOS

Deutlich einfacher. Xcode Command Line Tools reichen:

```sh
xcode-select --install
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
cd traxel && npm install && npm run tauri:build
```

Output: `.app` Bundle + `.dmg` Installer.

### Linux

```sh
sudo apt install libwebkit2gtk-4.1-dev libssl-dev libgtk-3-dev \
  libayatana-appindicator3-dev librsvg2-dev
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
cd traxel && npm install && npm run tauri:build
```

Output: `.deb`, `.rpm`, `.AppImage` (je nach Ziel-Konfiguration).

### Android

Benötigt Android Studio + NDK. Build läuft auf dem Mac oder Linux-Rechner
und erzeugt `.apk` / `.aab`.

---

## Kurzcheck auf neuem System

```powershell
# Alles vorhanden?
rustc --version          # >= 1.77
cargo --version
node --version           # >= 18
npm --version

# MSVC vorhanden?
dir "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC"

# Windows SDK vorhanden?
dir "C:\Program Files (x86)\Windows Kits\10\Lib"

# Setup-Skript ausführen:
cd traxel
PowerShell -ExecutionPolicy Bypass -File scripts/setup-windows-msvc.ps1

# Bauen:
npm install
npm run build:share
npm run tauri:build
```
