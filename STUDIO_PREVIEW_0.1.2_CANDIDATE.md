# Clearledger Studio Preview 0.1.2 — unsigned Android candidate

This candidate is based on the separate Studio Preview release branch, preserving the Google AI Studio-synced application source at `572e94f15d6fbd850933d52f7ee51f122a2f359e` except for the focused native fixes below. Its intended release package is `app.clearledger.finance.studio`, version code `3`, version name `0.1.2`. It is not signed or published; the owner retains signing and release authority. The ordinary debug build has the `app.clearledger.finance.studio.debug` ID, which already holds owner data, so it was **not** installed for this check.

## Focused changes

- The Import Statements action footer pads above Android system navigation, including a fallback for three-button navigation when WebView reports a zero safe-area inset.
- The Android physical Back button closes the Import sheet first; at the root it retains normal exit behavior.
- **Choose Statement Folder** uses Android's system folder picker and a one-shot, bounded read grant. The existing PDF/CSV parser handles the returned files. Browser and Windows folder selection are unchanged.
- `pnpm build:native` excludes the PWA service worker and fails if a worker or web manifest slips into packaged assets, preventing an old cached screen surviving an APK upgrade.
- The native AI screens no longer present a dead provider dropdown. They state clearly that no on-device AI model or external provider connection is present, and link to existing local Reports without calling those reports AI. No model inference or external request has been added; the separately hosted web-server mode retains its existing provider controls.

## Verification to date

- TypeScript/lint and all **52 offline tests** passed after integration. Native build, Capacitor sync, and Gradle `assembleDebug` passed; packaged native assets contain no `sw.js`, `registerSW.js`, or `manifest.webmanifest`.
- On the S21+, a fresh isolated `app.clearledger.finance.combinedtest.debug` package showed the action footer clear of the Android navigation bar, physical Back dismissed the Import sheet without exiting, and the system folder picker opened. Cancelling it returned to an empty Import sheet with Analyze disabled. That isolated test package and its temporary phone screenshot were removed; the owner-data package was untouched.
- The folder-picker feature separately passed a synthetic two-transaction import, non-statement-file exclusion, persistence after restart, and cancel path in `app.clearledger.finance.foldertest.debug`. No real bank statement was used.

This is a focused native candidate, **not a release-ready declaration**. The custom-alert and BYOK branches have separate verification gates, and owner signing and release review are still outstanding.

## Limits carried forward

The app starts with fictional sample data, and its local vault is unencrypted until a passphrase is enabled. The text-PDF importer remains experimental and may count informational rows, miss transactions, or double-import overlaps. Users must reconcile all imported figures against original statements and must not rely on this preview for financial decisions. No bank statements or real finance data are included.

True local AI is a separate build: it requires an on-device model/runtime, device performance and privacy tests, and an explicit model import or download. External providers require a separate opt-in and a secure server-side proxy; API keys must never be embedded in the APK.
