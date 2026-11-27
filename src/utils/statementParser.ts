import {
  CATEGORIES,
  CURRENCY_CONFIG,
  getTransactionDisplayAmount,
  type CategoryId,
  type CurrencyCode,
  type ExchangeRateTable,
  type SmartTagMatch,
  type SpendingClass,
  type Transaction,
} from '../types/finance';

const VALID_CURRENCIES = new Set<string>(Object.keys(CURRENCY_CONFIG));

function parseCurrencyCode(raw: string | undefined): CurrencyCode | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim().toUpperCase();
  if (VALID_CURRENCIES.has(trimmed)) return trimmed as CurrencyCode;
  if (trimmed.includes('£') || /\bGBP\b/.test(trimmed)) return 'GBP';
  if (trimmed.includes('€') || /\bEUR\b/.test(trimmed)) return 'EUR';
  if (trimmed.includes('C$') || /\bCAD\b/.test(trimmed)) return 'CAD';
  if (trimmed.includes('A$') || /\bAUD\b/.test(trimmed)) return 'AUD';
  if (/\bCHF\b/.test(trimmed)) return 'CHF';
  if (trimmed.includes('¥') || /\bJPY\b/.test(trimmed)) return 'JPY';
  if (trimmed.includes('$') || /\bUSD\b/.test(trimmed)) return 'USD';
  return undefined;
}

interface MerchantRule {
  pattern: RegExp;
  category: CategoryId;
  spendingClass: SpendingClass;
  canonicalMerchant?: string;
}

