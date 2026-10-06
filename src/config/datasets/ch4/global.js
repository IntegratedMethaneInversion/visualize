import { registerDataset }         from '../../datasetRegistry';
import { fetchCSV, parseNumber }   from '../../../utils/emissionsUtils';
import { COUNTRY_VIEWS }           from './countryViews';

const YEAR = 2023; // only year available for this dataset

// One file backs this whole dataset's country-level numbers: the 2x2 totals,
// the choropleth, the country hover tooltip and the Sector Breakdown chart's
// values *and* uncertainty. It supersedes both emissions_data3.csv (older
// inversion vintage, no natural-sector uncertainty) and
// website_data_withranges.csv (anthropogenic sectors only) — neither is read
// anywhere any more.
//
// Its `UNFCCC_total_*` sibling column in emissions_data_new.csv is not needed:
// it equals `AnthroTotal - Reservoirs` exactly (verified for all 161 countries
// in both estimates), i.e. the inventory-reportable subset, not a separate
// estimate. Derive it if it's ever wanted rather than loading a second file.
const CSV_URL = 'data/ch4_global/website_data_withranges_withnatural.csv';

// ─── Single source of truth for this dataset's sectors ───────────────────────
// The map's Sector dropdown, the Sector Breakdown bars and dataLoader's column
// mapping all derive from this table. The keys are also what MapView
// translates into grid/ensemble variable names, so renaming one here means
// updating CONTROL_SECTOR_TO_FILE_KEYS / NATIVE_SECTOR_TO_CONTROL there too.
//
//   key    internal sector key; also the Sector dropdown's value
//   label  user-facing text, shared by the dropdown and the bar chart
//   csv    column prefix(es) in CSV_URL — an array is summed
//   unc    column prefix for the `_post_min`/`_post_max` uncertainty deltas,
//          defaulting to `csv`
//   group  which category the sector belongs to. Nothing reads it yet; it's
//          here so the anthropogenic/natural split is stated once, in the
//          same place as the arithmetic that depends on it.
//
// `unc` exists as its own field because the file's totals carry *propagated*
// deltas that are genuinely narrower than the sum of their components'
// (China: AnthroTotal_post_min 9.44 vs 10.42 for its seven sectors). So an
// aggregate must read its own delta column wherever the file provides one,
// never the sum of its parts'. No sector currently needs it — `AnthroTotal` is
// read whole rather than assembled — but the mechanism stays for the next
// aggregate that does.
// `includes` lists an aggregate's constituent sub-sectors, in the wording the
// Sector Breakdown tooltip shows. Only set where the composition is actually
// knowable from the source data: `Other` is a leaf column in every file we
// have rather than an aggregate, so there is nothing to enumerate for it.
const SECTORS = [
  { key: 'Total',       label: 'Total (all sources)', csv: 'Total',                        group: 'total',
    includes: ['every anthropogenic and natural sector below', 'excludes soil absorption'] },
  // Biomass burning is *not* in here: it's grouped with the natural sources
  // below. That matches the file exactly — `AnthroTotal` is the sum of the
  // seven anthropogenic columns to the digit, so this reads both the value and
  // the propagated `_post_min`/`_post_max` deltas straight off one column with
  // no approximation. (The gridded products still count biomass burning as
  // anthropogenic in their precomputed `TotalAnth`, so MapView re-sums the
  // per-cell components instead of reading that aggregate — see
  // TOTAL_ANTH_SECTORS there.)
  { key: 'TotalAnth',   label: 'Total anthropogenic', csv: 'AnthroTotal',                  group: 'total',
    includes: ['livestock', 'oil & gas', 'coal', 'rice', 'waste', 'reservoirs',
               'other anthropogenic'] },
  { key: 'Livestock',   label: 'Livestock',           csv: 'Livestock',                    group: 'anthro'  },
  { key: 'OilAndGas',   label: 'Oil & gas',           csv: 'Oil-Gas',                      group: 'anthro'  },
  { key: 'Coal',        label: 'Coal',                csv: 'Coal',                         group: 'anthro'  },
  { key: 'Rice',        label: 'Rice cultivation',    csv: 'Rice',                         group: 'anthro'  },
  { key: 'Waste',       label: 'Waste',               csv: 'Waste',                        group: 'anthro',
    includes: ['landfills', 'wastewater'] },
  { key: 'Reservoirs',  label: 'Reservoirs',          csv: 'Reservoirs',                   group: 'anthro'  },
  { key: 'OtherAnth',   label: 'Other anthropogenic', csv: 'Other',                        group: 'anthro'  },
  { key: 'Wetlands',    label: 'Wetlands',            csv: 'Wetlands',                     group: 'natural' },
  // Selectable in its own right *and* counted inside `Natural` below, so these
  // two bars overlap — the only pair in this table that does. Both are wanted:
  // biomass burning is big enough to map on its own (~15 Tg/yr globally) but
  // too small to warrant a third top-level category next to anthropogenic and
  // natural.
  { key: 'BiomassBurn', label: 'Biomass burning',     csv: 'BiomassBurn',                  group: 'natural' },
  // Termites + seeps + biomass burning. Unlike `Total` and `TotalAnth` there's
  // no propagated combined delta in the file, so this one sums its components'
  // — a worst-case widening (assumes all three err the same direction at
  // once). Summed world deltas run -14.1/+5.3 against a 37.2 Tg/yr central
  // value, so the overlap it ignores is no longer negligible the way it was
  // with termites and seeps alone; read this bar's whiskers as an outer bound.
  { key: 'Natural',     label: 'Other Natural',       csv: ['Termites', 'Seeps', 'BiomassBurn'],
                                                                                           group: 'natural',
    includes: ['termites', 'seeps', 'biomass burning'] },
];

