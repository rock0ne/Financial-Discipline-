import {
  CURRENCY_CONFIG,
  type CurrencyCode,
  type Transaction,
} from '../types/finance';
import {
  classifyTransaction,
  type ParsedStatementResult,
} from './statementParser';

export interface PdfTextSpan {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfExtractedPage {
  pageNumber: number;
  spans: PdfTextSpan[];
}

export interface PdfParseOptions {
  /** Optional inclusive ISO start date override (YYYY-MM-DD) for yearless statements. */
  statementPeriodStart?: string;
  /** Optional inclusive ISO end date override (YYYY-MM-DD) for yearless statements. */
  statementPeriodEnd?: string;
  /** Default currency when the PDF omits explicit currency symbols. */
  defaultCurrency?: CurrencyCode;
}

export interface StatementDateContext {
  periodStart: string | null;
  periodEnd: string | null;
  anchorDate: string | null;
  source: 'manual' | 'period' | 'header_date' | 'filename' | 'document_date' | 'fallback';
}

interface PdfCell {
  text: string;
  x: number;
  endX: number;
  centerX: number;
}

interface PdfRow {
  pageNumber: number;
  y: number;
  cells: PdfCell[];
  text: string;
}

interface TableColumnLayout {
  dateX?: number;
  typeX?: number;
  descX?: number;
  paidOutCol?: { startX: number; endX: number; centerX: number };
  paidInCol?: { startX: number; endX: number; centerX: number };
  amountCol?: { startX: number; endX: number; centerX: number };
  balanceCol?: { startX: number; endX: number; centerX: number };
  isCreditCard: boolean;
}

interface ParsedDateToken {
  isoDate: string | null;
  yearless?: { day: number; month: number };
  matchedText: string;
  remainder: string;
}

interface ParsedMoneyToken {
  absValue: number;
  explicitSign: -1 | 1 | null;
  currency?: CurrencyCode;
  isOverdrawn?: boolean;
}

const MONTH_MAP: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const MONTH_REGEX_PART =
  '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

const UK_PAYMENT_CODES = new Set([
  'DEB',
  'DD',
  'DDR',
  'SO',
  'STO',
  'FPO',
  'FPI',
  'BGC',
  'CPT',
  'CHG',
  'TFR',
  'BP',
  'BACS',
  'CHAPS',
  'CR',
  'DR',
  'VIS',
  'POS',
  'ATM',
  'CHQ',
  'PAY',
  'INT',
  'FEE',
  'COR',
  'DEP',
  'WDR',
]);

const CREDIT_PAYMENT_CODES = new Set(['FPI', 'BGC', 'CR', 'DEP', 'INT']);
const DEBIT_PAYMENT_CODES = new Set([
  'DEB',
  'DD',
  'DDR',
  'SO',
  'STO',
  'FPO',
  'CPT',
  'CHG',
  'BP',
  'DR',
  'VIS',
  'POS',
  'ATM',
  'FEE',
  'WDR',
]);

const BROUGHT_FORWARD_RE =
  /\b(balance\s+brought\s+forward|brought\s+forward|opening\s+balance|previous\s+balance|start(?:ing)?\s+balance|balance\s+at\s+start|balance\s+b\/f|b\/f\s+balance)\b/i;

const NON_TRANSACTION_ROW_RE =
  /\b(balance\s+carried\s+forward|carried\s+forward|balance\s+c\/f|c\/f\s+balance|closing\s+balance|end(?:ing)?\s+balance|new\s+balance|total\s+(?:money|paid)\s+(?:in|out)|total\s+(?:credits?|debits?|payments?|deposits?|withdrawals?|spend|spending)|sub\s*total|balance\s+on\s+\d|balance\s+at\s+\d|account\s+summary|statement\s+summary|summary\s+of\s+(?:your|account|transactions)|overdraft\s+limit|arranged\s+overdraft|unarranged\s+overdraft|credit\s+limit|available\s+credit|minimum\s+payment|payment\s+due\s+date|interest\s+rate|estimated\s+interest|statement\s+period|statement\s+date|date\s+of\s+issue|sheet\s+number|statement\s+number|sort\s+code|account\s+number|account\s+no\.?|iban|bic|swift|page\s+\d+\s*(?:of|\/)\s*\d+|continued\s+(?:on|from)\s+(?:next|previous)\s+page|fscs|financial\s+services\s+compensation|authorised\s+by\s+the\s+prudential|regulated\s+by\s+the\s+financial\s+conduct|registered\s+in\s+england|registered\s+office|calls\s+may\s+be\s+recorded|please\s+check\s+this\s+statement|if\s+you\s+have\s+any\s+questions|your\s+transactions|transaction\s+types?)\b/i;

const BOILERPLATE_CONTINUATION_RE =
  /\b(page\s+\d+|continued\s+(?:on|from)|sort\s+code|account\s+number|account\s+name|statement\s+date|statement\s+period|sheet\s+no|iban|bic|fscs|prudential\s+regulation|financial\s+conduct|registered\s+office|www\.|https?:\/\/|tel:|telephone|helpline|customer\s+service|mr\s+|mrs\s+|ms\s+|miss\s+|dr\s+)\b/i;

const CREDIT_CARD_DOC_RE =
  /\b(credit\s+card\s+statement|credit\s+limit|minimum\s+payment|available\s+credit|card\s+number\s+ending)\b/i;

const CREDIT_DESC_RE =
  /\b(salary|payroll|bacs\s+credit|faster\s+payment\s+(?:from|in)|direct\s+credit|credit\s+interest|interest\s+paid|interest\s+credit|refund|cashback|dividend|hmrc\s+refund|transfer\s+from|payment\s+received|paid\s+in|deposit|credit\s+giro)\b/i;

const DEBIT_DESC_RE =
  /\b(card\s+payment|contactless|direct\s+debit|standing\s+order|faster\s+payment\s+to|cash\s+withdrawal|atm\s+|pos\s+|visa\s+purchase|debit\s+card|bill\s+payment|monthly\s+fee|overdraft\s+fee|bank\s+charge)\b/i;

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1990 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() + 1 === month &&
    d.getUTCDate() === day
  );
}

