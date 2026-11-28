# Clearledger local alerts MVP

This unsigned 0.1.2 candidate adds user-defined rules under **Vault & Settings → Local alerts & reminders**. It does not connect to a bank, poll in the background, or send a push notification through a server.

## Rules and storage

- A category threshold compares current-calendar-month **net** outflow from imported transactions with the chosen amount. Same-category positive refunds reduce spend. The threshold retains its creation currency if the display currency changes.
- A projected-cap rule uses Clearledger's existing current-month cap-pace calculation. A category cap must be set first. That existing calculation counts gross outflows; its forecast is an estimate, not a live bank balance.
- A one-time date reminder uses the device's local date and time. Its optional private label appears only inside the app.
- Rules are optional `VaultPayload.localAlertRules` data, included in encrypted vault backups when vault encryption is enabled. Existing vaults with no rules continue to load. A maximum of 32 validated rules is accepted from imported vaults.
- OS notifications are **off by default** and require an explicit Enable action. Their preference and bounded dedupe keys are device-local metadata in browser storage, not the bank ledger. Shredding the vault attempts to clear both and cancel pending reminders; if opt-out storage or Android cancellation cannot be confirmed, the app warns and advises disabling notifications in device settings.

## Delivery and privacy

- In-app checks run on open, when the app is foregrounded, after imports or edits, and once per minute while open. The app cannot detect new bank transactions while closed.
- Android uses `@capacitor/local-notifications` with `POST_NOTIFICATIONS` consent. One-time date reminders use an **inexact** local alarm; the app manifest removes the plugin's `SCHEDULE_EXACT_ALARM` permission. The OS may delay or suppress delivery. If the vault is locked, the scheduled generic reminder may still appear; it contains no private label.
- Windows Electron can request a toast while open if the OS supports notifications. It does not schedule a closed-app reminder. Packaged Windows delivery still needs a device smoke test.
- Browser preview has in-app checks only, no web notification permission request.
- Every OS notification has the fixed title **Clearledger alert** and body **Open Clearledger to review your local alert.** Amounts, category names, merchant names, account names and private reminder labels never enter the OS notification body.
- Sample-ledger spend matches appear in-app as synthetic but cannot generate OS spending notifications. Explicit generic tests and user-created date reminders may still notify after opt-in.
- The integrated first-import safeguard forces replacement of the fictional sample transactions and import receipts even when an older caller requests Merge. Later real statement imports can merge normally. Already-mixed older vaults cannot be repaired automatically without trustworthy transaction provenance.
- A successful OS trigger creates one receipt per rule per calendar month. Toggling off/on does not re-arm that month; deleting and recreating a rule intentionally creates a new rule ID. The next month re-arms monthly rules. Date reminders are one-time. Receipts prevent repeated app-open notifications, not OS delivery failure.
- Saving a rule is independent of Android alarm reconciliation. If scheduling or cancellation fails, the UI reports that OS state is unconfirmed and the app retries on focus/reopen and while open. A previously queued generic reminder may still appear before cancellation succeeds.

## Safe verification

Combined `pnpm lint`, `pnpm test` (**66/66**), `pnpm build:native`, Capacitor sync, and Android `assembleRelease` passed. The unsigned release APK is `android/app/build/outputs/apk/release/app-release-unsigned.apk` (SHA-256 `35E8210E46A5A271DEDCC3713F3024421132D96CBF0D99488F21750E65ED5A76`). A unique `app.clearledger.finance.alertsreview` debug package was installed for exploratory phone testing, but the foreground changed to a separate `app.clearledger.finance.safeareatest.debug` test package; a sample £100 groceries rule was added there. No real statement or main Clearledger package was opened. Notification permission, actual delivery, opt-out cancellation, and the revised mobile rule-card layout still need an exclusive device smoke test. No phone cleanup was attempted after the foreground switch. Do not install the ordinary debug package: `app.clearledger.finance.studio.debug` already holds owner data.
