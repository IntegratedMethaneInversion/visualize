import { registerFamily } from '../familyRegistry';

registerFamily({
  id:          'CH4',
  name:        'Methane',
  /*
  label:       'CH₄',
  */
  label:      'Library',
  dashboardTitle: 'IMI Results Dashboard', 
  description: 'Methane emissions estimates derived from satellite remote sensing observations.',
  theme: {
    accent:     '#d97706',               // amber
    accentDim:  'rgba(217,119,6,0.15)',
    accentText: '#1c0a00',
  },
});
