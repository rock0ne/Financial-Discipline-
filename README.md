# Clearledger — Local-First Personal Finance & Financial Discipline Planner

A privacy-first, offline-capable personal finance analyzer, spending forecast engine, recurring subscription forecaster, debt payoff simulator, and Cash ISA planner built with React, TypeScript, Tailwind CSS, Recharts, D3, and `jsPDF`.

The Clearledger source is publicly visible but rights are reserved; no open-source reuse license has been granted. Third-party font and PDF.js licenses are included separately in `public/`.

## Key Features

- **Local-first vault**: A fictional 14-month sample is loaded on first launch. Data is stored on this device in local IndexedDB and is not encrypted until a vault passphrase is enabled; the passphrase enables AES-256-GCM encryption. Do not keep sensitive statements on a shared or untrusted device without enabling it.
- **Spending Forecast Engine**: Estimates category trends and cap warnings. Verify imported transactions and totals independently before relying on a forecast.
- **Smart Ledger, Structured Search & Custom Tags**:
  - Multi-file CSV/TSV/OFX/QFX/JSON and text-based PDF statement import with local parsing. Review imported transactions and possible duplicates yourself; Undo/Redo is available in the ledger.
  - Structured search bar supporting merchant/description queries, date ranges (`2026-10-01..2026-10-31`, `from:`/`to:`), amount comparators/ranges (`>50`, `20..80`, `£42.50`), and `#tag` filters.
  - Inline custom transaction tagging plus automated **Tax Deductible** and **Expense Claimable** Smart Tags, all included in spreadsheet-ready CSV exports.
- **Recurring Subscriptions & 12-Month Projection**: Auto-detects recurring charges and price hikes, lets you classify items as Essential or Cancelable, and forecasts total 12-month recurring expenditure across both Current Habits and Cancelable-Cut scenarios.
- **Reports & Merchant Analytics**: Printable PDF reports (`jsPDF`) in A4 or US Letter, plus an interactive **Top Spending Merchants by Category Over Time** bar chart.
- **Windows & Android Ready**: Installable offline PWA right from Edge/Chrome, plus ready-to-build Electron (`.exe`) and Capacitor (`.apk`) packaging configs.

## Quick Start

```bash
npm install
npm run dev
```

Run the unit test suite, typecheck, and production build:

```bash
npm test
npm run lint
npm run build
```

## PDF statement import

Choose **Import Statements** and select a readable, text-based bank-statement PDF or a folder containing statements. PDF.js extracts text inside the local app; statement contents are not uploaded to a PDF conversion service. The Studio Preview does **not** require a distinct account label or row-by-row confirmation before **Analyze**.

Bank PDF layouts differ. This preview may mistake informational or fee rows for transactions, miss transactions, or import overlapping statements twice. Scanned, password-protected, or unsupported PDFs may fail. Prefer a bank CSV or OFX export when available. Before relying on any figures, compare the imported row count, dates, signed amounts, and balances with the original statements. Do not use this preview for financial decisions.

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