function toIsoDate(year: number, month: number, day: number): string | null {
  if (!isValidCalendarDate(year, month, day)) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function normalizeTwoDigitYear(rawYear: number): number {
  if (rawYear >= 100) return rawYear;
  return rawYear >= 70 ? 1900 + rawYear : 2000 + rawYear;
}

function parseMonthWord(word: string): number | null {
  return MONTH_MAP[word.toLowerCase().replace(/\.$/, '')] ?? null;
}

function parseCurrencyFromText(text: string): CurrencyCode | undefined {
  if (text.includes('£') || /\bGBP\b/i.test(text)) return 'GBP';
  if (text.includes('€') || /\bEUR\b/i.test(text)) return 'EUR';
  if (text.includes('C$') || /\bCAD\b/i.test(text)) return 'CAD';
  if (text.includes('A$') || /\bAUD\b/i.test(text)) return 'AUD';
  if (/\bCHF\b/i.test(text)) return 'CHF';
  if (text.includes('¥') || /\bJPY\b/i.test(text)) return 'JPY';
  if (text.includes('$') || /\bUSD\b/i.test(text)) return 'USD';
  return undefined;
}

/**
 * Parses a date token at the beginning of a cell or row string.
 * Supports full dates (DD MMM YYYY, DD-MMM-YY, DD/MM/YYYY, YYYY-MM-DD, MMM DD YYYY)
 * and yearless dates (DD MMM, DD-MMM, MMM DD, DD/MM).
 */
export function parseLeadingPdfDate(raw: string): ParsedDateToken | null {
  // Strip optional leading weekday prefix (e.g., "Mon 02 Oct", "Tue 29 Sep 26")
  const s = raw
    .trim()
    .replace(/^(?:mon|tue(?:s)?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun(?:day)?)\.?,?\s+/i, '');
  if (!s) return null;

  // 1. YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?=\s|$|[,\-;])/);
  if (isoMatch) {
    const iso = toIsoDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
    if (iso) {
      return {
        isoDate: iso,
        matchedText: isoMatch[0],
        remainder: s.slice(isoMatch[0].length).trim(),
      };
    }
  }

  // 2. DD MMM YYYY / DD-MMM-YYYY / DD MMM YY / DD-MMM-YY / DDMMMYY / DD MMM '26
  const dmyWordRe = new RegExp(
    `^(\\d{1,2})(?:st|nd|rd|th)?[\\s\\-./]*(${MONTH_REGEX_PART})\\.?(?:[\\s\\-./,'’]+|(?<=\\D))(\\d{2,4})(?=\\s|$|[,\\-;])`,
    'i'
  );
  const dmyWordMatch = s.match(dmyWordRe);
  if (dmyWordMatch) {
    const day = Number(dmyWordMatch[1]);
    const month = parseMonthWord(dmyWordMatch[2]);
    const year = normalizeTwoDigitYear(Number(dmyWordMatch[3]));
    if (month) {
      const iso = toIsoDate(year, month, day);
      if (iso) {
        return {
          isoDate: iso,
          matchedText: dmyWordMatch[0],
          remainder: s.slice(dmyWordMatch[0].length).trim(),
        };
      }
    }
  }

  // 3. MMM DD, YYYY / MMM DD YY (US/international statements)
  const mdyWordRe = new RegExp(
    `^(${MONTH_REGEX_PART})\\.?[\\s\\-./]+(\\d{1,2})(?:st|nd|rd|th)?(?:,\\s*|[\\s\\-./]+)(\\d{2,4})(?=\\s|$|[,\\-;])`,
    'i'
  );
  const mdyWordMatch = s.match(mdyWordRe);
  if (mdyWordMatch) {
    const month = parseMonthWord(mdyWordMatch[1]);
    const day = Number(mdyWordMatch[2]);
    const year = normalizeTwoDigitYear(Number(mdyWordMatch[3]));
    if (month) {
      const iso = toIsoDate(year, month, day);
      if (iso) {
        return {
          isoDate: iso,
          matchedText: mdyWordMatch[0],
          remainder: s.slice(mdyWordMatch[0].length).trim(),
        };
      }
    }
  }

  // 4. DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, DD/MM/YY, DD-MM-YY
  const dmyNumMatch = s.match(/^(\d{1,2})([/\-.])(\d{1,2})\2(\d{2,4})(?=\s|$|[,\-;])/);
  if (dmyNumMatch) {
    const a = Number(dmyNumMatch[1]);
    const b = Number(dmyNumMatch[3]);
    const year = normalizeTwoDigitYear(Number(dmyNumMatch[4]));
    const day = b > 12 ? b : a;
    const month = b > 12 ? a : b;
    const iso = toIsoDate(year, month, day);
    if (iso) {
      return {
        isoDate: iso,
        matchedText: dmyNumMatch[0],
        remainder: s.slice(dmyNumMatch[0].length).trim(),
      };
    }
  }

  // 5. Yearless DD MMM / DD-MMM / DDMMM (e.g., 02 Oct, 2 OCT, 02-OCT, 02OCT, 29Sep)
  const dmWordRe = new RegExp(
    `^(\\d{1,2})(?:st|nd|rd|th)?[\\s\\-./]*(${MONTH_REGEX_PART})\\.?(?=\\s|$|[,\\-;])`,
    'i'
  );
  const dmWordMatch = s.match(dmWordRe);
  if (dmWordMatch) {
    const day = Number(dmWordMatch[1]);
    const month = parseMonthWord(dmWordMatch[2]);
    if (month && day >= 1 && day <= 31) {
      return {
        isoDate: null,
        yearless: { day, month },
        matchedText: dmWordMatch[0],
        remainder: s.slice(dmWordMatch[0].length).trim(),
      };
    }
  }

  // 6. Yearless MMM DD / MMM-DD (e.g., Oct 02, Sep 14)
  const mdWordRe = new RegExp(
    `^(${MONTH_REGEX_PART})\\.?[\\s\\-./]+(\\d{1,2})(?:st|nd|rd|th)?(?=\\s|$|[,\\-;])`,
    'i'
  );
  const mdWordMatch = s.match(mdWordRe);
  if (mdWordMatch) {
    const month = parseMonthWord(mdWordMatch[1]);
    const day = Number(mdWordMatch[2]);
    if (month && day >= 1 && day <= 31) {
      return {
        isoDate: null,
        yearless: { day, month },
        matchedText: mdWordMatch[0],
        remainder: s.slice(mdWordMatch[0].length).trim(),
      };
    }
  }

  // 7. Yearless DD/MM (strictly slash-separated so we don't confuse decimals or ranges)
  const dmSlashMatch = s.match(/^(\d{1,2})\/(\d{1,2})(?=\s|$)/);
  if (dmSlashMatch) {
    const a = Number(dmSlashMatch[1]);
    const b = Number(dmSlashMatch[2]);
    const day = b > 12 ? b : a;
    const month = b > 12 ? a : b;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return {
        isoDate: null,
        yearless: { day, month },
        matchedText: dmSlashMatch[0],
        remainder: s.slice(dmSlashMatch[0].length).trim(),
      };
    }
  }

  return null;
}

/**
 * Extracts all full-year ISO dates appearing anywhere inside a line of text.
 */
