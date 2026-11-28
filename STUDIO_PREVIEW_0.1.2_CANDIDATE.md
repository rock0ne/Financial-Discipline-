# Clearledger Studio Preview 0.1.2 — unsigned Android candidate

This candidate is based on the separate Studio Preview release branch, preserving the Google AI Studio-synced application source at `572e94f15d6fbd850933d52f7ee51f122a2f359e` except for the two focused source fixes below. Its Android package is `app.clearledger.finance.studio`, version code `3`, version name `0.1.2`. It is not signed or published; the owner retains signing and release authority.

## Focused changes

- The Import Statements action footer now pads above Android system navigation, including a fallback for three-button navigation when WebView reports a zero safe-area inset. Device visual and Back-button checks remain required before release.
- The native AI screens no longer present a dead provider dropdown. They state clearly that no on-device AI model or external provider connection is present, and link to existing local Reports without calling those reports AI. No model inference or external request has been added; the separately hosted web-server mode retains its existing provider controls.

## Limits carried forward

The app starts with fictional sample data, and its local vault is unencrypted until a passphrase is enabled. The text-PDF importer remains experimental and may count informational rows, miss transactions, or double-import overlaps. Users must reconcile all imported figures against original statements and must not rely on this preview for financial decisions. No bank statements or real finance data are included.

True local AI is a separate build: it requires an on-device model/runtime, device performance and privacy tests, and an explicit model import or download. External providers require a separate opt-in and a secure server-side proxy; API keys must never be embedded in the APK.
