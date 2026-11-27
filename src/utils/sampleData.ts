import {
  DEFAULT_EXCHANGE_RATES,
  type AdvancedAutomationRule,
  type CategoryRule,
  type CurrencyCode,
  type DebtAccount,
  type IsaPlannerSettings,
  type PersonalPlannerState,
  type SavingsGoal,
  type StatementImportMeta,
  type Transaction,
  type VaultPayload,
} from '../types/finance';

// Deterministic PRNG so the 14-month statement ledger is crisp, repeatable, and realistic
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function generateSample14MonthData(): VaultPayload {
  const rand = mulberry32(20261126);
  const transactions: Transaction[] = [];
  let seq = 1;

  // Generate 14 full months: Oct 2025 through Nov 2026
  const months: Array<{ year: number; month: number }> = [
    { year: 2025, month: 10 },
    { year: 2025, month: 11 },
    { year: 2025, month: 12 },
    { year: 2026, month: 1 },
    { year: 2026, month: 2 },
    { year: 2026, month: 3 },
    { year: 2026, month: 4 },
    { year: 2026, month: 5 },
    { year: 2026, month: 6 },
    { year: 2026, month: 7 },
    { year: 2026, month: 8 },
    { year: 2026, month: 9 },
    { year: 2026, month: 10 },
    { year: 2026, month: 11 },
  ];

  const pushTx = (
    year: number,
    month: number,
    day: number,
    description: string,
    merchant: string,
    amount: number,
    category: Transaction['category'],
    spendingClass: Transaction['spendingClass'],
    accountName = 'Current Account',
    isRecurring = false,
    currency: CurrencyCode = 'GBP'
  ) => {
    const safeDay = Math.min(day, 28);
    transactions.push({
      id: `sample-${seq++}`,
      date: `${year}-${pad2(month)}-${pad2(safeDay)}`,
      description,
      merchant,
      amount: Math.round(amount * 100) / 100,
      currency,
      category,
      spendingClass,
      accountName,
      sourceFile:
        currency === 'GBP'
          ? 'Barclays_Current_Oct2025_Nov2026.csv'
          : `Wise_MultiCurrency_${currency}_2026.csv`,
      importBatchId:
        currency === 'GBP'
          ? 'sample-import-barclays'
          : currency === 'EUR'
            ? 'sample-import-wise-eur'
            : 'sample-import-wise-usd',
      isRecurring,
    });
  };

  months.forEach(({ year, month }, mIdx) => {
    // 1. Salary (net £3,920 rising to £4,080 in April 2026)
    const salary = mIdx >= 6 ? 4080 : 3920;
    pushTx(year, month, 25, 'BACS CREDIT - NORTHBRIDGE SYSTEMS PAYROLL', 'Northbridge Systems', salary, 'salary_income', 'income', 'Current Account', true);

    // 2. Essential Housing
    pushTx(year, month, 1, 'DIRECT DEBIT - NATIONWIDE MORTGAGE', 'Nationwide Mortgage', -1245, 'housing', 'essential', 'Current Account', true);
    pushTx(year, month, 3, 'DIRECT DEBIT - CAMDEN COUNCIL TAX', 'Council Tax', -182, 'housing', 'essential', 'Current Account', true);

    // 3. Essential Utilities (winter heating peak + broadband price hike in May 2026!)
    const isWinter = month === 11 || month === 12 || month === 1 || month === 2;
    const energyCost = isWinter ? -(188 + Math.round(rand() * 34)) : -(118 + Math.round(rand() * 22));
    pushTx(year, month, 6, 'DIRECT DEBIT - OCTOPUS ENERGY LTD', 'Octopus Energy', energyCost, 'utilities', 'essential', 'Current Account', true);
    pushTx(year, month, 8, 'DIRECT DEBIT - THAMES WATER UTILITIES', 'Thames Water', -44, 'utilities', 'essential', 'Current Account', true);
    // Virgin Media jumped from £42 to £64 after contract ended in month 7!
    const broadband = mIdx >= 7 ? -64 : -42;
    pushTx(year, month, 12, 'DIRECT DEBIT - VIRGIN MEDIA BROADBAND', 'Virgin Media Broadband', broadband, 'utilities', 'essential', 'Current Account', true);
    pushTx(year, month, 14, 'DIRECT DEBIT - EE MOBILE CONTRACT', 'EE Mobile', -34, 'utilities', 'essential', 'Current Account', true);

    // 4. Essential Insurance & Health
    pushTx(year, month, 5, 'DIRECT DEBIT - ADMIRAL HOME & CAR INS', 'Admiral Insurance', -68, 'insurance_health', 'essential', 'Current Account', true);
    if (mIdx % 2 === 0) {
      pushTx(year, month, 17, 'CARD PAYMENT - BOOTS PHARMACY', 'Boots Pharmacy', -(19 + rand() * 16), 'insurance_health', 'essential');
    }

    // 5. Essential Groceries (4 weekly shops)
    const grocers = [
      { desc: 'TESCO SUPERSTORE', merch: 'Tesco', base: 86 },
      { desc: 'SAINSBURYS SUPERMARKET', merch: "Sainsbury's", base: 78 },
      { desc: 'ALDI STORES UK', merch: 'Aldi', base: 58 },
      { desc: 'WAITROSE & PARTNERS', merch: 'Waitrose', base: 74 },
    ];
    for (let w = 0; w < 4; w++) {
      const g = grocers[(w + mIdx) % grocers.length];
      const cost = -(g.base + (rand() * 26 - 8));
      pushTx(year, month, 2 + w * 7, `CONTACTLESS - ${g.desc}`, g.merch, cost, 'groceries', 'essential');
    }

    // 6. Essential Transport
    pushTx(year, month, 4, 'TFL TRAVEL CHARGE LONDON', 'TfL Travel', -(72 + rand() * 14), 'transport', 'essential');
    pushTx(year, month, 18, 'TFL TRAVEL CHARGE LONDON', 'TfL Travel', -(68 + rand() * 14), 'transport', 'essential');
    if (mIdx % 2 === 1) {
      pushTx(year, month, 11, 'SHELL SERVICE STATION FUEL', 'Shell Fuel', -(54 + rand() * 15), 'transport', 'essential');
    }

    // 7. Non-Essential Subscriptions (with overlap & price creep!)
    pushTx(year, month, 9, 'CARD PAYMENT - NETFLIX.COM', 'Netflix', mIdx >= 8 ? -17.99 : -15.99, 'subscriptions', 'non-essential', 'Current Account', true);
    pushTx(year, month, 11, 'CARD PAYMENT - SPOTIFY UK', 'Spotify', -11.99, 'subscriptions', 'non-essential', 'Current Account', true);
    pushTx(year, month, 15, 'CARD PAYMENT - DISNEY PLUS', 'Disney+', -10.99, 'subscriptions', 'non-essential', 'Current Account', true);
    pushTx(year, month, 19, 'CARD PAYMENT - APPLE.COM/BILL APPLE ONE', 'Apple One', -18.95, 'subscriptions', 'non-essential', 'Current Account', true);
    pushTx(year, month, 21, 'CARD PAYMENT - AMAZON PRIME MEMBERSHIP', 'Amazon Prime', -8.99, 'subscriptions', 'non-essential', 'Current Account', true);
    pushTx(year, month, 2, 'DIRECT DEBIT - DAVID LLOYD CLUB', 'David Lloyd Club', mIdx >= 6 ? -129 : -118, 'subscriptions', 'non-essential', 'Current Account', true);
    pushTx(year, month, 24, 'DIRECT DEBIT - PUREGYM MEMBERSHIP', 'PureGym', -27.99, 'subscriptions', 'non-essential', 'Current Account', true);

    // 8. Non-Essential Dining & Takeaways (creeping up in recent months!)
    const takeawayCount = mIdx >= 10 ? 7 : 5;
    for (let t = 0; t < takeawayCount; t++) {
      const isDeliveroo = t % 2 === 0;
      const amt = isDeliveroo ? -(28 + rand() * 18) : -(24 + rand() * 16);
      pushTx(
        year,
        month,
        3 + t * 3,
        isDeliveroo ? 'CONTACTLESS - DELIVEROO LONDON' : 'CONTACTLESS - UBER EATS UK',
        isDeliveroo ? 'Deliveroo' : 'Uber Eats',
        amt,
        'dining_takeaway',
        'non-essential'
      );
    }
    pushTx(year, month, 13, 'CARD PAYMENT - DISHOOM SHOREDITCH', 'Dishoom', -(68 + rand() * 26), 'dining_takeaway', 'non-essential');
    pushTx(year, month, 22, 'CARD PAYMENT - FRANCO MANCA PIZZA', 'Franco Manca', -(44 + rand() * 18), 'dining_takeaway', 'non-essential');

    // 9. Non-Essential Coffee & Convenience (frequent small leaks!)
    const coffeeTrips = 11 + Math.floor(rand() * 4);
    for (let c = 0; c < coffeeTrips; c++) {
      const vendors = [
        { desc: 'PRET A MANGER LONDON', merch: 'Pret A Manger', base: 7.4 },
        { desc: 'COSTA COFFEE UK', merch: 'Costa Coffee', base: 5.8 },
        { desc: 'GAILS BAKERY', merch: "GAIL's Bakery", base: 8.6 },
        { desc: 'TESCO EXPRESS LUNCH', merch: 'Tesco Express', base: 9.2 },
      ];
      const v = vendors[(c + mIdx) % vendors.length];
      pushTx(year, month, 1 + ((c * 2) % 27), `CONTACTLESS - ${v.desc}`, v.merch, -(v.base + rand() * 3.8), 'coffee_convenience', 'non-essential');
    }

    // 10. Non-Essential Online Retail & Apparel
    const amazonOrders = mIdx === 2 ? 6 : 3 + Math.floor(rand() * 2); // December spike
    for (let a = 0; a < amazonOrders; a++) {
      const orderAmt = -(26 + rand() * 68);
      pushTx(year, month, 4 + a * 4, 'AMZN MKTPLACE AMAZON.CO.UK', 'Amazon', orderAmt, 'shopping_retail', 'non-essential');
    }
    if (mIdx % 2 === 0 || mIdx === 2) {
      pushTx(year, month, 16, 'CARD PAYMENT - ASOS.COM RETAIL', 'ASOS', -(74 + rand() * 64), 'shopping_retail', 'non-essential');
    }
    if (mIdx === 2 || mIdx === 8) {
      pushTx(year, month, 20, 'CARD PAYMENT - JOHN LEWIS PARTNERS', 'John Lewis', -(145 + rand() * 85), 'shopping_retail', 'non-essential');
    }

    // 11. Non-Essential Entertainment & Travel
    pushTx(year, month, 19, 'CARD PAYMENT - EVERYMAN CINEMA', 'Everyman Cinema', -(36 + rand() * 14), 'entertainment_leisure', 'non-essential');
    pushTx(year, month, 26, 'CARD PAYMENT - THE CROWN PUB', 'Local Pub & Social', -(48 + rand() * 28), 'entertainment_leisure', 'non-essential');

    if (month === 12 || month === 5 || month === 8) {
      pushTx(
        year,
        month,
        10,
        month === 8 ? 'CARD PAYMENT - EASYJET EUROPE (EUR)' : 'CARD PAYMENT - AIRBNB EUROPE (EUR)',
        month === 8 ? 'easyJet' : 'Airbnb',
        -(340 + rand() * 155),
        'travel_holidays',
        'non-essential',
        'Wise EUR Card',
        false,
        'EUR'
      );
    }

    // Occasional USD digital/software charge on multi-currency card
    if (mIdx % 3 === 1) {
      pushTx(
        year,
        month,
        15,
        'CARD PAYMENT - CLOUD STORAGE US (USD)',
        'Backblaze Cloud',
        -(24 + rand() * 8),
        'subscriptions',
        'non-essential',
        'Wise USD Card',
        false,
        'USD'
      );
    }

    // 12. Existing Savings Transfer (modest £250/mo)
    pushTx(year, month, 27, 'STANDING ORDER - BARCLAYS CASH ISA', 'Cash ISA Transfer', -250, 'savings_investment', 'savings', 'Current Account', true);
  });

  const buildSampleImportMeta = (
    id: string,
    fileName: string,
    importedAt: string
  ): StatementImportMeta => {
    const batchTx = transactions.filter((t) => t.importBatchId === id);
    const sortedDates = batchTx.map((t) => t.date).sort();
    return {
      id,
      fileName,
      importedAt,
      rowCount: batchTx.length,
      duplicatesSkipped: 0,
      dateRangeStart: sortedDates[0] ?? '2025-10-01',
      dateRangeEnd: sortedDates[sortedDates.length - 1] ?? '2026-11-28',
    };
  };

  const imports: StatementImportMeta[] = [
    buildSampleImportMeta(
      'sample-import-wise-usd',
      'Wise_MultiCurrency_USD_2026.csv',
      '2026-11-26T18:12:00.000Z'
    ),
    buildSampleImportMeta(
      'sample-import-wise-eur',
      'Wise_MultiCurrency_EUR_2026.csv',
      '2026-11-26T18:06:00.000Z'
    ),
    buildSampleImportMeta(
      'sample-import-barclays',
      'Barclays_Current_Oct2025_Nov2026.csv',
      '2026-11-26T18:00:00.000Z'
    ),
  ].filter((imp) => imp.rowCount > 0);

  const defaultGoals: SavingsGoal[] = [
    {
      id: 'goal-emergency',
      name: '6-Month Essential Safety Buffer',
      targetAmount: 12000,
      currentSaved: 4200,
      vehicle: 'emergency_fund',
      monthlyAllocationPct: 30,
    },
    {
      id: 'goal-isa-deposit',
      name: 'Tax-Free Cash ISA Reserve',
      targetAmount: 25000,
      currentSaved: 6800,
      vehicle: 'cash_isa',
      monthlyAllocationPct: 45,
    },
    {
      id: 'goal-lisa-home',
      name: 'Lifetime ISA Future Home / Bridge',
      targetAmount: 20000,
      currentSaved: 3500,
      vehicle: 'lifetime_isa',
      monthlyAllocationPct: 25,
    },
  ];

  const defaultIsaSettings: IsaPlannerSettings = {
    cashIsaRate: 4.85,
    currentAccountRate: 0.5,
    stocksIsaRate: 7.0,
    lisaRate: 4.5,
    horizonYears: 5,
    taxBand: 'higher_40',
    cashIsaSplitPct: 55,
    lisaSplitPct: 25,
    stocksIsaSplitPct: 20,
    customMonthlyOverride: null,
  };

  const defaultRules: CategoryRule[] = [
    {
      id: 'rule-waitrose',
      matchPattern: 'waitrose',
      matchType: 'exact_merchant',
      category: 'groceries',
      spendingClass: 'essential',
      source: 'manual',
      confidence: 100,
      matchCount: 14,
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'rule-deliveroo',
      matchPattern: 'deliveroo',
      matchType: 'exact_merchant',
      category: 'dining_takeaway',
      spendingClass: 'non-essential',
      source: 'manual',
      confidence: 100,
      matchCount: 28,
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'rule-david-lloyd',
      matchPattern: 'david lloyd club',
      matchType: 'recurring_pattern',
      category: 'subscriptions',
      spendingClass: 'non-essential',
      source: 'recurring_pattern',
      confidence: 96,
      matchCount: 14,
      updatedAt: new Date().toISOString(),
    },
  ];

  const defaultPlannerState: PersonalPlannerState = {
    commitmentDeclaration:
      'I am committed to paying my future self first every payday before discretionary spending begins. My goal over the next 12 months is to eliminate silent subscription leaks, cut impulse takeaway orders in half, and channel every freed pound into my emergency buffer and tax-free Cash ISA without feeling deprived.',
    commitmentSignedName: 'Personal Vault Commitment',
    commitmentUpdatedAt: '2026-11-26',
    struggles: [
      {
        id: 'strug-1',
        date: '2026-11-18',
        trigger: 'Late weeknight finishes triggering £28–£35 Deliveroo orders out of exhaustion.',
        responsePlan: 'Keep 3 ten-minute freezer meals stocked every Sunday so dinner is faster than delivery.',
      },
      {
        id: 'strug-2',
        date: '2026-11-10',
        trigger: 'One-click Amazon orders during evening phone scrolling.',
        responsePlan: 'Enforce a strict 48-hour wishlist pause on any non-essential item over £25.',
      },
    ],
    plannerGoals: [
      {
        id: 'pg-y1',
        horizon: 'yearly',
        title: 'Reach £12,000 full 6-month essential emergency buffer',
        targetNote: 'Transfer surplus on the 26th of every month',
        completed: false,
        createdAt: '2026-01-05',
      },
      {
        id: 'pg-y2',
        horizon: 'yearly',
        title: 'Max out £4,000 Lifetime ISA allowance before April tax year end',
        targetNote: 'Captures full £1,000 UK government bonus',
        completed: false,
        createdAt: '2026-01-05',
      },
      {
        id: 'pg-m1',
        horizon: 'monthly',
        title: 'Keep Dining & Takeaways under £220 cap this month',
        targetNote: 'Track weekly progress in Overview cap monitor',
        completed: false,
        createdAt: '2026-11-01',
      },
      {
        id: 'pg-m2',
        horizon: 'monthly',
        title: 'Cancel unused gym & streaming overlaps (£40+/mo)',
        targetNote: 'Completed Disney+ & PureGym cancellation checklist',
        completed: true,
        createdAt: '2026-11-02',
      },
      {
        id: 'pg-w1',
        horizon: 'weekly',
        title: 'Shift main weekly grocery shop to Aldi / Lidl staples',
        targetNote: 'Target £65–£75 basket vs £95 average',
        completed: true,
        createdAt: '2026-11-22',
      },
      {
        id: 'pg-w2',
        horizon: 'weekly',
        title: 'Plan 3 zero-spend days this week',
        targetNote: 'Check green/empty cells on the Spending Calendar Heatmap',
        completed: false,
        createdAt: '2026-11-22',
      },
      {
        id: 'pg-d1',
        horizon: 'daily',
        title: 'Make morning coffee at home instead of weekday cafe stop',
        targetNote: 'Saves ~£4.20/day (£85/mo)',
        completed: true,
        createdAt: '2026-11-26',
      },
      {
        id: 'pg-d2',
        horizon: 'daily',
        title: 'Pack lunch and avoid impulse convenience store snacks',
        targetNote: 'Saves ~£6.50 today',
        completed: false,
        createdAt: '2026-11-26',
      },
    ],
  };

  const defaultDebts: DebtAccount[] = [
    {
      id: 'debt-barclaycard',
      name: 'Barclaycard Rewards Visa',
      balance: 3450,
      apr: 24.9,
      minimumPayment: 105,
      category: 'credit_card',
    },
    {
      id: 'debt-flex',
      name: 'Monzo Flex / BNPL',
      balance: 1180,
      apr: 19.9,
      minimumPayment: 65,
      category: 'bnpl',
    },
    {
      id: 'debt-car',
      name: 'Car Finance Loan',
      balance: 6800,
      apr: 8.9,
      minimumPayment: 215,
      category: 'car_finance',
    },
  ];

  const defaultAdvancedRules: AdvancedAutomationRule[] = [
    {
      id: 'adv-rule-tesco-essential',
      name: 'Large Tesco orders > £50 are Essential Groceries',
      enabled: true,
      merchantContains: 'tesco',
      amountOperator: 'gt',
      amountValue: 50,
      currencyFilter: 'any',
      targetCategory: 'groceries',
      targetSpendingClass: 'essential',
      createdAt: '2026-11-20',
    },
    {
      id: 'adv-rule-amazon-household',
      name: 'Large Amazon orders > £85 flagged for review as Retail',
      enabled: true,
      merchantContains: 'amazon',
      amountOperator: 'gt',
      amountValue: 85,
      currencyFilter: 'any',
      targetCategory: 'shopping_retail',
      targetSpendingClass: 'non-essential',
      createdAt: '2026-11-22',
    },
  ];

  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    currency: 'GBP',
    exchangeRates: { ...DEFAULT_EXCHANGE_RATES },
    isSampleData: true,
    transactions: transactions.sort((a, b) => b.date.localeCompare(a.date)),
    imports,
    recurringActions: {
      'rec-puregym': 'cancel',
      'rec-disney+': 'cancel',
      'rec-virgin media broadband': 'downgrade',
    },
    subscriptionClassOverrides: {
      'rec-puregym': 'cancelable',
      'rec-disney+': 'cancelable',
      'rec-apple one': 'cancelable',
      'rec-david lloyd club': 'cancelable',
      'rec-netflix': 'essential',
      'rec-spotify': 'essential',
      'rec-amazon prime': 'cancelable',
    },
    categoryCaps: {
      groceries: 340,
      dining_takeaway: 220,
      subscriptions: 120,
      shopping_retail: 180,
      coffee_convenience: 60,
      entertainment_leisure: 100,
      utilities: 280,
    },
    categoryRules: defaultRules,
    advancedRules: defaultAdvancedRules,
    plannerState: defaultPlannerState,
    debts: defaultDebts,
    recommendationOverrides: {},
    goals: defaultGoals,
    isaSettings: defaultIsaSettings,
  };
}