function findAllFullDatesInLine(line: string): string[] {
  const results: string[] = [];
  const patterns: RegExp[] = [
    // YYYY-MM-DD
    /\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/g,
    // DD MMM YYYY / DD-MMM-YY
    new RegExp(
      `\\b(\\d{1,2})(?:st|nd|rd|th)?[\\s\\-./]+(${MONTH_REGEX_PART})\\.?[\\s\\-./,]+(\\d{2,4})\\b`,
      'gi'
    ),
    // MMM DD, YYYY
    new RegExp(
      `\\b(${MONTH_REGEX_PART})\\.?[\\s\\-./]+(\\d{1,2})(?:st|nd|rd|th)?(?:,\\s*|[\\s\\-./]+)(\\d{2,4})\\b`,
      'gi'
    ),
    // DD/MM/YYYY or DD-MM-YY
    /\b(\d{1,2})([/\-.])(\d{1,2})\2(\d{2,4})\b/g,
  ];

  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const parsed = parseLeadingPdfDate(m[0]);
      if (parsed?.isoDate) {
        results.push(parsed.isoDate);
      }
    }
  }

  return results;
}

/**
 * Infers the statement period or anchor date from manual options, header text,
 * filename (e.g. "Statement 02-OCT-26 AC 12345678.pdf"), or full dates inside the PDF.
 */
