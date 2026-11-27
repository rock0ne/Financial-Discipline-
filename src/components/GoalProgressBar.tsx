import React, { useMemo } from 'react';
import {
  formatMoney,
  type CurrencyCode,
  type IsaPlannerSettings,
  type SavingsGoal,
} from '../types/finance';

export interface GoalProgressCalculation {
  annualRatePct: number;
  monthlyAllocated: number;
  currentBalance: number;
  projectedBalance: number;
  projectedDeposits: number;
  projectedGrowthAndBonus: number;
  currentPct: number;
  projectedPct: number;
  depositsBarPct: number;
  growthBarPct: number;
  remainingGap: number;
  projectedSurplus: number;
  reachesTargetWithinHorizon: boolean;
}

export function getGoalAnnualRate(
  vehicle: SavingsGoal['vehicle'],
  settings: IsaPlannerSettings
): number {
  if (vehicle === 'stocks_isa') return settings.stocksIsaRate;
  if (vehicle === 'lifetime_isa') return settings.lisaRate;
  if (vehicle === 'cash_isa') return settings.cashIsaRate;
  return Math.max(settings.cashIsaRate - 0.35, 3.5);
}

/**
 * Projects a single savings goal balance across the selected horizon using
 * its starting balance, monthly allocation, compound growth rate, and LISA bonus.
 */
export function calculateGoalProgress(
  goal: SavingsGoal,
  totalMonthlyPot: number,
  settings: IsaPlannerSettings
): GoalProgressCalculation {
  const target = Math.max(goal.targetAmount, 1);
  const currentBalance = Math.max(goal.currentSaved, 0);
  const annualRatePct = getGoalAnnualRate(goal.vehicle, settings);
  const monthlyRate = annualRatePct / 100 / 12;
  const monthlyAllocated = Math.max(
    0,
    (totalMonthlyPot * goal.monthlyAllocationPct) / 100
  );
  const horizonMonths = Math.max(1, settings.horizonYears * 12);

  let balance = currentBalance;
  let totalDeposits = 0;
  let totalBonus = 0;

  for (let m = 0; m < horizonMonths; m++) {
    const lisaBonus =
      goal.vehicle === 'lifetime_isa'
        ? Math.min(monthlyAllocated, 4000 / 12) * 0.25
        : 0;
    totalDeposits += monthlyAllocated;
    totalBonus += lisaBonus;
    balance = (balance + monthlyAllocated + lisaBonus) * (1 + monthlyRate);
  }

  const projectedBalance = Math.round(balance);
  const projectedDeposits = Math.round(totalDeposits);
  const projectedGrowthAndBonus = Math.max(
    0,
    Math.round(projectedBalance - currentBalance - projectedDeposits)
  );

  const currentPct = Math.min(100, (currentBalance / target) * 100);
  const projectedPct = Math.min(100, (projectedBalance / target) * 100);

  // Split the projected bar segment beyond currentPct proportionally between deposits and growth/bonus
  const additionalPct = Math.max(0, projectedPct - currentPct);
  const totalGain = projectedDeposits + projectedGrowthAndBonus;
  const depositsBarPct =
    totalGain > 0 ? additionalPct * (projectedDeposits / totalGain) : 0;
  const growthBarPct =
    totalGain > 0 ? additionalPct * (projectedGrowthAndBonus / totalGain) : 0;

  return {
    annualRatePct,
    monthlyAllocated,
    currentBalance,
    projectedBalance,
    projectedDeposits,
    projectedGrowthAndBonus,
    currentPct,
    projectedPct,
    depositsBarPct,
    growthBarPct,
    remainingGap: Math.max(0, Math.round(target - projectedBalance)),
    projectedSurplus: Math.max(0, Math.round(projectedBalance - target)),
    reachesTargetWithinHorizon: projectedBalance >= target,
  };
}

interface GoalProgressBarProps {
  goal: SavingsGoal;
  totalMonthlyPot: number;
  settings: IsaPlannerSettings;
  currency: CurrencyCode;
}

