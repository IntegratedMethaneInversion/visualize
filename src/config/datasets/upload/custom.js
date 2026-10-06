import { registerDataset } from '../../datasetRegistry';

registerDataset({
  id:       'user-upload',
  family:   'UPLOAD',
  name:         'Your Data',   // big title on the dashboard
  dropdownName: 'Your Data',   // label in the Dataset dropdown
  description: `Your files are not stored or cached anywhere, so browser refreshes or switching datasets will clear all inputs. Uploads are limited to ~300MB so as to not compromise browser performance. Shaded region/choropleth maps are not supported for user uploads.`,

  reloadTrigger: [],
  gridType:      'upload', // signals MapView to render whatever the user uploaded

  mapConfig: {
    initialViewState: { latitude: 20, longitude: 0, zoom: 2 },
    minZoom: 1,
    maxZoom: 14,
  },

  controls: [
    {
      key:     'viewMode',
      label:   'Map View',
      type:    'radio',
      options: [{ value: 'grid', label: 'Grid' }],
      default: 'grid',
      visible: () => false,
    },
    {
      key:     'sector',
      label:   'Sector',
      type:    'select',
      default: '',
      // Options come from whatever sectors have been uploaded so far — see
      // ControlPanel's getOptions(baseData, { uploadedData }) call. Renders
      // nothing until at least one sector is uploaded (empty options → hidden).
      getOptions: (baseData, { uploadedData }) =>
        Object.keys(uploadedData?.sectors ?? {}).map(key => ({ value: key, label: key })),
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
      key:     'colorScaleMax',
      label:   'Color Scale Max',
      type:    'slider',
      options: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.25, 1.5, 2.0],
      default: 1.0,
      format:  v => `${Math.round(v * 100)}%`,
    },
  ],

  display: {
    units:       '',
    legendTitle: 'Your Data',
    legendUnits: '',
    colorScale: {
      stops: [
        [0,    '#ffffcc'],
        [0.15, '#c2e699'],
        [0.4,  '#78c679'],
        [0.65, '#31a354'],
        [1.0,  '#006837'],
      ],
    },
  },

  async dataLoader() {
    return {
      statesGeoJSON:    null,
      manifest:         null,
      gridFiles:        null,
      gridMeta:         null,
      sectorKeys:       [],
      byYear:           {},
      nationalPosterior: {},
      nationalPrior:    null,
      stateByYearPrior: {},
    };
  },
});