const SECTOR_KEYS = SECTORS.map(s => s.key);
const SECTOR_OPTIONS = SECTORS.map(({ key, label }) => ({ value: key, label }));

// ─── TEMPORARY (added 2026-09-14) ────────────────────────────────────────────
// Hides the natural-source bars — Wetlands, Biomass burning, Other Natural —
// from the Sector Breakdown chart, leaving Total, Total anthropogenic and the
// seven anthropogenic sectors. Added for an external screenshot script that
// builds anthropogenic-only info documents.
//
// TO REVERT: set this to false. That is the whole change — everything below
// keys off it, and nothing else in the app was touched.
//
// Deliberately scoped to the *chart* only: the map's Sector dropdown, the
// choropleth, the grid overlay and the 2x2 totals table all still carry the
// natural sectors, and every sector's numbers are still loaded. So this hides
// bars, it does not re-scope the dataset, and `Total` still means "all
// sources" — its bar stays taller than the anthropogenic bars it now sits
// next to, by the 225 Tg/yr of wetlands + other natural no longer drawn.
const ANTHRO_ONLY_BARS = true;

const BAR_SECTORS = SECTORS
  .filter(s => !ANTHRO_ONLY_BARS || s.group !== 'natural')
  .map(({ key, label, includes }) => ({ key, label, includes }));

// 12 bars x 2 series needs more vertical room than the 8-sector CONUS chart
// the component defaults to; the 9-bar anthropogenic-only view does not, and
// keeping 620 there would just stretch the bars.
const BAR_CHART_HEIGHT = ANTHRO_ONLY_BARS ? 500 : 620;

const asArray = v => (Array.isArray(v) ? v : [v]);

// Sums one sector's column prefixes for a given suffix. Returns null only when
// every component is missing, so a present-but-zero component still yields 0
// rather than reading as "no data" — the difference decides whether a
// choropleth country greys out or colors at the bottom of the scale.
function sumColumns(raw, prefixes, suffix) {
  let total = null;
  for (const prefix of prefixes) {
    const v = parseNumber(raw[`${prefix}${suffix}`]);
    if (v == null) continue;
    total = (total ?? 0) + v;
  }
  return total;
}

