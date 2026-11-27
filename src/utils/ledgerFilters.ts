import {
  CATEGORIES,
  CURRENCY_CONFIG,
  formatMoney,
  getTransactionDisplayAmount,
  type CurrencyCode,
  type ExchangeRateTable,
  type SmartTagMatch,
  type Transaction,
} from '../types/finance';

export const STARTER_TRANSACTION_TAGS = [
  'Work',
  'Reimbursable',
  'Holiday',
  'Shared',
  'Review',
] as const;

const MAX_TAG_LENGTH = 28;
const CURRENCY_PREFIX_RE = /^(?:[£$€¥₹]|GBP|USD|EUR|CAD|AUD|CHF|JPY|INR)\s*/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH_RE = /^\d{4}-\d{2}$/;

/**
 * Normalizes a user-entered custom tag label.
 * Trims surrounding whitespace, strips leading '#', collapses spaces, and caps length.
 */
export function normalizeTransactionTag(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/^#+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  return cleaned.slice(0, MAX_TAG_LENGTH).trim();
}

/**
 * Adds one or more comma-separated tags to a transaction's tag list (case-insensitive dedupe).
 */
export function mergeTransactionTags(
  existing: string[] | undefined,
  rawInput: string
): string[] {
  const current = (existing ?? []).map(normalizeTransactionTag).filter(Boolean);
  const seen = new Set(current.map((t) => t.toLowerCase()));
  const next = [...current];

  for (const part of rawInput.split(',')) {
    const tag = normalizeTransactionTag(part);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      next.push(tag);
    }
  }
  return next;
}

/**
 * Removes a tag from a transaction's tag list (case-insensitive match).
 */
export function removeTransactionTag(
  existing: string[] | undefined,
  tagToRemove: string
): string[] {
  const target = normalizeTransactionTag(tagToRemove).toLowerCase();
  return (existing ?? []).filter((t) => t.toLowerCase() !== target);
}

export interface ParsedAmountFilter {
  op: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'between';
  min?: number;
  max?: number;
  value?: number;
}

export interface ParsedLedgerSearch {
  raw: string;
  textTerms: string[];
  tagTerms: string[];
  dateFrom: string | null;
  dateTo: string | null;
  amountFilters: ParsedAmountFilter[];
}

function parseNumericAmount(token: string): number | null {
  const stripped = token.replace(CURRENCY_PREFIX_RE, '').replace(/,/g, '').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(stripped)) return null;
  const num = Number(stripped);
  return Number.isFinite(num) ? num : null;
}

function expandStartDate(raw: string): string | null {
  if (ISO_DATE_RE.test(raw)) return raw;
  if (ISO_MONTH_RE.test(raw)) return `${raw}-01`;
  return null;
}

function expandEndDate(raw: string): string | null {
  if (ISO_DATE_RE.test(raw)) return raw;
  if (ISO_MONTH_RE.test(raw)) return `${raw}-31`;
  return null;
}

/**
 * Tokenizes a search string while respecting quoted phrases (e.g. `"coffee shop"`).
 */
function tokenizeSearch(raw: string): string[] {
  const tokens: string[] = [];
  const regex = /"([^"]+)"|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw)) !== null) {
    const token = (match[1] ?? match[2] ?? '').trim();
    if (token) tokens.push(token);
  }
  return tokens;
}

/**
 * Parses structured ledger search queries supporting:
 * - Merchant / description / category / account text terms
 * - Custom tags: `#work`, `tag:holiday`
 * - Date & date ranges: `2026-10-01..2026-10-31`, `2026-09..2026-10`, `from:2026-10-01`, `to:2026-10-31`, `2026-10-15`, `2026-10`
 * - Amount & amount ranges: `>50`, `>=100`, `<20`, `<=15.50`, `=42.50`, `25..80`, `£25-80`, `£42.50`
 */
