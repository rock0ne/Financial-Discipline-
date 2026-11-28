# Installing & Building Clearledger for Windows and Android

Clearledger's core finance features run locally. Its on-device vault is **not encrypted until you set a passphrase**; with a passphrase it uses AES-256-GCM. The packaged Windows and Android builds have no connected AI provider. You have two ways to run it on **Windows** and **Android**:

---

## Option 1: Install Right Now (Zero Build Tools Needed — Offline PWA)

Clearledger is configured as an offline-capable **Progressive Web App (PWA)** with full service-worker caching.

### Windows (Edge or Chrome)
1. Open the Clearledger app URL directly in Microsoft Edge or Google Chrome (outside the editor preview frame).
2. Click **Install App** in the top header (or the install icon in the browser address bar).
3. Pin Clearledger to your Windows Start Menu or Taskbar. It launches in its own standalone window and works completely offline.

### Android (Chrome)
1. Open the Clearledger app URL in **Chrome for Android**.
2. Tap **Install App** in the top header (or Chrome's **⋮ menu → Install app**).
3. Clearledger installs onto your home screen and app drawer with full-screen standalone display and offline vault storage.

---

## Option 2: Build Native Windows (`.exe`) & Android (`.apk`) Installers Locally

Download or clone this project onto your Windows PC (requires **Node.js 22.13+**).

### 1. Install Project Dependencies
```bash
pnpm install --frozen-lockfile
```

### 2. Build Native Windows Desktop App (`.exe` Installer + Portable `.exe`)
Run this on Windows. It makes the native bundle with its content-security policy immediately before packaging:
```powershell
pnpm package:windows
```

Your outputs will appear in `release-studio/` as an NSIS installer and a portable `.exe`. Unless you sign the installer with a trusted Windows code-signing certificate, Windows may show an unknown-publisher warning. A Let's Encrypt TLS certificate cannot sign Windows software.

### 3. Build Native Android App (`.apk` / `.aab`)
Requires **Android Studio** (with Android SDK & JDK 21):
```bash
pnpm build:native
pnpm exec cap sync android
cd android
./gradlew assembleRelease
```
On Windows PowerShell, run `./gradlew.bat assembleRelease` inside `android` instead of `./gradlew assembleRelease`. The resulting release APK is **unsigned** until you sign it with your own keystore. Do not publish a debug APK or add a keystore or bank statement to GitHub.