export function extractStatementDateContext(
  rows: PdfRow[],
  fileName: string,
  options: PdfParseOptions = {}
): StatementDateContext {
  const manualStart =
    options.statementPeriodStart && /^\d{4}-\d{2}-\d{2}$/.test(options.statementPeriodStart)
      ? options.statementPeriodStart
      : null;
  const manualEnd =
    options.statementPeriodEnd && /^\d{4}-\d{2}-\d{2}$/.test(options.statementPeriodEnd)
      ? options.statementPeriodEnd
      : null;

  if (manualStart && manualEnd) {
    const [start, end] =
      manualStart <= manualEnd ? [manualStart, manualEnd] : [manualEnd, manualStart];
    return {
      periodStart: start,
      periodEnd: end,
      anchorDate: end,
      source: 'manual',
    };
  }

  // Scan top rows across pages for explicit period ranges: "03 Sep 2026 to 02 Oct 2026"
  // or partial-year ranges: "03 Sep to 02 Oct 2026"
  const periodRangePartialRe = new RegExp(
    `(\\d{1,2}[\\s\\-./]+${MONTH_REGEX_PART})\\.?\\s*(?:to|-|–|—|until)\\s*(\\d{1,2}[\\s\\-./]+${MONTH_REGEX_PART}\\.?[\\s\\-./,]+\\d{2,4})`,
    'i'
  );

  let headerAnchorDate: string | null = null;
  const allFullDates: string[] = [];

  for (const row of rows) {
    const line = row.text;
    const datesInLine = findAllFullDatesInLine(line);
    for (const d of datesInLine) {
      allFullDates.push(d);
    }

    // Explicit 2-date range on one line (e.g. "03 September 2026 to 02 October 2026")
    if (
      datesInLine.length >= 2 &&
      /\b(to|until|period|from|between)\b|[-–—]/i.test(line) &&
      !NON_TRANSACTION_ROW_RE.test(line.replace(/statement\s+period/gi, ''))
    ) {
      const sorted = [...datesInLine].sort();
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const daySpan =
        (Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000;
      if (daySpan >= 1 && daySpan <= 400) {
        return {
          periodStart: first,
          periodEnd: last,
          anchorDate: last,
          source: 'period',
        };
      }
    }

    // Partial-year range ("03 Sep to 02 Oct 2026" or "20 Dec to 19 Jan 2026")
    const partialMatch = line.match(periodRangePartialRe);
    if (partialMatch) {
      const endParsed = parseLeadingPdfDate(partialMatch[2]);
      const startParsed = parseLeadingPdfDate(partialMatch[1]);
      if (endParsed?.isoDate && startParsed?.yearless) {
        const endYear = Number(endParsed.isoDate.slice(0, 4));
        const endMonth = Number(endParsed.isoDate.slice(5, 7));
        const startYear = startParsed.yearless.month > endMonth ? endYear - 1 : endYear;
        const startIso = toIsoDate(startYear, startParsed.yearless.month, startParsed.yearless.day);
        if (startIso) {
          return {
            periodStart: startIso,
            periodEnd: endParsed.isoDate,
            anchorDate: endParsed.isoDate,
            source: 'period',
          };
        }
      }
    }

    if (
      !headerAnchorDate &&
      datesInLine.length >= 1 &&
      /\b(statement\s+date|date\s+of\s+issue|issued|statement\s+ending|as\s+at|closing\s+date)\b/i.test(
        line
      )
    ) {
      headerAnchorDate = datesInLine[datesInLine.length - 1];
    }
  }

  if (headerAnchorDate) {
    return {
      periodStart: manualStart,
      periodEnd: manualEnd ?? headerAnchorDate,
      anchorDate: manualEnd ?? headerAnchorDate,
      source: 'header_date',
    };
  }

  // Check the filename (e.g. "Statement 02-OCT-26 AC 12345678.pdf")
  const filenameDates = findAllFullDatesInLine(fileName.replace(/[_]/g, ' '));
  if (filenameDates.length > 0) {
    const sorted = [...filenameDates].sort();
    const last = sorted[sorted.length - 1];
    return {
      periodStart: manualStart ?? (sorted.length >= 2 ? sorted[0] : null),
      periodEnd: manualEnd ?? last,
      anchorDate: manualEnd ?? last,
      source: 'filename',
    };
  }

  if (allFullDates.length > 0) {
    const sorted = [...allFullDates].sort();
    const last = sorted[sorted.length - 1];
    return {
      periodStart: manualStart,
      periodEnd: manualEnd ?? last,
      anchorDate: manualEnd ?? last,
      source: 'document_date',
    };
  }

  // Fallback to current date if absolutely no year exists anywhere
  const todayIso = new Date().toISOString().slice(0, 10);
  return {
    periodStart: manualStart,
    periodEnd: manualEnd,
    anchorDate: manualEnd ?? manualStart ?? todayIso,
    source: manualStart || manualEnd ? 'manual' : 'fallback',
  };
}

/**
 * Resolves a yearless date (day + month) into an ISO YYYY-MM-DD date using the
 * inferred statement period or anchor date (correctly handling Dec -> Jan year rollovers).
 */
export function resolveYearlessDate(
  day: number,
  month: number,
  context: StatementDateContext
): string | null {
  if (context.periodStart && context.periodEnd) {
    const startYear = Number(context.periodStart.slice(0, 4));
    const endYear = Number(context.periodEnd.slice(0, 4));
    const candidateYears = Array.from(new Set([startYear, endYear, endYear - 1, endYear + 1]));

    // Prefer a candidate that falls strictly within [periodStart, periodEnd]
    for (const yr of candidateYears) {
      const iso = toIsoDate(yr, month, day);
      if (iso && iso >= context.periodStart && iso <= context.periodEnd) {
        return iso;
      }
    }

    // Allow a small ±7 day posting buffer around period boundaries
    const startMs = Date.parse(`${context.periodStart}T00:00:00Z`) - 7 * 86_400_000;
    const endMs = Date.parse(`${context.periodEnd}T00:00:00Z`) + 7 * 86_400_000;
    for (const yr of candidateYears) {
      const iso = toIsoDate(yr, month, day);
      if (!iso) continue;
      const ms = Date.parse(`${iso}T00:00:00Z`);
      if (ms >= startMs && ms <= endMs) return iso;
    }
  }

  const anchor = context.anchorDate ?? new Date().toISOString().slice(0, 10);
  const anchorYear = Number(anchor.slice(0, 4));
  const anchorMs = Date.parse(`${anchor}T00:00:00Z`);
  // Transactions on a statement dated e.g. 02-OCT-26 occur on or before 02-OCT-26
  // (allow +7 days grace for pending/posting dates, otherwise pick the latest year <= anchor)
  const maxAllowedMs = anchorMs + 7 * 86_400_000;

  let bestOnOrBefore: { iso: string; diff: number } | null = null;
  let bestOverall: { iso: string; diff: number } | null = null;

  for (const yr of [anchorYear - 1, anchorYear, anchorYear + 1]) {
    const iso = toIsoDate(yr, month, day);
    if (!iso) continue;
    const ms = Date.parse(`${iso}T00:00:00Z`);
    const absDiff = Math.abs(anchorMs - ms);
    if (!bestOverall || absDiff < bestOverall.diff) {
      bestOverall = { iso, diff: absDiff };
    }
    if (ms <= maxAllowedMs) {
      const lag = maxAllowedMs - ms;
      if (!bestOnOrBefore || lag < bestOnOrBefore.diff) {
        bestOnOrBefore = { iso, diff: lag };
      }
    }
  }

  return bestOnOrBefore?.iso ?? bestOverall?.iso ?? null;
}

/**
 * Parses a standalone monetary cell string (must have 2 decimal places OR a currency symbol
 * so card numbers, sort codes, and reference IDs are never misread as money).
 */
export function parsePdfMoneyCell(raw: string): ParsedMoneyToken | null {
  const s = raw.trim();
  if (!s) return null;

  // Reject dates, sort codes (20-45-12), or pure integer IDs without currency symbol
  if (/^\d{2}-\d{2}-\d{2}$/.test(s)) return null;
  if (/^\d{1,2}\/\d{1,2}(?:\/\d{2,4})?$/.test(s)) return null;

  const currency = parseCurrencyFromText(s);
  const parenNeg = /^\(.*\)$/.test(s);
  const trailingDr = /\b(?:DR|OD|D)\s*$/i.test(s);
  const trailingCr = /\b(?:CR|C)\s*$/i.test(s);
  const leadingMinus = /^[-−–]\s*[£$€]?|^[£$€]\s*[-−–]/.test(s) || /[-−]\s*$/.test(s);
  const leadingPlus = /^\+\s*[£$€]?|^[£$€]\s*\+/.test(s);

  const stripped = s
    .replace(/^\((.+)\)$/, '$1')
    .replace(/\b(?:DR|CR|OD|GBP|USD|EUR|CAD|AUD|CHF|JPY)\b/gi, '')
    .replace(/[DC]\s*$/i, '')
    .replace(/[£$€¥₹,\s]/g, '')
    .replace(/^[-−–+]+|[-−–+]+$/g, '')
    .trim();

  // Require decimal with 2 digits (standard bank format: 12.34, 1,200.00) or explicit currency symbol
  const hasTwoDecimals = /^\d+\.\d{2}$/.test(stripped);
  const isCurrencyWhole = Boolean(currency) && /^\d+(?:\.\d{1,2})?$/.test(stripped);
  if (!hasTwoDecimals && !isCurrencyWhole) return null;

  const absValue = Number(stripped);
  if (!Number.isFinite(absValue) || absValue < 0 || absValue > 10_000_000) return null;

  let explicitSign: -1 | 1 | null = null;
  if (parenNeg || leadingMinus || trailingDr) explicitSign = -1;
  else if (leadingPlus || trailingCr) explicitSign = 1;

  return {
    absValue: Math.round(absValue * 100) / 100,
    explicitSign,
    currency,
    isOverdrawn: trailingDr || leadingMinus || parenNeg,
  };
}

/**
 * Splits a merged cell if a single text span contains trailing money token(s)
 * separated from description text (e.g. "TESCO STORES 24.50 1,234.56").
 */
function splitCellMoneyTokens(cell: PdfCell): PdfCell[] {
  if (parsePdfMoneyCell(cell.text)) return [cell];

  // Look for space-separated monetary tokens at the right end of a single PDF span
  const moneyTokenRe =
    /(?:^|\s)((?:\(?[-−+]?[£$€]?\d{1,3}(?:,\d{3})*\.\d{2}[-−+]?\)?(?:\s*(?:CR|DR|OD|D|C))?))(?=\s|$)/gi;
  const matches: Array<{ index: number; token: string; fullStart: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = moneyTokenRe.exec(cell.text)) !== null) {
    const token = m[1].trim();
    if (parsePdfMoneyCell(token)) {
      const tokenStart = m.index + m[0].indexOf(m[1]);
      matches.push({ index: tokenStart, token, fullStart: m.index });
    }
  }

  if (matches.length === 0) return [cell];

  // Only split trailing contiguous monetary tokens at the end of the cell
  const lastMatch = matches[matches.length - 1];
  const trailingTextAfterLast = cell.text.slice(lastMatch.index + lastMatch.token.length).trim();
  if (trailingTextAfterLast.length > 0) return [cell];

  // Collect trailing chain of money tokens (up to 3: paidOut, paidIn, balance)
  const trailing: typeof matches = [lastMatch];
  for (let i = matches.length - 2; i >= 0 && trailing.length < 3; i--) {
    const prev = matches[i];
    const next = trailing[0];
    const between = cell.text.slice(prev.index + prev.token.length, next.index).trim();
    if (between.length === 0) {
      trailing.unshift(prev);
    } else {
      break;
    }
  }

  const totalLen = Math.max(1, cell.text.length);
  const width = Math.max(1, cell.endX - cell.x);
  const out: PdfCell[] = [];

  const prefixText = cell.text.slice(0, trailing[0].index).trim();
  if (prefixText) {
    const ratioEnd = trailing[0].index / totalLen;
    const endX = cell.x + width * ratioEnd;
    out.push({
      text: prefixText,
      x: cell.x,
      endX,
      centerX: (cell.x + endX) / 2,
    });
  }

  for (const item of trailing) {
    const startRatio = item.index / totalLen;
    const endRatio = (item.index + item.token.length) / totalLen;
    const x = cell.x + width * startRatio;
    const endX = cell.x + width * endRatio;
    out.push({
      text: item.token,
      x,
      endX,
      centerX: (x + endX) / 2,
    });
  }

  return out;
}

