import React                       from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
}                                  from 'recharts';
import { useDatasetContext }        from '../context/DatasetContext';
import { useEmissionData }          from '../hooks/useEmissionData';
import { useDisplayUnit }           from '../hooks/useDisplayUnit';
import { formatMassValue, formatAxisValue } from '../utils/units';
import {
  buildLineData,
  buildBottomUpLineData,
  labelSector,
  hasUncertainty,
  activeYears,
}                                  from '../utils/emissionsUtils';
import { buildPeriodLineData }      from '../utils/manifestUtils';

const DIM_COLOR    = '#99a7b9';
const BRIGHT_COLOR = '#e2e8f0';
const TEAL_COLOR   = '#14b8a6';

// Manifest total_kg values are in the tens-of-millions for a whole-basin
// week; Gg (1e6 kg) keeps the axis/tooltip numbers readable.
const KG_TO_GG = 1e6;

// Shared axis/grid styling for both branches below. Recharts needs
// CartesianGrid/XAxis/YAxis as direct children of the chart to auto-detect
// them, so these are prop objects to spread onto each branch's own element
// rather than a wrapping component.
const GRID_STYLE      = { strokeDasharray: '3 3', stroke: 'rgba(255,255,255,0.06)' };
const AXIS_TICK_STYLE = { tick: { fill: '#94a3b8', fontSize: 13 }, axisLine: { stroke: '#2d3148' }, tickLine: false };
const Y_AXIS_STYLE    = { ...AXIS_TICK_STYLE, width: 52, tickFormatter: formatAxisValue };

function cursorStyle(accent) {
  return { stroke: accent, strokeOpacity: 0.4, strokeWidth: 1, strokeDasharray: '4 4' };
}

