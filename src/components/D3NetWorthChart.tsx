import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import {
  formatMoney,
  type CurrencyCode,
  type DebtAccount,
  type IsaPlannerSettings,
  type NetWorthDebtStrategy,
  type NetWorthProjectionPoint,
} from '../types/finance';
import {
  computeBlendedIsaReturnPct,
  computeFiveYearNetWorthProjection,
} from '../utils/analyticsEngine';

interface D3NetWorthChartProps {
  currentSavings: number;
  debts: DebtAccount[];
  monthlyContribution: number;
  isaSettings: IsaPlannerSettings;
  currency: CurrencyCode;
  onNavigateDebt?: () => void;
}

export const D3NetWorthChart: React.FC<D3NetWorthChartProps> = ({
  currentSavings,
  debts,
  monthlyContribution,
  isaSettings,
  currency,
  onNavigateDebt,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [width, setWidth] = useState(760);

  const hasDebt = useMemo(
    () => debts.some((d) => d.balance > 0.01),
    [debts]
  );

  // Interactive modeling parameters for debt reduction rate & investment growth
  const [debtStrategy, setDebtStrategy] = useState<NetWorthDebtStrategy>('avalanche');
  const [extraDebtPayment, setExtraDebtPayment] = useState<number>(() =>
    Math.min(300, Math.max(0, Math.round(monthlyContribution * 0.25 / 25) * 25))
  );
  const [returnOverridePct, setReturnOverridePct] = useState<number | null>(null);

  // Series visibility toggles
  const [showAssets, setShowAssets] = useState(true);
  const [showDebt, setShowDebt] = useState(true);
  const [showBaseline, setShowBaseline] = useState(true);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const blendedIsaReturn = useMemo(
    () => computeBlendedIsaReturnPct(isaSettings),
    [isaSettings]
  );

  const effectiveReturnPct = returnOverridePct ?? blendedIsaReturn;

  // Keep monthly cash split sensible: extra debt payment draws from or adds cleanly alongside monthly savings
  const effectiveExtraDebt = hasDebt && debtStrategy !== 'minimums_only' ? extraDebtPayment : 0;

  const projection = useMemo(
    () =>
      computeFiveYearNetWorthProjection({
        currentSavings,
        debts,
        monthlyContribution,
        extraDebtPayment: effectiveExtraDebt,
        isaSettings,
        annualReturnOverridePct: returnOverridePct,
        debtStrategy,
      }),
    [
      currentSavings,
      debts,
      monthlyContribution,
      effectiveExtraDebt,
      isaSettings,
      returnOverridePct,
      debtStrategy,
    ]
  );

  // Measure container responsively across desktop & mobile
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const nextWidth = Math.floor(entries[0]?.contentRect.width ?? 760);
      if (nextWidth > 0) setWidth(nextWidth);
    });
    observer.observe(el);
    setWidth(Math.floor(el.getBoundingClientRect().width) || 760);
    return () => observer.disconnect();
  }, []);

  const height = 310;
  const margin = { top: 22, right: 20, bottom: 32, left: 66 };

  useEffect(() => {
    const svgEl = svgRef.current;
    const data = projection.points;
    if (!svgEl || data.length === 0) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const innerW = Math.max(140, width - margin.left - margin.right);
    const innerH = height - margin.top - margin.bottom;

    const xScale = d3.scaleLinear().domain([0, 60]).range([0, innerW]);

    let minVal = 0;
    let maxVal = 1000;
    for (const pt of data) {
      minVal = Math.min(minVal, pt.netWorth, showBaseline ? pt.baselineNetWorth : pt.netWorth);
      maxVal = Math.max(
        maxVal,
        pt.netWorth,
        showAssets ? pt.assets : pt.netWorth,
        showDebt && hasDebt ? pt.debt : 0,
        showBaseline ? pt.baselineNetWorth : pt.netWorth
      );
    }

    const span = Math.max(1000, maxVal - minVal);
    const domainMin = minVal < 0 ? minVal - span * 0.08 : 0;
    const domainMax = maxVal + span * 0.1;

    const yScale = d3
      .scaleLinear()
      .domain([domainMin, domainMax])
      .nice(5)
      .range([innerH, 0]);

    const defs = svg.append('defs');
    const netGrad = defs
      .append('linearGradient')
      .attr('id', 'd3-net-worth-area')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');
    netGrad.append('stop').attr('offset', '0%').attr('stop-color', '#0f766e').attr('stop-opacity', 0.22);
    netGrad.append('stop').attr('offset', '100%').attr('stop-color', '#0f766e').attr('stop-opacity', 0.01);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    // Horizontal gridlines
    const yTicks = yScale.ticks(5);
    g.selectAll('.nw-grid')
      .data(yTicks)
      .join('line')
      .attr('class', 'nw-grid')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', (d) => yScale(d))
      .attr('y2', (d) => yScale(d))
      .attr('stroke', 'currentColor')
      .attr('stroke-opacity', (d) => (d === 0 ? 0.28 : 0.1))
      .attr('stroke-dasharray', (d) => (d === 0 ? 'none' : '3,3'));

    // X Axis (Now, Yr 1, Yr 2, Yr 3, Yr 4, Yr 5)
    const xTickVals = width < 440 ? [0, 12, 24, 36, 48, 60] : [0, 12, 24, 36, 48, 60];
    const xAxis = d3
      .axisBottom(xScale)
      .tickValues(xTickVals)
      .tickSize(0)
      .tickPadding(10)
      .tickFormat((d) => {
        const m = Number(d);
        if (m === 0) return 'Now';
        return `Yr ${m / 12}`;
      });

    const yAxis = d3
      .axisLeft(yScale)
      .ticks(5)
      .tickSize(0)
      .tickPadding(10)
      .tickFormat((d) => formatMoney(Number(d), currency));

    g.append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(xAxis)
      .call((sel) => sel.select('.domain').remove())
      .selectAll('text')
      .attr('fill', '#64748b')
      .style('font-size', '11px')
      .style('font-family', 'var(--font-mono)');

    g.append('g')
      .call(yAxis)
      .call((sel) => sel.select('.domain').remove())
      .selectAll('text')
      .attr('fill', '#64748b')
      .style('font-size', '11px')
      .style('font-family', 'var(--font-mono)');

    // Net Worth shaded area anchored cleanly to zero line
    const zeroY = Math.min(innerH, Math.max(0, yScale(0)));
    const netWorthArea = d3
      .area<NetWorthProjectionPoint>()
      .x((d) => xScale(d.month))
      .y0(zeroY)
      .y1((d) => yScale(d.netWorth))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(data)
      .attr('fill', 'url(#d3-net-worth-area)')
      .attr('d', netWorthArea);

    const makeLine = (accessor: (d: NetWorthProjectionPoint) => number) =>
      d3
        .line<NetWorthProjectionPoint>()
        .x((d) => xScale(d.month))
        .y((d) => yScale(accessor(d)))
        .curve(d3.curveMonotoneX);

    // 1. Baseline comparison (minimum debt + low-yield current account)
    if (showBaseline) {
      g.append('path')
        .datum(data)
        .attr('fill', 'none')
        .attr('stroke', '#94a3b8')
        .attr('stroke-width', 1.6)
        .attr('stroke-dasharray', '4,4')
        .attr('d', makeLine((d) => d.baselineNetWorth));
    }

    // 2. Savings & Investments (Assets)
    if (showAssets) {
      g.append('path')
        .datum(data)
        .attr('fill', 'none')
        .attr('stroke', '#0284c7')
        .attr('stroke-width', 2)
        .attr('d', makeLine((d) => d.assets));
    }

    // 3. Remaining Debt (when user has active debts)
    if (showDebt && hasDebt) {
      g.append('path')
        .datum(data)
        .attr('fill', 'none')
        .attr('stroke', '#dc2626')
        .attr('stroke-width', 2)
        .attr('d', makeLine((d) => d.debt));
    }

    // 4. Total Net Worth primary line
    g.append('path')
      .datum(data)
      .attr('fill', 'none')
      .attr('stroke', '#0f766e')
      .attr('stroke-width', 2.75)
      .attr('d', makeLine((d) => d.netWorth));

    // Debt-Free Milestone vertical callout if cleared within 1..60 months
    if (
      hasDebt &&
      projection.debtFreeMonth !== null &&
      projection.debtFreeMonth > 0 &&
      projection.debtFreeMonth <= 60
    ) {
      const dfX = xScale(projection.debtFreeMonth);
      g.append('line')
        .attr('x1', dfX)
        .attr('x2', dfX)
        .attr('y1', 0)
        .attr('y2', innerH)
        .attr('stroke', '#0f766e')
        .attr('stroke-width', 1.25)
        .attr('stroke-opacity', 0.6)
        .attr('stroke-dasharray', '4,3');

      const anchorRight = dfX > innerW * 0.72;
      g.append('text')
        .attr('x', anchorRight ? dfX - 6 : dfX + 6)
        .attr('y', 11)
        .attr('text-anchor', anchorRight ? 'end' : 'start')
        .attr('fill', '#0f766e')
        .style('font-size', '10px')
        .style('font-weight', '600')
        .style('font-family', 'var(--font-mono)')
        .text(`Debt-free · ${projection.debtFreeDateLabel}`);
    }

    // Year-end milestone dots on Total Net Worth line
    const yearPts = data.filter((d) => d.month % 12 === 0);
    g.selectAll('.nw-year-dot')
      .data(yearPts)
      .join('circle')
      .attr('class', 'nw-year-dot')
      .attr('cx', (d) => xScale(d.month))
      .attr('cy', (d) => yScale(d.netWorth))
      .attr('r', 3.4)
      .attr('fill', '#0f766e')
      .attr('stroke', '#ffffff')
      .attr('stroke-width', 1.5);

    // Interactive Hover Crosshair & Active Dots
    if (hoveredIdx !== null && data[hoveredIdx]) {
      const pt = data[hoveredIdx];
      const cx = xScale(pt.month);

      g.append('line')
        .attr('x1', cx)
        .attr('x2', cx)
        .attr('y1', 0)
        .attr('y2', innerH)
        .attr('stroke', '#64748b')
        .attr('stroke-opacity', 0.45)
        .attr('stroke-dasharray', '2,2');

      if (showAssets) {
        g.append('circle')
          .attr('cx', cx)
          .attr('cy', yScale(pt.assets))
          .attr('r', 4.5)
          .attr('fill', '#0284c7')
          .attr('stroke', '#ffffff')
          .attr('stroke-width', 1.5);
      }

      if (showDebt && hasDebt) {
        g.append('circle')
          .attr('cx', cx)
          .attr('cy', yScale(pt.debt))
          .attr('r', 4.5)
          .attr('fill', '#dc2626')
          .attr('stroke', '#ffffff')
          .attr('stroke-width', 1.5);
      }

      if (showBaseline) {
        g.append('circle')
          .attr('cx', cx)
          .attr('cy', yScale(pt.baselineNetWorth))
          .attr('r', 3.8)
          .attr('fill', '#94a3b8')
          .attr('stroke', '#ffffff')
          .attr('stroke-width', 1.5);
      }

      g.append('circle')
        .attr('cx', cx)
        .attr('cy', yScale(pt.netWorth))
        .attr('r', 5.5)
        .attr('fill', '#0f766e')
        .attr('stroke', '#ffffff')
        .attr('stroke-width', 1.75);
    }

    // Transparent interaction layer for pointer/touch scrubbing across all 61 months
    const updateFromClientX = (mx: number) => {
      const rawMonth = Math.round(xScale.invert(mx));
      const clamped = Math.max(0, Math.min(data.length - 1, rawMonth));
      setHoveredIdx(clamped);
    };

    g.append('rect')
      .attr('width', innerW)
      .attr('height', innerH)
      .attr('fill', 'transparent')
      .style('cursor', 'crosshair')
      .on('pointermove', (event: PointerEvent) => {
        const [mx] = d3.pointer(event);
        updateFromClientX(mx);
      })
      .on('pointerdown', (event: PointerEvent) => {
        const [mx] = d3.pointer(event);
        updateFromClientX(mx);
      })
      .on('pointerleave', () => setHoveredIdx(null));
  }, [
    projection,
    width,
    currency,
    hasDebt,
    showAssets,
    showDebt,
    showBaseline,
    hoveredIdx,
  ]);

  const activePoint = hoveredIdx !== null ? projection.points[hoveredIdx] : null;
  const advantageVsBaseline = projection.projectedNetWorth5Y - projection.baselineNetWorth5Y;

  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-5">
      {/* Header + Series Toggles */}
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            5-Year Total Net Worth Projection (D3)
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Combines current savings ({formatMoney(projection.startingSavings, currency)}), debt paydown
            {hasDebt
              ? ` (${formatMoney(projection.startingDebt, currency)} starting debt)`
              : ' (no active debt logged)'}
            , and compounding growth at{' '}
            <span className="font-mono-num font-medium text-slate-700 dark:text-slate-300">
              {projection.blendedAnnualReturnPct.toFixed(2)}%
            </span>{' '}
            est. annual return
          </p>
        </div>

        {/* Interactive Legend / Series Toggles */}
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-400 shrink-0">
          <span className="inline-flex items-center gap-1.5 font-medium text-slate-800 dark:text-slate-200 px-1.5 py-1">
            <span className="w-3 h-0.5 bg-teal-700 inline-block" />
            Net Worth
          </span>
          <button
            type="button"
            onClick={() => setShowAssets((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs transition-colors cursor-pointer ${
              showAssets
                ? 'border-sky-600/40 text-sky-800 dark:text-sky-300'
                : 'border-transparent text-slate-400 line-through'
            }`}
          >
            <span className="w-3 h-0.5 bg-sky-600 inline-block" />
            Savings &amp; Investments
          </button>
          {hasDebt && (
            <button
              type="button"
              onClick={() => setShowDebt((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs transition-colors cursor-pointer ${
                showDebt
                  ? 'border-red-600/40 text-red-700 dark:text-red-400'
                  : 'border-transparent text-slate-400 line-through'
              }`}
            >
              <span className="w-3 h-0.5 bg-red-600 inline-block" />
              Remaining Debt
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowBaseline((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs transition-colors cursor-pointer ${
              showBaseline
                ? 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                : 'border-transparent text-slate-400 line-through'
            }`}
          >
            <span className="w-3 h-0.5 border-t border-dashed border-slate-400 inline-block" />
            Min. Baseline
          </button>
        </div>
      </div>

      {/* 4-Metric Net Worth Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40 divide-y lg:divide-y-0 lg:divide-x divide-slate-200/80 dark:divide-slate-800">
        <div className="p-3.5 sm:p-4">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Starting Net Worth
          </p>
          <p
            className={`mt-1 text-lg font-semibold font-mono-num ${
              projection.startingNetWorth < 0
                ? 'text-red-700 dark:text-red-400'
                : 'text-slate-900 dark:text-slate-100'
            }`}
          >
            {formatMoney(projection.startingNetWorth, currency)}
          </p>
          <p className="mt-0.5 text-[11px] font-mono-num text-slate-500 dark:text-slate-400">
            {formatMoney(projection.startingSavings, currency)} saved − {formatMoney(projection.startingDebt, currency)} debt
          </p>
        </div>

        <div className="p-3.5 sm:p-4">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Projected 5-Year Net Worth
          </p>
          <p className="mt-1 text-lg font-semibold font-mono-num text-teal-700 dark:text-teal-400">
            {formatMoney(projection.projectedNetWorth5Y, currency)}
          </p>
          <p className="mt-0.5 text-[11px] font-mono-num text-emerald-700 dark:text-emerald-400">
            {projection.netWorthGain5Y >= 0 ? '+' : ''}
            {formatMoney(projection.netWorthGain5Y, currency)} over 5 yrs
          </p>
        </div>

        <div className="p-3.5 sm:p-4">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            5Y Investment Growth
          </p>
          <p className="mt-1 text-lg font-semibold font-mono-num text-sky-700 dark:text-sky-400">
            +{formatMoney(projection.totalInvestmentGrowth5Y, currency)}
          </p>
          <p className="mt-0.5 text-[11px] font-mono-num text-slate-500 dark:text-slate-400">
            {advantageVsBaseline >= 0 ? '+' : ''}
            {formatMoney(advantageVsBaseline, currency)} vs. baseline
          </p>
        </div>

        <div className="p-3.5 sm:p-4">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            5Y Debt Reduction
          </p>
          <p className="mt-1 text-lg font-semibold font-mono-num text-slate-900 dark:text-slate-100">
            {hasDebt ? `-${formatMoney(projection.totalDebtReduced5Y, currency)}` : 'Debt-free'}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            {hasDebt ? (
              projection.debtFreeDateLabel ? (
                <span className="font-mono-num text-teal-700 dark:text-teal-400">
                  Cleared by {projection.debtFreeDateLabel}
                </span>
              ) : (
                <span className="font-mono-num">
                  {formatMoney(projection.projectedDebt5Y, currency)} left at Yr 5
                </span>
              )
            ) : onNavigateDebt ? (
              <button
                type="button"
                onClick={onNavigateDebt}
                className="text-teal-700 dark:text-teal-400 hover:underline cursor-pointer"
              >
                Add debts in Debt tab →
              </button>
            ) : (
              '0 liabilities modeled'
            )}
          </p>
        </div>
      </div>

      {/* Interactive Scrubbed Month Readout Bar */}
      <div className="min-h-[24px] flex flex-wrap items-center justify-between gap-2 text-xs font-mono-num text-slate-600 dark:text-slate-400">
        {activePoint ? (
          <>
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              {activePoint.month === 0
                ? `Now (${activePoint.dateLabel})`
                : `Month ${activePoint.month} · ${activePoint.dateLabel}`}
            </span>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="text-teal-700 dark:text-teal-400 font-semibold">
                Net Worth: {formatMoney(activePoint.netWorth, currency)}
              </span>
              <span className="text-sky-700 dark:text-sky-400">
                Assets: {formatMoney(activePoint.assets, currency)}
              </span>
              {hasDebt && (
                <span className="text-red-700 dark:text-red-400">
                  Debt: {formatMoney(activePoint.debt, currency)}
                </span>
              )}
              <span>
                Growth: +{formatMoney(activePoint.cumulativeGrowth, currency)}
              </span>
            </div>
          </>
        ) : (
          <span>Hover or drag along the 60-month curve to inspect exact projected net worth</span>
        )}
      </div>

      {/* Responsive D3 SVG Canvas */}
      <div ref={containerRef} className="w-full overflow-hidden">
        <svg
          ref={svgRef}
          width={width}
          height={height}
          role="img"
          aria-label="5-year projected total net worth D3 chart showing net worth, savings and investments, and remaining debt"
          className="block w-full text-slate-900 dark:text-slate-100"
        />
      </div>

      {/* Inline Sensitivity Controls (Debt Paydown Rate + Investment Growth Rate) */}
      <div className="pt-4 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
        <div className={hasDebt ? 'md:col-span-5' : 'md:col-span-7'}>
          <div className="flex items-center justify-between text-xs mb-1.5">
            <label
              htmlFor="nw-return-slider"
              className="font-medium text-slate-700 dark:text-slate-300"
            >
              Projected Investment Return
            </label>
            <div className="flex items-center gap-2">
              <span className="font-mono-num font-semibold text-sky-700 dark:text-sky-400">
                {effectiveReturnPct.toFixed(2)}% / yr
              </span>
              {returnOverridePct !== null && (
                <button
                  type="button"
                  onClick={() => setReturnOverridePct(null)}
                  className="text-[11px] text-teal-700 dark:text-teal-400 hover:underline cursor-pointer"
                >
                  Use ISA ({blendedIsaReturn.toFixed(1)}%)
                </button>
              )}
            </div>
          </div>
          <input
            id="nw-return-slider"
            type="range"
            min={0.5}
            max={12}
            step={0.25}
            value={effectiveReturnPct}
            onChange={(e) => setReturnOverridePct(Number(e.target.value))}
            className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer"
          />
        </div>

        {hasDebt ? (
          <>
            <div className="md:col-span-4">
              <div className="flex items-center justify-between text-xs mb-1.5">
                <label
                  htmlFor="nw-extra-debt-slider"
                  className="font-medium text-slate-700 dark:text-slate-300"
                >
                  Extra Debt Paydown / mo
                </label>
                <span className="font-mono-num font-semibold text-teal-700 dark:text-teal-400">
                  +{formatMoney(effectiveExtraDebt, currency)}/mo
                </span>
              </div>
              <input
                id="nw-extra-debt-slider"
                type="range"
                min={0}
                max={Math.max(800, monthlyContribution)}
                step={25}
                disabled={debtStrategy === 'minimums_only'}
                value={effectiveExtraDebt}
                onChange={(e) => setExtraDebtPayment(Number(e.target.value))}
                className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg disabled:opacity-40 cursor-pointer"
              />
            </div>

            <div className="md:col-span-3 flex flex-col">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                Debt Payoff Order
              </span>
              <div
                className="inline-flex items-center p-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg"
                role="group"
                aria-label="Debt payoff strategy"
              >
                {(
                  [
                    { id: 'avalanche', label: 'Avalanche' },
                    { id: 'snowball', label: 'Snowball' },
                    { id: 'minimums_only', label: 'Min.' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setDebtStrategy(opt.id)}
                    className={`flex-1 min-h-[30px] px-2 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer ${
                      debtStrategy === opt.id
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="md:col-span-5 text-xs text-slate-500 dark:text-slate-400 md:text-right">
            Once debts are cleared, freed minimum payments automatically roll into compounding investments.
            {onNavigateDebt && (
              <>
                {' '}
                <button
                  type="button"
                  onClick={onNavigateDebt}
                  className="font-medium text-teal-700 dark:text-teal-400 hover:underline cursor-pointer"
                >
                  Configure debts →
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
};
