import { registerFamily } from '../familyRegistry';

registerFamily({
  id:          'CO2',
  name:        'Carbon Dioxide',
  label:       'CO₂',
  dashboardTitle: 'ICI Results Dashboard',        // ← add this
  description: 'Carbon dioxide emissions estimates derived from satellite remote sensing observations.',
  enabled:     false, // temporarily hidden from dashboard — flip to re-enable
  theme: {
    accent:     '#2563eb',               // blue
    accentDim:  'rgba(37,99,235,0.15)',
    accentText: '#ffffff',
  },
});