/**
 * Groups positioned PDF text spans into visual rows (top-to-bottom per page)
 * and column-aligned cells (left-to-right within each row).
 */
export function groupPdfPagesIntoRows(pages: PdfExtractedPage[]): PdfRow[] {
  const allRows: PdfRow[] = [];

  for (const page of pages) {
    const cleanSpans = page.spans
      .map((s) => ({
        ...s,
        text: s.text.replace(/\u00A0/g, ' ').replace(/\s+/g, ' '),
      }))
      .filter((s) => s.text.trim().length > 0);

    if (cleanSpans.length === 0) continue;

    // Sort top-to-bottom (higher PDF y = higher on page), then left-to-right
    cleanSpans.sort((a, b) => {
      if (Math.abs(b.y - a.y) > 2.5) return b.y - a.y;
      return a.x - b.x;
    });

    const grouped: Array<{ y: number; spans: PdfTextSpan[] }> = [];
    for (const span of cleanSpans) {
      const tolerance = Math.max(2.6, Math.min(5, (span.height || 10) * 0.38));
      const existing = grouped.find((g) => Math.abs(g.y - span.y) <= tolerance);
      if (existing) {
        existing.spans.push(span);
      } else {
        grouped.push({ y: span.y, spans: [span] });
      }
    }

    // Ensure rows are ordered strictly top-to-bottom
    grouped.sort((a, b) => b.y - a.y);

    for (const group of grouped) {
      group.spans.sort((a, b) => a.x - b.x);
      const mergedCells: PdfCell[] = [];

      for (const span of group.spans) {
        const text = span.text.trim();
        if (!text) continue;
        const spanWidth = Math.max(span.width || text.length * 4.5, 2);
        const spanEndX = span.x + spanWidth;
        const prev = mergedCells[mergedCells.length - 1];

        // Merge spans that sit close together on the same row (same text column)
        const gap = prev ? span.x - prev.endX : Infinity;
        const mergeThreshold = Math.max(7, Math.min(14, (span.height || 10) * 0.85));

        if (prev && gap <= mergeThreshold && gap >= -6) {
          const joiner = gap > 1.2 ? ' ' : '';
          prev.text = `${prev.text}${joiner}${text}`.replace(/\s+/g, ' ').trim();
          prev.endX = Math.max(prev.endX, spanEndX);
          prev.centerX = (prev.x + prev.endX) / 2;
        } else {
          mergedCells.push({
            text,
            x: span.x,
            endX: spanEndX,
            centerX: (span.x + spanEndX) / 2,
          });
        }
      }

      // Split any single merged cell that ends with space-delimited monetary columns
      const expandedCells = mergedCells.flatMap((c) => splitCellMoneyTokens(c));
      if (expandedCells.length === 0) continue;

      allRows.push({
        pageNumber: page.pageNumber,
        y: group.y,
        cells: expandedCells,
        text: expandedCells.map((c) => c.text).join(' ').replace(/\s+/g, ' ').trim(),
      });
    }
  }

  return allRows;
}

/**
 * Detects a transaction table header row and returns its column X-coordinates.
 */
function detectTableHeaderFromCells(
  cells: PdfCell[],
  isCreditCard: boolean
): TableColumnLayout | null {
  const layout: TableColumnLayout = { isCreditCard };
  let hits = 0;

  for (const cell of cells) {
    const label = cell.text
      .toLowerCase()
      .replace(/[£$€()]/g, ' ')
      .replace(/[^a-z0-9\s/]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!label || label.length > 42) continue;

    if (/^(?:trans(?:action)?\s+|value\s+|post(?:ed|ing)?\s+)?dates?$/.test(label)) {
      layout.dateX = cell.x;
      hits++;
    } else if (/^(?:payment\s+|trans(?:action)?\s+)?type$/.test(label)) {
      layout.typeX = cell.x;
      hits++;
    } else if (
      /^(?:description|details|payment\s+details|payment\s+type\s+and\s+details|transaction(?:\s+details|\s+description)?|particulars|narrative|merchant|payee|activity)$/.test(
        label
      )
    ) {
      layout.descX = cell.x;
      hits++;
    } else if (
      /^(?:paid\s+out|money\s+out|payments?\s+out|debit(?:s)?|withdrawn|withdrawals?|out|payments?|spent|dr|outflow)$/.test(
        label
      ) ||
      label.includes('paid out') ||
      label.includes('money out') ||
      label.includes('payments out')
    ) {
      layout.paidOutCol = { startX: cell.x, endX: cell.endX, centerX: cell.centerX };
      hits++;
    } else if (
      /^(?:paid\s+in|money\s+in|payments?\s+in|credit(?:s)?|deposited|deposits?|in|receipts?|cr|inflow)$/.test(
        label
      ) ||
      label.includes('paid in') ||
      label.includes('money in') ||
      label.includes('payments in')
    ) {
      layout.paidInCol = { startX: cell.x, endX: cell.endX, centerX: cell.centerX };
      hits++;
    } else if (/^(?:transaction\s+)?amount$|^value$/.test(label)) {
      layout.amountCol = { startX: cell.x, endX: cell.endX, centerX: cell.centerX };
      hits++;
    } else if (/^(?:running\s+)?balance$/.test(label)) {
      layout.balanceCol = { startX: cell.x, endX: cell.endX, centerX: cell.centerX };
      hits++;
    }
  }

  // Require at least 2 table column header matches including at least one money/balance column or date+description
  const hasMoneyHeader = Boolean(
    layout.paidOutCol || layout.paidInCol || layout.amountCol || layout.balanceCol
  );
  const hasDateAndDesc = layout.dateX !== undefined && layout.descX !== undefined;
  if (hits >= 2 && (hasMoneyHeader || hasDateAndDesc)) {
    return layout;
  }
  return null;
}

/**
 * Detects single-line OR two-line wrapped transaction table headers
 * (e.g. UK bank PDFs wrapping "Paid / out (£)", "Paid / in (£)", "Money / out", "Payment type / and details").
 */
