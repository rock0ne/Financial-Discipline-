import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import {
  formatMoney,
  type CurrencyCode,
  type MonthlyBreakdown,
} from '../types/finance';

interface D3SpendingTrendChartProps {
  monthlySeries: MonthlyBreakdown[];
  currency: CurrencyCode;
  nonEssentialTarget: number;
}

export const D3SpendingTrendChart: React.FC<D3SpendingTrendChartProps> = ({
  monthlySeries,
  currency,
  nonEssentialTarget,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [width, setWidth] = useState(720);
  const [showTotal, setShowTotal] = useState(true);
  const [showTarget, setShowTarget] = useState(true);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  // Strictly slice the last 12 months for the 12-month progress view
  const data = useMemo(() => monthlySeries.slice(-12), [monthlySeries]);

  // Measure container responsively across Windows desktop & mobile viewports
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const nextWidth = Math.floor(entries[0]?.contentRect.width ?? 720);
      if (nextWidth > 0) setWidth(nextWidth);
    });
    observer.observe(el);
    setWidth(Math.floor(el.getBoundingClientRect().width) || 720);
    return () => observer.disconnect();
  }, []);

  // Compute progress delta: last 3 months avg vs first 3 months avg of non-essential spend
  const nonEssentialProgress = useMemo(() => {
    if (data.length < 2) return null;
    const windowSize = Math.min(3, Math.floor(data.length / 2));
    const earlyAvg =
      data.slice(0, windowSize).reduce((s, d) => s + d.nonEssential, 0) / windowSize;
    const recentAvg =
      data.slice(-windowSize).reduce((s, d) => s + d.nonEssential, 0) / windowSize;
    const delta = recentAvg - earlyAvg;
    const pct = earlyAvg > 0 ? (delta / earlyAvg) * 100 : 0;
    return { earlyAvg, recentAvg, delta, pct };
  }, [data]);

  const height = 280;
  const margin = { top: 18, right: 18, bottom: 32, left: 58 };

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl || data.length === 0) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const innerW = Math.max(120, width - margin.left - margin.right);
    const innerH = height - margin.top - margin.bottom;

    const xScale = d3
      .scalePoint<string>()
      .domain(data.map((d) => d.label))
      .range([0, innerW])
      .padding(0.25);

    const maxVal =
      d3.max(data, (d) =>
        Math.max(
          showTotal ? d.totalSpending : 0,
          d.essential,
          d.nonEssential,
          showTarget ? nonEssentialTarget : 0
        )
      ) ?? 1000;

    const yScale = d3
      .scaleLinear()
      .domain([0, maxVal * 1.12])
      .nice(5)
      .range([innerH, 0]);

    // Soft gradient for non-essential area fill
    const defs = svg.append('defs');
    const grad = defs
      .append('linearGradient')
      .attr('id', 'd3-non-essential-area')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');
    grad.append('stop').attr('offset', '0%').attr('stop-color', '#d97706').attr('stop-opacity', 0.22);
    grad.append('stop').attr('offset', '100%').attr('stop-color', '#d97706').attr('stop-opacity', 0.01);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    // Horizontal gridlines
    const yTicks = yScale.ticks(5);
    g.selectAll('.grid-line')
      .data(yTicks)
      .join('line')
      .attr('class', 'grid-line')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', (d) => yScale(d))
      .attr('y2', (d) => yScale(d))
      .attr('stroke', 'currentColor')
      .attr('stroke-opacity', 0.1)
      .attr('stroke-dasharray', '3,3');

    // Axes
    const xAxis = d3
      .axisBottom(xScale)
      .tickSize(0)
      .tickPadding(10)
      .tickValues(
        width < 480
          ? data.filter((_, i) => i % 2 === 0 || i === data.length - 1).map((d) => d.label)
          : data.map((d) => d.label)
      );

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

    // Target Non-Essential Reference Line
    if (showTarget && nonEssentialTarget > 0) {
      const targetY = yScale(nonEssentialTarget);
      g.append('line')
        .attr('x1', 0)
        .attr('x2', innerW)
        .attr('y1', targetY)
        .attr('y2', targetY)
        .attr('stroke', '#0f766e')
        .attr('stroke-width', 1.5)
        .attr('stroke-dasharray', '5,4');

      g.append('text')
        .attr('x', innerW)
        .attr('y', Math.max(10, targetY - 6))
        .attr('text-anchor', 'end')
        .attr('fill', '#0f766e')
        .style('font-size', '10px')
        .style('font-weight', '600')
        .style('font-family', 'var(--font-mono)')
        .text(`Cut Target ${formatMoney(nonEssentialTarget, currency)}/mo`);
    }

    // Area under Non-Essential curve
    const nonEssArea = d3
      .area<MonthlyBreakdown>()
      .x((d) => xScale(d.label) ?? 0)
      .y0(innerH)
      .y1((d) => yScale(d.nonEssential))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(data)
      .attr('fill', 'url(#d3-non-essential-area)')
      .attr('d', nonEssArea);

    // Line generators
    const makeLine = (accessor: (d: MonthlyBreakdown) => number) =>
      d3
        .line<MonthlyBreakdown>()
        .x((d) => xScale(d.label) ?? 0)
        .y((d) => yScale(accessor(d)))
        .curve(d3.curveMonotoneX);

    // 1. Total Spending (optional subtle dashed line)
    if (showTotal) {
      g.append('path')
        .datum(data)
        .attr('fill', 'none')
        .attr('stroke', '#94a3b8')
        .attr('stroke-width', 1.5)
        .attr('stroke-dasharray', '4,4')
        .attr('d', makeLine((d) => d.totalSpending));
    }

    // 2. Essential Spending line
    g.append('path')
      .datum(data)
      .attr('fill', 'none')
      .attr('stroke', '#475569')
      .attr('stroke-width', 2)
      .attr('d', makeLine((d) => d.essential));

    // 3. Non-Essential Spending line (primary focus)
    g.append('path')
      .datum(data)
      .attr('fill', 'none')
      .attr('stroke', '#d97706')
      .attr('stroke-width', 2.75)
      .attr('d', makeLine((d) => d.nonEssential));

    // Data point dots for Non-Essential
    g.selectAll('.non-ess-dot')
      .data(data)
      .join('circle')
      .attr('class', 'non-ess-dot')
      .attr('cx', (d) => xScale(d.label) ?? 0)
      .attr('cy', (d) => yScale(d.nonEssential))
      .attr('r', (_, i) => (i === hoveredIdx ? 5.5 : 3.2))
      .attr('fill', '#d97706')
      .attr('stroke', '#ffffff')
      .attr('stroke-width', 1.5);

    // Hover guide line & active points
    if (hoveredIdx !== null && data[hoveredIdx]) {
      const pt = data[hoveredIdx];
      const cx = xScale(pt.label) ?? 0;

      g.append('line')
        .attr('x1', cx)
        .attr('x2', cx)
        .attr('y1', 0)
        .attr('y2', innerH)
        .attr('stroke', '#64748b')
        .attr('stroke-opacity', 0.4)
        .attr('stroke-dasharray', '2,2');

      g.append('circle')
        .attr('cx', cx)
        .attr('cy', yScale(pt.essential))
        .attr('r', 4.5)
        .attr('fill', '#475569')
        .attr('stroke', '#ffffff')
        .attr('stroke-width', 1.5);

      if (showTotal) {
        g.append('circle')
          .attr('cx', cx)
          .attr('cy', yScale(pt.totalSpending))
          .attr('r', 4)
          .attr('fill', '#94a3b8')
          .attr('stroke', '#ffffff')
          .attr('stroke-width', 1.5);
      }
    }

    // Transparent interaction layer for pointer/touch hover scrubbing
    const positions = data.map((d) => xScale(d.label) ?? 0);
    g.append('rect')
      .attr('width', innerW)
      .attr('height', innerH)
      .attr('fill', 'transparent')
      .style('cursor', 'crosshair')
      .on('mousemove', (event: MouseEvent) => {
        const [mx] = d3.pointer(event);
        let nearest = 0;
        let bestDist = Infinity;
        for (let i = 0; i < positions.length; i++) {
          const dist = Math.abs(positions[i] - mx);
          if (dist < bestDist) {
            bestDist = dist;
            nearest = i;
          }
        }
        setHoveredIdx(nearest);
      })
      .on('mouseleave', () => setHoveredIdx(null));
  }, [data, width, currency, nonEssentialTarget, showTotal, showTarget, hoveredIdx]);

  const activePoint = hoveredIdx !== null ? data[hoveredIdx] : null;

  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-4">
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            12-Month Spending Trajectory (D3 Trend)
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            <span>Track progress cutting non-essential expenses month over month</span>
            {nonEssentialProgress && (
              <>
                <span aria-hidden="true">·</span>
                <span
                  className={`font-mono-num font-medium ${
                    nonEssentialProgress.delta <= 0
                      ? 'text-teal-700 dark:text-teal-400'
                      : 'text-amber-700 dark:text-amber-400'
                  }`}
                >
                  Non-essential {nonEssentialProgress.delta <= 0 ? 'down' : 'up'}{' '}
                  {formatMoney(Math.abs(nonEssentialProgress.delta), currency)}/mo (
                  {nonEssentialProgress.pct > 0 ? '+' : ''}
                  {Math.round(nonEssentialProgress.pct)}%) vs. early quarter
                </span>
              </>
            )}
          </div>
        </div>

        {/* Interactive Legend & Series Toggles */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 dark:text-slate-400 shrink-0">
          <span className="inline-flex items-center gap-1.5 font-medium text-slate-800 dark:text-slate-200">
            <span className="w-3 h-0.5 bg-amber-600 inline-block" />
            Non-Essential
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-slate-600 inline-block" />
            Essential
          </span>
          <button
            type="button"
            onClick={() => setShowTotal((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs transition-colors cursor-pointer ${
              showTotal
                ? 'border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200'
                : 'border-transparent text-slate-400 line-through'
            }`}
          >
            <span className="w-3 h-0.5 border-t border-dashed border-slate-400 inline-block" />
            Total
          </button>
          <button
            type="button"
            onClick={() => setShowTarget((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs transition-colors cursor-pointer ${
              showTarget
                ? 'border-teal-600/40 text-teal-800 dark:text-teal-300'
                : 'border-transparent text-slate-400 line-through'
            }`}
          >
            <span className="w-3 h-0.5 border-t border-dashed border-teal-600 inline-block" />
            Cut Target
          </button>
        </div>
      </div>

      {/* Interactive Scrubbed Month Readout Bar */}
      <div className="min-h-[24px] flex flex-wrap items-center justify-between gap-2 text-xs font-mono-num text-slate-600 dark:text-slate-400">
        {activePoint ? (
          <>
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              {activePoint.label}
            </span>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="text-amber-700 dark:text-amber-400">
                Non-Essential: {formatMoney(activePoint.nonEssential, currency)}
              </span>
              <span>Essential: {formatMoney(activePoint.essential, currency)}</span>
              <span>Total: {formatMoney(activePoint.totalSpending, currency)}</span>
              <span className="text-teal-700 dark:text-teal-400">
                Net Surplus: {formatMoney(activePoint.netCashFlow, currency)}
              </span>
            </div>
          </>
        ) : (
          <span>Hover or tap along the line to inspect exact monthly figures</span>
        )}
      </div>

      {/* Responsive D3 SVG Container */}
      <div ref={containerRef} className="w-full overflow-hidden">
        <svg
          ref={svgRef}
          width={width}
          height={height}
          role="img"
          aria-label="12-month monthly spending trend D3 line chart"
          className="block w-full text-slate-900 dark:text-slate-100"
        />
      </div>
    </section>
  );
};