export function parseLedgerSearchQuery(rawQuery: string): ParsedLedgerSearch {
  const raw = rawQuery.trim();
  const result: ParsedLedgerSearch = {
    raw,
    textTerms: [],
    tagTerms: [],
    dateFrom: null,
    dateTo: null,
    amountFilters: [],
  };

  if (!raw) return result;

  // Normalize "YYYY-MM-DD to YYYY-MM-DD" or "YYYY-MM to YYYY-MM" into "A..B"
  const normalized = raw.replace(
    /\b(\d{4}-\d{2}(?:-\d{2})?)\s+to\s+(\d{4}-\d{2}(?:-\d{2})?)\b/gi,
    '$1..$2'
  );

  const tokens = tokenizeSearch(normalized);

  for (const token of tokens) {
    // 1. Explicit custom tag: #tag or tag:label
    if (token.startsWith('#') && token.length > 1) {
      const tag = normalizeTransactionTag(token);
      if (tag) {
        result.tagTerms.push(tag.toLowerCase());
        continue;
      }
    }
    const tagPrefixMatch = /^tag:(.+)$/i.exec(token);
    if (tagPrefixMatch) {
      const tag = normalizeTransactionTag(tagPrefixMatch[1]);
      if (tag) {
        result.tagTerms.push(tag.toLowerCase());
        continue;
      }
    }

    // 2. Date range: YYYY-MM-DD..YYYY-MM-DD or YYYY-MM..YYYY-MM
    const dateRangeMatch = /^(\d{4}-\d{2}(?:-\d{2})?)\.\.(\d{4}-\d{2}(?:-\d{2})?)$/.exec(token);
    if (dateRangeMatch) {
      const start = expandStartDate(dateRangeMatch[1]);
      const end = expandEndDate(dateRangeMatch[2]);
      if (start && end) {
        const [orderedStart, orderedEnd] = start <= end ? [start, end] : [end, start];
        result.dateFrom =
          result.dateFrom && result.dateFrom > orderedStart ? result.dateFrom : orderedStart;
        result.dateTo =
          result.dateTo && result.dateTo < orderedEnd ? result.dateTo : orderedEnd;
        continue;
      }
    }

    // 3. Date bounds: from:/after:/since: and to:/before:/until:
    const dateFromMatch = /^(?:from|after|since):(\d{4}-\d{2}(?:-\d{2})?)$/i.exec(token);
    if (dateFromMatch) {
      const start = expandStartDate(dateFromMatch[1]);
      if (start) {
        result.dateFrom = result.dateFrom && result.dateFrom > start ? result.dateFrom : start;
        continue;
      }
    }
    const dateToMatch = /^(?:to|before|until):(\d{4}-\d{2}(?:-\d{2})?)$/i.exec(token);
    if (dateToMatch) {
      const end = expandEndDate(dateToMatch[1]);
      if (end) {
        result.dateTo = result.dateTo && result.dateTo < end ? result.dateTo : end;
        continue;
      }
    }

    // 4. Standalone ISO date or month: 2026-10-15 or 2026-10
    if (ISO_DATE_RE.test(token) || ISO_MONTH_RE.test(token)) {
      const start = expandStartDate(token);
      const end = expandEndDate(token);
      if (start && end) {
        result.dateFrom = result.dateFrom && result.dateFrom > start ? result.dateFrom : start;
        result.dateTo = result.dateTo && result.dateTo < end ? result.dateTo : end;
        continue;
      }
    }

    // 5. Amount comparators: >50, >=50, <20, <=20, =42.50 (optional currency symbol)
    const compMatch = /^(>=|<=|>|<|=)(.+)$/.exec(token);
    if (compMatch) {
      const num = parseNumericAmount(compMatch[2]);
      if (num !== null) {
        const opMap: Record<string, ParsedAmountFilter['op']> = {
          '>': 'gt',
          '>=': 'gte',
          '<': 'lt',
          '<=': 'lte',
          '=': 'eq',
        };
        result.amountFilters.push({ op: opMap[compMatch[1]], value: num });
        continue;
      }
    }

    // 6. Amount range: 25..80, £25..£80, 25-80, £25-£80
    const amtRangeMatch = /^([^\s.]+)(?:\.\.|-)([^\s.]+)$/.exec(token);
    if (amtRangeMatch && !token.includes('--')) {
      const a = parseNumericAmount(amtRangeMatch[1]);
      const b = parseNumericAmount(amtRangeMatch[2]);
      if (a !== null && b !== null) {
        result.amountFilters.push({
          op: 'between',
          min: Math.min(a, b),
          max: Math.max(a, b),
        });
        continue;
      }
    }

    // 7. Explicit currency-prefixed exact amount: £42.50, $19.99
    if (CURRENCY_PREFIX_RE.test(token)) {
      const exactNum = parseNumericAmount(token);
      if (exactNum !== null) {
        result.amountFilters.push({ op: 'eq', value: exactNum });
        continue;
      }
    }

    // 8. Default text term (matches merchant, description, category, account, tags, date, formatted amount)
    result.textTerms.push(token.toLowerCase());
  }

  return result;
}

