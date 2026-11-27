# Clearledger — Local-First Personal Finance & Financial Discipline Planner

A privacy-first, offline-capable personal finance analyzer, spending forecast engine, debt payoff simulator, and Cash ISA planner built with React, TypeScript, Tailwind CSS, D3, and `jsPDF`.

## Key Features

- **100% Local & Encrypted**: AES-256-GCM encrypted on-device vault with zero cloud storage required.
- **Accurate Spending Forecast Engine**: Tracks per-category history lengths (ignoring leading structural zeros), detects and excludes incomplete trailing months from baselines (with optional pro-rating), and retains pence precision across all cap warnings.
- **Smart Ledger & Import History**: Multi-file CSV/OFX statement import with deduplication, batch rollback, global Undo/Redo, and auto-tagging for **Tax Deductible** and **Expense Claimable** expenses.
- **Printable PDF Reports (`jsPDF`)**: Monthly and quarterly reports in A4 or US Letter featuring spending trend forecasts, category caps, Savings vs. Debt Payoff comparisons, Smart-Tag totals, and a paginated ledger register.
- **Windows & Android Ready**: Installable offline PWA right from Edge/Chrome, plus ready-to-build Electron (`.exe`) and Capacitor (`.apk`) packaging configs.

## Quick Start

```bash
npm install
npm run dev
```

Run the test suite and production build:

```bash
npm test
npm run lint
npm run build
```

## Installing on Windows & Android

See [BUILD_WINDOWS_AND_ANDROID.md](./BUILD_WINDOWS_AND_ANDROID.md) for:
1. One-click offline PWA installation on **Windows** (Edge/Chrome) and **Android** (Chrome).
2. Building native **Windows `.exe` installers** via Electron.
3. Building native **Android `.apk` packages** via Capacitor.
