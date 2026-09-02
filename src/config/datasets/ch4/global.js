import { registerDataset }         from '../../datasetRegistry';
import { fetchCSV, parseNumber }   from '../../../utils/emissionsUtils';

const YEAR = 2023; // only year available for this dataset

// column names from emissions_data3.csv. possibly going to be deprecated once new
// data source added. 
// These are options for map view sector dropdown menu.
// these are also 'sectorKeys' for DataTotals.jsx -- used for 2x2 sum totals table
// NOT used for sector bar chart, see RANGES_SECTORS below for that. 
const SECTOR_OPTIONS = [
  { value: 'TotalAnth',   label: 'Total (Anthropogenic)' },
  { value: 'Livestock',   label: 'Livestock'     },
  { value: 'Coal',        label: 'Coal'          },
  { value: 'OilAndGas',   label: 'Oil & Gas'     },
  { value: 'Rice',        label: 'Rice'          },
  { value: 'Landfills',   label: 'Landfills'     },
  { value: 'Wastewater',  label: 'Wastewater'    },
  { value: 'Reservoirs',  label: 'Reservoirs'    },
  { value: 'OtherAnth',   label: 'Other Anthropogenic' },
  { value: 'Wetlands',    label: 'Wetlands'      },
  { value: 'BiomassBurn', label: 'Biomass Burning' },
  { value: 'Natural',     label: 'Other Natural' },
];
const CSV_SECTOR_KEYS = SECTOR_OPTIONS.map(o => o.value);

// Used for creating sector breakdown chart. Data comes from 
// website_data_withranges.csv, which is the country- and sector-level 
// totals + uncertainty file.
// This is currently missing non-anthro sources; update pending. 
const RANGES_SECTORS = [
  { key: 'TotalAnth',  label: 'Total',      columnPrefix: 'AnthroTotal' },
  { key: 'Livestock',  label: 'Livestock',  columnPrefix: 'Livestock'   },
  { key: 'Coal',       label: 'Coal',       columnPrefix: 'Coal'        },
  { key: 'OilAndGas',  label: 'Oil & Gas',  columnPrefix: 'Oil-Gas'     },
  { key: 'Rice',       label: 'Rice',       columnPrefix: 'Rice'        },
  { key: 'Reservoirs', label: 'Reservoirs', columnPrefix: 'Reservoirs'  },
  { key: 'Waste',      label: 'Waste',      columnPrefix: 'Waste'       },
  { key: 'Other',      label: 'Other',      columnPrefix: 'Other'       },
];
const RANGES_SECTOR_KEYS   = RANGES_SECTORS.map(s => s.key);
const RANGES_COLUMN_PREFIX = Object.fromEntries(RANGES_SECTORS.map(s => [s.key, s.columnPrefix]));

// Builds { sectorKeys, byCountry, world } from website_data_withranges.csv's
// rows: byCountry[countryName][sectorKey] = { prior, post, minDelta, maxDelta },
// where minDelta/maxDelta are the file's own +/- uncertainty magnitudes (not
// absolute bounds — SectorBarChart derives the absolute lower/upper bound as
// post -/+ delta, clamping the lower bound to 0). `world` is the same shape,
// summed across every country the file covers (154 of the 173 in
// emissions_data3.csv; there's no separate world-level row in the source).
function loadSectorRanges(rangesRows) {
  const byCountry  = {};
  const worldSums  = {};

  for (const raw of rangesRows) {
    const name = raw.countries?.trim();
    if (!name) continue;

    const bySector = {};
    for (const key of RANGES_SECTOR_KEYS) {
      const prefix   = RANGES_COLUMN_PREFIX[key];
      const prior    = parseNumber(raw[`${prefix}_prior`]);
      const post     = parseNumber(raw[`${prefix}_post`]);
      const minDelta = parseNumber(raw[`${prefix}_post_min`]);
      const maxDelta = parseNumber(raw[`${prefix}_post_max`]);
      bySector[key] = { prior, post, minDelta, maxDelta };

      const sums = worldSums[key] ?? (worldSums[key] = { prior: null, post: null, minDelta: null, maxDelta: null });
      if (prior    != null) sums.prior    = (sums.prior    ?? 0) + prior;
      if (post     != null) sums.post     = (sums.post     ?? 0) + post;
      if (minDelta != null) sums.minDelta = (sums.minDelta ?? 0) + minDelta;
      if (maxDelta != null) sums.maxDelta = (sums.maxDelta ?? 0) + maxDelta;
    }
    byCountry[name] = bySector;
  }

  return { sectorKeys: RANGES_SECTOR_KEYS, byCountry, world: worldSums };
}

// world-countries.json (Natural Earth) identifies features by ADMIN name,
// which diverges from this CSV's "countries" column for a handful of
// countries/territories. Maps CSV name -> ADMIN name so the choropleth join
// (keyed on ADMIN, see MapView's getFeatureName) succeeds for these too.
const ADMIN_ALIASES = {
  'Bahamas':      'The Bahamas',
  'Congo':        'Republic of the Congo',
  'Falkland Is.': 'Falkland Islands',
  'North Cyprus': 'Northern Cyprus',
  'Solomon Is.':  'Solomon Islands',
  'Timor-Leste':  'East Timor',
};

