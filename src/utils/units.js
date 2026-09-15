// Linear mass-unit conversion for emissions totals. Grams-per-unit lets any
// pair convert via a single multiply/divide instead of a conversion table.
//
// The CO2e units are the same linear scale seen from the other side: one ton
// of CO2e stands for 1/GWP tons of CH4, so their grams-per-unit is DIVIDED
// by the GWP. That makes convertMass multiply the CH4 mass by the GWP, which
// is the direction the labels promise (374M tons CH4 -> 30.9B tons CO2e-20yr,
// not 4.5M).
const GRAMS_PER_UNIT = {
  Tg:   1e12,
  Gg:   1e9,
  Tons: 1e6, // metric ton = 1 Mg
  "20-year GWP (tons)": 1e6/82.5, // 20yr GWP = 82.5 from IPCC AR6
  "100-year GWP (tons)": 1e6/29.8, // 100yr GWP = 29.8 from IPCC AR6
};

export const MASS_UNITS = ['Tg', 'Gg', 'Tons', "20-year GWP (tons)", "100-year GWP (tons)"];

// Splits a display unit string like 'Tg/yr' or 'Gg/week' into its mass
// prefix and time suffix. massUnit is null when the string doesn't start
// with a known mass unit (e.g. 'ppm', '') — those datasets don't support
// the units dropdown and are shown as-is.
export function parseDisplayUnit(unitStr) {
  const str = unitStr ?? '';
  for (const unit of MASS_UNITS) {
    if (str === unit || str.startsWith(`${unit}/`)) {
      return { massUnit: unit, timeSuffix: str.slice(unit.length) };
    }
  }
  return { massUnit: null, timeSuffix: '' };
}

export function convertMass(value, fromUnit, toUnit) {
  if (value == null || !Number.isFinite(value) || fromUnit === toUnit) return value;
  return value * (GRAMS_PER_UNIT[fromUnit] / GRAMS_PER_UNIT[toUnit]);
}

export function formatDisplayUnit(massUnit, timeSuffix) {
  return `${massUnit}${timeSuffix}`;
}

// Shared number formatting for any displayed mass value, regardless of which
// unit it's currently in — a Tg total, a Gg/week weekly sum, or a single
// grid cell's Tons/yr share all need the same adaptive precision: compact
// notation once values run into the thousands (an unconverted Tons total
// can be 9+ digits), more decimals for the fractional values a raw Tg grid
// cell or Colombia sub-national total can be.
export function formatMassValue(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1000) {
    return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(v);
  }
  if (abs > 0 && abs < 1) return v.toFixed(5);
  return v.toFixed(2);
}

// ─── Uncertainty range display ───────────────────────────────────────────────
// Every uncertainty-carrying tooltip -- grid cells, the country choropleth,
// the sector bars, the time series -- renders its ensemble range the same
// way: the central value followed by "(min, max)". Centralized so the
// convention, including bound ordering, changes in exactly one place.
//
// `format` formats the bounds themselves. It defaults to formatMassValue;
// the raw-raster tooltips pass their own toFixed(3) because they show flux
// densities rather than unit-converted masses.
export function formatRange(min, max, format = formatMassValue) {
  if (min == null || max == null) return null;
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return `(${format(min)}, ${format(max)})`;
}

// The ranges CSVs give +/- delta magnitudes rather than absolute bounds, and
// a delta can exceed its own central value -- so the lower bound clamps at 0,
// exactly as buildRangesBarData does. Returns [min, max], or null when the
// central value or either delta is missing.
export function boundsFromDeltas(value, minDelta, maxDelta) {
  if (value == null || minDelta == null || maxDelta == null) return null;
  return [Math.max(0, value - minDelta), value + maxDelta];
}

// Axis-tick variant of the above. Ticks are auto-chosen round numbers laid
// out in a ~52px gutter, so they can't afford formatMassValue's fixed
// decimals — a 0.5 Tg tick rendering as '0.50000' is unreadable. Significant
// digits instead of fraction digits keeps every magnitude compact: a Tons
// total's 65200000 -> '65.2M', a Tg sector's 0.5 -> '0.5', and a raw grid
// cell's 0.00012 -> '0.00012' rather than collapsing to '0'.
export function formatAxisValue(v) {
  if (v == null || !Number.isFinite(v)) return '';
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumSignificantDigits: 3 }).format(v);
}
