// ─── Per-country framing overrides (ch4-global) ──────────────────────────────
// Selecting a country frames the map on that country's own geometry. Two
// things can make the automatic frame wrong, and only one of them is fixable
// in code:
//
//   * Territory crossing the antimeridian. Handled automatically — see
//     boundsOf in utils/mapFraming.js. Russia, Fiji, New Zealand, Kiribati and
//     the US Minor Outlying Islands all frame correctly with no entry here.
//
//   * Distant overseas territory that is genuinely part of the country but not
//     what a country factsheet is meant to show. France's bounding box reaches
//     from French Guiana to Réunion, Norway's from Bouvet Island at 54°S to
//     Svalbard at 81°N, and the United States' from Guam to Puerto Rico. Each
//     frames as an ocean with specks in it. That's a judgment call, not a
//     geometry bug, so it lives here.
//
// THIS ONLY MOVES THE CAMERA. A country's emissions still cover all of its
// territory — narrowing the frame never narrows the numbers, the choropleth
// value or the Sector Breakdown chart.
//
// Keys are the map's own feature names: Natural Earth's ADMIN property, which
// is also what selectedState holds and what the ?country= param's aliases
// resolve to before lookup. Three shapes, use whichever fits:
//
//   { center: [lat, lng], zoom }   set the view outright
//   { bounds: [[s, w], [n, e]] }   frame these bounds instead of the geometry's
//   { maxZoom }                    keep the automatic framing, change the clamp
//
// To add an entry, open the dashboard at
//     ?country=<name>&fit=1
// pan and zoom until the framing is right, and copy the ready-made line that
// FitToSelection logs to the console each time the map settles. The same
// numbers are on window.__imiView if a script wants them. ?center=<lat,lng>
// and ?zoom=<n> override the framing for a single page load, so a value can be
// tried without editing this file.
//
// The entries below are a starting point covering the countries whose default
// frame is most obviously unusable — none of them is authoritative, and
// deleting one just restores the automatic framing for that country.

export const COUNTRY_VIEWS = {
  // Russia's automatic frame is correct but a whole zoom level too loose:
  // it needs zoom 2.97 to fit, and Leaflet snaps a fitted zoom down to a whole
  // number, so it lands on 2 and fills a third of the map. Asking for 3 crops
  // a sliver off Kaliningrad and Chukotka and is worth it. (This snapping is
  // the usual reason an otherwise-correct frame looks too far out.)
  'Russia':                   { center: [66.0, 100.0], zoom: 3 },

  // Mainland New Zealand. The Kermadec Islands, 800 km north-east, otherwise
  // pull the frame off the country entirely.
  'New Zealand':              { bounds: [[-47.4, 166.3], [-34.3, 178.7]] },

  // Contiguous US. Alaska, Hawaii and the Pacific territories otherwise
  // stretch the frame 121° wide across the ocean.
  'United States of America': { bounds: [[24.5, -125.0], [49.4, -66.9]] },

  // Metropolitan France, excluding French Guiana, the Antilles and Réunion.
  'France':                   { bounds: [[41.3,   -5.2], [51.1,    9.6]] },

  // European Netherlands, excluding the Caribbean municipalities.
  'Netherlands':              { bounds: [[50.7,    3.3], [53.6,    7.2]] },

  // Mainland Norway, excluding Svalbard, Jan Mayen and Bouvet Island.
  'Norway':                   { bounds: [[57.9,    4.5], [71.2,   31.1]] },

  // Mainland Portugal, excluding the Azores and Madeira.
  'Portugal':                 { bounds: [[36.9,   -9.6], [42.2,   -6.2]] },

  // Peninsular Spain and the Balearics, excluding the Canaries.
  'Spain':                    { bounds: [[35.9,   -9.4], [43.9,    4.4]] },

  // Mainland Chile, excluding Easter Island.
  'Chile':                    { bounds: [[-56.0, -76.0], [-17.5,  -66.4]] },

  // Mainland Ecuador, excluding the Galápagos.
  'Ecuador':                  { bounds: [[-5.1,  -81.1], [1.5,    -75.2]] },
};