export const GoalProgressBar: React.FC<GoalProgressBarProps> = ({
  goal,
  totalMonthlyPot,
  settings,
  currency,
}) => {
  const calc = useMemo(
    () => calculateGoalProgress(goal, totalMonthlyPot, settings),
    [goal, totalMonthlyPot, settings]
  );

  const rawCurrentPct = Math.round((calc.currentBalance / Math.max(goal.targetAmount, 1)) * 100);
  const rawProjectedPct = Math.round(
    (calc.projectedBalance / Math.max(goal.targetAmount, 1)) * 100
  );

  return (
    <div className="mt-3 space-y-2">
      {/* Top Progress Figures */}
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-slate-600 dark:text-slate-400">
          <span>
            Now:{' '}
            <strong className="font-mono-num text-slate-900 dark:text-slate-100">
              {formatMoney(calc.currentBalance, currency)}
            </strong>{' '}
            <span className="font-mono-num">({rawCurrentPct}%)</span>
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {settings.horizonYears}Y Projected ({calc.annualRatePct.toFixed(2)}%):{' '}
            <strong
              className={`font-mono-num ${
                calc.reachesTargetWithinHorizon
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-teal-700 dark:text-teal-400'
              }`}
            >
              {formatMoney(calc.projectedBalance, currency)}
            </strong>{' '}
            <span className="font-mono-num">({Math.min(rawProjectedPct, 999)}%)</span>
          </span>
        </div>

        <span className="font-mono-num text-slate-600 dark:text-slate-400 shrink-0">
          Target {formatMoney(goal.targetAmount, currency)}
        </span>
      </div>

      {/* Multi-Segment Progress Bar: Current Balance + Projected Contributions + Compound Growth */}
      <div
        role="progressbar"
        aria-label={`${goal.name} savings progress: ${rawCurrentPct}% currently saved, ${rawProjectedPct}% projected over ${settings.horizonYears} years at ${calc.annualRatePct.toFixed(2)}% annual growth`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, rawProjectedPct)}
        className="w-full h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex"
      >
        {calc.currentPct > 0 && (
          <div
            className="h-full bg-teal-700 dark:bg-teal-500 transition-[width] duration-200"
            style={{ width: `${calc.currentPct}%` }}
            title={`Current balance: ${formatMoney(calc.currentBalance, currency)}`}
          />
        )}
        {calc.depositsBarPct > 0 && (
          <div
            className="h-full bg-sky-500/80 dark:bg-sky-400/70 transition-[width] duration-200"
            style={{ width: `${calc.depositsBarPct}%` }}
            title={`Projected contributions (${settings.horizonYears}Y): +${formatMoney(calc.projectedDeposits, currency)}`}
          />
        )}
        {calc.growthBarPct > 0 && (
          <div
            className="h-full bg-emerald-500 dark:bg-emerald-400 transition-[width] duration-200"
            style={{ width: `${calc.growthBarPct}%` }}
            title={`Projected growth & bonus (${calc.annualRatePct.toFixed(2)}%): +${formatMoney(calc.projectedGrowthAndBonus, currency)}`}
          />
        )}
      </div>

      {/* Bottom Breakdown & Status Text (No Hue-Only Signaling) */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-xs bg-teal-700 dark:bg-teal-500 inline-block" />
            <span>
              Saved <span className="font-mono-num">{formatMoney(calc.currentBalance, currency)}</span>
            </span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-xs bg-sky-500/80 dark:bg-sky-400/70 inline-block" />
            <span>
              Deposits{' '}
              <span className="font-mono-num">+{formatMoney(calc.projectedDeposits, currency)}</span>
            </span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-xs bg-emerald-500 dark:bg-emerald-400 inline-block" />
            <span>
              Growth{goal.vehicle === 'lifetime_isa' ? ' & LISA bonus' : ''}{' '}
              <span className="font-mono-num">
                +{formatMoney(calc.projectedGrowthAndBonus, currency)}
              </span>
            </span>
          </span>
        </div>

        <span
          className={`font-medium font-mono-num ${
            calc.reachesTargetWithinHorizon
              ? 'text-emerald-700 dark:text-emerald-400'
              : 'text-slate-600 dark:text-slate-300'
          }`}
        >
          {calc.reachesTargetWithinHorizon
            ? calc.projectedSurplus > 0
              ? `On track (+${formatMoney(calc.projectedSurplus, currency)} buffer)`
              : `Goal reached within ${settings.horizonYears}Y`
            : `${formatMoney(calc.remainingGap, currency)} gap after ${settings.horizonYears}Y`}
        </span>
      </div>
    </div>
  );
};

