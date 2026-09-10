// parses input emissions data from satellite(s)

import Papa from 'papaparse';

// ─── Constants (match your app.js) ───────────────────────────────────────────
export const SCENARIO_SUFFIX  = '_posterior';
export const DEFAULT_SECTOR   = 'Total_ExclSoilAbs';
export const EXCLUDED_SECTORS = [
  'Total', 'OtherAnth', 'Gas', 'Oil',
  'Lakes', 'Seeps', 'Termites', 'SoilAbsorb',
];
export const SECTOR_LABELS = {
  ONG:               'Oil/Gas',
  Livestock:         'Livestock',
  Total_ExclSoilAbs: 'Total',
  // Colombia sector keys
  TotalAnth:         'Total',
  OilGas:            'Oil/Gas',
  Waste:             'Waste',
  Other:             'Other',
  // Global (ch4-global) sector keys
  OtherAnth:         'Other',
  BiomassBurn:       'Biomass Burn.',
  OilAndGas:         'Oil & Gas',
};

// ─── CSV fetch ────────────────────────────────────────────────────────────────
export function fetchCSV(url) {
  return new Promise((resolve, reject) => {
    Papa.parse(url, {
      download:      true,
      header:        true,
      dynamicTyping: false,
      skipEmptyLines: true,
      complete: (r) => resolve(r.data),
      error:    reject,
    });
  });
}

// ─── Derive sector keys from a CSV row (same logic as app.js) ─────────────────
export function deriveSectors(row) {
  return Object.keys(row)
    .filter(k => k.endsWith(SCENARIO_SUFFIX))
    .map(k => k.replace(SCENARIO_SUFFIX, ''))
    .filter(s => s !== 'Total')
    .filter(s => !EXCLUDED_SECTORS.includes(s))
    .sort();
}

export function labelSector(key) {
  return SECTOR_LABELS[key] ?? key;
}

export function parseNumber(x) {
  const v = Number(x);
  return Number.isFinite(v) ? v : null;
}

// ─── Column name helpers ──────────────────────────────────────────────────────
export function mapValueCol(satellite) {
  return satellite === 'prior' ? 'Total_prior' : 'Total_posterior';
}

export function centralCol(sectorKey, mode, satellite) {
  if (mode === 'national') return sectorKey;  // national CSV has no suffix
  return satellite === 'prior'
    ? `${sectorKey}_prior`
    : `${sectorKey}_posterior`;
}

export function minCol(key) { return `${key}_min`; }
export function maxCol(key) { return `${key}_max`; }

export function hasUncertainty(satellite) {
  return satellite !== 'prior';
}

// Which years are valid for each data source
export function activeYears(satellite) {
  return satellite === 'prior'
    ? [2019, 2020]
    : [2019, 2020, 2021, 2022, 2023, 2024];
}

// ─── Bar chart data builder ───────────────────────────────────────────────────
export function buildBarData(baseData, { year, mode, satellite, selectedState }) {
  const { byYear, nationalPosterior, nationalPrior, stateByYearPrior, sectorKeys } = baseData;

  // Determine source row and whether columns use bare keys or _posterior suffix
  let row;
  let bareKeys;  // true = bare sector key, false = _posterior suffix

  if (mode === 'national') {
    row      = satellite === 'prior'
      ? (nationalPrior?.[year]     ?? null)
      : (nationalPosterior?.[year] ?? null);
    bareKeys = true;  // both national CSVs use bare keys
  } else {
    if (!selectedState) return { labels: [], values: [], mins: [], maxs: [] };
    if (satellite === 'prior') {
      row      = stateByYearPrior?.[year]?.[selectedState] ?? null;
      bareKeys = true;   // state prior CSV uses bare keys
    } else {
      row      = byYear?.[year]?.[selectedState] ?? null;
      bareKeys = false;  // state posterior CSV uses _posterior suffix
    }
  }

  if (!row || !sectorKeys.length) {
    return { labels: [], values: [], mins: [], maxs: [] };
  }

  const getVal = (s) => parseNumber(row[bareKeys ? s : `${s}_posterior`]);
  const values = sectorKeys.map(s => getVal(s));

  if (!hasUncertainty(satellite)) {
    return {
      labels: sectorKeys,
      values,
      mins: values.map(() => null),
      maxs: values.map(() => null),
    };
  }

  return {
    labels: sectorKeys,
    values,
    mins: sectorKeys.map(s => parseNumber(row[minCol(s)])),
    maxs: sectorKeys.map(s => parseNumber(row[maxCol(s)])),
  };
}

