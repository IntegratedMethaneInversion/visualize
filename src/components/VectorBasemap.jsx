// ─── VectorBasemap ────────────────────────────────────────────────────────────
// CARTO Positron as MapLibre vector tiles, rendered as two Leaflet layers so
// place names stay ABOVE the data overlays.
//
// Why two: a MapLibre layer paints its whole style into one WebGL canvas on one
// Leaflet pane, and the emission grids live on Leaflet panes at z-index 645–650.
// A single instance would therefore put every label underneath the data, so
// the style is split by layer type — geometry goes on the tile pane, the 27
// symbol layers on `labelPane` above. Positron's labels are not quite a
// contiguous block (a few water labels sit below the road casings), so the
// split lifts those few above the roads, which is harmless.
//
// The cost is two WebGL contexts sharing one vector source. Tile requests are
// deduped by the HTTP cache, but each instance parses them, so this trades some
// CPU on pan for the label clarity.

import { useEffect, useMemo, useState } from 'react';
import { useMap, TileLayer } from 'react-leaflet';
import { setWorkerUrl } from 'maplibre-gl';
import { maplibreGL } from '@maplibre/maplibre-gl-leaflet';
import 'maplibre-gl/dist/maplibre-gl.css';

// maplibre parses every vector tile in a web worker, and by default locates it
// relative to its own module URL — which no bundler leaves intact. Left alone
// the worker 404s and the map renders as an empty canvas with no error, so the
// URL is pinned here. `?worker&url` makes Vite bundle the worker together with
// the shared chunk it imports and hand back the emitted asset's URL, which is
// what the plain `?url` form would get wrong. Must run before any Map is
// constructed; module scope guarantees that.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

setWorkerUrl(maplibreWorkerUrl);

export const POSITRON_STYLE_URL =
  'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> contributors ' +
  '&copy; <a href="https://carto.com/attributions">CARTO</a>';

// Data panes run 645–650 (see RasterLayer / JsonGridLayer / CountryGridLayer).
const LABEL_PANE   = 'labelPane';
const LABEL_Z_INDEX = '660';

// ══════════════════════════════════════════════════════════════════════════════
// STYLE TUNING — the three knobs, coarsest first. Everything below this banner
// is safe to edit; nothing else in this file needs to change.
//
//   1. BRIGHTNESS  scale every colour in a category up or down
//   2. MIN_ZOOM    change the zoom at which a layer starts drawing
//   3. PAINT       replace one exact property on one exact layer
//
// Later knobs win over earlier ones: an explicit PAINT entry is applied after
// BRIGHTNESS and is left untouched by it.
// ══════════════════════════════════════════════════════════════════════════════

// Positron's 93 layers, bucketed by what they draw. `groupOf` below assigns
// every layer to exactly one of these, so a single number can retone a whole
// class of detail. Counts: road 51, label 27, land 5, boundary 4, water 3,
// building 2, background 1. Every symbol layer counts as a label, so
// `label` also covers watername_* and roadname_* rather than water/road.
// The group names are the keys of BRIGHTNESS below.

function groupOf(layer) {
  const id = layer.id;
  if (layer.type === 'background') return 'background';
  if (id.includes('boundary')) return 'boundary';
  if (layer.type === 'symbol') return 'label';
  if (/water|ocean|river/.test(id)) return 'water';
  if (id.includes('building')) return 'building';
  if (/tunnel|bridge|road|highway|transit|aeroway|rail/.test(id)) return 'road';
  if (/landuse|landcover|park|wood|grass|sand|glacier/.test(id)) return 'land';
  return 'other';
}

// ─── 1. BRIGHTNESS ────────────────────────────────────────────────────────────
// Multiplier on the RGB channels of every colour in the group. 1 = untouched,
// >1 lighter, <1 darker. Alpha is preserved and channels clamp at 255, so a
// large value flattens toward white rather than wrapping.
//
// Applies to the *fill* colours only, never to `*-halo-color`: label halos are
// the light outline that keeps text legible over the emission grids, and
// darkening them alongside the text erases the contrast it provides.
//
// Start here rather than with PAINT — one number retones 55 road layers at once
// and keeps each layer's zoom ramp intact.
const BRIGHTNESS = {
  background: 1,
  water:      1,
  land:       1,
  boundary:   1,
  road:       1,
  building:   1,
  label:      0.6,   // Positron's stock greys wash out over the colour ramps
  other:      1,
};

