# Installing & Building Clearledger for Windows and Android

Clearledger runs 100% locally with AES-256-GCM encrypted on-device storage. You have two ways to run it on **Windows** and **Android**:

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

Download or clone this project onto your Windows PC (requires **Node.js 20+**).

### 1. Install Project Dependencies
```bash
npm install
```

### 2. Build Native Windows Desktop App (`.exe` Installer + Portable `.exe`)
Install Electron & electron-builder locally on your Windows machine, then build:
```bash
npm install -D electron electron-builder
ELECTRON_BUILD=true npx vite build
npx electron-builder --win --config electron-builder.json
```
*(In PowerShell on Windows, run `$env:ELECTRON_BUILD="true"; npx vite build; npx electron-builder --win --config electron-builder.json`.)*

Your outputs will appear in `release/`:
- `Clearledger Setup <version>.exe` (Windows installer with Start Menu & Desktop shortcuts)
- `Clearledger <version>.exe` (Single-file portable Windows executable)

### 3. Build Native Android App (`.apk` / `.aab`)
Requires **Android Studio** (with Android SDK & JDK 17+):
```bash
npm install @capacitor/core @capacitor/android
npm install -D @capacitor/cli
npm run build
npx cap add android
npx cap sync android
npx cap open android
```
In **Android Studio**, choose **Build → Build Bundle(s) / APK(s) → Build APK(s)** (or run `cd android && ./gradlew assembleDebug` to generate `android/app/build/outputs/apk/debug/app-debug.apk`).
