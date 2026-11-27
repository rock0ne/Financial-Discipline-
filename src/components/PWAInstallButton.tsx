import React, { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Download, Monitor, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, platform, install } =
    usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);
  const isNativePackage =
    Capacitor.isNativePlatform() ||
    (typeof window !== 'undefined' &&
      Boolean((window as Window & { clearledgerDesktop?: object }).clearledgerDesktop));

  // Already running as an installed desktop/mobile app
  if (isInstalled || isNativePackage) {
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      await install();
      return;
    }
    setShowGuide(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        aria-label="Install Clearledger on Windows or Android"
        title="Install Clearledger as a standalone offline app on Windows or Android"
        className="min-h-[40px] inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-teal-200 dark:border-teal-800 bg-teal-50/70 dark:bg-teal-950/50 text-teal-800 dark:text-teal-300 hover:bg-teal-100/80 dark:hover:bg-teal-900/60 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
      >
        <Download className="w-3.5 h-3.5" />
        <span className="hidden lg:inline">
          {isInstallable ? 'Install App' : 'Get App'}
        </span>
      </button>

      {showGuide && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-install-guide-title"
        >
          <div className="w-full max-w-md rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3
                  id="pwa-install-guide-title"
                  className="text-base font-semibold text-slate-900 dark:text-slate-100"
                >
                  Install Clearledger on Your Device
                </h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Runs 100% offline with local AES-256 vault storage on Windows, Android, and iOS.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label="Close install instructions"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-600 dark:text-slate-300">
              <div
                className={`p-3.5 rounded-lg border ${
                  platform === 'windows'
                    ? 'border-teal-300 dark:border-teal-700 bg-teal-50/50 dark:bg-teal-950/30'
                    : 'border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50'
                }`}
              >
                <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
                  <Monitor className="w-4 h-4 text-teal-700 dark:text-teal-400" />
                  <span>Windows Desktop (Edge or Chrome)</span>
                </div>
                <ol className="mt-2 list-decimal list-inside space-y-1 leading-relaxed">
                  <li>Open the Clearledger URL directly in a browser tab (not inside a preview frame).</li>
                  <li>Click the <strong>Install Clearledger</strong> icon in the right side of the address bar (or Menu &rarr; Apps &rarr; Install this site as an app).</li>
                  <li>Pin Clearledger to your Windows Taskbar or Start Menu for native offline launch.</li>
                </ol>
              </div>

              <div
                className={`p-3.5 rounded-lg border ${
                  platform === 'android'
                    ? 'border-teal-300 dark:border-teal-700 bg-teal-50/50 dark:bg-teal-950/30'
                    : 'border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50'
                }`}
              >
                <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
                  <Smartphone className="w-4 h-4 text-teal-700 dark:text-teal-400" />
                  <span>Android Phone / Tablet (Chrome)</span>
                </div>
                <ol className="mt-2 list-decimal list-inside space-y-1 leading-relaxed">
                  <li>Open Clearledger in <strong>Chrome for Android</strong>.</li>
                  <li>Tap the <strong>three-dot menu</strong> (&vellip;) &rarr; <strong>Install app</strong> (or Add to Home screen).</li>
                  <li>Launch Clearledger full-screen from your Android app drawer — works completely offline.</li>
                </ol>
              </div>

              {isIOS && (
                <div className="p-3.5 rounded-lg border border-teal-300 dark:border-teal-700 bg-teal-50/50 dark:bg-teal-950/30">
                  <p className="font-semibold text-slate-900 dark:text-slate-100">
                    iPhone / iPad (Safari)
                  </p>
                  <p className="mt-1 leading-relaxed">
                    Tap the <strong>Share</strong> icon in Safari, then choose <strong>Add to Home Screen</strong>.
                  </p>
                </div>
              )}

              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                Need a native <strong>.exe</strong> installer or Android <strong>.apk</strong>? The project includes ready-to-build Electron and Capacitor configs — see <code className="font-mono">BUILD_WINDOWS_AND_ANDROID.md</code>.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="w-full min-h-[40px] rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-medium hover:opacity-90 transition-opacity cursor-pointer"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
};
