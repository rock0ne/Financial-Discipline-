# Clearledger Studio Preview 0.1.2 — build handoff

Status: **unsigned private test candidate; do not publish yet.** Source branch `build/clearledger-studio-0.1.2-final`, verified code commit `67b7450` (followed by documentation-only commits). No owner keystore, real bank statement, owner-data Clearledger installation, or main repository worktree was changed. An older isolated sample test app was changed as recorded below.

## Progress gauge

1. **Source integration — done.** Android Back/footer and true folder picker; first real import forcibly replaces fictional sample data; local category threshold, projected-cap and date-reminder rules. On-device AI and BYOK are separate, not in this candidate.
2. **Automated verification — done.** `pnpm lint`, 65/65 tests, `pnpm build:native`, Capacitor sync, Android `assembleRelease`, and Windows packaging passed. Android APK contains no PWA service worker or web manifest. Its manifest contains `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`, and `WAKE_LOCK`, but no exact-alarm permission.
3. **Private device verification — partly done.** The combined Android Back, footer, and folder picker passed on a uniquely named synthetic test app; a separate folder test imported and reread two fictional rows. The alert notification test was **inconclusive** when the phone foreground changed to another test package. Windows OS toast was not tested on an installed app.
4. **Owner signing and public release — not started.** Do not sign or publish until the notification test, final review and owner decision. The ordinary debug package ID `app.clearledger.finance.studio.debug` already has owner data; never install this candidate's ordinary debug APK over it.

## Built artifacts (unsigned)

- Android: `android/app/build/outputs/apk/release/app-release-unsigned.apk`, package `app.clearledger.finance.studio`, version code `3`, version name `0.1.2`, SHA-256 `01F377DDE09AA7DD24421772A158649E29F23DBC94E120CB641094F478414863`.
- Windows NSIS test build: `J:\PurpleTeam\output\clearledger-windows-alerts-check-20261128\release-studio\Clearledger Studio Preview Setup 0.1.2-studio.0.exe`, SHA-256 `4D03EC47FB0F263ADDB45B6C3CC7950F7F2FF1F43304839019525A1E1F4DA9EE`.
- Windows portable test build: sibling `Clearledger Studio Preview 0.1.2-studio.0.exe`, SHA-256 `B6AD8653995B20BC5DB044E47781CF673384DD1DA7E459077766C9387D2A7E3B`.

The Windows installer is not installed or code-signed. Electron sets the AppUserModelID to the builder app ID and NSIS is configured for a Start Menu shortcut; actual toast delivery still needs an installed-app test. Portable Windows notifications may not work without a shortcut.

## Next checks

- Obtain an exclusive S21+ window. In a **new unique synthetic package**, opt in, grant Android notification permission, send a generic test notice, schedule and cancel a one-time reminder, and verify that turning notifications off leaves no managed pending notices. Avoid `app.clearledger.finance.studio.debug` and any real statement folder. The interrupted test added only a £100 groceries rule to the fictional ledger of `app.clearledger.finance.safeareatest.debug`; no cleanup was attempted after the foreground switch.
- Test Windows notifications from an installed private NSIS preview, not the portable build. Confirm the user can disable them and no financial details appear in the OS toast.
- After those checks, perform one final source/artifact review. Only then ask the owner to sign the Android APK and decide whether to publish a GitHub release.

## Scope and limitations

OS notifications are off by default. Spending checks use imported statements while the app is open; they do not detect bank activity while closed. Android date reminders are inexact and may be delayed. Notification text is always generic. Already-mixed older preview vaults cannot be automatically corrected without reliable provenance; affected users should review and, if needed, reimport with Replace after backing up their own data.

The isolated Android BYOK credential foundation is at `J:\PurpleTeam\output\clearledger-android-byok-20261128` commit `02bf713`, but it is **not merged**. It has no provider calls and no real-key/device test. The experimental on-device small-model build is also unmerged because synthetic finance reasoning tests failed.