// ─── Time series data builder ─────────────────────────────────────────────────
export function buildLineData(baseData, { mode, sectorKey, satellite, selectedState }) {
  const { byYear, nationalPosterior, nationalPrior, stateByYearPrior } = baseData;
  const years = activeYears(satellite);

  // national CSVs and state prior CSV all use bare keys;
  // state posterior CSV uses _posterior suffix
  const bareKeys = mode === 'national' || satellite === 'prior';
  const col      = bareKeys ? sectorKey : `${sectorKey}_posterior`;

  function getRow(year) {
    if (mode === 'national') {
      return satellite === 'prior'
        ? (nationalPrior?.[year]     ?? null)
        : (nationalPosterior?.[year] ?? null);
    }
    if (!selectedState) return null;
    return satellite === 'prior'
      ? (stateByYearPrior?.[year]?.[selectedState] ?? null)
      : (byYear?.[year]?.[selectedState]           ?? null);
  }

  const values = years.map(y => {
    const row = getRow(y);
    return row ? parseNumber(row[col]) : null;
  });

  if (!hasUncertainty(satellite)) {
    return {
      years,
      values,
      mins: years.map(() => null),
      maxs: years.map(() => null),
    };
  }

  return {
    years,
    values,
    mins: years.map(y => { const r = getRow(y); return r ? parseNumber(r[minCol(sectorKey)]) : null; }),
    maxs: years.map(y => { const r = getRow(y); return r ? parseNumber(r[maxCol(sectorKey)]) : null; }),
  };
}
// Compute min/max of state values for the current year/satellite
// Used by both MapView (choropleth coloring) and Legend (tick labels)
export function computeChoroplethDomain(baseData, year, satellite, sector) {
  if (!baseData?.byYear?.[year]) return { min: 0, max: 10 };

  // Use centralCol so sector selection is respected
  // mode is always 'state' here — we are coloring individual states
  const col    = centralCol(sector, 'state', satellite);
  const values = Object.values(baseData.byYear[year])
    .map(row => parseNumber(row[col]))
    .filter(v => v != null && Number.isFinite(v));

  if (!values.length) return { min: 0, max: 10 };
  return { min: Math.min(...values), max: Math.max(...values) };
}

// ─── Bottom-up data builders (used only in ghgi_tropomi mode) ─────────────────

/**
 * Pull prior (bottom-up) values for the sector bar chart.
 * National: reads bare keys from nationalPrior (consistent across all years).
 * State:    reads _prior columns from byYear (present for all years in estrada CSVs).
 */
export function buildBottomUpBarData(baseData, { year, mode, selectedState }) {
  const { byYear, nationalPrior, sectorKeys } = baseData;
  if (!sectorKeys?.length) return { labels: [], values: [] };

  if (mode === 'national') {
    const row = nationalPrior?.[year];
    if (!row) return { labels: [], values: [] };
    return {
      labels: sectorKeys,
      values: sectorKeys.map(s => parseNumber(row[s])),
    };
  }

  const row = selectedState ? byYear?.[year]?.[selectedState] : null;
  if (!row) return { labels: [], values: [] };
  return {
    labels: sectorKeys,
    values: sectorKeys.map(s => parseNumber(row[`${s}_prior`])),
  };
}

/**
 * Pull prior (bottom-up) time series values for a single sector.
 * Covers all posterior years (2019-2024); national prior is now populated
 * for all years after the dataLoader extension above.
 */
export function buildBottomUpLineData(baseData, { mode, sectorKey, selectedState }) {
  const years = [2019, 2020, 2021, 2022, 2023, 2024];
  const { byYear, nationalPrior } = baseData;

  const values = years.map(y => {
    if (mode === 'national') {
      return parseNumber(nationalPrior?.[y]?.[sectorKey]);
    }
    return selectedState
      ? parseNumber(byYear?.[y]?.[selectedState]?.[`${sectorKey}_prior`])
      : null;
  });

  return { years, values };
}

// ─── ch4-global Sector Breakdown chart (sectorRanges) ────────────────────────
// Unlike buildBarData, this reads directly from dataLoader's `sectorRanges`
// (country -> sector -> {prior, post, minDelta, maxDelta}, plus a `world` sum
// across all covered countries — see global.js's dataLoader) rather than the
// byYear/national* structures, because only sectorRanges carries the
// per-sector uncertainty. Both now come from the same CSV, so their central
// values agree by construction; the country hover tooltip in MapView reads
// sectorRanges too, for the same reason.
//
// sectorRanges stores minDelta/maxDelta as +/- magnitudes, not absolute
// bounds, so the absolute lower/upper bound is `post -/+ delta` — and since
// a sector/country's delta can exceed its own post value, the lower bound
// is clamped to 0 rather than going negative.
export function buildRangesBarData(sectorRanges, { selectedState, satellite }) {
  const empty = { labels: [], values: [], mins: [], maxs: [] };
  if (!sectorRanges) return empty;

  const bySector = selectedState ? sectorRanges.byCountry[selectedState] : sectorRanges.world;
  if (!bySector) return empty;

  const labels    = sectorRanges.sectorKeys;
  const uncertain = hasUncertainty(satellite); // ranges file is posterior-only

  const values = [], mins = [], maxs = [];
  for (const key of labels) {
    const entry = bySector[key];
    values.push(satellite === 'prior' ? (entry?.prior ?? null) : (entry?.post ?? null));

    if (!uncertain || entry?.post == null) {
      mins.push(null);
      maxs.push(null);
      continue;
    }
    mins.push(entry.minDelta != null ? Math.max(0, entry.post - entry.minDelta) : null);
    maxs.push(entry.maxDelta != null ? entry.post + entry.maxDelta : null);
  }

  return { labels, values, mins, maxs };
}

// Prior (bottom-up) series for the same chart — always prior, regardless of
// the Data Source control (only rendered when that control is posterior).
export function buildRangesBottomUpBarData(sectorRanges, { selectedState }) {
  if (!sectorRanges) return { labels: [], values: [] };

  const bySector = selectedState ? sectorRanges.byCountry[selectedState] : sectorRanges.world;
  if (!bySector) return { labels: [], values: [] };

  const labels = sectorRanges.sectorKeys;
  return { labels, values: labels.map(key => bySector[key]?.prior ?? null) };
}