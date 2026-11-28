# Clearledger 0.1.2

Clearledger is a local-first personal finance app for Windows and Android. This release adds a **Start Here** page with three simple steps and a beginner-friendly Help section. The detailed Overview and existing tools remain available.

It also adds an Android statement-folder picker, replaces fictional practice transactions on the first real import, and offers optional local spending rules and date reminders. Notifications are off until you enable them and show only generic text.

## Before using your own statements

- The app starts with fictional practice numbers. Your first real import replaces that practice ledger. Review the import summary and compare its dates, row counts, amounts and balances with your original statements.
- PDF import supports readable text-based statements, but bank layouts vary. It can miss or misread rows; use a bank CSV or OFX export if a PDF is not interpreted safely. Do not make financial decisions from unverified figures or forecasts.
- Imported data stays on the device. The vault is **not encrypted until you set a passphrase**. Keep an encrypted backup before uninstalling or clearing app data, and keep its passphrase safe.
- The packaged Windows and Android apps do not include a connected AI provider or an on-device AI model. They do not connect to your bank or monitor transactions in real time.
- Spending alerts check imported statements while the app is open. Android date reminders may arrive late; Windows reminders do not run while the app is closed.

The Windows installer is not code-signed and may show an unknown-publisher warning. Source is publicly visible, but rights are reserved; no open-source reuse license is granted. No bank statements or signing keys are included in this release.
