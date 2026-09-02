import { registerDataset }      from '../../datasetRegistry';
import { PERMIAN_PERIODS }      from './permianWeeklyPeriods';

const DATA_ROOT   = `${import.meta.env.BASE_URL}data/ch4_permian_weekly`;
const MANIFEST_URL = `${DATA_ROOT}/manifest_start_labels.json`;

// PERMIAN_PERIODS covers all 286 periods (2018-07 through 2023-12). Periods
// 1-26 (2018) are a partial year of weeks stored under tif_2018/nc_2018 —
// the manifest's own paths for those periods point at tif/nc instead, where
// the files don't exist, so dataLoader() patches them after fetch (see below).
const PERIOD_BY_KEY = new Map(PERMIAN_PERIODS.map(p => [p.key, p]));
const YEARS = [...new Set(PERMIAN_PERIODS.map(p => Number(p.start.slice(0, 4))))];

function periodsForYear(year) {
  return PERMIAN_PERIODS.filter(p => Number(p.start.slice(0, 4)) === year);
}

function formatWeekLabel(periodKey) {
  const period = PERIOD_BY_KEY.get(periodKey);
  if (!period) return String(periodKey);
  const date = new Date(`${period.start}T00:00:00Z`);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

const DEFAULT_YEAR   = 2022;
const DEFAULT_PERIOD = periodsForYear(DEFAULT_YEAR)[0]?.key;

registerDataset({
  id:       'ch4-permian-weekly',
  family:   'CH4',
  name:     'Permian Basin',
  dataRoot: DATA_ROOT,
  description: 'Weekly methane emissions for the Permian basin generated with the IMI using TROPOMI satellite data. See Varon et al. (2025) for details.',
  citation: { text: 'Varon et al. (2025)', url: 'https://pubs.acs.org/esthag/article/60/1/425/5082337/Seasonality-and-Declining-Intensity-of-Methane' },
  satellites: ['TROPOMI', 'GHGSat'],

  reloadTrigger: [],
  gridType: 'period', // signals MapView/Legend to resolve tif urls via manifest.data[satellite][sector][period]

  mapConfig: {
    initialViewState: { latitude: 32, longitude: -104, zoom: 7 },
    minZoom: 3,
    maxZoom: 12,
    maxBounds: [[22, -130], [52, -60]],
  },

  controls: [
    {
      key:     'satellite',
      label:   'Data Source',
      type:    'select',
      group:   'selects-row',
      options: [
        { value: 'posterior', label: 'Posterior (TROPOMI)' },
        { value: 'prior',     label: 'Prior (Bottom-up GHGI Inventory)' },
      ],
      default: 'posterior',
    },
    {
      key:        'sector',
      label:      'Sector',
      type:       'select',
      group:      'selects-row',
      getOptions: (baseData) =>
        (baseData?.manifest?.variables ?? []).map(v => ({ value: v.key, label: v.label })),
      default: 'EmisCH4_Total_ExclSoilAbs',
    },
    {
      key:     'year',
      label:   'Year',
      type:    'select',
      group:   'selects-row',
      options: () => YEARS.map(y => ({ value: y, label: String(y) })),
      default: DEFAULT_YEAR,
    },
    {
      // 286 weekly rasters is too many for a flat dropdown, so this is a
      // slider scoped to the selected Year (~52 stops) rather than a select
      // over all periods. Its options are recomputed whenever Year changes
      // (see DatasetContext's SET_CONTROL reclamp), and the current stop is
      // shown as its actual start date instead of a raw period number.
      key:     'period',
      label:   'Week',
      type:    'slider',
      options: (controls) => periodsForYear(controls.year ?? DEFAULT_YEAR).map(p => p.key),
      format:  formatWeekLabel,
      default: DEFAULT_PERIOD,
    },
    {
      key:     'opacity',
      label:   'Layer Opacity',
      type:    'slider',
      options: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
      default: 0.7,
      format:  v => `${Math.round(v * 100)}%`,
    },
    {
      key:     'maxEmission',
      label:   'Color Scale Max',
      type:    'slider',
      options: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.25, 1.5, 2.0],
      default: 1.0,
      format:  v => `${Math.round(v * 100)}%`,
    },
  ],

  display: {
    units:       'Gg/week',
    legendTitle: 'CH₄ Emissions',
    legendUnits: 'kg h⁻¹',
    totalsLabels: { bottomUp: 'Bottom-up', posterior: 'IMI Best Estimate' }, // column headers on the DataTotals table
    colorScale: {
      stops: [
        [0,    '#ffffcc'],
        [0.15, '#feb24c'],
        [0.4,  '#fd8d3c'],
        [0.65, '#e31a1c'],
        [1.0,  '#800026'],
      ],
    },
  },

  async dataLoader() {
    const manifest = await fetch(MANIFEST_URL).then(r => {
      if (!r.ok) throw new Error(`manifest_start_labels.json: HTTP ${r.status}`);
      return r.json();
    });

    // Periods 1-26 (2018) were generated into tif_2018/nc_2018 folders, but
    // the manifest's own tif/nc paths for those periods still point at
    // tif/nc (where the files don't exist) — patch them in place so every
    // consumer of manifest.data can stay oblivious to the 2018 split.
    const legacy2018Keys = new Set(
      (manifest.periods ?? []).filter(p => p.start < '2019-01-01').map(p => p.key),
    );
    for (const variables of Object.values(manifest.data ?? {})) {
      for (const periods of Object.values(variables)) {
        for (const key of Object.keys(periods)) {
          if (!legacy2018Keys.has(key)) continue;
          const entry = periods[key];
          if (entry.tif) entry.tif = entry.tif.replace('/tif/', '/tif_2018/');
          if (entry.nc)  entry.nc  = entry.nc.replace('/nc/', '/nc_2018/');
        }
      }
    }

    return {
      manifest,
      sectorKeys:    (manifest.variables ?? []).map(v => v.key),
      statesGeoJSON: null,
    };
  },
});