interface PortfolioGoalsProgressBarProps {
  goals: SavingsGoal[];
  totalMonthlyPot: number;
  settings: IsaPlannerSettings;
  currency: CurrencyCode;
}

export const PortfolioGoalsProgressBar: React.FC<PortfolioGoalsProgressBarProps> = ({
  goals,
  totalMonthlyPot,
  settings,
  currency,
}) => {
  const summary = useMemo(() => {
    let totalTarget = 0;
    let totalCurrent = 0;
    let totalProjectedCapped = 0;
    let totalProjectedRaw = 0;
    let totalGrowth = 0;
    let weightedRateNumerator = 0;
    let goalsOnTrack = 0;

    for (const g of goals) {
      const c = calculateGoalProgress(g, totalMonthlyPot, settings);
      totalTarget += Math.max(g.targetAmount, 0);
      totalCurrent += Math.min(c.currentBalance, g.targetAmount);
      totalProjectedCapped += Math.min(c.projectedBalance, g.targetAmount);
      totalProjectedRaw += c.projectedBalance;
      totalGrowth += c.projectedGrowthAndBonus;
      weightedRateNumerator += c.annualRatePct * Math.max(g.targetAmount, 1);
      if (c.reachesTargetWithinHorizon) goalsOnTrack++;
    }

    const safeTarget = Math.max(totalTarget, 1);
    const currentPct = Math.min(100, (totalCurrent / safeTarget) * 100);
    const projectedPct = Math.min(100, (totalProjectedCapped / safeTarget) * 100);
    const weightedAvgRate = totalTarget > 0 ? weightedRateNumerator / totalTarget : settings.cashIsaRate;

    return {
      totalTarget,
      totalCurrent,
      totalProjectedRaw,
      totalGrowth,
      currentPct,
      projectedPct,
      weightedAvgRate,
      goalsOnTrack,
    };
  }, [goals, totalMonthlyPot, settings]);

  if (goals.length === 0) return null;

  return (
    <div className="mb-5 pb-5 border-b border-slate-100 dark:border-slate-800 space-y-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
            Combined Goal Progress ({settings.horizonYears}-Year Outlook · {summary.weightedAvgRate.toFixed(2)}% avg growth)
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            {summary.goalsOnTrack} of {goals.length} goal{goals.length === 1 ? '' : 's'} projected to reach target within {settings.horizonYears} year{settings.horizonYears === 1 ? '' : 's'} ·{' '}
            <span className="font-mono-num text-emerald-700 dark:text-emerald-400 font-medium">
              +{formatMoney(summary.totalGrowth, currency)}
            </span>{' '}
            estimated compound growth &amp; bonuses
          </p>
        </div>

        <div className="text-right font-mono-num text-xs">
          <span className="font-semibold text-slate-900 dark:text-slate-100">
            {summary.currentPct.toFixed(0)}% now
          </span>
          <span className="mx-1.5 text-slate-400">→</span>
          <span className="font-semibold text-teal-700 dark:text-teal-400">
            {summary.projectedPct.toFixed(0)}% in {settings.horizonYears}Y
          </span>
        </div>
      </div>

      <div
        role="progressbar"
        aria-label={`Combined savings goals progress: ${summary.currentPct.toFixed(0)}% currently funded, ${summary.projectedPct.toFixed(0)}% projected in ${settings.horizonYears} years`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(summary.projectedPct)}
        className="w-full h-3 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex"
      >
        <div
          className="h-full bg-teal-700 dark:bg-teal-500 transition-[width] duration-200"
          style={{ width: `${summary.currentPct}%` }}
        />
        <div
          className="h-full bg-emerald-500/80 dark:bg-emerald-400/75 transition-[width] duration-200"
          style={{ width: `${Math.max(0, summary.projectedPct - summary.currentPct)}%` }}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono-num text-slate-500 dark:text-slate-400">
        <span>Current balance: {formatMoney(summary.totalCurrent, currency)}</span>
        <span>
          Projected ({settings.horizonYears}Y): {formatMoney(summary.totalProjectedRaw, currency)} / {formatMoney(summary.totalTarget, currency)} target
        </span>
      </div>
    </div>
  );
};
