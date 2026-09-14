import React                       from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ErrorBar,
  Cell,
}                                  from 'recharts';
import { useDatasetContext }        from '../context/DatasetContext';
import { useEmissionData }          from '../hooks/useEmissionData';
import { useDisplayUnit }           from '../hooks/useDisplayUnit';
import { formatMassValue, formatAxisValue } from '../utils/units';
import {
  buildBarData,
  buildBottomUpBarData,
  buildRangesBarData,
  buildRangesBottomUpBarData,
  labelSector,
  hasUncertainty,
}                                  from '../utils/emissionsUtils';
import { buildPeriodBarData }       from '../utils/manifestUtils';

const DIM_COLOR    = '#99a7b9';
const BRIGHT_COLOR = '#e2e8f0';
const TEAL_COLOR   = '#14b8a6';

// Manifest total_kg values are in the tens-of-millions for a whole-basin
// week; Gg (1e6 kg) keeps the axis/tooltip numbers readable.
const KG_TO_GG = 1e6;

// A dataset's display.barSectors ([{ key, label }, ...], in a config's own
// config file) manually curates the Sector Breakdown chart's bar order and
// display text. When a dataset hasn't defined one yet, fall back to the
// data's natural key order and labelSector()'s cross-dataset lookup — the
// pre-existing behavior. Sectors named in barSectors that aren't present in
// `labels` (a typo, or a sector the data doesn't have this year) are
// dropped rather than rendered as an empty bar.
function resolveBarSectors(labels, barSectors) {
  if (!barSectors?.length) {
    return labels.map((key, i) => ({ key, label: labelSector(key), i }));
  }
  const indexByKey = new Map(labels.map((key, i) => [key, i]));
  return barSectors
    .filter(({ key }) => indexByKey.has(key))
    .map(({ key, label, includes }) => ({ key, label, includes, i: indexByKey.get(key) }));
}

// Builds Sector Breakdown chart rows from a { labels, values, mins, maxs }
// bundle (buildBarData/buildRangesBarData's shape) plus its matching
// bottom-up bundle. Shared by the ch4-global and default (CONUS/other)
// branches below, which differ only in which data-building functions
// produced `data`/`bottomUpData`.
function buildSectorRows(resolvedSectors, data, bottomUpData, { showUncertainty, showBottomUp, convert }) {
  return resolvedSectors.map(({ label, includes, i }) => ({
    sector:        label,
    // Sub-sector list for aggregate bars; the tooltip renders it when present.
    includes,
    value:         convert(data.values[i]),
    errorRange:    showUncertainty && data.mins[i] != null
      ? [convert(data.mins[i]), convert(data.maxs[i])]
      : null,
    errorDelta:    showUncertainty && data.mins[i] != null && data.values[i] != null
      ? [
          Math.max(0, convert(data.values[i] - data.mins[i])),
          Math.max(0, convert(data.maxs[i]   - data.values[i])),
        ]
      : null,
    bottomUpValue: showBottomUp ? convert(bottomUpData?.values[i] ?? null) : null,
  }));
}

// Color key for charts that plot both series — swatch colors match the Bar
// fills exactly (accent = IMI output, TEAL_COLOR = bottom-up).
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

