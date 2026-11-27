import React, { useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Plus, Trash2 } from 'lucide-react';
import {
  formatMoney,
  type CurrencyCode,
  type DebtAccount,
  type IsaPlannerSettings,
  type SavingsGoal,
  type SavingsVehicleId,
  type TaxBand,
} from '../types/finance';
import {
  computeWealthProjections,
  estimateGoalMonths,
  type AnalyticsResult,
} from '../utils/analyticsEngine';
import {
  GoalProgressBar,
  PortfolioGoalsProgressBar,
} from './GoalProgressBar';
import { D3NetWorthChart } from './D3NetWorthChart';

interface WealthPlannerViewProps {
  analytics: AnalyticsResult;
  currency: CurrencyCode;
  settings: IsaPlannerSettings;
  goals: SavingsGoal[];
  debts?: DebtAccount[];
  onUpdateSettings: (next: Partial<IsaPlannerSettings>) => void;
  onAddGoal: (goal: Omit<SavingsGoal, 'id'>) => void;
  onDeleteGoal: (id: string) => void;
  onNavigateDebt?: () => void;
}

const VEHICLE_LABELS: Record<SavingsVehicleId, string> = {
  cash_isa: 'Cash ISA (Tax-Free)',
  lifetime_isa: 'Lifetime ISA (+25% Bonus)',
  stocks_isa: 'Stocks & Shares ISA',
  emergency_fund: 'Easy-Access Emergency',
};

