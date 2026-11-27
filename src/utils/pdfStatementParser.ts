import {
  type CurrencyCode,
  type Transaction,
} from '../types/finance';
import { classifyTransaction, type ParsedStatementResult } from './statementParser';

export interface PdfTextCell {
  text: string;
  x: number;
  width: number;
  y: number;
}

export interface PdfTextRow {
  page: number;
  y: number;
  cells: PdfTextCell[];
}

export function groupPdfPageText(pageNumber: number, cells: PdfTextCell[]): PdfTextRow[] {
  const rows: PdfTextRow[] = [];
  for (const cell of cells.sort((a, b) => b.y - a.y || a.x - b.x)) {
    const lastRow = rows[rows.length - 1];
    const nearby = lastRow && Math.abs(lastRow.y - cell.y) <= 2 ? lastRow : null;
    if (nearby) {
      nearby.cells.push(cell);
    } else {
      rows.push({ page: pageNumber, y: cell.y, cells: [cell] });
    }
  }
  for (const row of rows) {
    row.cells.sort((a, b) => a.x - b.x);
    const joined: PdfTextCell[] = [];
    for (const cell of row.cells) {
      const previous = joined[joined.length - 1];
      if (
        previous &&
        cell.x >= previous.x &&
        cell.x - (previous.x + previous.width) >= -1 &&
        cell.x - (previous.x + previous.width) <= 5
      ) {
        const gap = cell.x - (previous.x + previous.width);
        previous.text += `${gap > 1 ? ' ' : ''}${cell.text}`;
        previous.width = Math.max(previous.width, cell.x + cell.width - previous.x);
      } else {
        joined.push({ ...cell });
      }
    }
    row.cells = joined;
  }
  return rows;
}

interface Column {
  kind: 'date' | 'description' | 'debit' | 'credit' | 'amount' | 'direction' | 'balance';
  x: number;
}

interface PendingTransaction {
  date: string;
  description: string;
  amount: number;
  currency: CurrencyCode;
  page: number;
  y: number;
}

const MAX_PDF_TRANSACTIONS = 5_000;
const MONEY_PATTERN = /^[+\-]?(?:£\s*|\$\s*|€\s*|GBP\s*|USD\s*|EUR\s*)?(?:\d{1,3}(?:,\d{3})*|\d+)\.\d{2}(?:\s*(?:CR|DR))?$/i;

function columnKind(text: string): Column['kind'] | null {
  const normal = text.toLowerCase().replace(/[^a-z]+/g, ' ').trim();
  if (/^(transaction |posting |posted |value )?date$/.test(normal)) return 'date';
  if (/^(description|details|transaction details|narrative|payee|reference)$/.test(normal)) {
    return 'description';
  }
  if (/^(debit|debits|money out|paid out|withdrawal|withdrawals)$/.test(normal)) return 'debit';
  if (/^(credit|credits|money in|paid in|deposit|deposits)$/.test(normal)) return 'credit';
  if (/^(amount|transaction amount|value)$/.test(normal)) return 'amount';
  if (/^(type|dr cr|credit debit|direction)$/.test(normal)) return 'direction';
  if (/^(balance|running balance)$/.test(normal)) return 'balance';
  return null;
}

function detectHeader(row: PdfTextRow): Column[] | null {
  const columns = row.cells
    .map((cell) => ({ kind: columnKind(cell.text), x: cell.x }))
    .filter((column): column is Column => column.kind !== null)
    .sort((a, b) => a.x - b.x);
  const kinds = new Set(columns.map((column) => column.kind));
  if (
    !kinds.has('date') ||
    !kinds.has('description') ||
    !(kinds.has('amount') || (kinds.has('debit') && kinds.has('credit')))
  ) {
    return null;
  }
  if (new Set(columns.map((column) => column.kind)).size !== columns.length) return null;
  return columns;
}