// ─── 2. MIN_ZOOM ──────────────────────────────────────────────────────────────
// The zoom at which a layer starts drawing — the dial that actually governs how
// much regional detail appears. Positron is tuned as a sparse backdrop and
// withholds these until late, which is what made zoomed-in views feel empty.
// Stock values in comments.
const MIN_ZOOM = {
  boundary_county: 6,   // was 9
  place_villages:  4,   // was 10
  place_hamlet:   6,   // was 12
  place_suburbs:  10,   // was 12
  boundary_state: 2,
  place_country_1: 2,
  road_mot_case_noramp: 3,   // was 6
};

// ─── 3. PAINT ─────────────────────────────────────────────────────────────────
// Exact style-spec paint properties on one layer, replacing whatever the style
// had. Note that most Positron colours are zoom ramps
// (`{ stops: [[4, '#ead5d7'], [6, '#e1c5c7']] }`), so assigning a flat colour here
// deliberately discards that ramp — which is usually what you want for a line
// you need visible at every zoom. Pass a ramp object to keep zoom-dependence.
//
// These two replace the hard-coded white US state outline that used to be drawn
// over the global choropleth, but apply worldwide and at every zoom.
const PAINT = {
  boundary_state:  { 'line-color': 'rgba(15,23,42,0.35)', 'line-width': 0.6 },
  boundary_county: { 'line-color': 'rgba(15,23,42,0.15)' },
  road_mot_case_noramp:          { 'line-color': '#ae620b', 'line-width': 0.8 },
};

// ══════════════════════════════════════════════════════════════════════════════
// End of tuning. Implementation below.
// ══════════════════════════════════════════════════════════════════════════════

// Colour properties worth scaling. `*-halo-color` is intentionally absent.
const TINTABLE = [
  'background-color', 'fill-color', 'line-color', 'text-color',
  'fill-extrusion-color', 'circle-color', 'icon-color',
];

const clamp255 = (n) => Math.max(0, Math.min(255, Math.round(n)));

// Scales one CSS colour string. Returns null for anything unrecognised so the
// caller can leave the original value in place rather than emit a broken one.
function scaleColorString(value, factor) {
  if (typeof value !== 'string') return null;
  const str = value.trim();
  if (str === 'transparent' || str === 'none') return null;

  let m = /^#([0-9a-f]{3})$/i.exec(str);
  if (m) {
    const [r, g, b] = [...m[1]].map((c) => parseInt(c + c, 16));
    return `rgb(${clamp255(r * factor)}, ${clamp255(g * factor)}, ${clamp255(b * factor)})`;
  }

  m = /^#([0-9a-f]{6})$/i.exec(str);
  if (m) {
    const n = parseInt(m[1], 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    return `rgb(${clamp255(r * factor)}, ${clamp255(g * factor)}, ${clamp255(b * factor)})`;
  }

  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+)\s*)?\)$/i.exec(str);
  if (m) {
    const [r, g, b] = [1, 2, 3].map((i) => Number(m[i]) * factor);
    const a = m[4] === undefined ? 1 : Number(m[4]);
    return `rgba(${clamp255(r)}, ${clamp255(g)}, ${clamp255(b)}, ${a})`;
  }

  return null;                        // named colour or expression — left as-is
}

// Colour values come in three shapes: a flat string, a legacy zoom ramp
// (`{ stops: [[zoom, colour], …] }`), or an expression array
// (`['interpolate', …]`). Recursing over all three keeps zoom-dependence intact
// instead of flattening a ramp to a single colour.
function scaleColorValue(value, factor) {
  if (factor === 1) return value;

  if (typeof value === 'string') return scaleColorString(value, factor) ?? value;

  if (Array.isArray(value)) {
    return value.map((item) => (
      typeof item === 'string' ? (scaleColorString(item, factor) ?? item)
        : (item && typeof item === 'object') ? scaleColorValue(item, factor)
          : item
    ));
  }

  if (value && typeof value === 'object') {
    if (Array.isArray(value.stops)) {
      return {
        ...value,
        stops: value.stops.map(([stop, color]) => [stop, scaleColorValue(color, factor)]),
      };
    }
    return value;
  }

  return value;
}