function detectTableHeader(
  row: PdfRow,
  nextRow: PdfRow | undefined,
  isCreditCard: boolean
): { layout: TableColumnLayout; consumedNextRow: boolean } | null {
  const single = detectTableHeaderFromCells(row.cells, isCreditCard);

  // Check if next row completes wrapped header labels (e.g. "Paid" + "out", "Money" + "in", "(£)")
  if (
    nextRow &&
    nextRow.pageNumber === row.pageNumber &&
    row.y - nextRow.y > 0 &&
    row.y - nextRow.y <= 26 &&
    !parseLeadingPdfDate(nextRow.cells[0]?.text ?? '') &&
    !nextRow.cells.some((c) => parsePdfMoneyCell(c.text) !== null)
  ) {
    const combined: PdfCell[] = row.cells.map((c) => ({ ...c }));
    for (const sub of nextRow.cells) {
      const target = combined.find(
        (parent) =>
          Math.abs(parent.centerX - sub.centerX) <= 38 ||
          Math.abs(parent.x - sub.x) <= 28 ||
          Math.abs(parent.endX - sub.endX) <= 28
      );
      if (target) {
        target.text = `${target.text} ${sub.text}`.replace(/\s+/g, ' ').trim();
        target.x = Math.min(target.x, sub.x);
        target.endX = Math.max(target.endX, sub.endX);
        target.centerX = (target.x + target.endX) / 2;
      } else {
        combined.push({ ...sub });
      }
    }

    const wrapped = detectTableHeaderFromCells(combined, isCreditCard);
    if (wrapped) {
      const singleScore =
        (single?.paidOutCol ? 1 : 0) +
        (single?.paidInCol ? 1 : 0) +
        (single?.amountCol ? 1 : 0) +
        (single?.balanceCol ? 1 : 0);
      const wrappedScore =
        (wrapped.paidOutCol ? 1 : 0) +
        (wrapped.paidInCol ? 1 : 0) +
        (wrapped.amountCol ? 1 : 0) +
        (wrapped.balanceCol ? 1 : 0);
      const nextIsCurrencyOrSubheader = /^(?:out|in|details|and details|description|balance|amount|gbp|usd|eur|[£$€()/\s-]+)$/i.test(
        nextRow.text.trim()
      );
      if (!single || wrappedScore > singleScore || nextIsCurrencyOrSubheader) {
        return { layout: wrapped, consumedNextRow: true };
      }
    }
  }

  return single ? { layout: single, consumedNextRow: false } : null;
}

function columnDistance(
  cell: PdfCell,
  col: { startX: number; endX: number; centerX: number }
): number {
  // Bank numeric columns are right-aligned, so check both right-edge and center alignment
  return Math.min(Math.abs(cell.endX - col.endX), Math.abs(cell.centerX - col.centerX));
}

function isCellNearColumn(
  cell: PdfCell,
  col: { startX: number; endX: number; centerX: number } | undefined,
  tolerance = 44
): boolean {
  if (!col) return false;
  return (
    columnDistance(cell, col) <= tolerance ||
    (cell.centerX >= col.startX - 18 && cell.centerX <= col.endX + 18)
  );
}

function stripLeadingPaymentCode(text: string): { code: string | null; rest: string } {
  const m = text.trim().match(/^([A-Z]{2,5})\s+(.+)$/);
  if (m && UK_PAYMENT_CODES.has(m[1])) {
    return { code: m[1], rest: m[2].trim() };
  }
  return { code: null, rest: text.trim() };
}

function resolveSignedAmount(params: {
  txCell: PdfCell;
  txMoney: ParsedMoneyToken;
  rowBalance: number | null;
  prevBalance: number | null;
  layout: TableColumnLayout;
  paymentCode: string | null;
  description: string;
}): number {
  const { txCell, txMoney, rowBalance, prevBalance, layout, paymentCode, description } = params;
  const absVal = txMoney.absValue;

  // 1. Explicit sign directly on the amount token (-45.00, +100.00, 45.00 CR, 45.00 DR)
  if (txMoney.explicitSign !== null) {
    // On credit card statements, positive amounts are expenses and CR/- are refunds/payments
    if (layout.isCreditCard) {
      return txMoney.explicitSign === 1 ? absVal : -absVal;
    }
    return txMoney.explicitSign * absVal;
  }

  // 2. Running balance math verification (gold standard on UK/EU current account statements!)
  if (rowBalance !== null && prevBalance !== null) {
    const outDiff = Math.abs(prevBalance - absVal - rowBalance);
    const inDiff = Math.abs(prevBalance + absVal - rowBalance);
    if (outDiff <= 0.025 && inDiff > 0.05) {
      return -absVal;
    }
    if (inDiff <= 0.025 && outDiff > 0.05) {
      return absVal;
    }
  }

  // 3. Split Paid Out / Paid In column X-alignment
  if (layout.paidOutCol && layout.paidInCol) {
    const distOut = columnDistance(txCell, layout.paidOutCol);
    const distIn = columnDistance(txCell, layout.paidInCol);
    if (Math.abs(distOut - distIn) > 8) {
      return distOut < distIn ? -absVal : absVal;
    }
  } else if (layout.paidOutCol && isCellNearColumn(txCell, layout.paidOutCol)) {
    return -absVal;
  } else if (layout.paidInCol && isCellNearColumn(txCell, layout.paidInCol)) {
    return absVal;
  }

  // 4. UK bank payment type codes (FPI, BGC = credit; DEB, DD, SO, FPO, CPT = debit)
  if (paymentCode) {
    if (CREDIT_PAYMENT_CODES.has(paymentCode)) return absVal;
    if (DEBIT_PAYMENT_CODES.has(paymentCode)) return -absVal;
  }

  // 5. Description heuristics
  if (CREDIT_DESC_RE.test(description) && !DEBIT_DESC_RE.test(description)) {
    return absVal;
  }

  // Default for unsigned bank transaction rows: outflow (debit)
  return -absVal;
}

/**
 * Pure, unit-testable PDF bank statement table parser.
 * Handles UK/US/EU bank statement layouts including yearless dates, blank same-day dates,
 * multi-line wrapped descriptions, Paid Out / Paid In columns, and running balance sign verification.
 */