const CLASSIFICATION_RULES: MerchantRule[] = [
  // Income
  { pattern: /\b(salary|payroll|bacs credit|employer|wages|monthly pay|hmrc refund)\b/i, category: 'salary_income', spendingClass: 'income' },
  { pattern: /\b(dividend|interest credit|cashback|refund|freelance|invoice paid)\b/i, category: 'other_income', spendingClass: 'income' },

  // Savings / ISA Transfers
  { pattern: /\b(cash isa|lifetime isa|lisa|vanguard|trading 212|hargreaves|monzo pot|marcus|chip savings|ns&i|premium bonds|savings transfer|isa deposit)\b/i, category: 'savings_investment', spendingClass: 'savings' },

  // Essential: Housing
  { pattern: /\b(mortgage|nationwide|halifax mortgage|rent|letting|estate agent|council tax|service charge|ground rent)\b/i, category: 'housing', spendingClass: 'essential' },

  // Essential: Utilities
  { pattern: /\b(octopus energy|british gas|edf energy|ovo energy|bulb|thames water|severn trent|united utilities|virgin media|bt broadband|sky broadband|hyperoptic|vodafone|ee limited|o2|three uk|giffgaff)\b/i, category: 'utilities', spendingClass: 'essential' },

  // Essential: Groceries
  { pattern: /\b(tesco|sainsbury|waitrose|aldi|lidl|asda|morrisons|ocado|m&s food|co-op|coop food|iceland|whole foods|trader joe|costco)\b/i, category: 'groceries', spendingClass: 'essential' },

  // Essential: Transport
  { pattern: /\b(tfl|transport for london|trainline|national rail|lner|gwr|shell|bp fuel|esso|texaco|petrol|parking|congestion charge|dvla|mot test|uber trip)\b/i, category: 'transport', spendingClass: 'essential' },

  // Essential: Insurance & Health
  { pattern: /\b(aviva|admiral|direct line|axa|bupa|boots pharmacy|superdrug|nhs|dentist|optician|specsavers|pet insurance|life insurance)\b/i, category: 'insurance_health', spendingClass: 'essential' },

  // Non-Essential: Subscriptions
  { pattern: /\b(netflix|spotify|disney\+|disney plus|apple\.com\/bill|apple one|amazon prime|prime video|youtube premium|icloud|puregym|virgin active|david lloyd|nuffield|peloton|audible|nyt|guardian|chatgpt|adobe|dropbox|sky tv|now tv|playstation|xbox)\b/i, category: 'subscriptions', spendingClass: 'non-essential' },

  // Non-Essential: Dining & Takeaways
  { pattern: /\b(deliveroo|uber eats|ubereats|just eat|justeat|nando|wagamama|dishoom|pizza express|domino|five guys|mcdonald|kfc|burger king|gourmet|restaurant|bistro|pub|wetherspoon|honest burger|franco manca|itsu|leon)\b/i, category: 'dining_takeaway', spendingClass: 'non-essential' },

  // Non-Essential: Coffee & Convenience
  { pattern: /\b(pret a manger|pret|costa coffee|starbucks|caffe nero|gail's|gails|greggs|blank street|joe & the juice|whsmith|tesco express|sainsburys local)\b/i, category: 'coffee_convenience', spendingClass: 'non-essential' },

  // Non-Essential: Online Retail & Apparel
  { pattern: /\b(amazon|amzn|asos|zara|uniqlo|h&m|john lewis|argos|currys|ikea|next retail|nike|adidas|apple store|selfridges|etsy|ebay|sephora|tk maxx|primark)\b/i, category: 'shopping_retail', spendingClass: 'non-essential' },

  // Non-Essential: Entertainment & Leisure
  { pattern: /\b(odeon|vue cinema|everyman|ticketmaster|dice fm|eventbrite|bowling|theatre|bar |cocktail|wine shop|majestic wine|steam games|nintendo|waterstones)\b/i, category: 'entertainment_leisure', spendingClass: 'non-essential' },

  // Non-Essential: Travel
  { pattern: /\b(british airways|easyjet|ryanair|eurostar|airbnb|booking\.com|premier inn|hilton|marriott|expedia|hotel|flight|jet2)\b/i, category: 'travel_holidays', spendingClass: 'non-essential' },
];

export function cleanMerchantName(raw: string): string {
  let cleaned = raw
    .replace(/\b(card payment to|direct debit to|faster payment to|vis purchase|pos|contactless|gbp|london|gb|uk)\b/gi, ' ')
    .replace(/\b\d{4,}\b/g, ' ')
    .replace(/[*#_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) cleaned = raw.trim() || 'Unknown Merchant';

  // Normalize common merchant variants
  if (/amzn|amazon\.co\.uk|amazon mktplace/i.test(raw)) return 'Amazon';
  if (/deliveroo/i.test(raw)) return 'Deliveroo';
  if (/uber\s*eats/i.test(raw)) return 'Uber Eats';
  if (/just\s*eat/i.test(raw)) return 'Just Eat';
  if (/pret/i.test(raw)) return 'Pret A Manger';
  if (/costa/i.test(raw)) return 'Costa Coffee';
  if (/starbucks/i.test(raw)) return 'Starbucks';
  if (/netflix/i.test(raw)) return 'Netflix';
  if (/spotify/i.test(raw)) return 'Spotify';
  if (/disney/i.test(raw)) return 'Disney+';
  if (/apple\.com\/bill|apple one/i.test(raw)) return 'Apple One';
  if (/prime video|amazon prime/i.test(raw)) return 'Amazon Prime';
  if (/octopus energy/i.test(raw)) return 'Octopus Energy';
  if (/virgin media/i.test(raw)) return 'Virgin Media Broadband';
  if (/puregym/i.test(raw)) return 'PureGym';
  if (/david lloyd/i.test(raw)) return 'David Lloyd Club';
  if (/tesco express/i.test(raw)) return 'Tesco Express';
  if (/tesco/i.test(raw)) return 'Tesco';
  if (/sainsbury/i.test(raw)) return "Sainsbury's";
  if (/waitrose/i.test(raw)) return 'Waitrose';
  if (/aldi/i.test(raw)) return 'Aldi';
  if (/tfl|transport for london/i.test(raw)) return 'TfL Travel';

  // Title case if all caps
  if (cleaned === cleaned.toUpperCase() && cleaned.length > 3) {
    cleaned = cleaned
      .toLowerCase()
      .replace(/\b\w/g, (ch) => ch.toUpperCase());
  }
  return cleaned.slice(0, 42);
}

export function classifyTransaction(
  description: string,
  amount: number
): { category: CategoryId; spendingClass: SpendingClass; merchant: string } {
  const merchant = cleanMerchantName(description);

  for (const rule of CLASSIFICATION_RULES) {
    if (rule.pattern.test(description) || rule.pattern.test(merchant)) {
      // Ensure positive values only map to income unless explicit savings
      if (amount > 0 && rule.spendingClass !== 'income') {
        return { category: 'other_income', spendingClass: 'income', merchant };
      }
      return {
        category: rule.category,
        spendingClass: rule.spendingClass,
        merchant: rule.canonicalMerchant ?? merchant,
      };
    }
  }

  if (amount > 0) {
    return { category: 'other_income', spendingClass: 'income', merchant };
  }

  return {
    category: 'other_discretionary',
    spendingClass: CATEGORIES.other_discretionary.defaultClass,
    merchant,
  };
}

function parseFlexibleDate(raw: string): string | null {
  const s = raw.trim().replace(/['"]/g, '');
  if (!s) return null;

  // YYYY-MM-DD or YYYY/MM/DD
  const iso = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  }

  // DD/MM/YYYY or DD-MM-YYYY (UK standard default when ambiguous)
  const dmy = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (dmy) {
    const a = parseInt(dmy[1], 10);
    const b = parseInt(dmy[2], 10);
    let year = parseInt(dmy[3], 10);
    if (year < 100) year += 2000;
    // If second number > 12, assume MM/DD/YYYY
    const day = b > 12 ? b : a;
    const month = b > 12 ? a : b;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  // OFX YYYYMMDD
  const ofx = s.match(/^(\d{4})(\d{2})(\d{2})/);
  if (ofx) {
    return `${ofx[1]}-${ofx[2]}-${ofx[3]}`;
  }

  // Natural date e.g. "14 Mar 2026"
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return null;
}

function parseMoneyNumber(raw: string | undefined): number {
  if (!raw) return 0;
  const cleaned = raw
    .trim()
    .replace(/[£$€,\s]/g, '')
    .replace(/^\((.+)\)$/, '-$1');
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? num : 0;
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

export function buildDedupKey(
  tx: Pick<Transaction, 'date' | 'description' | 'amount' | 'currency'>
): string {
  return `${tx.date}|${tx.description.toLowerCase().trim()}|${tx.amount.toFixed(2)}|${tx.currency ?? ''}`;
}

export interface ParsedStatementResult {
  transactions: Transaction[];
  warnings: string[];
}

export function parseStatementContent(
  content: string,
  fileName: string
): ParsedStatementResult {
  const lower = fileName.toLowerCase();
  const warnings: string[] = [];

  if (lower.endsWith('.ofx') || lower.endsWith('.qfx') || content.includes('<STMTTRN>')) {
    return parseOfx(content, fileName);
  }

  if (lower.endsWith('.json')) {
    try {
      const parsed = JSON.parse(content);
      const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed.transactions) ? parsed.transactions : [];
      const transactions: Transaction[] = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const date = parseFlexibleDate(String(r.date ?? r.Date ?? ''));
        const description = String(r.description ?? r.Description ?? r.merchant ?? r.name ?? '').trim();
        const rawAmt = String(r.amount ?? r.Amount ?? 0);
        const amount = typeof r.amount === 'number' ? r.amount : parseMoneyNumber(rawAmt);
        if (!date || !description || amount === 0) continue;
        const classified = classifyTransaction(description, amount);
        const detectedCurrency =
          parseCurrencyCode(String(r.currency ?? r.Currency ?? '')) ??
          parseCurrencyCode(rawAmt);
        transactions.push({
          id: `imp-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
          date,
          description,
          merchant: r.merchant ? String(r.merchant) : classified.merchant,
          amount,
          ...(detectedCurrency ? { currency: detectedCurrency } : {}),
          category: (r.category && r.category in CATEGORIES ? r.category : classified.category) as CategoryId,
          spendingClass: r.spendingClass ?? classified.spendingClass,
          accountName: r.accountName ? String(r.accountName) : fileName.replace(/\.[^.]+$/, ''),
          sourceFile: fileName,
        });
      }
      return { transactions, warnings };
    } catch {
      return { transactions: [], warnings: ['Could not parse JSON file. Ensure it contains a transaction array.'] };
    }
  }

  // CSV / TSV parsing
  const lines = content
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l) => l.trim().length > 0);

  if (lines.length < 2) {
    return { transactions: [], warnings: ['File has fewer than 2 lines. Expected a header row and transactions.'] };
  }

  const headerLine = lines[0];
  const commaCount = (headerLine.match(/,/g) ?? []).length;
  const semiCount = (headerLine.match(/;/g) ?? []).length;
  const tabCount = (headerLine.match(/\t/g) ?? []).length;
  const delimiter = tabCount > commaCount && tabCount > semiCount ? '\t' : semiCount > commaCount ? ';' : ',';

  const headers = parseCsvLine(headerLine, delimiter).map((h) => h.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim());

  const dateIdx = headers.findIndex((h) => /(date|posted|completed|time)/.test(h));
  const descIdx = headers.findIndex((h) => /(description|merchant|name|payee|memo|details|narrative|reference)/.test(h));
  const amountIdx = headers.findIndex((h) => /(amount|value|total|net)/.test(h));
  const debitIdx = headers.findIndex((h) => /(debit|money out|paid out|withdrawal|outflow|spent)/.test(h));
  const creditIdx = headers.findIndex((h) => /(credit|money in|paid in|deposit|inflow)/.test(h));
  const typeIdx = headers.findIndex((h) => /^(type|dr cr|direction)$/.test(h));
  const accountIdx = headers.findIndex((h) => /(account|bank|card)/.test(h));
  const currencyIdx = headers.findIndex((h) => /(currency|ccy|curr)/.test(h));

  if (dateIdx === -1 || (amountIdx === -1 && debitIdx === -1 && creditIdx === -1)) {
    warnings.push('Could not auto-detect Date and Amount/Debit/Credit columns. Check your CSV header row.');
    return { transactions: [], warnings };
  }

  const transactions: Transaction[] = [];
  const defaultAccount = fileName.replace(/\.[^.]+$/, '');
  const fileCurrencyHint = parseCurrencyCode(fileName);

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i], delimiter);
    const date = parseFlexibleDate(cols[dateIdx] ?? '');
    if (!date) continue;

    const description = (descIdx !== -1 ? cols[descIdx] : cols.find((_, idx) => idx !== dateIdx && idx !== amountIdx)) ?? 'Bank Transaction';
    let amount = 0;
    let rawMoneyCell = '';

    if (debitIdx !== -1 || creditIdx !== -1) {
      const debit = debitIdx !== -1 ? Math.abs(parseMoneyNumber(cols[debitIdx])) : 0;
      const credit = creditIdx !== -1 ? Math.abs(parseMoneyNumber(cols[creditIdx])) : 0;
      rawMoneyCell = `${cols[debitIdx] ?? ''} ${cols[creditIdx] ?? ''}`;
      amount = credit - debit;
    } else if (amountIdx !== -1) {
      rawMoneyCell = cols[amountIdx] ?? '';
      amount = parseMoneyNumber(rawMoneyCell);
      if (typeIdx !== -1) {
        const typeVal = (cols[typeIdx] ?? '').toLowerCase();
        if (/^(debit|dr|out|expense)$/.test(typeVal) && amount > 0) {
          amount = -amount;
        }
      }
    }

    if (amount === 0) continue;

    const detectedCurrency =
      (currencyIdx !== -1 ? parseCurrencyCode(cols[currencyIdx]) : undefined) ??
      parseCurrencyCode(rawMoneyCell) ??
      fileCurrencyHint;

    const classified = classifyTransaction(description, amount);
    transactions.push({
      id: `csv-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      date,
      description: description.trim(),
      merchant: classified.merchant,
      amount: Math.round(amount * 100) / 100,
      ...(detectedCurrency ? { currency: detectedCurrency } : {}),
      category: classified.category,
      spendingClass: classified.spendingClass,
      accountName: accountIdx !== -1 && cols[accountIdx] ? cols[accountIdx] : defaultAccount,
      sourceFile: fileName,
    });
  }

  if (transactions.length === 0) {
    warnings.push('No valid transaction rows could be extracted from this file.');
  }

  return { transactions, warnings };
}

function parseOfx(content: string, fileName: string): ParsedStatementResult {
  const curDefMatch = content.match(/<CURDEF>([^<\r\n]+)/i);
  const fileCurrency = parseCurrencyCode(curDefMatch?.[1]);
  const blocks = content.split(/<STMTTRN>/i).slice(1);
  const transactions: Transaction[] = [];
  const defaultAccount = fileName.replace(/\.[^.]+$/, '');

  blocks.forEach((block, i) => {
    const dtMatch = block.match(/<DTPOSTED>([^<\r\n]+)/i);
    const amtMatch = block.match(/<TRNAMT>([^<\r\n]+)/i);
    const nameMatch = block.match(/<NAME>([^<\r\n]+)/i);
    const memoMatch = block.match(/<MEMO>([^<\r\n]+)/i);
    const curMatch = block.match(/<CURSYM>([^<\r\n]+)/i);

    const date = dtMatch ? parseFlexibleDate(dtMatch[1].trim()) : null;
    const amount = amtMatch ? parseMoneyNumber(amtMatch[1]) : 0;
    const description = [nameMatch?.[1]?.trim(), memoMatch?.[1]?.trim()].filter(Boolean).join(' - ') || 'OFX Entry';
    const txCurrency = parseCurrencyCode(curMatch?.[1]) ?? fileCurrency;

    if (!date || amount === 0) return;
    const classified = classifyTransaction(description, amount);
    transactions.push({
      id: `ofx-${Date.now()}-${i}`,
      date,
      description,
      merchant: classified.merchant,
      amount: Math.round(amount * 100) / 100,
      ...(txCurrency ? { currency: txCurrency } : {}),
      category: classified.category,
      spendingClass: classified.spendingClass,
      accountName: defaultAccount,
      sourceFile: fileName,
    });
  });

  return {
    transactions,
    warnings: transactions.length === 0 ? ['No <STMTTRN> transactions found in OFX file.'] : [],
  };
}

function escapeCsvText(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export interface CsvExportOptions {
  exchangeRates?: Partial<ExchangeRateTable>;
  smartTagsByTxId?: Record<string, SmartTagMatch[]>;
}

export function exportTransactionsToCsv(
  transactions: Transaction[],
  defaultCurrency: CurrencyCode = 'GBP',
  options: CsvExportOptions = {}
): string {
  const { exchangeRates, smartTagsByTxId } = options;
  const header = [
    'Date',
    'Merchant',
    'Description',
    'Amount',
    'Currency',
    `DisplayAmount (${defaultCurrency})`,
    'Category',
    'Classification',
    'SmartTags',
    'CustomTags',
    'Account',
    'SourceFile',
    'Notes',
  ].join(',');

  const rows = transactions
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((tx) => {
      const merchant = escapeCsvText(tx.merchant);
      const desc = escapeCsvText(tx.description);
      const catLabel = escapeCsvText(CATEGORIES[tx.category]?.label ?? tx.category);
      const acc = escapeCsvText(tx.accountName);
      const source = escapeCsvText(tx.sourceFile ?? '');
      const notes = escapeCsvText(tx.notes ?? '');
      const ccy = tx.currency ?? defaultCurrency;
      const displayAmt = getTransactionDisplayAmount(tx, defaultCurrency, exchangeRates);
      const tagMatches = smartTagsByTxId?.[tx.id] ?? [];
      const smartTags = escapeCsvText(tagMatches.map((t) => t.label).join('; '));
      const customTags = escapeCsvText((tx.tags ?? []).join('; '));
      return [
        tx.date,
        merchant,
        desc,
        tx.amount.toFixed(2),
        ccy,
        displayAmt.toFixed(2),
        catLabel,
        tx.spendingClass,
        smartTags,
        customTags,
        acc,
        source,
        notes,
      ].join(',');
    });
  // Prefix UTF-8 BOM + CRLF so Windows Excel and Google Sheets render currency symbols cleanly
  return `\uFEFF${[header, ...rows].join('\r\n')}`;
}

export function downloadTransactionsCsv(
  transactions: Transaction[],
  defaultCurrency: CurrencyCode = 'GBP',
  filePrefix = 'ledger',
  options: CsvExportOptions = {}
): string {
  const csv = exportTransactionsToCsv(transactions, defaultCurrency, options);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const safePrefix = filePrefix.replace(/[^a-zA-Z0-9_-]/g, '_');
  const fileName = `clearledger_${safePrefix}_${new Date().toISOString().slice(0, 10)}.csv`;
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return fileName;
}
