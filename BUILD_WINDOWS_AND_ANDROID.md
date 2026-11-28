# Clearledger: Windows and Android build handoff

Clearledger's ledger, statement parser and forecasts run on-device. A new vault starts empty. The fictional sample is an explicit opt-in under **Vault & Settings**; a normal sample ledger is replaced on real import. In older mixed vaults, identifiable sample rows/imports are removed, while ambiguous edited settings are preserved with an in-app review warning. Do not commit statement PDFs, local vaults, debug logs or signing keys. A successful build is not evidence that a bank PDF was parsed correctly: review dates, signed amounts, currency and account separation before confirming an import.

## Prerequisites

- Node.js 22.13+ and pnpm 11.25.0. Use the committed `pnpm-lock.yaml` with `pnpm install --frozen-lockfile`.
- For Windows packaging: Windows x64. The Electron and electron-builder versions are pinned in `package.json`.
- For Android packaging: JDK 21 and Android SDK platform/build tools for API 36. The `android/` project is already tracked; **do not run `cap add android`**.
- Build each target from a clean source revision. `dist/`, `release/`, Android build output and `node_modules/` are ignored and are not release source.

Before either native build, run `pnpm test` and `pnpm lint`. Do not package if either fails.

## Windows Electron (PowerShell)

From the repository root:

```powershell
pnpm install --frozen-lockfile
$env:ELECTRON_BUILD = 'true'
pnpm exec vite build
Remove-Item Env:ELECTRON_BUILD
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
pnpm exec electron-builder --win --config electron-builder.json --publish never
Remove-Item Env:CSC_IDENTITY_AUTO_DISCOVERY
Get-FileHash 'release\Clearledger Setup 0.1.1.exe' -Algorithm SHA256
Get-FileHash 'release\Clearledger 0.1.1.exe' -Algorithm SHA256
```

This produces an NSIS installer and portable executable in `release/`. They are **unsigned** unless the owner separately configures a trusted Windows code-signing certificate. OpenSSL alone cannot make a public Windows publisher identity trusted. Do not publish an unsigned preview as a signed release. The app loads its bundled `dist/index.html`, not a development server; online-only optional features must fail clearly when unavailable.

## Android Capacitor (PowerShell)

From the same repository root, rebuild the web assets for Android before syncing (the Windows build uses a different asset base):

```powershell
$env:CAPACITOR_BUILD = 'true'
pnpm exec vite build
Remove-Item Env:CAPACITOR_BUILD
pnpm exec cap sync android
Push-Location android
.\gradlew.bat assembleDebug assembleRelease --offline
Pop-Location
Get-FileHash 'android\app\build\outputs\apk\debug\app-debug.apk' -Algorithm SHA256
Get-FileHash 'android\app\build\outputs\apk\release\app-release-unsigned.apk' -Algorithm SHA256
```

If dependencies are not cached, remove only Gradle's `--offline` option and review the downloaded dependency sources. On Rockson's WSL setup, JDK 21 and the Android SDK are under `/root/.local/`; the Gradle wrapper must have LF line endings to run under Linux (`.gitattributes` enforces this on checkout).

`assembleDebug` creates a debug-key APK with application ID `app.clearledger.finance.debug`, isolated from the installed production app and its data. `assembleRelease` creates an **unsigned** APK with application ID `app.clearledger.finance` and version code 2/version name 0.1.1. The owner signs the exact frozen release APK privately, then verifies its certificate, package/version, payload identity and SHA-256. Never commit the keystore or signing password.

## Browser PWA

`pnpm build` makes a separate service-worker-enabled PWA bundle. Install from a browser origin after loading it once online, then test the cached core offline. The PWA, Electron and Capacitor builds have different service-worker and URL-base behavior; do not reuse one target's `dist/` for another target.