export function parsePdfStatementPages(
  pages: PdfExtractedPage[],
  fileName: string,
  options: PdfParseOptions = {}
): ParsedStatementResult {
  const warnings: string[] = [];
  const rows = groupPdfPagesIntoRows(pages);

  if (rows.length === 0) {
    warnings.push(
      'This PDF contains no selectable text (it appears to be a scanned image). Please export CSV or OFX from your online banking instead.'
    );
    return { transactions: [], warnings };
  }

  const fullDocText = rows.map((r) => r.text).join('\n');
  const isCreditCard = CREDIT_CARD_DOC_RE.test(fullDocText);
  const docCurrency =
    parseCurrencyFromText(fullDocText) ??
    parseCurrencyFromText(fileName) ??
    options.defaultCurrency;

  const dateContext = extractStatementDateContext(rows, fileName, options);
  const defaultAccount = fileName
    .replace(/\.[^.]+$/, '')
    .replace(/^.*\//, '')
    .trim();

  let layout: TableColumnLayout = { isCreditCard };
  let sawTableHeader = false;
  let currentDate: string | null = null;
  let prevBalance: number | null = null;
  let lastPageNumber = -1;
  let pendingEntry: {
    date: string;
    paymentCode: string | null;
    descParts: string[];
    pageNumber: number;
  } | null = null;

  const transactions: Transaction[] = [];
  let usedYearlessInference = false;
  let inheritedBlankDates = 0;

  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx];

    // On page break, clear any dangling pending entry so header lines don't merge into it
    if (row.pageNumber !== lastPageNumber) {
      pendingEntry = null;
      lastPageNumber = row.pageNumber;
    }

    // 1. Check if this row (or this row + wrapped subheader) is a table header
    const headerMatch = detectTableHeader(row, rows[rowIdx + 1], isCreditCard);
    if (headerMatch) {
      const detectedHeader = headerMatch.layout;
      layout = {
        ...layout,
        ...detectedHeader,
        // Preserve previously learned columns if repeated page header omits one
        dateX: detectedHeader.dateX ?? layout.dateX,
        typeX: detectedHeader.typeX ?? layout.typeX,
        descX: detectedHeader.descX ?? layout.descX,
        paidOutCol: detectedHeader.paidOutCol ?? layout.paidOutCol,
        paidInCol: detectedHeader.paidInCol ?? layout.paidInCol,
        amountCol: detectedHeader.amountCol ?? layout.amountCol,
        balanceCol: detectedHeader.balanceCol ?? layout.balanceCol,
      };
      sawTableHeader = true;
      pendingEntry = null;
      if (headerMatch.consumedNextRow) {
        rowIdx += 1;
      }
      continue;
    }

    // 2. Capture Brought Forward / Opening Balance to seed running-balance sign verification
    if (BROUGHT_FORWARD_RE.test(row.text)) {
      const moneyTokens = row.cells
        .map((cell) => ({ cell, money: parsePdfMoneyCell(cell.text) }))
        .filter((x): x is { cell: PdfCell; money: ParsedMoneyToken } => x.money !== null);
      if (moneyTokens.length > 0) {
        const lastToken = moneyTokens[moneyTokens.length - 1];
        prevBalance = lastToken.money.isOverdrawn
          ? -lastToken.money.absValue
          : lastToken.money.absValue;
      }
      pendingEntry = null;
      continue;
    }

    // 3. Skip non-transaction summary / header / footer rows
    if (NON_TRANSACTION_ROW_RE.test(row.text)) {
      pendingEntry = null;
      continue;
    }

    // 4. Parse leading date (either in cell 0 or after a short payment code if date is in cell 0/1)
    let rowDate: string | null = null;
    let dateCellIndex = -1;
    let dateRemainderText = '';

    for (let c = 0; c < Math.min(2, row.cells.length); c++) {
      const cell = row.cells[c];
      // If we know where the Date column is, don't parse dates far to the right inside the description
      if (c > 0 && layout.dateX !== undefined && cell.x > layout.dateX + 70) break;
      const parsedDate = parseLeadingPdfDate(cell.text);
      if (parsedDate) {
        if (parsedDate.isoDate) {
          rowDate = parsedDate.isoDate;
        } else if (parsedDate.yearless) {
          rowDate = resolveYearlessDate(
            parsedDate.yearless.day,
            parsedDate.yearless.month,
            dateContext
          );
          if (rowDate) usedYearlessInference = true;
        }
        if (rowDate) {
          dateCellIndex = c;
          dateRemainderText = parsedDate.remainder;
          break;
        }
      }
    }

    // 5. Identify monetary cells on this row
    const moneyCells: Array<{ index: number; cell: PdfCell; money: ParsedMoneyToken }> = [];
    for (let i = 0; i < row.cells.length; i++) {
      if (i === dateCellIndex && !dateRemainderText) continue;
      const textToTest = i === dateCellIndex ? dateRemainderText : row.cells[i].text;
      const parsedMoney = parsePdfMoneyCell(textToTest);
      if (parsedMoney) {
        moneyCells.push({ index: i, cell: row.cells[i], money: parsedMoney });
      }
    }

    // Collect non-date, non-money cells as description + optional UK payment code
    const moneyIndexSet = new Set(moneyCells.map((m) => m.index));
    const descPieces: string[] = [];
    let paymentCode: string | null = null;

    for (let i = 0; i < row.cells.length; i++) {
      if (moneyIndexSet.has(i)) continue;
      const rawPiece =
        i === dateCellIndex ? dateRemainderText : row.cells[i].text;
      const piece = rawPiece.trim();
      if (!piece || /^[-–—]+$/.test(piece)) continue;

      if (!paymentCode && UK_PAYMENT_CODES.has(piece.toUpperCase()) && descPieces.length === 0) {
        paymentCode = piece.toUpperCase();
        continue;
      }

      if (!paymentCode && descPieces.length === 0) {
        const stripped = stripLeadingPaymentCode(piece);
        if (stripped.code) {
          paymentCode = stripped.code;
          if (stripped.rest) descPieces.push(stripped.rest);
          continue;
        }
      }

      descPieces.push(piece);
    }

    const rowDescription = descPieces.join(' ').replace(/\s+/g, ' ').trim();

    // 6. Handle rows WITHOUT any monetary values
    if (moneyCells.length === 0) {
      // Case A: Date + description on line 1, amount expected on line 2
      if (rowDate && rowDescription && !BOILERPLATE_CONTINUATION_RE.test(rowDescription)) {
        currentDate = rowDate;
        pendingEntry = {
          date: rowDate,
          paymentCode,
          descParts: [rowDescription],
          pageNumber: row.pageNumber,
        };
        continue;
      }

      // Case B: Multi-line description continuation for pendingEntry
      if (
        !rowDate &&
        pendingEntry &&
        rowDescription &&
        !BOILERPLATE_CONTINUATION_RE.test(rowDescription) &&
        pendingEntry.descParts.length < 3
      ) {
        pendingEntry.descParts.push(rowDescription);
        continue;
      }

      // Case C: Multi-line description continuation for the immediately preceding transaction
      if (
        !rowDate &&
        transactions.length > 0 &&
        rowDescription &&
        rowDescription.length >= 2 &&
        rowDescription.length <= 90 &&
        !BOILERPLATE_CONTINUATION_RE.test(rowDescription) &&
        (!layout.dateX || (row.cells[0]?.x ?? 0) >= layout.dateX - 8)
      ) {
        const lastTx = transactions[transactions.length - 1];
        // Only attach continuation lines from the same page and keep descriptions concise
        if (lastTx.description.length < 130 && !lastTx.description.includes(rowDescription)) {
          const mergedDesc = `${lastTx.description} ${rowDescription}`.replace(/\s+/g, ' ').trim();
          const reclassified = classifyTransaction(mergedDesc, lastTx.amount);
          lastTx.description = mergedDesc;
          lastTx.merchant = reclassified.merchant;
          lastTx.category = reclassified.category;
          lastTx.spendingClass = reclassified.spendingClass;
        }
      }
      continue;
    }

    // 7. Row HAS monetary value(s): determine effective date
    let effectiveDate = rowDate;
    let combinedDesc = rowDescription;
    let effectiveCode = paymentCode;

    if (!effectiveDate && pendingEntry) {
      effectiveDate = pendingEntry.date;
      effectiveCode = pendingEntry.paymentCode ?? paymentCode;
      combinedDesc = [...pendingEntry.descParts, rowDescription].filter(Boolean).join(' ').trim();
      pendingEntry = null;
    } else if (effectiveDate) {
      currentDate = effectiveDate;
      pendingEntry = null;
    } else if (currentDate && (sawTableHeader || transactions.length > 0)) {
      // Blank date on same-day subsequent transaction safely inherits preceding transaction date
      effectiveDate = currentDate;
      inheritedBlankDates++;
    }

    if (!effectiveDate) {
      // Before any dated transaction has started (e.g. account summary box on page 1)
      continue;
    }

    // 8. Separate transaction amount cell(s) from running balance cell
    let rowBalance: number | null = null;
    let txMoneyEntries = moneyCells;

    const lastMoney = moneyCells[moneyCells.length - 1];
    const hasBalanceHeader = Boolean(layout.balanceCol);
    const lastIsBalanceByHeader =
      hasBalanceHeader && isCellNearColumn(lastMoney.cell, layout.balanceCol, 48);

    if (moneyCells.length >= 2 && (lastIsBalanceByHeader || !layout.amountCol)) {
      // Standard UK/EU layout: [txAmount, balance] or [paidOut, paidIn, balance]
      rowBalance = lastMoney.money.isOverdrawn
        ? -lastMoney.money.absValue
        : lastMoney.money.absValue;
      txMoneyEntries = moneyCells.slice(0, -1);
    } else if (moneyCells.length === 1 && lastIsBalanceByHeader && !combinedDesc) {
      // Balance-only line (no transaction amount)
      prevBalance = lastMoney.money.isOverdrawn
        ? -lastMoney.money.absValue
        : lastMoney.money.absValue;
      continue;
    }

    if (txMoneyEntries.length === 0) continue;

    // Pick primary transaction money cell (if 2 non-balance money cells appear, use the non-zero one)
    const chosenEntry =
      txMoneyEntries.find((m) => m.money.absValue > 0) ?? txMoneyEntries[0];

    if (chosenEntry.money.absValue === 0) {
      if (rowBalance !== null) prevBalance = rowBalance;
      continue;
    }

    // Require a meaningful description (fallback to payment code label if bank only printed code)
    if (!combinedDesc) {
      if (effectiveCode) {
        combinedDesc = `Bank Transaction (${effectiveCode})`;
      } else {
        if (rowBalance !== null) prevBalance = rowBalance;
        continue;
      }
    }

    // Compute exact signed amount using explicit sign -> balance delta -> Paid Out/In column -> code/description
    const signedAmount = resolveSignedAmount({
      txCell: chosenEntry.cell,
      txMoney: chosenEntry.money,
      rowBalance,
      prevBalance,
      layout,
      paymentCode: effectiveCode,
      description: combinedDesc,
    });

    if (rowBalance !== null) {
      prevBalance = rowBalance;
    }

    const txCurrency = chosenEntry.money.currency ?? docCurrency;
    const classified = classifyTransaction(combinedDesc, signedAmount);

    transactions.push({
      id: `pdf-${Date.now()}-${rowIdx}-${Math.random().toString(36).slice(2, 6)}`,
      date: effectiveDate,
      description: combinedDesc,
      merchant: classified.merchant,
      amount: Math.round(signedAmount * 100) / 100,
      ...(txCurrency && txCurrency in CURRENCY_CONFIG ? { currency: txCurrency } : {}),
      category: classified.category,
      spendingClass: classified.spendingClass,
      accountName: defaultAccount || 'PDF Statement',
      sourceFile: fileName,
    });
  }

  // Guard against non-statement PDFs mixed into a statements folder (e.g. utility bills, school letters)
  const looksLikeNonStatementDoc =
    !sawTableHeader &&
    /\b(meter\s+reading|kwh|standing\s+charge|electricity\s+supply|gas\s+supply|dear\s+parent|headteacher|school\s+term|council\s+tax\s+bill)\b/i.test(
      fullDocText
    );

  if (looksLikeNonStatementDoc) {
    return {
      transactions: [],
      warnings: [
        'Skipped (appears to be a utility bill or letter rather than a bank statement).',
      ],
    };
  }

  if (transactions.length === 0) {
    warnings.push(
      'No bank transaction table found in this PDF (it may be a scanned document, summary certificate, or non-statement PDF).'
    );
  } else if (usedYearlessInference && dateContext.source === 'fallback') {
    warnings.push(
      `Yearless dates were resolved using the current year (${dateContext.anchorDate?.slice(0, 4)}). Set the optional PDF Statement Period dates below if this statement is from an earlier year.`
    );
  } else if (usedYearlessInference && dateContext.source === 'filename') {
    void inheritedBlankDates;
  }

  return { transactions, warnings };
}

