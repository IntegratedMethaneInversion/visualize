// ─── URL-addressable initial state ───────────────────────────────────────────
// The per-country factsheet pipeline screenshots this dashboard with Playwright
// (one choropleth + one Sector Breakdown per country, ~160 countries). Driving
// that by hit-testing map polygons is slow and brittle, so the initial view is
// addressable by query string instead:
//
//   ?dataset=ch4-global&country=Colombia&sector=TotalAnth&fit=1
//
// `dataset`, `country` and `fit` are handled here; every other param is matched
// against the active dataset's own `controls` array, so no control key is
// hardcoded and each dataset gets whichever params it actually declares.
//
// These params describe the *initial* state only — after hydration the app is
// driven by normal interaction, and reflectUrl() below rewrites the query
// string to match rather than reading from it.

// Params that address something other than a dataset control.
const RESERVED = new Set(['dataset', 'country', 'fit', 'zoom', 'center']);

// ?zoom=3&center=66,100 — an ad-hoc framing override for one page load, and
// the way values for a countryViews.js entry get discovered before they're
// written down. The two are independent: zoom alone keeps the region centred,
// center alone keeps the automatically derived zoom. Applies only to the
// country the URL selected, so clicking elsewhere goes back to normal framing.
function readView(params) {
  const rawZoom = params.get('zoom');
  const zoom    = rawZoom != null && rawZoom !== '' && Number.isFinite(Number(rawZoom))
    ? Number(rawZoom)
    : null;

  let center = null;
  const rawCenter = params.get('center');
  if (rawCenter) {
    const [lat, lng] = rawCenter.split(',').map(Number);
    // Longitude is deliberately unbounded: a frame straddling the antimeridian
    // is centred past 180 (see boundsOf), and Leaflet pans there fine.
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90) {
      center = [lat, lng];
    }
  }

  return (zoom == null && center == null) ? null : { zoom, center };
}

// Parsed once per page load. Caching matters rather than being an optimisation:
// reflectUrl() rewrites window.location.search as the user interacts, so
// re-reading it later would feed the app its own output instead of the
// screenshot script's request.
let cached = null;

export function readUrlParams() {
  if (!cached) {
    // The app is served from a GitHub Pages project sub-path, so only the
    // search string is ours to interpret — never assume a domain root.
    const search = typeof window === 'undefined' ? '' : window.location.search;
    const params = new URLSearchParams(search);
    cached = {
      params,
      datasetId: params.get('dataset'),
      country:   params.get('country'),
      fit:       ['1', 'true', 'yes'].includes((params.get('fit') ?? '').toLowerCase()),
      view:      readView(params),
    };
  }
  return cached;
}

// ─── Controls ────────────────────────────────────────────────────────────────

// A control's `options` is either a static array or a function of the other
// controls (e.g. CONUS's year list narrows when satellite is 'prior', and
// permian-weekly's week slider is scoped to the selected year), so resolve it
// against the controls settled so far. Controls that instead declare
// `getOptions(baseData)` have no statically knowable option list — their valid
// values only exist once the dataset's data has loaded, which is after this
// runs — so they return null and their param is ignored.
function optionValues(control, controls) {
  const opts = typeof control.options === 'function'
    ? control.options(controls)
    : control.options;
  if (!Array.isArray(opts)) return null;
  return opts.map(o => (o && typeof o === 'object' ? o.value : o));
}

/**
 * Overlays whichever control params the URL carries onto `defaults`.
 * A param that names no control, or whose value isn't among that control's
 * options, is ignored silently — a bad query string must degrade to the
 * default view, never to a blank page.
 *
 * Returns { controls, touched }, where `touched` names the controls the URL
 * actually set (so the caller's reclamp pass knows to leave them alone).
 */
export function controlsFromUrl(dataset, params, defaults) {
  const controls = { ...defaults };
  const touched  = new Set();

  // Dataset order, so a control whose options depend on an earlier one
  // (year on satellite, period on year) sees the URL's value, not the default.
  for (const c of dataset.controls) {
    if (RESERVED.has(c.key) || !params.has(c.key)) continue;
    const values = optionValues(c, controls);
    if (!values?.length) continue;

    // String comparison so `?year=2023` matches the numeric option 2023 while
    // still yielding the option's own typed value.
    const raw   = params.get(c.key);
    const match = values.find(v => String(v) === raw);
    if (match === undefined) continue;

    controls[c.key] = match;
    touched.add(c.key);
  }

  return { controls, touched };
}

// ─── Place names ─────────────────────────────────────────────────────────────

/**
 * Collapses a place name to a comparison key: unaccented, lowercase,
 * punctuation- and separator-insensitive, and without a leading article. Lets
 * `?country=bahamas`, `The+Bahamas` and `The%20Bahamas` all reach Natural
 * Earth's "The Bahamas", and `cote+d'ivoire` reach "Côte d'Ivoire".
 */
export function canonicalPlaceKey(name) {
  return String(name ?? '')
    .replace(/\+/g, ' ')              // URLSearchParams already decodes these; raw strings may not
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // strip combining accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^the\s+/, '');
}

/**
 * Resolves a user-supplied place name to the exact feature name the map keys
 * on (Natural Earth's ADMIN, via MapView's getFeatureName), which is also what
 * selectedState holds. Returns null when nothing matches, so an unknown
 * country leaves the app in its default world view.
 *
 * `aliases` maps a dataset's own spelling to the map's (see ch4-global's
 * ADMIN_ALIASES); an alias is only honoured when its target really is one of
 * the features, and never when it would shadow a feature's own name.
 */
export function resolveFeatureName(input, featureNames, aliases = null) {
  const key = canonicalPlaceKey(input);
  if (!key) return null;

  const byKey = new Map();
  for (const name of featureNames ?? []) {
    const k = canonicalPlaceKey(name);
    if (k && !byKey.has(k)) byKey.set(k, name);
  }
  for (const [from, to] of Object.entries(aliases ?? {})) {
    const k = canonicalPlaceKey(from);
    if (k && !byKey.has(k) && byKey.has(canonicalPlaceKey(to))) byKey.set(k, to);
  }

  return byKey.get(key) ?? null;
}

// ─── Reflecting state back into the URL ──────────────────────────────────────

/**
 * Rewrites the query string to describe the current view, so a link can be
 * copied out of the address bar and the correct param values can be discovered
 * by clicking around. replaceState rather than pushState: this fires on every
 * dropdown change and must not fill the back button.
 *
 * Only non-default values are emitted, so the default view keeps the bare path
 * it loaded with.
 */
export function reflectUrl({ dataset, defaultDatasetId, controls, country, fit, view }) {
  if (typeof window === 'undefined') return;

  const params = new URLSearchParams();
  if (dataset.id !== defaultDatasetId) params.set('dataset', dataset.id);
  if (country) params.set('country', country);
  for (const c of dataset.controls) {
    const v = controls[c.key];
    if (v !== undefined && v !== c.default) params.set(c.key, String(v));
  }
  if (fit) params.set('fit', '1');
  // Carried only while the country it was aimed at is still selected — the
  // caller drops it otherwise, so a hand-tuned frame can't leak onto the next
  // country clicked.
  if (view?.zoom   != null) params.set('zoom', String(view.zoom));
  if (view?.center != null) params.set('center', view.center.map(n => Number(n).toFixed(3)).join(','));

  const qs = params.toString();
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`,
  );
}
