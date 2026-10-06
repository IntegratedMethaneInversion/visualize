import { registerDataset } from '../../datasetRegistry';

registerDataset({
  id:     'co2-global',
  family: 'CO2',
  name:         'Global',   // big title on the dashboard
  dropdownName: 'Global',   // label in the Dataset dropdown
  description: 'Global column-averaged CO₂ concentrations from satellite observations.',
  satellites: ['OCO-2', 'OCO-3', 'GOSAT', 'GOSAT-2'],

  mapConfig: {
  initialViewState: { latitude: 20, longitude: 10, zoom: 2 },
  minZoom: 1,
  maxZoom: 8,
  maxBounds: null,
 },

  controls: [
    {
      key:     'year',
      label:   'Year',
      type:    'slider',
      options: [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022],
      default: 2021,
    },
    {
      key:     'satellite',
      label:   'Satellite Source',
      type:    'select',
      options: [
        { value: 'OCO2',   label: 'OCO-2'   },
        { value: 'OCO3',   label: 'OCO-3'   },
        { value: 'GOSAT',  label: 'GOSAT'   },
        { value: 'GOSAT2', label: 'GOSAT-2' },
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
      ],
      default: 'all',
    },
    {
      key:     'aggregation',
      label:   'View By',
      type:    'radio',
      options: [
        { value: 'grid',    label: 'Grid'    },
        { value: 'country', label: 'Country' },
        { value: 'region',  label: 'Region'  },
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

    // const res = await fetch(`/api/co2/global?${new URLSearchParams(controls)}`);
    // if (!res.ok) throw new Error(`CO2/Global fetch failed: ${res.statusText}`);
    // return res.json();
  },
});