registerDataset({
  id:     'ch4-global',
  family: 'CH4',
  name:   'Global',
  description: 'Annual methane emissions by country at 25-km resolution generated with the IMI using TROPOMI satellite data combined with bottom-up information from national BTRs. See East et al. (2025) for details.',
  /*
  description: 'Annual anthropogenic methane emissions by country at 25 km resolution, from East et al. (2025) . Anthropogenic national emission estimates from UNFCCC reports and natural emission estimates from various inventories are corrected by inversion of TROPOMI satellite methane observations to produce best estimates of emissions.',
  */
  citation: { text: 'East et al. (2025)', url: 'https://www.nature.com/articles/s41467-025-67122-8' },
  satellites: ['TROPOMI'],

  reloadTrigger: [],       // load all data once on dataset mount
  gridType: 'country-mask', // signals MapView to overlay a per-country masked grid on click

  mapConfig: {
    initialViewState: { latitude: 20, longitude: 10, zoom: 2 },
    minZoom:   1,
    maxZoom:   8,
    maxBounds: null,
  },

  controls: [
    /*{
      key:     'viewMode',
      label:   'Map View',
      type:    'radio',
      options: [
        { value: 'grid',       label: 'Grid'       },
        { value: 'choropleth', label: 'Shaded Map' },
      ],
      default: 'choropleth',
    },*/
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
    // Order + labels for the Sector Breakdown bar chart — see RANGES_SECTORS
    // above, which is this control's single source of truth.
    barSectors: RANGES_SECTORS.map(({ key, label }) => ({ key, label })),
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
    const [rows, rangesRows, countriesGeoJSON] = await Promise.all([
      fetchCSV(`${import.meta.env.BASE_URL}data/emissions_data3.csv`),
      fetchCSV(`${import.meta.env.BASE_URL}data/ch4_global/website_data_withranges.csv`),
      fetch(`${import.meta.env.BASE_URL}data/world-countries.json`).then(r => {
        if (!r.ok) throw new Error(`world-countries.json: HTTP ${r.status}`);
        return r.json();
      }),
    ]);

    const byYear             = { [YEAR]: {} };
    const stateByYearPrior   = { [YEAR]: {} };
    const worldPosterior     = {};
    const worldPrior         = {};

    const addTo = (acc, key, v) => {
      if (v == null) return;
      acc[key] = (acc[key] ?? 0) + v;
    };

    for (const raw of rows) {
      const csvName = raw.countries?.trim();
      if (!csvName) continue;
      const name = ADMIN_ALIASES[csvName] ?? csvName;

      // byYear: both suffixes present, for choropleth coloring in either
      // Data Source mode (see computeChoroplethDomain / centralCol).
      const row = {};
      // stateByYearPrior: bare keys, prior only — backs the bottom-up bar
      // chart branch (buildBarData's satellite === 'prior' path).
      const priorBare = {};

      for (const s of CSV_SECTOR_KEYS) {
        const prior = parseNumber(raw[`${s}_prior`]);
        const post  = parseNumber(raw[`${s}_post`]);
        row[`${s}_prior`]     = prior;
        row[`${s}_posterior`] = post;
        priorBare[s]          = prior;
        addTo(worldPrior,     s, prior);
        addTo(worldPosterior, s, post);
      }

      const totalAnthPrior = parseNumber(raw.Total_Anth_Prior);
      const totalAnthPost  = parseNumber(raw.Total_Anth_Post);
      row.TotalAnth_prior     = totalAnthPrior;
      row.TotalAnth_posterior = totalAnthPost;
      priorBare.TotalAnth      = totalAnthPrior;
      addTo(worldPrior,     'TotalAnth', totalAnthPrior);
      addTo(worldPosterior, 'TotalAnth', totalAnthPost);

      const totalPrior = parseNumber(raw.Total_prior);
      const totalPost  = parseNumber(raw.Total_posterior);
      row.Total_prior     = totalPrior;
      row.Total_posterior = totalPost;
      priorBare.Total      = totalPrior;
      addTo(worldPrior,     'Total', totalPrior);
      addTo(worldPosterior, 'Total', totalPost);

      byYear[YEAR][name]           = row;
      stateByYearPrior[YEAR][name] = priorBare;
    }

    return {
      byYear,
      nationalPosterior: { [YEAR]: worldPosterior },
      nationalPrior:     { [YEAR]: worldPrior },
      stateByYearPrior,
      sectorKeys:      CSV_SECTOR_KEYS,
      sectorRanges:    loadSectorRanges(rangesRows), // Sector Breakdown chart's sole data source — see loadSectorRanges
      statesGeoJSON:   countriesGeoJSON,
      manifest:        null,
    };
  },
});