function UploadBarTooltip({ active, payload, label, units, accent }) {
  if (!active || !payload?.length) return null;
  const val = payload[0]?.value;

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
      <div style={{ color: BRIGHT_COLOR, display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
        <span>Total</span>
        <span style={{ fontWeight: 600 }}>
          {val != null ? formatMassValue(val) : 'N/A'}
          {units && (
            <span style={{ opacity: 0.6, fontSize: '0.68rem', marginLeft: '0.2rem' }}>
              {units}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

function SectorBarCustomTooltip({
  active, payload, label, units, accent, showUncertainty, showBottomUp,
}) {
  if (!active || !payload?.length) return null;

  const postEntry = payload.find(p => p.dataKey === 'value');
  const buEntry   = payload.find(p => p.dataKey === 'bottomUpValue');

  const val        = postEntry?.value;
  const errorRange = postEntry?.payload?.errorRange;
  const buVal      = buEntry?.value;
  const includes   = postEntry?.payload?.includes;

  // Same +/- convention as the map's grid-cell hover tooltip: the larger of
  // the two (possibly asymmetric) deltas around the central value, collapsed
  // to a single figure, rather than separate upper/lower bound rows.
  const spread = (showUncertainty && errorRange && val != null)
    ? Math.max(0, val - errorRange[0], errorRange[1] - val)
    : null;

  const rows = [
    { name: 'IMI Best Estimate', value: val, spread, color: BRIGHT_COLOR, weight: 600 },
  ];
  if (showBottomUp && buVal != null) {
    rows.push({ name: 'Bottom-up', value: buVal, color: TEAL_COLOR, weight: 600 });
  }

  return (
    <div style={{
      background:   '#1a1d27',
      border:       '1px solid #2d3148',
      borderRadius: '6px',
      padding:      '0.4rem 0.65rem',
      fontSize:     '0.85rem',
      lineHeight:   1.65,
      minWidth:     '9rem',
      maxWidth:     '17rem',
    }}>
      <div style={{ color: accent, fontWeight: 700, marginBottom: '0.15rem' }}>
        {label}
      </div>
      {/* Aggregate bars name their components, so a merged bucket like
          "Other Natural" doesn't have to be guessed at from the label. */}
      {includes?.length > 0 && (
        <div style={{
          color:        DIM_COLOR,
          fontWeight:   400,
          fontSize:     '0.72rem',
          lineHeight:   1.4,
          marginBottom: '0.3rem',
          whiteSpace:   'normal',
        }}>
          Includes {includes.join(', ')}
        </div>
      )}
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

// Header row shared by the ch4-global and default branches: place/year/units
// plus a loading indicator and the bottom-up legend when that series is shown.
function SectorChartHeader({ place, year, units, loading, showBottomUp, accent }) {
  return (
    <>
      <div className="chart-header">
        <span className="chart-title">Sector Breakdown</span>
        <span className="chart-place">{place}</span>
        <span className="chart-year">{year}</span>
        <span className="chart-units">{units}</span>
        {loading && <span className="chart-status">Loading…</span>}
      </div>
      {showBottomUp && <SeriesLegend accent={accent} />}
    </>
  );
}

// The BarChart itself, shared by every branch below that plots
// { sector, value, errorDelta, bottomUpValue } rows (i.e. everything except
// the single-series user-upload chart, which has no bottom-up/uncertainty
// series and uses its own tooltip).
// `height`/`labelWidth` default to what the 8-sector CONUS chart has always
// used; datasets with more bars or longer sector names override them via
// display.barChartHeight / display.barLabelWidth.
function SectorBarChartBody({
  chartData, accent, displayUnits, showUncertainty, showBottomUp,
  height = 500, labelWidth = 90,
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        layout="vertical"
        data={chartData}
        margin={{ top: 4, right: showUncertainty ? 24 : 12, left: 0, bottom: 4 }}
      >
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="rgba(255,255,255,0.06)"
          horizontal={false}
        />
        <XAxis
          type="number"
          tick={{ fill: '#94a3b8', fontSize: 13 }}
          axisLine={{ stroke: '#2d3148' }}
          tickLine={false}
          tickFormatter={formatAxisValue}
        />
        <YAxis
          type="category"
          dataKey="sector"
          tick={{ fill: '#94a3b8', fontSize: 14 }}
          axisLine={false}
          tickLine={false}
          width={labelWidth}
        />

        <Tooltip
          content={
            <SectorBarCustomTooltip
              units={displayUnits}
              accent={accent}
              showUncertainty={showUncertainty}
              showBottomUp={showBottomUp}
            />
          }
          cursor={{ fill: 'rgba(255,255,255,0.04)' }}
        />

        {/* Posterior bars */}
        <Bar dataKey="value" name="Posterior" radius={[0, 3, 3, 0]}>
          {chartData.map((_, i) => (
            <Cell key={i} fill={accent} fillOpacity={0.85} />
          ))}
          {showUncertainty && (
            <ErrorBar
              dataKey="errorDelta"
              width={4}
              strokeWidth={1.5}
              stroke="#94a3b8"
              direction="x"
            />
          )}
        </Bar>

        {/* Bottom-up bars (teal) */}
        {showBottomUp && (
          <Bar dataKey="bottomUpValue" name="Bottom-up" radius={[0, 3, 3, 0]}>
            {chartData.map((_, i) => (
              <Cell key={i} fill={TEAL_COLOR} fillOpacity={0.75} />
            ))}
          </Bar>
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SectorBarChart() {
  const { activeDataset, activeFamily, controls, selectedState, uploadedData } = useDatasetContext();
  const { data: baseData, loading } = useEmissionData();
  const { label: displayUnits, convert } = useDisplayUnit();

  if (activeDataset.id === 'user-upload') {
    const sectors    = uploadedData?.sectors ?? {};
    const sectorKeys = Object.keys(sectors);
    if (sectorKeys.length < 2) return null; // nothing to compare with only one sector

    const accent = activeFamily.theme.accent;
    const units  = uploadedData?.meta?.units || '';

    const chartData = sectorKeys.map(key => ({
      sector: key,
      value:  sectors[key].sum ?? 0,
    }));

    return (
      <div className="chart-panel">
        <div className="chart-header">
          <span className="chart-title">Sector Breakdown</span>
          <span className="chart-units">{units}</span>
        </div>

        <ResponsiveContainer width="100%" height={500}>
          <BarChart
            layout="vertical"
            data={chartData}
            margin={{ top: 4, right: 12, left: 0, bottom: 4 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" horizontal={false} />
            <XAxis
              type="number"
              tick={{ fill: '#94a3b8', fontSize: 13 }}
              axisLine={{ stroke: '#2d3148' }}
              tickLine={false}
              tickFormatter={formatAxisValue}
            />
            <YAxis
              type="category"
              dataKey="sector"
              tick={{ fill: '#94a3b8', fontSize: 14 }}
              axisLine={false}
              tickLine={false}
              width={90}
            />
            <Tooltip
              content={<UploadBarTooltip units={units} accent={accent} />}
              cursor={{ fill: 'rgba(255,255,255,0.04)' }}
            />
            <Bar dataKey="value" name="Total" radius={[0, 3, 3, 0]}>
              {chartData.map((_, i) => (
                <Cell key={i} fill={accent} fillOpacity={0.85} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (activeDataset.gridType === 'period') {
    if (!baseData?.manifest) return null;

    // Both sources are always shown here, independent of the Data Source
    // control (which only drives what's rendered on the map) — same
    // philosophy as ch4-global's DataTotals.
    const post = buildPeriodBarData(baseData.manifest, 'posterior', controls.period);
    const prior = buildPeriodBarData(baseData.manifest, 'prior', controls.period);
    if (!post.labels.length) return null;

    const accent    = activeFamily.theme.accent;
    const weekStart = baseData.manifest.periods?.find(p => p.key === String(controls.period))?.start;

    const chartData = post.labels.map((sector, i) => ({
      sector,
      value:         post.values[i]  != null ? convert(post.values[i]  / KG_TO_GG) : null,
      bottomUpValue: prior.values[i] != null ? convert(prior.values[i] / KG_TO_GG) : null,
    }));

    return (
      <div className="chart-panel">
        <div className="chart-header">
          <span className="chart-title">Sector Breakdown</span>
          <span className="chart-year">{weekStart}</span>
          <span className="chart-units">{displayUnits}</span>
        </div>
        <SeriesLegend accent={accent} />

        <SectorBarChartBody
          chartData={chartData}
          accent={accent}
          displayUnits={displayUnits}
          showUncertainty={false}
          showBottomUp
        />
      </div>
    );
  }

  if (activeDataset.id === 'ch4-global') {
    if (!baseData?.sectorRanges) return null;

    const placeLabel = selectedState ?? (activeDataset.display?.defaultPlaceLabel ?? 'National');

    const rangesData = buildRangesBarData(baseData.sectorRanges, {
      selectedState,
      satellite: controls.satellite,
    });
    if (!rangesData.labels.length) return null;

    const showUncertainty = hasUncertainty(controls.satellite);
    const showBottomUp    = controls.satellite === 'posterior';
    const accent           = activeFamily.theme.accent;

    const bottomUpData = showBottomUp
      ? buildRangesBottomUpBarData(baseData.sectorRanges, { selectedState })
      : null;

    const resolvedSectors = resolveBarSectors(rangesData.labels, activeDataset.display?.barSectors);
    const chartData = buildSectorRows(resolvedSectors, rangesData, bottomUpData, { showUncertainty, showBottomUp, convert });

    return (
      <div className="chart-panel">
        <SectorChartHeader
          place={placeLabel}
          year={controls.year}
          units={displayUnits}
          loading={loading}
          showBottomUp={showBottomUp}
          accent={accent}
        />

        <SectorBarChartBody
          chartData={chartData}
          accent={accent}
          displayUnits={displayUnits}
          showUncertainty={showUncertainty}
          showBottomUp={showBottomUp}
          height={activeDataset.display?.barChartHeight}
          labelWidth={activeDataset.display?.barLabelWidth}
        />
      </div>
    );
  }

  if (!baseData) return null;

  const mode       = selectedState ? 'state' : 'national';
  const placeLabel = selectedState ?? (activeDataset.display?.defaultPlaceLabel ?? 'National');

  const barData = buildBarData(baseData, {
    year:      controls.year,
    mode,
    satellite: controls.satellite,
    selectedState,
  });

  if (!barData.labels.length) return null;

  const showUncertainty = hasUncertainty(controls.satellite);
  // Bottom-up series only appears alongside the posterior (CONUS & global)
  const showBottomUp = controls.satellite === 'posterior'
    && (activeDataset.id === 'ch4-conus' || activeDataset.id === 'ch4-global');
  const accent       = activeFamily.theme.accent;

  const bottomUpData = showBottomUp
    ? buildBottomUpBarData(baseData, { year: controls.year, mode, selectedState })
    : null;

  const resolvedSectors = resolveBarSectors(barData.labels, activeDataset.display?.barSectors);
  const chartData = buildSectorRows(resolvedSectors, barData, bottomUpData, { showUncertainty, showBottomUp, convert });

  return (
    <div className="chart-panel">
      <SectorChartHeader
        place={placeLabel}
        year={controls.year}
        units={displayUnits}
        loading={loading}
        showBottomUp={showBottomUp}
        accent={accent}
      />

      <SectorBarChartBody
        chartData={chartData}
        accent={accent}
        displayUnits={displayUnits}
        showUncertainty={showUncertainty}
        showBottomUp={showBottomUp}
      />
    </div>
  );
}