function matchesAmountFilter(
  absDisplayAmount: number,
  absNativeAmount: number,
  filter: ParsedAmountFilter
): boolean {
  const check = (amt: number): boolean => {
    switch (filter.op) {
      case 'gt':
        return amt > (filter.value ?? 0);
      case 'gte':
        return amt >= (filter.value ?? 0);
      case 'lt':
        return amt < (filter.value ?? 0);
      case 'lte':
        return amt <= (filter.value ?? 0);
      case 'eq':
        return Math.abs(amt - (filter.value ?? 0)) < 0.005;
      case 'between':
        return amt >= (filter.min ?? 0) && amt <= (filter.max ?? Number.POSITIVE_INFINITY);
      default:
        return true;
    }
  };
  return check(absDisplayAmount) || check(absNativeAmount);
}

/**
 * Evaluates whether a single transaction satisfies a parsed ledger search query.
 */
export function matchesLedgerSearch(
  tx: Transaction,
  parsed: ParsedLedgerSearch,
  displayCurrency: CurrencyCode,
  exchangeRates?: Partial<ExchangeRateTable>,
  txSmartTags: SmartTagMatch[] = []
): boolean {
  if (!parsed.raw) return true;

  if (parsed.dateFrom && tx.date < parsed.dateFrom) return false;
  if (parsed.dateTo && tx.date > parsed.dateTo) return false;

  const absDisplay = Math.abs(getTransactionDisplayAmount(tx, displayCurrency, exchangeRates));
  const absNative = Math.abs(tx.amount);

  for (const af of parsed.amountFilters) {
    if (!matchesAmountFilter(absDisplay, absNative, af)) return false;
  }

  const customTags = tx.tags ?? [];
  if (parsed.tagTerms.length > 0) {
    const lowerTags = customTags.map((t) => t.toLowerCase());
    for (const requiredTag of parsed.tagTerms) {
      if (!lowerTags.some((t) => t.includes(requiredTag))) return false;
    }
  }

  if (parsed.textTerms.length > 0) {
    const txCurr = tx.currency ?? displayCurrency;
    const smartText = txSmartTags.map((t) => `${t.label} ${t.reason}`).join(' ');
    const customTagText = customTags.join(' ');
    const amountStrings = [
      absNative.toFixed(2),
      String(absNative),
      absDisplay.toFixed(2),
      formatMoney(absDisplay, displayCurrency, 2),
      formatMoney(absNative, txCurr, 2),
    ].join(' ');
    const hay = `${tx.merchant} ${tx.description} ${tx.date} ${CATEGORIES[tx.category].label} ${tx.accountName} ${txCurr} ${tx.notes ?? ''} ${smartText} ${customTagText} ${amountStrings}`.toLowerCase();

    for (const term of parsed.textTerms) {
      if (!hay.includes(term)) return false;
    }
  }

  return true;
}

