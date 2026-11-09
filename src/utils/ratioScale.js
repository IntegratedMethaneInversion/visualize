// ─── Posterior / prior ratio view ────────────────────────────────────────────
// Helpers for the 'ratio' Data Source (ch4-global): the map colors each cell
// or country by IMI estimate ÷ bottom-up, on a log scale centred on 1 so that
// halving and doubling sit equally far from "unchanged". The scale's numbers
// live in the dataset's display.ratioScale (see ch4/global.js).

export const RATIO_MODE = 'ratio';

export function isRatioMode(satellite) {
  return satellite === RATIO_MODE;
}

// post / prior, or null when the prior is at or below `threshold` — there the
// ratio would be dominated by noise in a near-zero denominator, so the cell
// or country is masked rather than colored. Summed values are passed in, so
// aggregate sectors get Σpost / Σprior, never a combination of per-sector
// ratios.
export function ratioOrNull(post, prior, threshold = 0) {
  if (post == null || prior == null) return null;
  if (!(prior > threshold)) return null;
  return post / prior;
}

// Ratio -> [0, 1] position on the color ramp, log-scaled between
// scale.min and scale.max and clamped at both ends. A non-positive ratio
// (a handful of cells have a slightly negative posterior) has no logarithm and
// lands at the bottom of the ramp.
export function ratioToT(ratio, { min, max }) {
  if (!(ratio > 0)) return 0;
  const lo = Math.log(min);
  const hi = Math.log(max);
  return Math.max(0, Math.min(1, (Math.log(ratio) - lo) / (hi - lo)));
}

// Ratios are dimensionless, so they bypass the units selector. Two decimals
// below 10, one above.
export function formatRatio(ratio) {
  if (ratio == null || !Number.isFinite(ratio)) return '—';
  return Math.abs(ratio) >= 10 ? ratio.toFixed(1) : ratio.toFixed(2);
}

// The masking thresholds are tiny in Tg/yr (1e-5), so they get their own
// formatter rather than formatMassValue's "<0.01". `value` is already in the
// display unit.
export function formatThreshold(value) {
  if (value == null || !Number.isFinite(value)) return '';
  return new Intl.NumberFormat('en-US', { maximumSignificantDigits: 2 }).format(value);
}