/**
 * Extracts text spans with (x, y, width, height) coordinates from a PDF ArrayBuffer
 * completely locally inside the user's browser using pdfjs-dist.
 */
export async function extractPdfPagesFromBuffer(
  buffer: ArrayBuffer
): Promise<PdfExtractedPage[]> {
  const [pdfjsLib, workerUrlModule] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);

  if (pdfjsLib.GlobalWorkerOptions) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrlModule.default;
  }

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
  });

  const pdfDoc = await loadingTask.promise;
  const pages: PdfExtractedPage[] = [];

  try {
    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent();
      const spans: PdfTextSpan[] = [];

      for (const item of textContent.items) {
        if (!('str' in item)) continue;
        const text = item.str;
        if (!text || !text.trim()) continue;
        const transform = item.transform ?? [1, 0, 0, 10, 0, 0];
        const x = Number(transform[4] ?? 0);
        const y = Number(transform[5] ?? 0);
        const height = Math.abs(Number(item.height || transform[3] || 10));
        const width = Math.abs(Number(item.width || text.length * height * 0.5));
        spans.push({ text, x, y, width, height });
      }

      pages.push({ pageNumber: pageNum, spans });
    }
  } finally {
    await pdfDoc.cleanup();
    await loadingTask.destroy();
  }

  return pages;
}

/**
 * High-level browser helper: reads a PDF File locally and parses its bank transactions.
 */
export async function parsePdfStatementFile(
  file: File,
  displayPath: string,
  options: PdfParseOptions = {}
): Promise<ParsedStatementResult> {
  try {
    const buffer = await file.arrayBuffer();
    const pages = await extractPdfPagesFromBuffer(buffer);
    return parsePdfStatementPages(pages, displayPath, options);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/password/i.test(message)) {
      return {
        transactions: [],
        warnings: [
          'This PDF is password-protected. Please unlock/print-to-PDF without a password or export CSV/OFX from your bank.',
        ],
      };
    }
    return {
      transactions: [],
      warnings: [
        'Unable to read this PDF file locally. Ensure it is a valid text-based bank statement PDF or export CSV/OFX from your bank.',
      ],
    };
  }
}