export const WealthPlannerView: React.FC<WealthPlannerViewProps> = ({
  analytics,
  currency,
  settings,
  goals,
  debts = [],
  onUpdateSettings,
  onAddGoal,
  onDeleteGoal,
  onNavigateDebt,
}) => {
  const [showAddGoal, setShowAddGoal] = useState(false);
  const [goalName, setGoalName] = useState('');
  const [goalTarget, setGoalTarget] = useState('15000');
  const [goalSaved, setGoalSaved] = useState('1000');
  const [goalVehicle, setGoalVehicle] = useState<SavingsVehicleId>('cash_isa');
  const [goalAlloc, setGoalAlloc] = useState('25');

  const computedMonthlyPot = Math.round(
    analytics.avgMonthlySurplus + analytics.totalRecommendedMonthlySavings
  );
  const activeMonthlyContribution =
    settings.customMonthlyOverride !== null
      ? settings.customMonthlyOverride
      : computedMonthlyPot;

  const currentSavingsTotal = goals.reduce(
    (sum, g) => sum + Math.max(0, g.currentSaved),
    0
  );

  const projection = computeWealthProjections(activeMonthlyContribution, settings);
  const essentialSixMonthTarget = Math.round(analytics.avgMonthlyEssential * 6);
  const essentialThreeMonthTarget = Math.round(analytics.avgMonthlyEssential * 3);
  const extraVsCurrentAccount = Math.max(
    0,
    projection.finalBlendedIsa - projection.finalCurrentAccount
  );

  const handleCreateGoal = (e: React.FormEvent) => {
    e.preventDefault();
    const target = parseFloat(goalTarget);
    const saved = parseFloat(goalSaved) || 0;
    const alloc = Math.min(100, Math.max(5, parseFloat(goalAlloc) || 20));
    if (!goalName.trim() || !Number.isFinite(target) || target <= 0) return;

    onAddGoal({
      name: goalName.trim(),
      targetAmount: target,
      currentSaved: saved,
      vehicle: goalVehicle,
      monthlyAllocationPct: alloc,
    });
    setGoalName('');
    setGoalTarget('15000');
    setGoalSaved('1000');
    setShowAddGoal(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Cash ISA &amp; Savings Strategy
          </h1>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Model where to deploy your freed monthly cash across tax-free ISAs, emergency buffers, and long-term goals
          </p>
        </div>

        {/* Horizon Selector */}
        <div
          className="inline-flex items-center p-1 bg-slate-100 dark:bg-slate-800 rounded-lg self-start sm:self-auto"
          role="group"
          aria-label="Projection horizon"
        >
          {[1, 3, 5, 10, 20].map((yr) => (
            <button
              key={yr}
              type="button"
              onClick={() => onUpdateSettings({ horizonYears: yr })}
              className={`min-h-[36px] px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                settings.horizonYears === yr
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {yr}Y
            </button>
          ))}
        </div>
      </div>

      {/* Outcome Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800">
        <div className="p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Monthly Savings Deployed
          </p>
          <p className="mt-2 text-2xl font-semibold font-mono-num text-slate-900 dark:text-slate-100">
            {formatMoney(activeMonthlyContribution, currency)}
            <span className="text-sm font-normal text-slate-500">/mo</span>
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono-num">
            {formatMoney(activeMonthlyContribution * 12, currency)}/yr ({projection.isaAllowanceUsedPct.toFixed(0)}% of £20k ISA cap)
          </p>
        </div>

        <div className="p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {settings.horizonYears}-Year Cash ISA ({settings.cashIsaRate}% AER)
          </p>
          <p className="mt-2 text-2xl font-semibold font-mono-num text-teal-700 dark:text-teal-400">
            {formatMoney(projection.finalCashIsa, currency)}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono-num">
            +{formatMoney(projection.cashIsaInterestEarned, currency)} tax-free interest
          </p>
        </div>

        <div className="p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {settings.horizonYears}-Year Blended ISA Plan
          </p>
          <p className="mt-2 text-2xl font-semibold font-mono-num text-slate-900 dark:text-slate-100">
            {formatMoney(projection.finalBlendedIsa, currency)}
          </p>
          <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400 font-mono-num">
            +{formatMoney(extraVsCurrentAccount, currency)} vs. current account
          </p>
        </div>

        <div className="p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Tax Shield &amp; LISA Bonus ({settings.horizonYears}Y)
          </p>
          <p className="mt-2 text-2xl font-semibold font-mono-num text-slate-900 dark:text-slate-100">
            +{formatMoney(projection.taxSavedTotal + projection.lisaGovtBonusTotal, currency)}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono-num">
            {formatMoney(projection.taxSavedTotal, currency)} tax saved · {formatMoney(projection.lisaGovtBonusTotal, currency)} LISA bonus
          </p>
        </div>
      </div>

      {/* 5-Year Total Net Worth Projection (D3) */}
      <D3NetWorthChart
        currentSavings={currentSavingsTotal}
        debts={debts}
        monthlyContribution={activeMonthlyContribution}
        isaSettings={settings}
        currency={currency}
        onNavigateDebt={onNavigateDebt}
      />

      {/* Main Compounding Chart + Strategy Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <section className="lg:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 flex flex-col">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-5">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Wealth Growth: Cash ISA vs. Blended ISA vs. Current Account
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Compounding {formatMoney(activeMonthlyContribution, currency)}/mo over {settings.horizonYears} years
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 dark:text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-teal-600 inline-block" />
                Blended ISA
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-sky-600 inline-block" />
                Cash ISA Only
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-slate-400 inline-block" />
                Current Acc ({settings.currentAccountRate}%)
              </span>
            </div>
          </div>

          <div className="w-full h-[290px] mt-auto">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={projection.points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="blendedFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0f766e" stopOpacity={0.22} />
                    <stop offset="95%" stopColor="#0f766e" stopOpacity={0.01} />
                  </linearGradient>
                  <linearGradient id="cashIsaFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0284c7" stopOpacity={0.14} />
                    <stop offset="95%" stopColor="#0284c7" stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#cbd5e1" opacity={0.35} />
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
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    border: '1px solid #334155',
                    borderRadius: '8px',
                    fontSize: '12px',
                    color: '#f8fafc',
                  }}
                  formatter={(val: unknown, name: unknown) => {
                    const labels: Record<string, string> = {
                      blendedIsa: 'Blended ISA Strategy',
                      cashIsa: `100% Cash ISA (${settings.cashIsaRate}%)`,
                      currentAccount: `Current Account (${settings.currentAccountRate}%)`,
                    };
                    const key = String(name);
                    return [formatMoney(Number(val), currency), labels[key] ?? key];
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="blendedIsa"
                  stroke="#0f766e"
                  strokeWidth={2.5}
                  fill="url(#blendedFill)"
                />
                <Area
                  type="monotone"
                  dataKey="cashIsa"
                  stroke="#0284c7"
                  strokeWidth={2}
                  fill="url(#cashIsaFill)"
                />
                <Area
                  type="monotone"
                  dataKey="currentAccount"
                  stroke="#94a3b8"
                  strokeWidth={1.75}
                  strokeDasharray="4 4"
                  fill="none"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Rate & Allocation Controls */}
        <section className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-5">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Allocation &amp; Rate Assumptions
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Customize your monthly transfer and tax band
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <label htmlFor="monthly-pot-slider" className="font-medium text-slate-700 dark:text-slate-300">
                  Monthly Contribution
                </label>
                <span className="font-mono-num font-semibold text-teal-700 dark:text-teal-400">
                  {formatMoney(activeMonthlyContribution, currency)}/mo
                </span>
              </div>
              <input
                id="monthly-pot-slider"
                type="range"
                min={100}
                max={Math.max(2500, computedMonthlyPot * 2)}
                step={25}
                value={activeMonthlyContribution}
                onChange={(e) =>
                  onUpdateSettings({ customMonthlyOverride: Number(e.target.value) })
                }
                className="w-full h-2 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
              />
              {settings.customMonthlyOverride !== null && (
                <button
                  type="button"
                  onClick={() => onUpdateSettings({ customMonthlyOverride: null })}
                  className="mt-1 text-xs text-teal-700 dark:text-teal-400 hover:underline cursor-pointer"
                >
                  Reset to statement surplus + cuts ({formatMoney(computedMonthlyPot, currency)}/mo)
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="cash-isa-rate" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Cash ISA AER (%)
                </label>
                <input
                  id="cash-isa-rate"
                  type="number"
                  step="0.05"
                  min="0"
                  max="12"
                  value={settings.cashIsaRate}
                  onChange={(e) =>
                    onUpdateSettings({ cashIsaRate: parseFloat(e.target.value) || 0 })
                  }
                  className="w-full min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm font-mono-num text-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label htmlFor="stocks-isa-rate" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Stocks ISA Est. (%)
                </label>
                <input
                  id="stocks-isa-rate"
                  type="number"
                  step="0.25"
                  min="0"
                  max="15"
                  value={settings.stocksIsaRate}
                  onChange={(e) =>
                    onUpdateSettings({ stocksIsaRate: parseFloat(e.target.value) || 0 })
                  }
                  className="w-full min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm font-mono-num text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            <div>
              <label htmlFor="tax-band-select" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Income Tax Band (for ISA tax-shield math)
              </label>
              <select
                id="tax-band-select"
                value={settings.taxBand}
                onChange={(e) => onUpdateSettings({ taxBand: e.target.value as TaxBand })}
                className="w-full min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100"
              >
                <option value="basic_20">Basic Rate (20% · £1,000 PSA)</option>
                <option value="higher_40">Higher Rate (40% · £500 PSA)</option>
                <option value="additional_45">Additional Rate (45% · £0 PSA)</option>
              </select>
            </div>

            {/* Blended Split Sliders */}
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-3">
              <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Blended ISA Split
              </p>
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600 dark:text-slate-400">Cash ISA</span>
                  <span className="font-mono-num font-medium text-slate-900 dark:text-slate-100">
                    {settings.cashIsaSplitPct}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={settings.cashIsaSplitPct}
                  onChange={(e) => {
                    const cash = Number(e.target.value);
                    const remaining = 100 - cash;
                    const lisa = Math.min(settings.lisaSplitPct, remaining);
                    onUpdateSettings({
                      cashIsaSplitPct: cash,
                      lisaSplitPct: lisa,
                      stocksIsaSplitPct: remaining - lisa,
                    });
                  }}
                  className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
                />

                <div className="flex items-center justify-between pt-1">
                  <span className="text-slate-600 dark:text-slate-400">Lifetime ISA (25% bonus, £4k cap)</span>
                  <span className="font-mono-num font-medium text-slate-900 dark:text-slate-100">
                    {settings.lisaSplitPct}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100 - settings.cashIsaSplitPct}
                  step={5}
                  value={settings.lisaSplitPct}
                  onChange={(e) => {
                    const lisa = Number(e.target.value);
                    onUpdateSettings({
                      lisaSplitPct: lisa,
                      stocksIsaSplitPct: Math.max(0, 100 - settings.cashIsaSplitPct - lisa),
                    });
                  }}
                  className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
                />

                <div className="flex items-center justify-between pt-1 text-slate-600 dark:text-slate-400">
                  <span>Stocks &amp; Shares ISA</span>
                  <span className="font-mono-num font-medium text-slate-900 dark:text-slate-100">
                    {settings.stocksIsaSplitPct}%
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Emergency Fund Benchmark + Long-Term Financial Goals */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Personalized Emergency Fund & Recommended Savings Waterfall */}
        <section className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Recommended Priority Order
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Tailored to your actual essential baseline of {formatMoney(analytics.avgMonthlyEssential, currency)}/mo
          </p>

          <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
            <div className="py-3.5">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  01. Easy-Access Emergency Buffer
                </h3>
                <span className="text-xs font-mono-num text-slate-600 dark:text-slate-400">
                  {formatMoney(essentialThreeMonthTarget, currency)}–{formatMoney(essentialSixMonthTarget, currency)}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Covers 3 to 6 months of strictly essential living expenses (housing, utilities, groceries, transport) in an instant-access account.
              </p>
            </div>

            <div className="py-3.5">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  02. Flexible Cash ISA
                </h3>
                <span className="text-xs font-mono-num text-teal-700 dark:text-teal-400">
                  {settings.cashIsaRate}% AER tax-free
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Shield up to £20,000 per tax year from savings interest tax. Ideal for 1–5 year targets where capital protection matters.
              </p>
            </div>

            <div className="py-3.5">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  03. Lifetime ISA (First Home / Age 60)
                </h3>
                <span className="text-xs font-mono-num text-emerald-700 dark:text-emerald-400">
                  +25% govt bonus
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Eligible savers (aged 18–39) receive up to £1,000/yr free bonus on £4,000/yr contributions toward a first property or retirement.
              </p>
            </div>

            <div className="py-3.5">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  04. Global Index Stocks &amp; Shares ISA
                </h3>
                <span className="text-xs font-mono-num text-slate-600 dark:text-slate-400">
                  5+ year horizon
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                For money you will not need for 5+ years, low-cost diversified equities outpace inflation tax-free (capital at risk).
              </p>
            </div>
          </div>
        </section>

        {/* Personal Financial Goals */}
        <section className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Long-Term Financial Goals
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Projected completion dates update live as you trim spending
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAddGoal((v) => !v)}
              className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              {showAddGoal ? 'Close Form' : 'Add Goal'}
            </button>
          </div>

          {showAddGoal && (
            <form
              onSubmit={handleCreateGoal}
              className="mb-5 p-4 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-2 gap-3"
            >
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Goal Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g., House Deposit, Sabbatical Fund"
                  value={goalName}
                  onChange={(e) => setGoalName(e.target.value)}
                  className="w-full min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Target Amount
                </label>
                <input
                  type="number"
                  required
                  min={100}
                  value={goalTarget}
                  onChange={(e) => setGoalTarget(e.target.value)}
                  className="w-full min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-mono-num text-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Already Saved
                </label>
                <input
                  type="number"
                  min={0}
                  value={goalSaved}
                  onChange={(e) => setGoalSaved(e.target.value)}
                  className="w-full min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-mono-num text-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Savings Vehicle
                </label>
                <select
                  value={goalVehicle}
                  onChange={(e) => setGoalVehicle(e.target.value as SavingsVehicleId)}
                  className="w-full min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100"
                >
                  <option value="cash_isa">Cash ISA (Tax-Free)</option>
                  <option value="lifetime_isa">Lifetime ISA (+25% Bonus)</option>
                  <option value="stocks_isa">Stocks &amp; Shares ISA</option>
                  <option value="emergency_fund">Easy-Access Emergency</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Share of Monthly Savings (%)
                </label>
                <input
                  type="number"
                  min={5}
                  max={100}
                  value={goalAlloc}
                  onChange={(e) => setGoalAlloc(e.target.value)}
                  className="w-full min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-mono-num text-slate-900 dark:text-slate-100"
                />
              </div>
              <div className="sm:col-span-2 flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowAddGoal(false)}
                  className="min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="min-h-[38px] px-4 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium cursor-pointer"
                >
                  Save Goal
                </button>
              </div>
            </form>
          )}

          <PortfolioGoalsProgressBar
            goals={goals}
            totalMonthlyPot={activeMonthlyContribution}
            settings={settings}
            currency={currency}
          />

          {goals.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
              No savings goals added yet. Click &ldquo;Add Goal&rdquo; to track progress with live growth projections.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {goals.map((goal) => {
                const est = estimateGoalMonths(goal, activeMonthlyContribution, settings);

                return (
                  <div key={goal.id} className="py-4 first:pt-1 last:pb-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {goal.name}
                        </h3>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                          {VEHICLE_LABELS[goal.vehicle]} · {goal.monthlyAllocationPct}% allocation (
                          <span className="font-mono-num">
                            {formatMoney(est.monthlyAllocated, currency)}/mo
                          </span>
                          )
                        </p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <div className="text-right font-mono-num">
                          <p className="text-sm font-semibold text-teal-700 dark:text-teal-400">
                            {est.targetDateLabel}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {est.months !== null ? `${est.months} mo left` : 'Paused'}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => onDeleteGoal(goal.id)}
                          aria-label={`Delete ${goal.name}`}
                          className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <GoalProgressBar
                      goal={goal}
                      totalMonthlyPot={activeMonthlyContribution}
                      settings={settings}
                      currency={currency}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
