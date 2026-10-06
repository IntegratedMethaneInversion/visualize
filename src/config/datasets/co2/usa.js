import { registerDataset } from '../../datasetRegistry';

registerDataset({
  id:     'co2-conus',
  family: 'CO2',
  name:         'Continental USA',   // big title on the dashboard
  dropdownName: 'Continental USA',   // label in the Dataset dropdown
  description: 'Column-averaged CO₂ concentrations over the continental United States.',
  satellites: ['OCO-2', 'OCO-3', 'GOSAT'],

  mapConfig: {
  initialViewState: { latitude: 39.5, longitude: -98.5, zoom: 4 },
  minZoom: 3,
  maxZoom: 12,
  maxBounds: [[22, -130], [52, -60]],   // [[southLat, westLng], [northLat, eastLng]]
 },

  controls: [
    {
      key:     'year',
      label:   'Year',
      type:    'slider',
      options: [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022],
      default: 2022,
    },
    {
      key:     'satellite',
      label:   'Satellite Source',
      type:    'select',
      options: [
        { value: 'OCO2',  label: 'OCO-2' },
        { value: 'OCO3',  label: 'OCO-3' },
        { value: 'GOSAT', label: 'GOSAT'  },
      ],
      default: 'OCO2',
    },
    {
      key:     'sector',
      label:   'Sector',
      type:    'select',
      options: [
        { value: 'all',         label: 'All Sectors'    },
        { value: 'energy',      label: 'Energy'         },
        { value: 'transport',   label: 'Transportation' },
        { value: 'industrial',  label: 'Industrial'     },
        { value: 'land_use',    label: 'Land Use'       },
        { value: 'residential', label: 'Residential'    },
      ],
      default: 'all',
    },
    {
      key:     'aggregation',
      label:   'View By',
      type:    'radio',
      options: [
        { value: 'grid',   label: 'Grid'   },
        { value: 'state',  label: 'State'  },
        { value: 'county', label: 'County' },
      ],
      default: 'grid',
    },
  ],

  display: {
    units: 'ppm',
    colorScale: {
      stops: [
        [408, '#f7fbff'],
        [412, '#6baed6'],
        [416, '#2171b5'],
        [422, '#084594'],
      ],
    },
    legendTitle: 'XCO₂ (ppm)',
  },

  async dataLoader(controls) {
    // Stub — replace with real endpoint when API is ready
    return { type: 'FeatureCollection', features: [] };

    // const res = await fetch(`/api/co2/conus?${new URLSearchParams(controls)}`);
    // if (!res.ok) throw new Error(`CO2/CONUS fetch failed: ${res.statusText}`);
    // return res.json();
  },
});
