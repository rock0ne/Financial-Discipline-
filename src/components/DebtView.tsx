import React, { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowRight, Plus, Trash2 } from 'lucide-react';
import {
  CURRENCY_CONFIG,
  formatMoney,
  type CurrencyCode,
  type DebtAccount,
  type DebtCategory,
  type IsaPlannerSettings,
} from '../types/finance';
import {
  simulateDebtStrategies,
  type AnalyticsResult,
} from '../utils/analyticsEngine';

interface DebtViewProps {
  debts: DebtAccount[];
  analytics: AnalyticsResult;
  isaSettings: IsaPlannerSettings;
  currency: CurrencyCode;
  onAddDebt: (debt: Omit<DebtAccount, 'id'>) => void;
  onUpdateDebt: (id: string, patch: Partial<Omit<DebtAccount, 'id'>>) => void;
  onDeleteDebt: (id: string) => void;
  onNavigateWealth: () => void;
}

const DEBT_CATEGORY_LABELS: Record<DebtCategory, string> = {
  credit_card: 'Credit Card',
  personal_loan: 'Personal Loan',
  car_finance: 'Car Finance',
  overdraft: 'Overdraft',
  bnpl: 'Buy Now Pay Later',
  other: 'Other Debt',
};

export const DebtView: React.FC<DebtViewProps> = ({
  debts,
  analytics,
  isaSettings,
  currency,
  onAddDebt,
  onUpdateDebt,
  onDeleteDebt,
  onNavigateWealth,
}) => {
  const currencySymbol = CURRENCY_CONFIG[currency].symbol;

  const baseSurplus = Math.max(0, Math.round(analytics.avgMonthlySurplus));
  const boostedSavingsPath = Math.max(
    0,
    Math.round(analytics.avgMonthlySurplus + analytics.totalRecommendedMonthlySavings)
  );
  const defaultExtra = boostedSavingsPath > 0 ? boostedSavingsPath : 350;

  const [budgetPreset, setBudgetPreset] = useState<'boosted' | 'surplus' | 'custom'>('boosted');
  const [customExtra, setCustomExtra] = useState<number>(defaultExtra);
  const [chartMode, setChartMode] = useState<'net_worth' | 'debt_balance'>('net_worth');

  // New debt form state
  const [name, setName] = useState('');
  const [category, setCategory] = useState<DebtCategory>('credit_card');
  const [balance, setBalance] = useState('');
  const [apr, setApr] = useState('');
  const [minPayment, setMinPayment] = useState('');

  const activeExtraBudget =
    budgetPreset === 'boosted'
      ? boostedSavingsPath
      : budgetPreset === 'surplus'
        ? baseSurplus
        : Math.max(0, customExtra);

  const simulation = useMemo(
    () => simulateDebtStrategies(debts, activeExtraBudget, isaSettings.cashIsaRate),
    [debts, activeExtraBudget, isaSettings.cashIsaRate]
  );

  const handleAddDebtSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedBal = parseFloat(balance);
    const parsedApr = parseFloat(apr);
    const parsedMin = parseFloat(minPayment);
    if (!name.trim() || !Number.isFinite(parsedBal) || parsedBal <= 0) return;

    const safeApr = Number.isFinite(parsedApr) && parsedApr >= 0 ? parsedApr : 0;
    const defaultMin = Math.max(25, Math.round(parsedBal * 0.03));
    const safeMin = Number.isFinite(parsedMin) && parsedMin > 0 ? parsedMin : defaultMin;

    onAddDebt({
      name: name.trim(),
      category,
      balance: Math.round(parsedBal * 100) / 100,
      apr: Math.round(safeApr * 100) / 100,
      minimumPayment: Math.round(safeMin * 100) / 100,
    });

    setName('');
    setBalance('');
    setApr('');
    setMinPayment('');
  };

  const avalancheBeatsSavingsPath = simulation.netAdvantageAvalancheVsSavingsPath >= 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Debt Payoff Simulator
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            <span>Snowball vs. Avalanche vs. Current Savings Path</span>
            <span aria-hidden="true">·</span>
            <span>
              Cash ISA benchmark{' '}
              <span className="font-mono-num">{isaSettings.cashIsaRate.toFixed(2)}% AER</span>
            </span>
            <span aria-hidden="true">·</span>
            <span>100% local simulation</span>
          </div>
        </div>

        <button
          type="button"
          onClick={onNavigateWealth}
          className="min-h-[38px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto cursor-pointer"
        >
          <span>Compare in Cash ISA Planner</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800">
        <div className="p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Total Debt Balance
          </p>
          <p className="mt-2 text-2xl font-semibold font-mono-num text-slate-900 dark:text-slate-100">
            {formatMoney(simulation.totalStartingDebt, currency)}
          </p>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 font-mono-num">
            {simulation.weightedAvgApr.toFixed(1)}% weighted APR ·{' '}
            {formatMoney(simulation.totalMinimumMonthly, currency)}/mo mins
          </p>
        </div>

        <div className="p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Avalanche (Highest APR First)
          </p>
          <p className="mt-2 text-2xl font-semibold font-mono-num text-teal-700 dark:text-teal-400">
            {simulation.avalanche.monthsToDebtFree !== null
              ? `${simulation.avalanche.monthsToDebtFree} mo`
              : '15+ yrs'}
          </p>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 font-mono-num">
            {simulation.avalanche.debtFreeDateLabel} ·{' '}
            {formatMoney(simulation.avalanche.totalInterestPaid, currency)} interest
          </p>
        </div>

        <div className="p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Snowball (Smallest Balance First)
          </p>
          <p className="mt-2 text-2xl font-semibold font-mono-num text-slate-900 dark:text-slate-100">
            {simulation.snowball.monthsToDebtFree !== null
              ? `${simulation.snowball.monthsToDebtFree} mo`
              : '15+ yrs'}
          </p>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 font-mono-num">
            {simulation.snowball.firstDebtClearedMonth
              ? `1st debt cleared in ${simulation.snowball.firstDebtClearedMonth} mo`
              : 'No active debts'}
            {simulation.avalancheInterestEdgeOverSnowball > 0
              ? ` · +${formatMoney(simulation.avalancheInterestEdgeOverSnowball, currency)} interest`
              : ' · Same interest'}
          </p>
        </div>

        <div className="p-5 bg-teal-50/50 dark:bg-teal-950/20 rounded-b-xl xl:rounded-b-none xl:rounded-r-xl">
          <p className="text-xs font-medium text-teal-800 dark:text-teal-300">
            vs. Current Savings Path ({isaSettings.cashIsaRate.toFixed(2)}% ISA)
          </p>
          <p
            className={`mt-2 text-2xl font-semibold font-mono-num ${
              avalancheBeatsSavingsPath
                ? 'text-teal-700 dark:text-teal-400'
                : 'text-amber-700 dark:text-amber-400'
            }`}
          >
            {avalancheBeatsSavingsPath ? '+' : '-'}
            {formatMoney(Math.abs(simulation.netAdvantageAvalancheVsSavingsPath), currency)}
          </p>
          <p className="mt-1.5 text-xs text-teal-800/80 dark:text-teal-300/80">
            {debts.length === 0
              ? 'Add a balance below to simulate'
              : avalancheBeatsSavingsPath
                ? `Avalanche net-worth gain over ${simulation.horizonMonths} mo`
                : `Cash ISA outperforms low-APR debt by ${simulation.horizonMonths} mo`}
          </p>
        </div>
      </div>

      {/* Extra Monthly Payment Strategy Bar + Simulation Chart */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Snowball vs. Avalanche vs. Current Savings Path
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Simulates paying minimums plus your monthly extra budget, then rolling freed payments into your{' '}
              <span className="font-mono-num">{isaSettings.cashIsaRate.toFixed(2)}%</span> Cash ISA once debts clear
            </p>
          </div>

          <div
            className="inline-flex items-center p-1 bg-slate-100 dark:bg-slate-800 rounded-lg self-start lg:self-auto"
            role="group"
            aria-label="Simulation chart mode"
          >
            <button
              type="button"
              onClick={() => setChartMode('net_worth')}
              className={`min-h-[34px] px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                chartMode === 'net_worth'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Net Position (Savings − Debt)
            </button>
            <button
              type="button"
              onClick={() => setChartMode('debt_balance')}
              className={`min-h-[34px] px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                chartMode === 'debt_balance'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Remaining Debt Balance
            </button>
          </div>
        </div>

        {/* Extra Payment Selector */}
        <div className="p-4 rounded-xl bg-slate-50/80 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              Extra Monthly Budget Applied:{' '}
              <span className="font-mono-num text-teal-700 dark:text-teal-400">
                {formatMoney(activeExtraBudget, currency)}/mo
              </span>
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono-num">
              Total monthly commitment: {formatMoney(simulation.totalMonthlyCommitted, currency)}/mo (
              {formatMoney(simulation.totalMinimumMonthly, currency)} minimums +{' '}
              {formatMoney(activeExtraBudget, currency)} extra)
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div
              className="inline-flex items-center p-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg"
              role="group"
              aria-label="Extra payment source preset"
            >
              <button
                type="button"
                onClick={() => setBudgetPreset('boosted')}
                className={`min-h-[32px] px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  budgetPreset === 'boosted'
                    ? 'bg-teal-700 text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Surplus + Cuts ({formatMoney(boostedSavingsPath, currency)})
              </button>
              <button
                type="button"
                onClick={() => setBudgetPreset('surplus')}
                className={`min-h-[32px] px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  budgetPreset === 'surplus'
                    ? 'bg-teal-700 text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Current Surplus ({formatMoney(baseSurplus, currency)})
              </button>
              <button
                type="button"
                onClick={() => {
                  setBudgetPreset('custom');
                  setCustomExtra(activeExtraBudget);
                }}
                className={`min-h-[32px] px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  budgetPreset === 'custom'
                    ? 'bg-teal-700 text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Custom
              </button>
            </div>

            {budgetPreset === 'custom' && (
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={Math.max(2500, Math.round(simulation.totalStartingDebt * 0.25))}
                  step={25}
                  aria-label="Custom extra monthly payment slider"
                  value={customExtra}
                  onChange={(e) => setCustomExtra(Number(e.target.value))}
                  className="w-28 sm:w-36"
                />
                <input
                  type="number"
                  min={0}
                  step={25}
                  aria-label="Custom extra monthly payment amount"
                  value={customExtra}
                  onChange={(e) => setCustomExtra(Math.max(0, Number(e.target.value) || 0))}
                  className="w-24 min-h-[34px] px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono-num text-right text-slate-900 dark:text-slate-100"
                />
              </div>
            )}
          </div>
        </div>

        {/* Visualization Area */}
        {simulation.timeline.length === 0 ? (
          <div className="py-12 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              No active debts entered yet
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Add a credit card, loan, or BNPL balance below to compare Snowball, Avalanche, and your Cash ISA savings path.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-slate-600 dark:text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-teal-600 inline-block" />
                Avalanche (Highest APR first)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-amber-500 inline-block" />
                Snowball (Smallest balance first)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-slate-500 dark:bg-slate-400 border-t border-dashed inline-block" />
                Current Savings Path (Minimums + {isaSettings.cashIsaRate.toFixed(1)}% ISA)
              </span>
            </div>

            <div className="w-full h-[300px] sm:h-[330px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={simulation.timeline}
                  margin={{ top: 8, right: 12, left: -4, bottom: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="#cbd5e1"
                    opacity={0.35}
                  />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => formatMoney(Number(v), currency)}
                  />
                  {chartMode === 'net_worth' && (
                    <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3" />
                  )}
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0f172a',
                      border: '1px solid #334155',
                      borderRadius: '8px',
                      fontSize: '12px',
                      color: '#f8fafc',
                    }}
                    formatter={(value: unknown, name: unknown) => {
                      const labels: Record<string, string> = {
                        avalancheNetWorth: 'Avalanche Net Position',
                        snowballNetWorth: 'Snowball Net Position',
                        savingsPathNetWorth: 'Current Savings Path Net Position',
                        avalancheDebt: 'Avalanche Remaining Debt',
                        snowballDebt: 'Snowball Remaining Debt',
                        savingsPathDebt: 'Savings Path Remaining Debt',
                      };
                      const key = String(name);
                      return [formatMoney(Number(value), currency), labels[key] ?? key];
                    }}
                  />
                  {chartMode === 'net_worth' ? (
                    <>
                      <Line
                        type="monotone"
                        dataKey="avalancheNetWorth"
                        stroke="#0f766e"
                        strokeWidth={2.5}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="snowballNetWorth"
                        stroke="#d97706"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="savingsPathNetWorth"
                        stroke="#64748b"
                        strokeWidth={2}
                        strokeDasharray="5 4"
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                    </>
                  ) : (
                    <>
                      <Line
                        type="monotone"
                        dataKey="avalancheDebt"
                        stroke="#0f766e"
                        strokeWidth={2.5}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="snowballDebt"
                        stroke="#d97706"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="savingsPathDebt"
                        stroke="#64748b"
                        strokeWidth={2}
                        strokeDasharray="5 4"
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                    </>
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Strategy Comparison Matrix */}
        {debts.length > 0 && (
          <div className="overflow-x-auto pt-2 border-t border-slate-100 dark:border-slate-800">
            <table className="w-full text-left border-collapse text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 pr-4">Strategy</th>
                  <th className="py-2.5 px-3 text-right">Debt-Free In</th>
                  <th className="py-2.5 px-3 text-right">1st Quick Win</th>
                  <th className="py-2.5 px-3 text-right">Total Interest</th>
                  <th className="py-2.5 px-3 text-right">Interest Saved</th>
                  <th className="py-2.5 pl-3 text-right">
                    Net Position (M{simulation.horizonMonths})
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono-num">
                <tr>
                  <td className="py-3 pr-4 font-sans">
                    <p className="font-medium text-teal-700 dark:text-teal-400">
                      Avalanche (Highest APR First)
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Mathematically lowest interest · Rolls freed payments into ISA
                    </p>
                  </td>
                  <td className="py-3 px-3 text-right text-slate-900 dark:text-slate-100 whitespace-nowrap">
                    {simulation.avalanche.monthsToDebtFree !== null
                      ? `${simulation.avalanche.monthsToDebtFree} mo`
                      : '15+ yrs'}
                    <span className="block text-[11px] text-slate-400">
                      {simulation.avalanche.debtFreeDateLabel}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-right text-slate-700 dark:text-slate-300 whitespace-nowrap">
                    {simulation.avalanche.firstDebtClearedMonth
                      ? `Month ${simulation.avalanche.firstDebtClearedMonth}`
                      : '—'}
                  </td>
                  <td className="py-3 px-3 text-right text-slate-900 dark:text-slate-100 whitespace-nowrap">
                    {formatMoney(simulation.avalanche.totalInterestPaid, currency)}
                  </td>
                  <td className="py-3 px-3 text-right text-teal-700 dark:text-teal-400 font-medium whitespace-nowrap">
                    +{formatMoney(simulation.interestSavedAvalancheVsMinimum, currency)}
                  </td>
                  <td className="py-3 pl-3 text-right font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                    {formatMoney(simulation.avalanche.finalNetPosition, currency)}
                  </td>
                </tr>

                <tr>
                  <td className="py-3 pr-4 font-sans">
                    <p className="font-medium text-amber-700 dark:text-amber-400">
                      Snowball (Smallest Balance First)
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Fastest psychological momentum · Clears smallest account early
                    </p>
                  </td>
                  <td className="py-3 px-3 text-right text-slate-900 dark:text-slate-100 whitespace-nowrap">
                    {simulation.snowball.monthsToDebtFree !== null
                      ? `${simulation.snowball.monthsToDebtFree} mo`
                      : '15+ yrs'}
                    <span className="block text-[11px] text-slate-400">
                      {simulation.snowball.debtFreeDateLabel}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-right text-slate-700 dark:text-slate-300 whitespace-nowrap">
                    {simulation.snowball.firstDebtClearedMonth
                      ? `Month ${simulation.snowball.firstDebtClearedMonth}`
                      : '—'}
                  </td>
                  <td className="py-3 px-3 text-right text-slate-900 dark:text-slate-100 whitespace-nowrap">
                    {formatMoney(simulation.snowball.totalInterestPaid, currency)}
                  </td>
                  <td className="py-3 px-3 text-right text-teal-700 dark:text-teal-400 font-medium whitespace-nowrap">
                    +{formatMoney(simulation.interestSavedSnowballVsMinimum, currency)}
                  </td>
                  <td className="py-3 pl-3 text-right font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                    {formatMoney(simulation.snowball.finalNetPosition, currency)}
                  </td>
                </tr>

                <tr>
                  <td className="py-3 pr-4 font-sans">
                    <p className="font-medium text-slate-700 dark:text-slate-300">
                      Current Savings Path (Minimums + Cash ISA)
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Minimum payments only · Extra budget invested at{' '}
                      {isaSettings.cashIsaRate.toFixed(2)}% AER
                    </p>
                  </td>
                  <td className="py-3 px-3 text-right text-slate-700 dark:text-slate-300 whitespace-nowrap">
                    {simulation.savingsPath.monthsToDebtFree !== null
                      ? `${simulation.savingsPath.monthsToDebtFree} mo`
                      : '15+ yrs'}
                    <span className="block text-[11px] text-slate-400">
                      {simulation.savingsPath.debtFreeDateLabel}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-right text-slate-500 dark:text-slate-400 whitespace-nowrap">
                    {simulation.savingsPath.firstDebtClearedMonth
                      ? `Month ${simulation.savingsPath.firstDebtClearedMonth}`
                      : '—'}
                  </td>
                  <td className="py-3 px-3 text-right text-red-600 dark:text-red-400 whitespace-nowrap">
                    {formatMoney(simulation.savingsPath.totalInterestPaid, currency)}
                  </td>
                  <td className="py-3 px-3 text-right text-slate-400 whitespace-nowrap">
                    Baseline
                  </td>
                  <td className="py-3 pl-3 text-right font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                    {formatMoney(simulation.savingsPath.finalNetPosition, currency)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Debt Accounts Input & Payoff Order Editor */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-5">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Your Debt Balances &amp; Interest Rates
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Edit balances, APRs, or minimums inline to update the simulation instantly — stored strictly inside your encrypted local vault
          </p>
        </div>

        {/* Add Debt Form */}
        <form
          onSubmit={handleAddDebtSubmit}
          className="p-4 rounded-xl bg-slate-50/80 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 items-end"
        >
          <div className="lg:col-span-3">
            <label
              htmlFor="debt-name"
              className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1"
            >
              Account / Lender Name
            </label>
            <input
              id="debt-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Amex Cashback Card"
              className="w-full min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
            />
          </div>

          <div className="lg:col-span-2">
            <label
              htmlFor="debt-category"
              className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1"
            >
              Type
            </label>
            <select
              id="debt-category"
              value={category}
              onChange={(e) => setCategory(e.target.value as DebtCategory)}
              className="w-full min-h-[40px] px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-900 dark:text-slate-100"
            >
              {(Object.keys(DEBT_CATEGORY_LABELS) as DebtCategory[]).map((cat) => (
                <option key={cat} value={cat}>
                  {DEBT_CATEGORY_LABELS[cat]}
                </option>
              ))}
            </select>
          </div>

          <div className="lg:col-span-2">
            <label
              htmlFor="debt-balance"
              className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1"
            >
              Balance ({currencySymbol})
            </label>
            <input
              id="debt-balance"
              type="number"
              min="1"
              step="0.01"
              inputMode="decimal"
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
              placeholder="2500"
              className="w-full min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono-num text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
            />
          </div>

          <div className="lg:col-span-2">
            <label
              htmlFor="debt-apr"
              className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1"
            >
              APR (%)
            </label>
            <input
              id="debt-apr"
              type="number"
              min="0"
              max="99.9"
              step="0.1"
              inputMode="decimal"
              value={apr}
              onChange={(e) => setApr(e.target.value)}
              placeholder="22.9"
              className="w-full min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono-num text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
            />
          </div>

          <div className="lg:col-span-2">
            <label
              htmlFor="debt-min"
              className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1"
            >
              Min / Month ({currencySymbol})
            </label>
            <input
              id="debt-min"
              type="number"
              min="1"
              step="1"
              inputMode="decimal"
              value={minPayment}
              onChange={(e) => setMinPayment(e.target.value)}
              placeholder="75"
              className="w-full min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono-num text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
            />
          </div>

          <div className="lg:col-span-1">
            <button
              type="submit"
              disabled={!name.trim() || !balance.trim() || Number(balance) <= 0}
              className="w-full min-h-[40px] inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-40 text-white text-xs font-medium transition-colors whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Add
            </button>
          </div>
        </form>

        {/* Active Debts List */}
        {debts.length > 0 && (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {debts.map((debt) => {
              const av = simulation.avalanche.milestones[debt.id];
              const sb = simulation.snowball.milestones[debt.id];
              return (
                <div
                  key={debt.id}
                  className="py-4 first:pt-1 last:pb-0 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {debt.name}
                      </p>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {DEBT_CATEGORY_LABELS[debt.category]}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400 font-mono-num">
                      {av && (
                        <span>
                          Avalanche #{av.payoffOrder}:{' '}
                          <strong className="text-teal-700 dark:text-teal-400">
                            {av.payoffDateLabel}
                          </strong>
                        </span>
                      )}
                      {av && sb && <span aria-hidden="true">·</span>}
                      {sb && (
                        <span>
                          Snowball #{sb.payoffOrder}:{' '}
                          <strong className="text-amber-700 dark:text-amber-400">
                            {sb.payoffDateLabel}
                          </strong>
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 shrink-0">
                    <label className="flex flex-col text-[11px] text-slate-500 dark:text-slate-400">
                      Balance ({currencySymbol})
                      <input
                        type="number"
                        min={0}
                        step={50}
                        value={debt.balance}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          onUpdateDebt(debt.id, {
                            balance: Number.isFinite(val) && val >= 0 ? val : 0,
                          });
                        }}
                        className="mt-0.5 w-24 min-h-[34px] px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-mono-num text-right text-slate-900 dark:text-slate-100"
                      />
                    </label>

                    <label className="flex flex-col text-[11px] text-slate-500 dark:text-slate-400">
                      APR (%)
                      <input
                        type="number"
                        min={0}
                        max={99.9}
                        step={0.1}
                        value={debt.apr}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          onUpdateDebt(debt.id, {
                            apr: Number.isFinite(val) && val >= 0 ? val : 0,
                          });
                        }}
                        className="mt-0.5 w-20 min-h-[34px] px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-mono-num text-right text-slate-900 dark:text-slate-100"
                      />
                    </label>

                    <label className="flex flex-col text-[11px] text-slate-500 dark:text-slate-400">
                      Min / mo ({currencySymbol})
                      <input
                        type="number"
                        min={0}
                        step={5}
                        value={debt.minimumPayment}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          onUpdateDebt(debt.id, {
                            minimumPayment: Number.isFinite(val) && val >= 0 ? val : 0,
                          });
                        }}
                        className="mt-0.5 w-20 min-h-[34px] px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-mono-num text-right text-slate-900 dark:text-slate-100"
                      />
                    </label>

                    <button
                      type="button"
                      onClick={() => onDeleteDebt(debt.id)}
                      aria-label={`Delete ${debt.name}`}
                      className="self-end min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
