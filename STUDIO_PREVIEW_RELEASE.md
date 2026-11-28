# Clearledger Studio Preview 0.1.1 — Android prerelease

This is a separate, experimental Android package (`app.clearledger.finance.studio`), not an update to the main Clearledger installation. It was built from the Google AI Studio-synced application source at commit `572e94f15d6fbd850933d52f7ee51f122a2f359e`. This release branch changes native/build identifiers and dependencies for packaging, and corrects the README; it does not change `src/**`, `server.ts`, `test/**`, or the Electron runtime.

## Signed APK identity

- File: `Clearledger-Studio-Preview-0.1.1-signed.apk`
- SHA-256: `03a54fed4d105fefcc9faf109af6cb63057f980ea2b06b2a6580c8b976d0af4a`
- Android package: `app.clearledger.finance.studio`; version code `2`, version name `0.1.1`
- Signing certificate SHA-256: `4df369299819ef40647c510122abfcd1fadddbf13ba4c412808f7c5a22a70b4f`
- APK Signature Schemes v2 and v3 verified; one signer; ZIP alignment verified.

## Preview limitations

The app starts with fictional sample data. Choose **Replace existing ledger** when importing your own statements to avoid mixing that sample into the ledger, then check the resulting figures. The local vault is unencrypted until a passphrase is enabled. No bank statements are included in this APK or source branch.

The text-PDF importer is experimental. It can mistake informational or fee rows for transactions, miss transactions, or import overlapping statements twice. A successful import is **not** proof that balances or financial forecasts are correct. Reconcile dates, signed amounts, row counts, and balances against the originals; prefer CSV/OFX exports when available. Do not use this prerelease for financial decisions.

This source is publicly visible but rights are reserved; no open-source reuse license is granted. The Windows builds are not part of this Android prerelease and remain unsigned private previews.