function readColumn(row: PdfTextRow, columns: Column[], kind: Column['kind']): string {
  const index = columns.findIndex((column) => column.kind === kind);
  if (index === -1) return '';
  const start = index === 0 ? -Infinity : (columns[index - 1].x + columns[index].x) / 2;
  const end =
    index === columns.length - 1
      ? Infinity
      : (columns[index].x + columns[index + 1].x) / 2;
  return row.cells
    .filter((cell) => cell.x >= start && cell.x < end)
    .sort((a, b) => a.x - b.x)
    .map((cell) => cell.text)
    .join(' ')
    .trim();
}

function parseDate(raw: string): string | null {
  const text = raw.trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const uk = text.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  const named = text.match(/^(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})$/i);
  let year: number;
  let month: number;
  let day: number;
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (uk) {
    day = Number(uk[1]);
    month = Number(uk[2]);
    year = Number(uk[3]);
  } else if (named) {
    day = Number(named[1]);
    month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(named[2].slice(0, 3).toLowerCase()) + 1;
    year = Number(named[3]);
  } else {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseMoney(raw: string): { amount: number; direction: 'debit' | 'credit' | null; currency: CurrencyCode | null } | null {
  const value = raw.trim();
  if (!value) return { amount: 0, direction: null, currency: null };
  const parenthesized = /^\((.+)\)$/.exec(value);
  const normalized = parenthesized ? `-${parenthesized[1]}` : value;
  if (!MONEY_PATTERN.test(normalized)) return null;
  const currency = /£|\bGBP\b/i.test(normalized)
    ? 'GBP'
    : /€|\bEUR\b/i.test(normalized)
      ? 'EUR'
      : /\$|\bUSD\b/i.test(normalized)
        ? 'USD'
        : null;
  const direction = /^-/.test(normalized) || /\bDR$/i.test(normalized)
    ? 'debit'
    : /^\+/.test(normalized) || /\bCR$/i.test(normalized)
      ? 'credit'
      : null;
  const amount = Number(normalized.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000) return null;
  return { amount, direction, currency };
}

function documentCurrency(rows: PdfTextRow[]): CurrencyCode | null {
  const top = rows
    .slice(0, 40)
    .flatMap((row) => row.cells.map((cell) => cell.text))
    .join(' ');
  const found = new Set<CurrencyCode>();
  if (/£|\bGBP\b/i.test(top)) found.add('GBP');
  if (/€|\bEUR\b/i.test(top)) found.add('EUR');
  if (/\$|\bUSD\b/i.test(top)) found.add('USD');
  return found.size === 1 ? [...found][0] : null;
}

function isBalanceOrTotal(description: string): boolean {
  return /^(?:opening|closing|starting|ending|brought forward|carried forward|previous)\s+balance$|^balance\s+(?:brought|carried)\s+forward$|^(?:statement\s+)?(?:total|subtotal)(?:\s+(?:debits|credits|payments|transactions))?$/i.test(description.trim());
}

export function parsePdfStatementRows(
  rows: PdfTextRow[],
  fileName: string
): ParsedStatementResult {
  const warnings: string[] = [];
  const parsed: PendingTransaction[] = [];
  const sorted = rows.slice().sort((a, b) => a.page - b.page || b.y - a.y);
  const fileCurrency = documentCurrency(sorted);
  let columns: Column[] | null = null;
  let pending: PendingTransaction | null = null;
  let foundHeader = false;
  let rejectedRows = 0;

  const flush = () => {
    if (pending) parsed.push(pending);
    pending = null;
  };
  for (const row of sorted) {
    const header = detectHeader(row);
    if (header) {
      flush();
      columns = header;
      foundHeader = true;
      continue;
    }
    if (!columns) continue;
    const dateText = readColumn(row, columns, 'date');
    const description = readColumn(row, columns, 'description');
    const debitText = readColumn(row, columns, 'debit');
    const creditText = readColumn(row, columns, 'credit');
    const amountText = readColumn(row, columns, 'amount');
    const directionText = readColumn(row, columns, 'direction');
    const hasMoney = Boolean(debitText || creditText || amountText);
    if (isBalanceOrTotal(description)) {
      flush();
      continue;
    }
    if (!dateText && !hasMoney && description && pending && pending.page === row.page && pending.y - row.y < 24) {
      pending.description += ` ${description}`;
      pending.y = row.y;
      continue;
    }
    if (!dateText && !hasMoney) continue;
    const date = parseDate(dateText);
    if (!date) {
      rejectedRows++;
      continue;
    }
    flush();
    if (!description || !hasMoney) {
      rejectedRows++;
      continue;
    }
    const debit = parseMoney(debitText);
    const credit = parseMoney(creditText);
    const value = parseMoney(amountText);
    if (!debit || !credit || !value) {
      rejectedRows++;
      continue;
    }
    let amount = 0;
    const explicitCurrencies = new Set(
      [debit.currency, credit.currency, value.currency].filter((currency) => currency !== null)
    );
    if (explicitCurrencies.size > 1) {
      rejectedRows++;
      continue;
    }
    const currency = debit.currency ?? credit.currency ?? value.currency ?? fileCurrency;
    if (columns.some((column) => column.kind === 'debit')) {
      if (
        (debit.amount > 0 && credit.amount > 0) ||
        (debit.amount > 0 && debit.direction === 'credit') ||
        (credit.amount > 0 && credit.direction === 'debit') ||
        value.amount > 0
      ) {
        rejectedRows++;
        continue;
      }
      amount = credit.amount - debit.amount;
    } else {
      const labeledDirection = /^debit$|^dr$|^out$/i.test(directionText)
        ? 'debit'
        : /^credit$|^cr$|^in$/i.test(directionText)
          ? 'credit'
          : null;
      if (labeledDirection && value.direction && labeledDirection !== value.direction) {
        rejectedRows++;
        continue;
      }
      const direction = labeledDirection ?? value.direction;
      if (!direction) {
        rejectedRows++;
        continue;
      }
      amount = direction === 'debit' ? -value.amount : value.amount;
    }
    if (!currency || amount === 0) {
      rejectedRows++;
      continue;
    }
    pending = { date, description, amount, currency, page: row.page, y: row.y };
    if (parsed.length >= MAX_PDF_TRANSACTIONS) {
      warnings.push(`PDF exceeds the ${MAX_PDF_TRANSACTIONS}-transaction safety limit.`);
      return { transactions: [], warnings };
    }
  }
  flush();
  if (!foundHeader) {
    warnings.push('No supported Date / Description / Debit-Credit or signed Amount table was found. This PDF may be scanned or use an unsupported layout; export CSV/OFX instead.');
    return { transactions: [], warnings };
  }
  if (rejectedRows > 0) {
    warnings.push(`${rejectedRows} transaction-like PDF row${rejectedRows === 1 ? '' : 's'} could not be interpreted safely. No rows from this PDF were staged; export CSV/OFX instead.`);
    return { transactions: [], warnings };
  }
  if (parsed.length === 0) {
    warnings.push('No readable transaction rows were found. Scanned/image-only PDFs need OCR, which is not available in this local import.');
    return { transactions: [], warnings };
  }
  if (parsed.length > MAX_PDF_TRANSACTIONS) {
    warnings.push(`PDF exceeds the ${MAX_PDF_TRANSACTIONS}-transaction safety limit.`);
    return { transactions: [], warnings };
  }
  const accountName = fileName.replace(/\.pdf$/i, '');
  const transactions: Transaction[] = parsed.map((row, index) => {
    const classification = classifyTransaction(row.description, row.amount);
    return {
      id: `pdf-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`,
      date: row.date,
      description: row.description,
      merchant: classification.merchant,
      amount: row.amount,
      currency: row.currency,
      category: classification.category,
      spendingClass: classification.spendingClass,
      accountName,
      sourceFile: fileName,
    };
  });
  warnings.push('PDF amounts and UK-style dates were extracted locally. Review every transaction, currency and account before confirming; PDF layouts vary by bank.');
  return { transactions, warnings };
}
