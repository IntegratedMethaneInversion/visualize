// Linear mass-unit conversion for emissions totals. Grams-per-unit lets any
// pair convert via a single multiply/divide instead of a conversion table.
const GRAMS_PER_UNIT = {
  Tg:   1e12,
  Gg:   1e9,
  Tons: 1e6, // metric ton = 1 Mg
  "Tons CO₂e(20yr)": 1e6*82.5, // 20yr GWP = 82.5 from IPCC AR6
  "Tons CO₂e(100yr)": 1e6*29.8, // 100yr GWP = 29.8 from IPCC AR6
};

export const MASS_UNITS = ['Tg', 'Gg', 'Tons', "Tons CO₂e(20yr)", "Tons CO₂e(100yr)"];

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