// world-countries.json (Natural Earth) identifies features by ADMIN name,
// which diverges from this CSV's "countries" column. Maps CSV name -> ADMIN
// name so the choropleth join (keyed on ADMIN, see MapView's getFeatureName)
// succeeds. Only Congo still needs one: the other five countries this table
// used to cover (Bahamas, Falkland Is., North Cyprus, Solomon Is.,
// Timor-Leste) aren't in the current data file at all, so their entries were
// dead weight.
//
// Exported (and reachable off the registered config as `nameAliases`) because
// the ?country= URL param accepts either spelling and normalises to the ADMIN
// name before selecting — see utils/urlParams.js's resolveFeatureName.
export const ADMIN_ALIASES = {
  'Congo': 'Republic of the Congo',
};

registerDataset({
  id:     'ch4-global',
  family: 'CH4',
  name:         'Global',   // big title on the dashboard
  dropdownName: 'Global - East et al., 2023',   // label in the Dataset dropdown
  description: 'Annual methane emissions by country at 25-km resolution generated with the IMI using TROPOMI satellite data combined with bottom-up information from national BTRs. See East et al. (2025) for details.',
  citation: { text: 'East et al. (2025)', url: 'https://www.nature.com/articles/s41467-025-67122-8' },
  satellites: ['TROPOMI'],

  reloadTrigger: [],       // load all data once on dataset mount
  gridType: 'country-mask', // signals MapView to overlay a per-country masked grid on click
  nameAliases:  ADMIN_ALIASES, // alternative spellings the ?country= param accepts
  viewOverrides: COUNTRY_VIEWS, // per-country framing, where the automatic fit is wrong

  mapConfig: {
    initialViewState: { latitude: 20, longitude: 10, zoom: 2 },
    minZoom:   1,
    maxZoom:   8,
    maxBounds: null,
  },

  controls: [
    {
      key:     'satellite',
      label:   'Data Source',
      type:    'select',
      group:   'selects-row',
      options: [
        { value: 'posterior', label: 'IMI best estimate' },
        { value: 'prior',     label: 'Bottom-up'   },
      ],
      default: 'posterior',
    },
    {
      key:     'sector',
      label:   'Sector',
      type:    'select',
      group:   'selects-row',
      options: SECTOR_OPTIONS,
      default: 'TotalAnth',
    },
    {
      key:     'year',
      label:   'Year',
      type:    'select',
      options: [{ value: YEAR, label: String(YEAR) }],
      default: YEAR,
    },
    {
      key:     'opacity',
      label:   'Opacity',
      type:    'slider',
      options: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
      default: 0.7,
      format:  v => `${Math.round(v * 100)}%`,
    },
    {
      key:     'colorScaleMax',
      label:   'Color Scale Max',
      type:    'slider',
      options: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.25, 1.5, 2.0],
      default: 1.0,
      format:  v => `${Math.round(v * 100)}%`,
    },
  ],

  display: {
    units:            'Tg/yr',
    legendTitle:      'CH₄ Emissions',
    legendUnits:      'Tg/yr',
    defaultPlaceLabel: 'Global', // shown in chart headers when no country is selected
    totalsLabels: { bottomUp: 'Bottom-up', posterior: 'IMI Best Estimate' }, // column headers on the DataTotals table
    // Order, labels and sub-sector lists for the Sector Breakdown bar chart,
    // straight off SECTORS so the bars and the Sector dropdown can never drift
    // apart on wording or arithmetic — subject to the temporary
    // ANTHRO_ONLY_BARS filter above, which drops rows but never rewords them.
    barSectors:     BAR_SECTORS,
    barChartHeight: BAR_CHART_HEIGHT,
    // Wider tick labels than the CONUS chart this defaults to: 'Other
    // anthropogenic' and 'Total (all sources)' both need the room.
    barLabelWidth:  150,
    colorScale: {
      stops: [
        [0,    '#ffffcc'],
        [0.15, '#feb24c'],
        [0.4,  '#fd8d3c'],
        [0.65, '#e31a1c'],
        [1.0,  '#800026'],
      ],
      // Domain is pinned to this sector's max rather than recomputed on every
      // sector change, so switching sectors doesn't rescale the color scale —
      // colorScaleMax slider still adjusts it from here. ch4-global has no
      // separate grid/choropleth toggle, so both the shaded map and the
      // per-country grid overlay pin to the same sector.
      pinnedSector:     'TotalAnth',
      pinnedGridSector: 'TotalAnth',
    },
  },

  async dataLoader() {
    const [rows, countriesGeoJSON] = await Promise.all([
      fetchCSV(`${import.meta.env.BASE_URL}${CSV_URL}`),
      fetch(`${import.meta.env.BASE_URL}data/world-countries.json`).then(r => {
        if (!r.ok) throw new Error(`world-countries.json: HTTP ${r.status}`);
        return r.json();
      }),
    ]);

    const byYear           = { [YEAR]: {} };
    const stateByYearPrior = { [YEAR]: {} };
    const worldPrior       = {};
    const worldPosterior   = {};
    const rangesByCountry  = {};
    // `world` row for the Sector Breakdown chart when no country is selected.
    // Its deltas are summed across countries, which — like `Natural` above —
    // is the worst case rather than a propagation; the file has no world row
    // to read a propagated figure from.
    const rangesWorld      = {};

    const addTo = (acc, key, v) => {
      if (v == null) return;
      acc[key] = (acc[key] ?? 0) + v;
    };

    for (const raw of rows) {
      const csvName = raw.countries?.trim();
      if (!csvName) continue;
      const name = ADMIN_ALIASES[csvName] ?? csvName;

      // byYear: both suffixes present, so the choropleth can color in either
      // Data Source mode (see computeChoroplethDomain / centralCol).
      const row       = {};
      // stateByYearPrior: bare keys, prior only — the bottom-up column of the
      // 2x2 totals table reads this.
      const priorBare = {};
      // sectorRanges: per-sector central values + uncertainty deltas, for the
      // Sector Breakdown chart and the country hover tooltip.
      const bySector  = {};

      for (const s of SECTORS) {
        const csvPrefixes = asArray(s.csv);
        const uncPrefixes = asArray(s.unc ?? s.csv);

        const prior    = sumColumns(raw, csvPrefixes, '_prior');
        const post     = sumColumns(raw, csvPrefixes, '_post');
        const minDelta = sumColumns(raw, uncPrefixes, '_post_min');
        const maxDelta = sumColumns(raw, uncPrefixes, '_post_max');

        row[`${s.key}_prior`]     = prior;
        row[`${s.key}_posterior`] = post;
        priorBare[s.key]          = prior;
        bySector[s.key]           = { prior, post, minDelta, maxDelta };

        addTo(worldPrior,     s.key, prior);
        addTo(worldPosterior, s.key, post);

        const sums = rangesWorld[s.key]
          ?? (rangesWorld[s.key] = { prior: null, post: null, minDelta: null, maxDelta: null });
        if (prior    != null) sums.prior    = (sums.prior    ?? 0) + prior;
        if (post     != null) sums.post     = (sums.post     ?? 0) + post;
        if (minDelta != null) sums.minDelta = (sums.minDelta ?? 0) + minDelta;
        if (maxDelta != null) sums.maxDelta = (sums.maxDelta ?? 0) + maxDelta;
      }

      byYear[YEAR][name]           = row;
      stateByYearPrior[YEAR][name] = priorBare;
      // Keyed on the ADMIN name, matching selectedState — the choropleth and
      // the bar chart/tooltip lookups all go through the same alias.
      rangesByCountry[name]        = bySector;
    }

    return {
      byYear,
      nationalPosterior: { [YEAR]: worldPosterior },
      nationalPrior:     { [YEAR]: worldPrior },
      stateByYearPrior,
      sectorKeys:   SECTOR_KEYS,
      sectorRanges: { sectorKeys: SECTOR_KEYS, byCountry: rangesByCountry, world: rangesWorld },
      statesGeoJSON: countriesGeoJSON,
      manifest:      null,
    };
  },
});