function tuneLayer(layer) {
  const next = { ...layer };
  const factor = BRIGHTNESS[groupOf(layer)] ?? 1;

  if (factor !== 1 && layer.paint) {
    const paint = { ...layer.paint };
    for (const prop of TINTABLE) {
      if (prop in paint) paint[prop] = scaleColorValue(paint[prop], factor);
    }
    next.paint = paint;
  }

  if (layer.id in MIN_ZOOM) next.minzoom = MIN_ZOOM[layer.id];

  // Applied last so an explicit override is never re-scaled by BRIGHTNESS.
  if (layer.id in PAINT) next.paint = { ...next.paint, ...PAINT[layer.id] };

  return next;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
// CARTO does not yet enforce a key on the vector endpoints (unlike the raster
// ones, which serve a watermarked tile without it) but has announced that it
// will, so every request carries the key now. Scoped to CARTO hosts so that
// pointing `styleUrl` at another provider cannot leak it.

const CARTO_HOST = /(^|\.)cartocdn\.com$/;

function withKey(url) {
  const key = import.meta.env.VITE_CARTO_API_KEY;
  if (!key) return url;
  try {
    const parsed = new URL(url, window.location.href);
    if (!CARTO_HOST.test(parsed.hostname) || parsed.searchParams.has('key')) return url;
    parsed.searchParams.set('key', key);
    return parsed.toString();
  } catch {
    return url;                       // non-absolute or opaque URL — leave alone
  }
}

// Module-level so the identity is stable and GLLayer's effect does not tear the
// WebGL context down on every render. Covers tiles.json, .mvt, sprite, glyphs.
const transformRequest = (url) => ({ url: withKey(url) });

// One fetch shared by both instances and across dataset switches.
let stylePromise = null;

function loadStyle(url) {
  stylePromise ??= fetch(withKey(url)).then((r) => {
    if (!r.ok) throw new Error(`basemap style: HTTP ${r.status}`);
    return r.json();
  });
  return stylePromise;
}

function splitStyle(style) {
  const layers = style.layers.map(tuneLayer);

  return {
    // Keeps the `background` layer, so this canvas is opaque.
    geometry: { ...style, layers: layers.filter((l) => l.type !== 'symbol') },
    // No background layer here — the canvas stays transparent over the data.
    labels:   { ...style, layers: layers.filter((l) => l.type === 'symbol') },
  };
}

function GLLayer({ style, pane, attribution }) {
  const map = useMap();

  useEffect(() => {
    const layer = maplibreGL({ style, pane, attribution, transformRequest });
    layer.addTo(map);

    // Leaflet drives all interaction; the canvas must not swallow clicks meant
    // for the choropleth beneath it or the grid hover above it.
    layer.getContainer().style.pointerEvents = 'none';

    return () => { map.removeLayer(layer); };
  }, [map, style, pane, attribution]);

  return null;
}

export function VectorBasemap({ styleUrl = POSITRON_STYLE_URL }) {
  const map = useMap();
  const [split,  setSplit]  = useState(null);
  const [failed, setFailed] = useState(false);

  // Built during render, not in an effect: Leaflet falls back to the tile pane
  // for any layer naming a pane that does not exist yet, which would silently
  // drop the labels back underneath the data.
  useMemo(() => {
    if (map.getPane(LABEL_PANE)) return;
    const pane = map.createPane(LABEL_PANE);
    pane.style.zIndex = LABEL_Z_INDEX;
    pane.style.pointerEvents = 'none';
  }, [map]);

  useEffect(() => {
    let alive = true;
    loadStyle(styleUrl)
      .then((style) => { if (alive) setSplit(splitStyle(style)); })
      .catch((err) => {
        console.error('Vector basemap failed, falling back to raster tiles:', err);
        if (alive) setFailed(true);
      });
    return () => { alive = false; };
  }, [styleUrl]);

  // Raster fallback keeps the same geometry/labels pane split, so a style-fetch
  // failure costs detail but never the layer ordering.
  if (failed) {
    const key = import.meta.env.VITE_CARTO_API_KEY;
    return (
      <>
        <TileLayer
          url={`https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png?key=${key}`}
          attribution={ATTRIBUTION}
          subdomains="abcd"
          maxZoom={20}
        />
        <TileLayer
          url={`https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png?key=${key}`}
          subdomains="abcd"
          maxZoom={20}
          pane={LABEL_PANE}
        />
      </>
    );
  }

  if (!split) return null;

  return (
    <>
      <GLLayer style={split.geometry} pane="tilePane" attribution={ATTRIBUTION} />
      <GLLayer style={split.labels}   pane={LABEL_PANE} />
    </>
  );
}