function TimeSeriesCustomTooltip({ active, payload, label, units, accent }) {
  if (!active || !payload?.length) return null;

  // Index by dataKey for reliable lookup regardless of render order
  const byKey = Object.fromEntries(payload.map(p => [p.dataKey, p]));
  const val   = byKey.value?.value;

  // Same +/- convention as the map's grid-cell hover tooltip: the larger of
  // the two (possibly asymmetric) deltas around the central value, collapsed
  // to a single figure, rather than separate upper/lower bound rows.
  const spread = (byKey.min && byKey.max && val != null)
    ? Math.max(0, val - byKey.min.value, byKey.max.value - val)
    : null;

  const rows = [];
  if (byKey.value)
    rows.push({ name: 'IMI Best Estimate', value: val, spread, color: BRIGHT_COLOR, weight: 600 });
  if (byKey.bottomUp && byKey.bottomUp.value != null)
    rows.push({ name: 'Bottom-up',   value: byKey.bottomUp.value, color: TEAL_COLOR,  weight: 600 });

  return (
    <div style={{
      background:   '#1a1d27',
      border:       '1px solid #2d3148',
      borderRadius: '6px',
      padding:      '0.4rem 0.65rem',
      fontSize:     '0.85rem',
      lineHeight:   1.65,
      minWidth:     '9rem',
    }}>
      <div style={{ color: accent, fontWeight: 700, marginBottom: '0.15rem' }}>
        {label}
      </div>
      {rows.map(row => (
        <div
          key={row.name}
          style={{ color: row.color, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem' }}
        >
          <span>{row.name}</span>
          <span style={{ fontWeight: row.weight }}>
            {row.value != null ? formatMassValue(row.value) : 'N/A'}
            {row.spread != null && (
              <span style={{ color: DIM_COLOR, fontWeight: 400, fontSize: '0.75rem' }}>
                {' ± '}{formatMassValue(row.spread)}
              </span>
            )}
            {units && (
              <span style={{ opacity: 0.6, fontSize: '0.68rem', marginLeft: '0.2rem' }}>
                {units}
              </span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

// Color key for charts that plot both series — swatch colors match the Line
// strokes exactly (accent = IMI output, TEAL_COLOR = bottom-up).
function SeriesLegend({ accent }) {
  const swatch = color => ({
    width: 8, height: 8, borderRadius: 2, background: color, display: 'inline-block',
  });
  return (
    <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.4rem', fontSize: '0.8rem', color: '#94a3b8' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
        <span style={swatch(accent)} />
        IMI output
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
        <span style={swatch(TEAL_COLOR)} />
        Bottom-up
      </span>
    </div>
  );
}

const SUPPORTED = new Set(['ch4-conus', 'ch4-colombia']);

export function TimeSeriesPlot() {
  const { activeDataset, activeFamily, controls, selectedState } = useDatasetContext();
  const { data: baseData } = useEmissionData();
  const { label: displayUnits, convert } = useDisplayUnit();

  if (activeDataset.gridType === 'period') {
    if (!baseData?.manifest) return null;

    // Both sources are always shown here, independent of the Data Source
    // control (which only drives what's rendered on the map) — same
    // philosophy as ch4-global's DataTotals.
    const post  = buildPeriodLineData(baseData.manifest, 'posterior', controls.sector);
    const prior = buildPeriodLineData(baseData.manifest, 'prior', controls.sector);
    if (!post.dates.length) return null;

    const accent      = activeFamily.theme.accent;
    const sectorLabel = baseData.manifest.variables?.find(v => v.key === controls.sector)?.label ?? controls.sector;
    const currentDate = baseData.manifest.periods?.find(p => p.key === String(controls.period))?.start;

    // One tick per calendar year, rather than one per week (286 of them).
    const yearTicks = [];
    const seenYears = new Set();
    for (const d of post.dates) {
      const y = d.slice(0, 4);
      if (!seenYears.has(y)) { seenYears.add(y); yearTicks.push(d); }
    }

    const chartData = post.dates.map((date, i) => ({
      date,
      value:    post.values[i]  != null ? convert(post.values[i]  / KG_TO_GG) : null,
      bottomUp: prior.values[i] != null ? convert(prior.values[i] / KG_TO_GG) : null,
    }));

    return (
      <div className="chart-panel">
        <div className="chart-header">
          <span className="chart-title">Time Series</span>
          <span className="chart-sector">{sectorLabel}</span>
          <span className="chart-units">{displayUnits}</span>
        </div>
        <SeriesLegend accent={accent} />

        <ResponsiveContainer width="100%" height={160}>
          <ComposedChart
            data={chartData}
            margin={{ top: 22, right: 16, left: 0, bottom: 0 }}
          >
            <CartesianGrid {...GRID_STYLE} />
            <XAxis
              dataKey="date"
              ticks={yearTicks}
              tickFormatter={v => v.slice(0, 4)}
              {...AXIS_TICK_STYLE}
            />
            <YAxis {...Y_AXIS_STYLE} />

            <Tooltip
              content={<TimeSeriesCustomTooltip units={displayUnits} accent={accent} />}
              cursor={cursorStyle(accent)}
            />

            <Line
              type="monotone"
              dataKey="value"
              name="Posterior"
              stroke={accent}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
              isAnimationActive={false}
            />

            <Line
              type="monotone"
              dataKey="bottomUp"
              name="Bottom-up"
              stroke={TEAL_COLOR}
              strokeWidth={1.5}
              strokeDasharray="5 3"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
              isAnimationActive={false}
              connectNulls={false}
            />

            {currentDate && (
              <ReferenceLine
                x={currentDate}
                stroke={accent}
                strokeWidth={1.5}
                strokeDasharray="4 4"
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    );
  }

  const years = activeYears(controls.satellite);
  if (!SUPPORTED.has(activeDataset.id) || years.length < 2 || !baseData) return null;

  const mode       = selectedState ? 'state' : 'national';
  const placeLabel = selectedState ?? (activeDataset.display?.defaultPlaceLabel ?? 'National');

  const lineData = buildLineData(baseData, {
    mode,
    sectorKey:     controls.sector,
    satellite:     controls.satellite,
    selectedState,
  });

  const showUncertainty = hasUncertainty(controls.satellite);
  const showBottomUp    = controls.satellite === 'posterior' && activeDataset.id === 'ch4-conus';
  const accent          = activeFamily.theme.accent;
  const accentDim       = activeFamily.theme.accentDim;

  const bottomUpLine = showBottomUp
    ? buildBottomUpLineData(baseData, {
        mode,
        sectorKey:     controls.sector,
        selectedState,
      })
    : null;

  const chartData = lineData.years.map((year, i) => ({
    year,
    value:    convert(lineData.values[i]),
    min:      convert(lineData.mins[i]),
    max:      convert(lineData.maxs[i]),
    // undefined (not null) when showBottomUp is false so Recharts ignores the key entirely
    ...(showBottomUp && { bottomUp: convert(bottomUpLine?.values[i] ?? null) }),
  }));

  return (
    <div className="chart-panel">
      <div className="chart-header">
        <span className="chart-title">Time Series</span>
        <span className="chart-place">{placeLabel}</span>
        <span className="chart-sector">{labelSector(controls.sector)}</span>
        <span className="chart-units">{displayUnits}</span>
      </div>
      {showBottomUp && <SeriesLegend accent={accent} />}

      <ResponsiveContainer width="100%" height={160}>
        <ComposedChart
          data={chartData}
          margin={{ top: 22, right: 16, left: 0, bottom: 0 }}
        >
          <CartesianGrid {...GRID_STYLE} />
          <XAxis dataKey="year" {...AXIS_TICK_STYLE} />
          <YAxis {...Y_AXIS_STYLE} />

          <Tooltip
            content={<TimeSeriesCustomTooltip units={displayUnits} accent={accent} />}
            cursor={cursorStyle(accent)}
          />

          {/* Uncertainty band */}
          {showUncertainty && (
            <>
              <Area
                type="monotone"
                dataKey="max"
                name="Upper bound"
                stroke="none"
                fill={accentDim}
                legendType="none"
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="min"
                name="Lower bound"
                stroke="none"
                fill="#0f1117"
                legendType="none"
                isAnimationActive={false}
              />
            </>
          )}

          {/* Posterior line */}
          <Line
            type="monotone"
            dataKey="value"
            name="Posterior"
            stroke={accent}
            strokeWidth={2}
            dot={{ r: 3, fill: accent, strokeWidth: 0 }}
            activeDot={{ r: 5, strokeWidth: 0 }}
          />

          {/* Bottom-up line (teal, dashed) — ghgi_tropomi only */}
          {showBottomUp && (
            <Line
              type="monotone"
              dataKey="bottomUp"
              name="Bottom-up"
              stroke={TEAL_COLOR}
              strokeWidth={2}
              strokeDasharray="5 3"
              dot={{ r: 3, fill: TEAL_COLOR, strokeWidth: 0 }}
              activeDot={{ r: 5, strokeWidth: 0 }}
              connectNulls={false}
            />
          )}

          <ReferenceLine
            x={controls.year}
            stroke={accent}
            strokeWidth={1.5}
            strokeDasharray="4 4"
            label={{
              value:    controls.year,
              fill:     accent,
              fontSize: 12,
              position: 'top',
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}