/**
 * Produces concise badges describing structured tokens recognized in the search bar.
 */
export function describeParsedSearchFilters(
  parsed: ParsedLedgerSearch,
  displayCurrency: CurrencyCode
): string[] {
  const badges: string[] = [];
  const sym = CURRENCY_CONFIG[displayCurrency].symbol;

  if (parsed.dateFrom && parsed.dateTo) {
    badges.push(
      parsed.dateFrom === parsed.dateTo
        ? `Date: ${parsed.dateFrom}`
        : `Dates: ${parsed.dateFrom} → ${parsed.dateTo}`
    );
  } else if (parsed.dateFrom) {
    badges.push(`From: ${parsed.dateFrom}`);
  } else if (parsed.dateTo) {
    badges.push(`To: ${parsed.dateTo}`);
  }

  for (const af of parsed.amountFilters) {
    if (af.op === 'between' && af.min !== undefined && af.max !== undefined) {
      badges.push(`Amount: ${sym}${af.min}–${sym}${af.max}`);
    } else if (af.value !== undefined) {
      const opSymbol =
        af.op === 'gt'
          ? '>'
          : af.op === 'gte'
            ? '≥'
            : af.op === 'lt'
              ? '<'
              : af.op === 'lte'
                ? '≤'
                : '=';
      badges.push(`Amount ${opSymbol} ${sym}${af.value}`);
    }
  }

  for (const tag of parsed.tagTerms) {
    badges.push(`#${tag}`);
  }

  return badges;
}

export interface BatchTransactionUpdate {
  category?: Transaction['category'];
  spendingClass?: Transaction['spendingClass'];
  addTag?: string;
  removeTag?: string;
}

/**
 * Applies a batch category and/or tag update to all transactions whose IDs are in `selectedIds`.
 */
export function applyBatchTransactionUpdate(
  transactions: Transaction[],
  selectedIds: Set<string>,
  update: BatchTransactionUpdate
): { transactions: Transaction[]; updatedCount: number } {
  if (selectedIds.size === 0) {
    return { transactions, updatedCount: 0 };
  }

  const normalizedAdd = update.addTag ? normalizeTransactionTag(update.addTag) : '';
  const normalizedRemove = update.removeTag ? normalizeTransactionTag(update.removeTag) : '';
  const hasCategory = Boolean(update.category);
  const hasAddTag = Boolean(normalizedAdd);
  const hasRemoveTag = Boolean(normalizedRemove);

  if (!hasCategory && !hasAddTag && !hasRemoveTag) {
    return { transactions, updatedCount: 0 };
  }

  let updatedCount = 0;
  const nextTransactions = transactions.map((tx) => {
    if (!selectedIds.has(tx.id)) return tx;

    let changed = false;
    let nextTx: Transaction = tx;

    if (update.category) {
      const nextClass = update.spendingClass ?? CATEGORIES[update.category].defaultClass;
      if (tx.category !== update.category || tx.spendingClass !== nextClass) {
        nextTx = { ...nextTx, category: update.category, spendingClass: nextClass };
        changed = true;
      }
    }

    if (hasAddTag) {
      const merged = mergeTransactionTags(nextTx.tags, normalizedAdd);
      const prev = nextTx.tags ?? [];
      if (merged.length !== prev.length || merged.some((t, i) => t !== prev[i])) {
        nextTx = { ...nextTx, tags: merged };
        changed = true;
      }
    }

    if (hasRemoveTag) {
      const afterRemove = removeTransactionTag(nextTx.tags, normalizedRemove);
      const prev = nextTx.tags ?? [];
      if (afterRemove.length !== prev.length) {
        nextTx = {
          ...nextTx,
          tags: afterRemove.length > 0 ? afterRemove : undefined,
        };
        changed = true;
      }
    }

    if (changed) updatedCount += 1;
    return nextTx;
  });

  return { transactions: nextTransactions, updatedCount };
}

