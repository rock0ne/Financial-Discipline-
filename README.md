# Clearledger — Local-First Personal Finance & Financial Discipline Planner

A privacy-first, offline-capable personal finance analyzer, spending forecast engine, recurring subscription forecaster, debt payoff simulator, and Cash ISA planner built with React, TypeScript, Tailwind CSS, Recharts, D3, and `jsPDF`.

## Key Features

- **100% Local & Encrypted**: AES-256-GCM encrypted on-device vault with zero cloud storage required.
- **Accurate Spending Forecast Engine**: Tracks per-category history lengths (ignoring leading structural zeros), detects and excludes incomplete trailing months from baselines (with optional pro-rating), and retains pence precision across all cap warnings.
- **Smart Ledger, Structured Search & Custom Tags**:
  - Multi-file CSV/OFX statement import with deduplication, batch rollback, and global Undo/Redo.
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
