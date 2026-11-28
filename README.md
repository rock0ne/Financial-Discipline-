# Clearledger — Local-First Personal Finance & Financial Discipline Planner

A privacy-first, offline-capable personal finance analyzer, spending forecast engine, recurring subscription forecaster, debt payoff simulator, and Cash ISA planner built with React, TypeScript, Tailwind CSS, Recharts, D3, and `jsPDF`.

The Clearledger source is publicly visible but rights are reserved; no open-source reuse license has been granted. Third-party font and PDF.js licenses are included separately in `public/`.

## Key Features

- **Local-first vault**: Data is kept on this device; a passphrase enables AES-256-GCM encryption. No cloud storage is required. A new vault starts with an empty ledger. The fictional sample is an explicit opt-in under **Vault & Settings**; a normal sample ledger is replaced on real import. For older mixed vaults, identifiable sample rows/imports are removed, while ambiguous edited settings are preserved and flagged for review.
- **Accurate Spending Forecast Engine**: Tracks per-category history lengths (ignoring leading structural zeros), detects and excludes incomplete trailing months from baselines (with optional pro-rating), and retains pence precision across all cap warnings.
- **Smart Ledger, Structured Search & Custom Tags**:
  - Multi-file CSV/TSV/OFX/QFX/JSON and text-based PDF statement import with account-aware deduplication, batch rollback, and global Undo/Redo.
  - Structured search bar supporting merchant/description queries, date ranges (`2026-10-01..2026-10-31`, `from:`/`to:`), amount comparators/ranges (`>50`, `20..80`, `£42.50`), and `#tag` filters.
  - Inline custom transaction tagging plus automated **Tax Deductible** and **Expense Claimable** Smart Tags, all included in spreadsheet-ready CSV exports.
- **Recurring Subscriptions & 12-Month Projection**: Auto-detects recurring charges and price hikes, lets you classify items as Essential or Cancelable, and forecasts total 12-month recurring expenditure across both Current Habits and Cancelable-Cut scenarios.
- **Reports & Merchant Analytics**: Printable PDF reports (`jsPDF`) in A4 or US Letter, plus an interactive **Top Spending Merchants by Category Over Time** bar chart.
- **Windows & Android Ready**: Installable offline PWA right from Edge/Chrome, plus ready-to-build Electron (`.exe`) and Capacitor (`.apk`) packaging configs.

## Quick Start

`pnpm-lock.yaml` is the release dependency lock. Google AI Studio may regenerate a `bun.lock` while editing its preview; do not treat that file as a release lock or commit it without reconciling it to the pinned native dependencies.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Run the unit test suite, typecheck, and production build:

```bash
pnpm test
pnpm lint
pnpm build
```

## PDF statement import

Choose **Import Statements** and select a readable, text-based bank-statement PDF or a folder containing statements. PDF.js extracts the text inside the local app; statement contents are not uploaded. The importer accepts only recognisable transaction tables with an explicit Date, Description and Debit/Credit columns, or an Amount column whose values identify their debit/credit direction. Each PDF must represent one account: enter a stable, distinct account label and reuse that label for future downloads of the same account. Review the displayed dates, currencies and signed amounts against the original statement, then explicitly confirm before anything is saved.

Bank PDF layouts differ. Scanned/image-only, password-protected, ambiguous and unsupported layouts are rejected rather than guessed; ask the bank for CSV or OFX where available. A PDF is limited to 15 MiB and 100 pages. The importer reports individual file failures and requires acknowledgement before importing the remaining files of a mixed batch. Identical repeated rows within one statement are retained; overlapping copies across statements are deduplicated by account/date/description/amount occurrence count. If a bank does not supply transaction IDs, two separately exported identical charges cannot always be distinguished from an overlapping copy, so inspect the skipped count and your ledger after import.

## Project Layout

```text
src/
  components/    # Overview, Ledger, Subscriptions, Cut & Save, Wealth Planner, Reports, Import
  utils/         # analyticsEngine, ledgerFilters, statementParser, pdfReportGenerator, vaultCrypto
  types/         # Core domain models (Transaction, RecurringItem, SavingsGoal, DebtAccount, etc.)
test/            # Node test runner suite covering analytics, search/tags, CSV/PDF, and projections
electron/        # Windows desktop packaging entry points
```

## Installing on Windows & Android

See [BUILD_WINDOWS_AND_ANDROID.md](./BUILD_WINDOWS_AND_ANDROID.md) for:
1. One-click offline PWA installation on **Windows** (Edge/Chrome) and **Android** (Chrome).
2. Building native **Windows `.exe` installers** via Electron.
3. Building native **Android `.apk` packages** via Capacitor.
