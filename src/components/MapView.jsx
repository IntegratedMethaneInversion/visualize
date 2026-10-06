import React, {
  useEffect, useRef, useState, useMemo, useCallback,
} from 'react';
import { createPortal } from 'react-dom';
import {
  MapContainer,
  GeoJSON,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import L                from 'leaflet';
import 'leaflet/dist/leaflet.css';
import parseGeoraster        from 'georaster';
import GeoRasterLayer        from 'georaster-layer-for-leaflet';
import { VectorBasemap }     from './VectorBasemap';
import { useDatasetContext } from '../context/DatasetContext';
import { useEmissionData }   from '../hooks/useEmissionData';
import { useDisplayUnit }    from '../hooks/useDisplayUnit';
import { formatMassValue, convertMass, formatRange, boundsFromDeltas } from '../utils/units';
import {
  getManifestEntry,
  getGlobalDomain,
  getPeriodManifestEntry,
  getPeriodGlobalDomain,
  resolveTifUrl,
} from '../utils/manifestUtils';
import {
  computeChoroplethDomain,
  centralCol,
  parseNumber,
  hasUncertainty,
} from '../utils/emissionsUtils';
import { rasterMax } from '../utils/gridStats';
import { boundsOf, applyRegionView, FIT_MAX_ZOOM } from '../utils/mapFraming';

// ─── Color utilities ──────────────────────────────────────────────────────────

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m
    ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]
    : [0, 0, 0];
}

function stopsToColor(t, stops) {
  if (!stops?.length) return 'rgba(128,128,128,1)';
  const c = Math.max(0, Math.min(1, t));
  if (c <= stops[0][0]) return stops[0][1];
  const last = stops[stops.length - 1];
  if (c >= last[0]) return last[1];

  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (c >= t0 && c <= t1) {
      const f    = (c - t0) / (t1 - t0);
      const rgb0 = hexToRgb(c0);
      const rgb1 = hexToRgb(c1);
      const r    = Math.round(rgb0[0] + f * (rgb1[0] - rgb0[0]));
      const g    = Math.round(rgb0[1] + f * (rgb1[1] - rgb0[1]));
      const b    = Math.round(rgb0[2] + f * (rgb1[2] - rgb0[2]));
      return `rgba(${r},${g},${b},1)`;
    }
  }
  return last[1];
}

function buildPixelColorFn(domainMin, domainMax, stops) {
  const range = (domainMax - domainMin) || 1;
  return (values) => {
    let v = values[0];
    if (v == null || Number.isNaN(v)) v = 0;
    const t = (v - domainMin) / range;
    return stopsToColor(t, stops);
  };
}

// ─── Feature name helper ──────────────────────────────────────────────────────
// Handles US state GeoJSON (name / NAME / NAME_1), Colombia province GeoJSON
// (PROVINCE / province), and Natural Earth world-countries GeoJSON (ADMIN)
// with a single priority-ordered lookup.

function getFeatureName(feature) {
  const p = feature?.properties ?? {};
  return p.ADMIN ?? p.name ?? p.NAME ?? p.NAME_1 ?? p.PROVINCE ?? p.province ?? '';
}

// ─── Grid value lookup (TIF) ──────────────────────────────────────────────────

function getValueAtLatLng(gr, lat, lng, { allowZero = false } = {}) {
  if (!gr?.values) return null;
  const {
    xmin, xmax, ymin, ymax,
    pixelWidth, pixelHeight,
    values, noDataValue,
    width, height,
  } = gr;
  if (lng < xmin || lng > xmax || lat < ymin || lat > ymax) return null;
  const col = Math.floor((lng - xmin) / pixelWidth);
  const row = Math.floor((ymax - lat) / pixelHeight);
  if (row < 0 || row >= height || col < 0 || col >= width) return null;
  const val = values[0]?.[row]?.[col];
  if (val == null)                                   return null;
  if (noDataValue != null && val === noDataValue)    return null;
  if (!Number.isFinite(val) || (!allowZero && val <= 0)) return null;
  return val;
}

// ─── Grid value lookup (JSON / Colombia) ──────────────────────────────────────
// Nearest-neighbour search into the flat values array using the lat/lon metadata.

function getValueAtLatLngFromGrid(gridMeta, values, lat, lng, { allowZero = false } = {}) {
  if (!gridMeta?.lats?.length || !gridMeta?.lons?.length || !values?.length) return null;

  const { lats, lons } = gridMeta;
  const nlat = lats.length;
  const nlon = lons.length;
  const dlat = nlat > 1 ? Math.abs(Number(lats[1]) - Number(lats[0])) : 0.25;
  const dlon = nlon > 1 ? Math.abs(Number(lons[1]) - Number(lons[0])) : 0.25;

  // Find nearest lat row
  let latIdx = 0, minLatD = Infinity;
  for (let i = 0; i < nlat; i++) {
    const d = Math.abs(Number(lats[i]) - lat);
    if (d < minLatD) { minLatD = d; latIdx = i; }
  }
  if (minLatD > dlat / 2) return null;   // cursor outside grid

  // Find nearest lon column
  let lonIdx = 0, minLonD = Infinity;
  for (let j = 0; j < nlon; j++) {
    const d = Math.abs(Number(lons[j]) - lng);
    if (d < minLonD) { minLonD = d; lonIdx = j; }
  }
  if (minLonD > dlon / 2) return null;   // cursor outside grid

  const v = values[latIdx * nlon + lonIdx];
  if (v == null || !Number.isFinite(v) || (!allowZero && v <= 0)) return null;
  return v;
}

// ─── MapController ────────────────────────────────────────────────────────────
// React-Leaflet's MapContainer treats center / zoom / maxBounds as initial-only.
// This child component keeps the Leaflet instance in sync when the active dataset
// (and therefore mapConfig) changes.

function MapController({ mapConfig }) {
  const map = useMap();
  const { initialViewState, maxBounds, minZoom, maxZoom } = mapConfig;

  // Stable serialised key — bounds effect only re-fires when limits actually change
  const boundsKey = JSON.stringify({ maxBounds: maxBounds ?? null, minZoom, maxZoom });

  // Re-centre / re-zoom on dataset switch
  useEffect(() => {
    map.setView(
      [initialViewState.latitude, initialViewState.longitude],
      initialViewState.zoom,
      { animate: true, duration: 0.5 },
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, initialViewState.latitude, initialViewState.longitude, initialViewState.zoom]);

  // Sync pan bounds and zoom limits
  useEffect(() => {
    if (maxBounds) {
      map.setMaxBounds(maxBounds);
      map.options.maxBoundsViscosity = 1.0;
    } else {
      map.setMaxBounds(null);
      map.options.maxBoundsViscosity = 0;
    }
    if (minZoom != null) map.setMinZoom(minZoom);
    if (maxZoom != null) map.setMaxZoom(maxZoom);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, boundsKey]);

  return null;
}

// ─── FitToSelection (?fit=1) ──────────────────────────────────────────────────
// Selecting a country normally only restyles it — the viewport stays wherever
// MapController last put it, which for ch4-global is the whole world. That
// makes a useless factsheet image, so ?fit=1 frames the selection instead.
//
// Rendered after MapController so its mount effect runs after that component's
// setView, and only while ?fit=1 is set, so default behaviour is untouched.
// animate:false throughout — an in-flight pan is a race with the screenshot.
//
// Where the resulting frame is wrong, applyRegionView takes an override: see
// config/datasets/ch4/countryViews.js. This component publishes the settled
// view as window.__imiView and logs a ready-to-paste entry for that table on
// every settle, so a new override can be dialled in by panning the map rather
// than guessing coordinates.

function FitToSelection({ geojson, selectedState, override, urlView }) {
  const map = useMap();

  useEffect(() => {
    if (!geojson?.features?.length || !selectedState) return undefined;
    const feature = geojson.features.find(f => getFeatureName(f) === selectedState);
    if (!feature) return undefined;

    try {
      applyRegionView(map, {
        bounds:  boundsOf(feature),
        override,
        urlView,
        maxZoom: FIT_MAX_ZOOM,
        animate: false,
      });
    } catch (err) {
      console.error('[FitToSelection]', err.message);
    }

    const report = () => {
      const c = map.getCenter();
      const view = {
        country: selectedState,
        center:  [Number(c.lat.toFixed(2)), Number(c.lng.toFixed(2))],
        zoom:    Number(map.getZoom().toFixed(2)),
      };
      window.__imiView = view;
      console.info(
        `[fit] '${selectedState}': { center: [${view.center[0]}, ${view.center[1]}], zoom: ${view.zoom} },`
        + '  ← paste into src/config/datasets/ch4/countryViews.js',
      );
    };

    report();
    map.on('moveend zoomend', report);
    return () => { map.off('moveend zoomend', report); };
  }, [map, geojson, selectedState, override, urlView]);

  return null;
}

// ─── ReadinessFlag ────────────────────────────────────────────────────────────
// window.__imiReady / <body data-imi-ready> tell the factsheet screenshot
// script when the view has actually settled, so it doesn't have to guess with
// fixed sleeps. Deliberately conservative: the flag clears on every dataset,
// control or selection change and only re-arms once
//   * the dataset's dataLoader has resolved,
//   * the URL's initial state has been applied,
//   * any per-country grid has finished loading,
//   * the map has stopped moving, and
//   * one frame has been painted (Leaflet layers and the Recharts SVG are
//     drawn by then, not merely mounted).

// Grace period after the last moveend, so a fitBounds that is about to be
// issued in a following effect isn't mistaken for a settled map.
const MAP_IDLE_MS = 150;

function setReadyFlag(ready) {
  if (typeof window === 'undefined') return;
  window.__imiReady = ready;
  if (ready) document.body.dataset.imiReady = 'true';
  else       delete document.body.dataset.imiReady;
}

function ReadinessFlag({ loading, error, gridLoading }) {
  const map = useMap();
  const { activeDataset, controls, selectedState, urlHydrated } = useDatasetContext();

  const dataSettled = !loading && error == null && urlHydrated && !gridLoading;
  // Controls are a fresh object on every change, so serialise for a dep that
  // compares by value rather than re-running this on every render.
  const controlsKey = JSON.stringify(controls);

  useEffect(() => {
    setReadyFlag(false);
    if (!dataSettled) return undefined;

    let cancelled = false;
    let idleTimer = null;
    let rafId     = null;

    const arm = () => {
      clearTimeout(idleTimer);
      if (rafId != null) cancelAnimationFrame(rafId);
      idleTimer = setTimeout(() => {
        // Still moving: the moveend that ends this pan will re-arm.
        if (cancelled || map._moving || map._animatingZoom) return;
        rafId = requestAnimationFrame(() => { if (!cancelled) setReadyFlag(true); });
      }, MAP_IDLE_MS);
    };

    const disarm = () => { setReadyFlag(false); arm(); };

    map.on('movestart zoomstart', disarm);
    map.on('moveend zoomend',     arm);
    arm();

    return () => {
      cancelled = true;
      clearTimeout(idleTimer);
      if (rafId != null) cancelAnimationFrame(rafId);
      map.off('movestart zoomstart', disarm);
      map.off('moveend zoomend',     arm);
      setReadyFlag(false);
    };
  }, [map, dataSettled, activeDataset.id, controlsKey, selectedState]);

  return null;
}

// ─── GridHoverLayer (TIF mode) ────────────────────────────────────────────────

// Ensemble min/max TIFs are produced in kg/m²/s; the rest of the app works in
// kg/km²/hr, so convert on read (1 km² = 1000² m², 1 hr = 3600 s).
const KG_M2_S_TO_KG_KM2_HR = (1000 ** 2) * 60 * 60;

// The raw-raster hover tooltips print flux densities rather than unit-selected
// masses, so their range bounds match the central value's fixed 3 decimals
// instead of going through formatMassValue.
const FLUX_FORMAT = v => v.toFixed(3);

function GridHoverLayer({ georaster, minGeoraster, maxGeoraster, units }) {
  const map = useMap();
  const [hover, setHover] = useState(null);

  useMapEvents({
    mousemove(e) {
      if (!georaster) { setHover(null); return; }
      const val = getValueAtLatLng(georaster, e.latlng.lat, e.latlng.lng);
      if (val == null) { setHover(null); return; }
      const rawMin = minGeoraster ? getValueAtLatLng(minGeoraster, e.latlng.lat, e.latlng.lng, { allowZero: true }) : null;
      const rawMax = maxGeoraster ? getValueAtLatLng(maxGeoraster, e.latlng.lat, e.latlng.lng, { allowZero: true }) : null;
      const min = rawMin != null ? rawMin * KG_M2_S_TO_KG_KM2_HR : null;
      const max = rawMax != null ? rawMax * KG_M2_S_TO_KG_KM2_HR : null;
      setHover({ point: e.containerPoint, value: val, min, max });
    },
    mouseout()  { setHover(null); },
    dragstart() { setHover(null); },
  });

  if (!hover) return null;

  // Ensemble min/max only exist for posterior data -- when either is
  // unavailable (e.g. GHGI-prior, or this cell has no ensemble coverage)
  // formatRange returns null and the tooltip falls back to the central
  // value alone.
  const range = formatRange(hover.min, hover.max, FLUX_FORMAT);

  return createPortal(
    <div
      className="grid-hover-tooltip"
      style={{ left: hover.point.x + 14, top: hover.point.y }}
    >
      {hover.value.toFixed(3)}
      {range && <span className="grid-hover-range"> {range}</span>}
      {units && <span className="grid-hover-units"> {units}</span>}
    </div>,
    map.getContainer(),
  );
}

// ─── useGeoraster (fetch + parse only, no map layer) ──────────────────────────
// Used for the min/max ensemble rasters, which back the hover tooltip but are
// never drawn on the map themselves.

function useGeoraster(url) {
  const [georaster, setGeoraster] = useState(null);

  useEffect(() => {
    if (!url) { setGeoraster(null); return undefined; }
    let cancelled = false;
    fetch(url)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status} — ${url}`); return r.arrayBuffer(); })
      .then(buf => parseGeoraster(buf))
      .then(gr  => { if (!cancelled) setGeoraster(gr); })
      .catch(err => { if (!cancelled) console.error('[useGeoraster] load error:', err.message); });
    return () => { cancelled = true; };
  }, [url]);

  return georaster;
}

// ─── useJsonMinMax (fetch only, Colombia hover uncertainty) ───────────────────
// Each uncertainty file holds a single { min: [...], max: [...] } pair of flat
// arrays aligned with gridMeta -- one fetch backs both bounds of the tooltip.

function useJsonMinMax(url) {
  const [minMax, setMinMax] = useState(null);

  useEffect(() => {
    if (!url) { setMinMax(null); return undefined; }
    let cancelled = false;
    fetch(url)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status} — ${url}`); return r.json(); })
      .then(data => { if (!cancelled) setMinMax({ min: data.min ?? null, max: data.max ?? null }); })
      .catch(err => { if (!cancelled) console.error('[useJsonMinMax] load error:', err.message); });
    return () => { cancelled = true; };
  }, [url]);

  return minMax;
}

// ─── useJsonGridMax (fetch only, Colombia pinned-sector domain) ───────────────
// Fetches a grid file just for its own raw max value — used to pin the color
// scale to the Total sector's grid even while a different sector is displayed.
function useJsonGridMax(url) {
  const [max, setMax] = useState(null);

  useEffect(() => {
    if (!url) { setMax(null); return undefined; }
    let cancelled = false;
    fetch(url)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status} — ${url}`); return r.json(); })
      .then(data => {
        if (cancelled) return;
        const vals = Array.isArray(data.values) ? data.values : [];
        let m = 0;
        for (const raw of vals) {
          if (raw == null) continue;
          const v = (Number.isFinite(raw) && raw > 0) ? raw : 0;
          if (v > m) m = v;
        }
        setMax(m > 0 ? m : null);
      })
      .catch(err => { if (!cancelled) console.error('[useJsonGridMax] load error:', err.message); });
    return () => { cancelled = true; };
  }, [url]);

  return max;
}

// ─── useGlobalEnsembleMinMax (ch4-global hover uncertainty) ───────────────────
// ch4-global has no per-sector/year ensemble rasters like CONUS — instead
// there's one gzipped JSON covering the whole world at the model's native
// 0.25°x0.3125° resolution, for every sector at once. This fetches it once
// and reshapes the sectors the Sector dropdown can select into dense
// {gridMeta, values} pairs — same shape Colombia's hover already consumes,
// so the lookup itself is just getValueAtLatLngFromGrid, same as Colombia.
//
// The file only ships "_post" (posterior) variables — no ensemble exists for
// the bottom-up/prior estimate — so there's nothing to look up when the Data
// Source control is set to prior; callers should treat a null result as
// "no uncertainty available" rather than an error.
//
// TotalAnth, Natural and Waste aren't native ensemble variables, so their
// spread is approximated by summing the constituent sectors' min/max
// element-wise — the same composition the central value uses (see
// TOTAL_ANTH_SECTORS / NATURAL_SECTORS / WASTE_SECTORS below), just applied to
// the bounds instead of the estimate. Summing independent bounds like this is
// a worst-case approximation (assumes every sector errs the same direction at
// once), not a statistically rigorous propagation — reasonable for a hover
// tooltip, but worth knowing if this number is ever used for anything more
// rigorous. `Total` needs no such approximation: the file ships a native
// Total_Excl_Soil, which is exactly the country CSV's `Total` definition
// (anthropogenic + wetlands + termites + seeps + biomass burning, soil
// excluded).
const ENSEMBLE_MINMAX_URL = `${import.meta.env.BASE_URL}data/ch4_global/ensemble_minmax.json.gz`;

// Native ensemble variable name -> the Sector dropdown value it corresponds
// to (see global.js's SECTOR_OPTIONS). Only OG/OilAndGas and
// Total_Excl_Soil/Total differ in spelling.
const NATIVE_SECTOR_TO_CONTROL = {
  BiomassBurn:     'BiomassBurn',
  Coal:            'Coal',
  Livestock:       'Livestock',
  OG:              'OilAndGas',
  OtherAnth:       'OtherAnth',
  Rice:            'Rice',
  Reservoirs:      'Reservoirs',
  Wetlands:        'Wetlands',
  Total_Excl_Soil: 'Total',
};
// Fetched to build the aggregates below, but not independently selectable:
// the country CSV has landfills and wastewater only as a merged `Waste`, and
// termites and seeps only inside `Natural`.
const COMPONENT_ONLY_SECTORS = ['Landfills', 'Wastewater', 'Termites', 'Seeps'];
const NATIVE_SECTORS_NEEDED  = [...Object.keys(NATIVE_SECTOR_TO_CONTROL), ...COMPONENT_ONLY_SECTORS];

// The anthropogenic/natural split, in native grid spellings, matching
// global.js's SECTORS: biomass burning counts as natural, alongside termites
// and seeps. This deliberately no longer mirrors build_country_sector_grids.py's
// `aggregates`, which still files BiomassBurn under TotalAnth — the precomputed
// per-cell `emissions_TotalAnth_*`/`emissions_Natural_*` properties therefore
// disagree with these lists and must not be read directly (see
// CONTROL_SECTOR_TO_FILE_KEYS below). Regenerating those files with biomass
// burning moved would let both go back to reading one property per cell.
const TOTAL_ANTH_SECTORS = ['Coal', 'Landfills', 'Livestock', 'OG', 'OtherAnth', 'Rice', 'Wastewater', 'Reservoirs'];
const NATURAL_SECTORS    = ['Termites', 'Seeps', 'BiomassBurn'];
// The country CSV only has landfills and wastewater merged, so the dropdown's
// `Waste` is the aggregate — the gridded products keep them separate.
const WASTE_SECTORS      = ['Landfills', 'Wastewater'];

// Fetched once per session and cached at module scope — CountryGridLayer
// remounts (new `key`) on every country switch, but that should never
// re-trigger a 20MB fetch + decompress + parse of a file whose content
// never changes.
let ensembleMinMaxPromise = null;

function sumDense(length, arrays) {
  const out = new Float32Array(length);
  for (const arr of arrays) {
    for (let i = 0; i < length; i++) out[i] += arr[i];
  }
  return out;
}

function useGlobalEnsembleMinMax() {
  const [result, setResult] = useState(null);

  useEffect(() => {
    let cancelled = false;

    if (!ensembleMinMaxPromise) {
      ensembleMinMaxPromise = fetch(ENSEMBLE_MINMAX_URL)
        .then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status} — ${ENSEMBLE_MINMAX_URL}`);
          // A static host serving this .gz as opaque bytes (no Content-Encoding
          // header) hands us the raw gzip stream, so we decompress it ourselves.
          // Vite's dev server instead declares Content-Encoding: gzip and the
          // browser already transparently decodes it before we ever see the
          // body — decompressing again there would choke on plain JSON text.
          const alreadyDecoded = r.headers.get('content-encoding') === 'gzip';
          return alreadyDecoded
            ? r.text()
            : new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).text();
        })
        .then(text => {
          const raw = JSON.parse(text);
          const { lat: lats, lon: lons } = raw.grid;
          const nlon   = lons.length;
          const length = lats.length * nlon;
          const { lat_index: latIdx, lon_index: lonIdx } = raw.cells;

          // Raw file is "Gg yr-1 per grid cell"; the country-mask grid it
          // annotates (country_sectors/*.json → emissions_<Sector>_post) is Tg.
          const ggToTg = convertMass(1, 'Gg', 'Tg');

          const denseBySector = {}; // native sector name -> {minValues, maxValues}
          for (const sector of NATIVE_SECTORS_NEEDED) {
            const { min, max } = raw.data[`EmisCH4_${sector}_post`] ?? {};
            const minValues = new Float32Array(length).fill(NaN);
            const maxValues = new Float32Array(length).fill(NaN);
            if (min && max) {
              for (let i = 0; i < latIdx.length; i++) {
                const idx = latIdx[i] * nlon + lonIdx[i];
                minValues[idx] = min[i] * ggToTg;
                maxValues[idx] = max[i] * ggToTg;
              }
            }
            denseBySector[sector] = { minValues, maxValues };
          }

          const bySector = {};
          for (const [native, controlValue] of Object.entries(NATIVE_SECTOR_TO_CONTROL)) {
            bySector[controlValue] = denseBySector[native];
          }
          for (const [controlValue, natives] of [
            ['TotalAnth', TOTAL_ANTH_SECTORS],
            ['Natural',   NATURAL_SECTORS],
            ['Waste',     WASTE_SECTORS],
          ]) {
            bySector[controlValue] = {
              minValues: sumDense(length, natives.map(s => denseBySector[s].minValues)),
              maxValues: sumDense(length, natives.map(s => denseBySector[s].maxValues)),
            };
          }

          return { gridMeta: { lats, lons }, bySector };
        })
        .catch(err => {
          console.error('[useGlobalEnsembleMinMax] load error:', err.message);
          ensembleMinMaxPromise = null; // allow a retry on next mount rather than caching the failure
          return null;
        });
    }

    ensembleMinMaxPromise.then(r => { if (!cancelled) setResult(r); });
    return () => { cancelled = true; };
  }, []);

  return result;
}

// ─── JsonGridHoverLayer ───────────────────────────────────────────────────────
// Same portal tooltip as GridHoverLayer but uses the flat JSON values array
// instead of a parsed georaster (the polygon layer is non-interactive).

// NOTE: unlike CountryGridLayer's tooltip (ch4-global, whose cells are Tg/yr
// totals and so track the units selector), this one is deliberately left
// unconverted. Its callers pass display.legendUnits, which for Colombia is a
// flux density — kg km⁻² h⁻¹, not a mass — and for an uploaded grid is
// whatever string the file declared. Neither is something the mass-unit
// selector can rescale, so the raw value and its own label are shown as-is.
function JsonGridHoverLayer({
  gridMeta, values, minValues, maxValues, units,
}) {
  const map = useMap();
  const [hover, setHover] = useState(null);

  useMapEvents({
    mousemove(e) {
      if (!gridMeta || !values) { setHover(null); return; }
      const val = getValueAtLatLngFromGrid(gridMeta, values, e.latlng.lat, e.latlng.lng);
      if (val == null) { setHover(null); return; }
      const min = minValues ? getValueAtLatLngFromGrid(gridMeta, minValues, e.latlng.lat, e.latlng.lng, { allowZero: true }) : null;
      const max = maxValues ? getValueAtLatLngFromGrid(gridMeta, maxValues, e.latlng.lat, e.latlng.lng, { allowZero: true }) : null;
      setHover({ point: e.containerPoint, value: val, min, max });
    },
    mouseout()  { setHover(null); },
    dragstart() { setHover(null); },
  });

  if (!hover) return null;

  // Ensemble min/max only exist for sectors/years with uncertainty coverage --
  // when either is unavailable the tooltip falls back to the central value alone.
  const range = formatRange(hover.min, hover.max, FLUX_FORMAT);

  return createPortal(
    <div
      className="grid-hover-tooltip"
      style={{ left: hover.point.x + 14, top: hover.point.y }}
    >
      {hover.value.toFixed(3)}
      {range && <span className="grid-hover-range"> {range}</span>}
      {units && <span className="grid-hover-units"> {units}</span>}
    </div>,
    map.getContainer(),
  );
}

// ─── RasterLayer (TIF / CONUS) ────────────────────────────────────────────────

function RasterLayer({
  tifUrl, domainMin, domainMax, colorStops, opacity, onGeoRasterReady, onRawMaxReady,
}) {
  const map = useMap();
  const [georaster, setGeoraster] = useState(null);
  const layerRef = useRef(null);
  const displayRef = useRef({ domainMin, domainMax, colorStops, opacity });
  displayRef.current = { domainMin, domainMax, colorStops, opacity };

  useEffect(() => {
    let cancelled = false;
    fetch(tifUrl)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status} — ${tifUrl}`); return r.arrayBuffer(); })
      .then(buf  => parseGeoraster(buf))
      .then(gr   => {
        if (cancelled) return;
        setGeoraster(gr);
        onGeoRasterReady?.(gr);
        onRawMaxReady?.(rasterMax(gr));
      })
      .catch(err => { if (!cancelled) console.error('[RasterLayer] load error:', err.message); });
    return () => { cancelled = true; onGeoRasterReady?.(null); onRawMaxReady?.(null); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tifUrl]);

  useEffect(() => {
    if (!georaster) return undefined;
    const { domainMin: dMin, domainMax: dMax, colorStops: cs, opacity: op } = displayRef.current;

    const PANE = 'rasterPane';
    try {
      if (!map.getPane(PANE)) {
        map.createPane(PANE);
        const p = map.getPane(PANE);
        if (p?.style) { p.style.zIndex = 650; p.style.pointerEvents = 'none'; }
      }
    } catch (_) {}

    if (layerRef.current) {
      try { map.removeLayer(layerRef.current); } catch (_) {
        try { layerRef.current.remove(); } catch (__) {}
      }
      layerRef.current = null;
    }

    try {
      map.eachLayer((l) => {
        if (!l || l === layerRef.current) return;
        if ((!!l.__isGeoRaster || !!(l.options?.pixelValuesToColorFn) || l.options?.pane === PANE)
            && !(l.options?.url || l._url)) {
          try { map.removeLayer(l); } catch (_) {}
        }
      });
    } catch (_) {}

    const layer = new GeoRasterLayer({
      georaster,
      opacity:              op,
      pixelValuesToColorFn: buildPixelColorFn(dMin, dMax, cs),
      resolution:           256,
      pane:                 PANE,
      caching:              false,
    });
    try { layer.__isGeoRaster = true; } catch (_) {}
    layer.addTo(map);
    layerRef.current = layer;

    return () => {
      try { if (map && layer) map.removeLayer(layer); } catch (_) {
        try { layer?.remove(); } catch (__) {}
      }
      try {
        const pane = map.getPane?.('rasterPane');
        if (pane) while (pane.firstChild) pane.removeChild(pane.firstChild);
      } catch (_) {}
      try {
        map.eachLayer((l) => {
          if (!l) return;
          if ((!!l.__isGeoRaster || l.options?.pane === PANE || !!(l.options?.pixelValuesToColorFn))
              && !(l.options?.url || l._url)) {
            try { map.removeLayer(l); } catch (_) {}
          }
        });
      } catch (_) {}
      if (layerRef.current === layer) layerRef.current = null;
    };
  }, [georaster, map]);

  useEffect(() => {
    if (!layerRef.current) return;
    layerRef.current.options.pixelValuesToColorFn = buildPixelColorFn(domainMin, domainMax, colorStops);
    layerRef.current.redraw();
  }, [domainMin, domainMax, colorStops]);

  useEffect(() => {
    if (!layerRef.current) return;
    layerRef.current.setOpacity(opacity);
  }, [opacity]);

  return null;
}

// ─── JsonGridLayer (Colombia) ─────────────────────────────────────────────────

function JsonGridLayer({ gridMeta, filePath, domainMax, colorStops, opacity, onRawMaxReady, onValuesReady }) {
  const map = useMap();
  const layerRef = useRef(null);
  const styleRef = useRef({ domainMax, colorStops, opacity });
  styleRef.current = { domainMax, colorStops, opacity };

  // Effect 1: fetch grid JSON and rebuild the polygon layer
  useEffect(() => {
    if (!filePath || !gridMeta?.lats?.length || !gridMeta?.lons?.length) {
      onRawMaxReady?.(null);
      return undefined;
    }

    let cancelled = false;

    fetch(filePath)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status} — ${filePath}`);
        return r.json();
      })
      .then(data => {
        if (cancelled) return;

        const rawVals = Array.isArray(data.values) ? data.values : [];
        const { lats, lons } = gridMeta;
        const nlat = lats.length;
        const nlon = lons.length;
        const dlat = nlat > 1 ? Math.abs(Number(lats[1]) - Number(lats[0])) : 0.25;
        const dlon = nlon > 1 ? Math.abs(Number(lons[1]) - Number(lons[0])) : 0.25;

        const features = [];
        let rawMax = 0;

        for (let i = 0; i < nlat; i++) {
          for (let j = 0; j < nlon; j++) {
            const raw = rawVals[i * nlon + j];

            // null / undefined means this cell is absent from the dataset — skip it
            if (raw == null) continue;

            // NaN / Infinity → treat as zero so the cell renders with the first
            // colour stop rather than leaving a transparent gap in the grid
            const v = (Number.isFinite(raw) && raw > 0) ? raw : 0;
            if (v > rawMax) rawMax = v;

            const lat = Number(lats[i]);
            const lon = Number(lons[j]);
            features.push({
              type: 'Feature',
              properties: { value: v },
              geometry: {
                type: 'Polygon',
                coordinates: [[
                  [lon - dlon / 2, lat - dlat / 2],
                  [lon + dlon / 2, lat - dlat / 2],
                  [lon + dlon / 2, lat + dlat / 2],
                  [lon - dlon / 2, lat + dlat / 2],
                  [lon - dlon / 2, lat - dlat / 2],
                ]],
              },
            });
          }
        }

        if (cancelled) return;

        if (layerRef.current) {
          try { map.removeLayer(layerRef.current); } catch (_) {}
          layerRef.current = null;
        }

        if (!features.length) { onRawMaxReady?.(null); return; }

        try {
          if (!map.getPane('jsonGridPane')) {
            map.createPane('jsonGridPane');
            const p = map.getPane('jsonGridPane');
            if (p) { p.style.zIndex = '645'; p.style.pointerEvents = 'none'; }
          }
        } catch (_) {}

        const layer = L.geoJSON(
          { type: 'FeatureCollection', features },
          {
            pane:        'jsonGridPane',
            interactive: false,
            style: (feature) => {
              const { domainMax: dm, colorStops: cs, opacity: op } = styleRef.current;
              const t = Math.max(0, Math.min(1, feature.properties.value / (dm || 1)));
              return { color: 'transparent', weight: 0, fillColor: stopsToColor(t, cs), fillOpacity: op };
            },
          },
        );

        layer.addTo(map);
        layerRef.current = layer;
        onRawMaxReady?.(rawMax > 0 ? rawMax : null);
        onValuesReady?.(rawVals);
      })
      .catch(err => {
        if (!cancelled) console.error('[JsonGridLayer]', err.message);
      });

    return () => {
      cancelled = true;
      if (layerRef.current) {
        try { map.removeLayer(layerRef.current); } catch (_) {}
        layerRef.current = null;
      }
      onRawMaxReady?.(null);
      onValuesReady?.(null);    
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, gridMeta, map]);

  // Effect 2: restyle in-place when domain or opacity changes (no rebuild)
  useEffect(() => {
    if (!layerRef.current) return;
    layerRef.current.setStyle((feature) => {
      const t = Math.max(0, Math.min(1, feature.properties.value / (domainMax || 1)));
      return { color: 'transparent', weight: 0, fillColor: stopsToColor(t, colorStops), fillOpacity: opacity };
    });
  }, [domainMax, colorStops, opacity]);

  return null;
}

// ─── CountryGridLayer (ch4-global masked per-country grid) ───────────────────
// Each file is already a ready-made GeoJSON FeatureCollection of grid-cell
// polygons (properties.emissions) clipped to one country — unlike the
// Colombia grid, there's no shared lats/lons metadata to reconstruct cells
// from, so this just draws the features as given. Rendered on a canvas
// renderer (features can number in the thousands for large countries).
//
// The pane is pointer-events:none (see below) so clicks fall through to the
// country-selection layer underneath — otherwise this canvas, which always
// spans the full map viewport regardless of the country's actual footprint,
// would swallow every click and block selecting a different country. That
// same setting means per-feature Leaflet tooltips never fire, so hover values
// are looked up here directly (bounding-box scan, same idea as
// getValueAtLatLngFromGrid) and rendered as a portal tooltip instead.

function cellBBox(geometry) {
  if (!geometry) return null;
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  const walk = (coords) => {
    if (typeof coords[0] === 'number') {
      const [lon, lat] = coords;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      return;
    }
    coords.forEach(walk);
  };
  walk(geometry.coordinates);
  return Number.isFinite(minLat) ? { minLat, maxLat, minLon, maxLon } : null;
}

// Sector dropdown value -> the country_sectors/*.json property key(s) holding
// that sector's estimate; multiple keys are summed. Only OilAndGas/OG differs
// in spelling.
//
// TotalAnth and Natural are summed from their components rather than read off
// the precomputed `emissions_TotalAnth_*`/`emissions_Natural_*` properties,
// because those still count biomass burning as anthropogenic — see
// TOTAL_ANTH_SECTORS above. `Total` needs no entry: it's precomputed and its
// definition is unaffected by which side of the split biomass burning sits on.
// `Waste` is summed for a different reason: these grids keep landfills and
// wastewater separate, while the country CSV only has them merged.
const CONTROL_SECTOR_TO_FILE_KEYS = {
  OilAndGas: ['OG'],
  Waste:     WASTE_SECTORS,
  TotalAnth: TOTAL_ANTH_SECTORS,
  Natural:   NATURAL_SECTORS,
};

function emissionsPropertyKeys(sector, satellite) {
  const suffix = satellite === 'prior' ? 'prior' : 'post';
  const keys   = CONTROL_SECTOR_TO_FILE_KEYS[sector] ?? [sector];
  return keys.map(k => `emissions_${k}_${suffix}`);
}

// Cells omit zero-valued sector keys entirely (most cells are dominated by
// 1-2 sectors), so a missing key is a real, meaningful zero — not missing data.
function readEmissions(properties, propertyKeys) {
  let total = 0;
  for (const key of propertyKeys) total += properties?.[key] ?? 0;
  return total;
}

function domainMaxFor(features, propertyKeys) {
  let max = 0;
  for (const f of features) {
    const v = readEmissions(f.properties, propertyKeys);
    if (v > max) max = v;
  }
  return max;
}

function CountryGridLayer({ filePath, colorStops, opacity, pinnedSector, onDomainReady, onLoadingChange }) {
  const map = useMap();
  const {
    controls, fitToSelection, urlView, selectedState, activeDataset,
  } = useDatasetContext();
  const viewOverrides = activeDataset.viewOverrides;
  const { convert, label: units } = useDisplayUnit();
  const ensembleMinMax = useGlobalEnsembleMinMax();
  const layerRef = useRef(null);
  const rendererRef = useRef(null);
  // Placeholder until the fetch below resolves and overwrites it. Derived
  // rather than hardcoded so it can't drift from the sector definitions.
  const styleRef = useRef({
    colorStops, opacity, domainMax: 1,
    propertyKeys: emissionsPropertyKeys('TotalAnth', 'posterior'),
  });
  styleRef.current.colorStops = colorStops;
  styleRef.current.opacity = opacity;
  const cellsRef = useRef([]);
  const featuresRef = useRef([]);
  const [hover, setHover] = useState(null);

  const styleFeature = useCallback((feature) => {
    const { colorStops: cs, opacity: op, domainMax: dm, propertyKeys } = styleRef.current;
    const v = readEmissions(feature.properties, propertyKeys);
    const t = dm > 0 ? Math.max(0, Math.min(1, v / dm)) : 0;
    return { color: 'transparent', weight: 0, fillColor: stopsToColor(t, cs), fillOpacity: op };
  }, []);

  useEffect(() => {
    if (!filePath) { onDomainReady?.(null); return undefined; }
    let cancelled = false;
    onLoadingChange?.(true);

    fetch(filePath)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status} — ${filePath}`);
        return r.json();
      })
      .then(data => {
        if (cancelled) return;

        const features = data.features ?? [];
        featuresRef.current = features;

        const propertyKeys       = emissionsPropertyKeys(controls.sector, controls.satellite);
        const domainPropertyKeys = emissionsPropertyKeys(pinnedSector ?? controls.sector, controls.satellite);
        const rawDomainMax       = domainMaxFor(features, domainPropertyKeys);
        const scaleMax           = controls.colorScaleMax ?? 1.0;
        styleRef.current.propertyKeys = propertyKeys;
        styleRef.current.domainMax    = (rawDomainMax || 1) * scaleMax;

        cellsRef.current = features
          .map(f => {
            const box = cellBBox(f.geometry);
            return box && { ...box, properties: f.properties };
          })
          .filter(Boolean);

        if (layerRef.current) {
          try { map.removeLayer(layerRef.current); } catch (_) {}
          layerRef.current = null;
        }

        try {
          if (!map.getPane('countryGridPane')) {
            map.createPane('countryGridPane');
            const p = map.getPane('countryGridPane');
            if (p) { p.style.zIndex = '648'; p.style.pointerEvents = 'none'; }
          }
        } catch (_) {}

        const renderer = L.canvas({ pane: 'countryGridPane' });
        rendererRef.current = renderer;

        const layer = L.geoJSON(data, {
          pane:     'countryGridPane',
          renderer,
          style:    styleFeature,
        });

        try {
          // Measured off the raw GeoJSON rather than layer.getBounds() so the
          // grid's own antimeridian handling matches the country polygon's,
          // and so the same per-country overrides apply — a country framed by
          // hand shouldn't be re-framed by its grid a moment later. Under
          // ?fit=1 FitToSelection has already placed the view; this repeats it
          // without animation, or the screenshot catches the map mid-flight.
          applyRegionView(map, {
            bounds:   boundsOf(data),
            override: viewOverrides?.[selectedState],
            urlView:  fitToSelection ? urlView : null,
            maxZoom:  fitToSelection ? FIT_MAX_ZOOM : null,
            animate:  !fitToSelection,
            duration: 0.5,
          });
        } catch (_) {}

        layer.addTo(map);
        layerRef.current = layer;
        onDomainReady?.(rawDomainMax > 0 ? { min: 0, max: rawDomainMax } : null);
        onLoadingChange?.(false);
      })
      .catch(err => {
        if (!cancelled) console.error('[CountryGridLayer]', err.message);
        onDomainReady?.(null);
        onLoadingChange?.(false);
      });

    return () => {
      cancelled = true;
      if (layerRef.current) {
        try { map.removeLayer(layerRef.current); } catch (_) {}
        layerRef.current = null;
      }
      // The canvas renderer is a separate Leaflet layer of its own — removing
      // the geoJSON layer above does not detach its <canvas> from the map, so
      // without this it's left behind covering the pane and swallowing clicks.
      if (rendererRef.current) {
        try { map.removeLayer(rendererRef.current); } catch (_) {}
        rendererRef.current = null;
      }
      cellsRef.current = [];
      featuresRef.current = [];
      setHover(null);
      onDomainReady?.(null);
      onLoadingChange?.(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, map]);

  useEffect(() => {
    if (layerRef.current) layerRef.current.setStyle(styleFeature);
  }, [colorStops, opacity, styleFeature]);

  // Sector/estimate are all bundled in the one file already fetched above —
  // switching them just re-derives the color domain and restyles in place,
  // no refetch.
  useEffect(() => {
    if (!layerRef.current || !featuresRef.current.length) return;
    const propertyKeys       = emissionsPropertyKeys(controls.sector, controls.satellite);
    const domainPropertyKeys = emissionsPropertyKeys(pinnedSector ?? controls.sector, controls.satellite);
    const rawDomainMax       = domainMaxFor(featuresRef.current, domainPropertyKeys);
    const scaleMax           = controls.colorScaleMax ?? 1.0;
    styleRef.current.propertyKeys = propertyKeys;
    styleRef.current.domainMax    = (rawDomainMax || 1) * scaleMax;
    layerRef.current.setStyle(styleFeature);
    onDomainReady?.(rawDomainMax > 0 ? { min: 0, max: rawDomainMax } : null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controls.sector, controls.satellite, controls.colorScaleMax, pinnedSector, styleFeature]);

  useMapEvents({
    mousemove(e) {
      const { lat, lng } = e.latlng;
      const hit = cellsRef.current.find(
        c => lat >= c.minLat && lat <= c.maxLat && lng >= c.minLon && lng <= c.maxLon,
      );
      if (!hit) { setHover(null); return; }

      const propertyKeys = emissionsPropertyKeys(controls.sector, controls.satellite);
      const value = readEmissions(hit.properties, propertyKeys);

      // The file's grid and the ensemble's grid are both the native
      // 0.25°x0.3125° model grid, but look up by this cell's own center
      // rather than the raw cursor position — getValueAtLatLngFromGrid's
      // half-cell tolerance is cheap insurance against any residual offset.
      // Ensemble uncertainty only exists for the posterior estimate.
      const sectorMinMax = controls.satellite === 'posterior' ? ensembleMinMax?.bySector[controls.sector] : null;
      let min = null, max = null;
      if (sectorMinMax) {
        const centerLat = (hit.minLat + hit.maxLat) / 2;
        const centerLon = (hit.minLon + hit.maxLon) / 2;
        min = getValueAtLatLngFromGrid(ensembleMinMax.gridMeta, sectorMinMax.minValues, centerLat, centerLon, { allowZero: true });
        max = getValueAtLatLngFromGrid(ensembleMinMax.gridMeta, sectorMinMax.maxValues, centerLat, centerLon, { allowZero: true });
      }

      setHover({ point: e.containerPoint, value, min, max });
    },
    mouseout()  { setHover(null); },
    dragstart() { setHover(null); },
  });

  if (!hover) return null;

  const value = convert(hover.value);
  const range = formatRange(convert(hover.min), convert(hover.max));

  return createPortal(
    <div
      className="grid-hover-tooltip"
      style={{ left: hover.point.x + 14, top: hover.point.y }}
    >
      {formatMassValue(value)}
      {range && <span className="grid-hover-range"> {range}</span>}
      {units && <span className="grid-hover-units"> {units}</span>}
    </div>,
    map.getContainer(),
  );
}

// ─── ChoroplethLayer ──────────────────────────────────────────────────────────

function ChoroplethLayer({
  geojson, stateDataMap, colKey, domain, colorStops, opacity, suppressTooltipFor, onStateClick,
  sectorRanges, sector, satellite,
}) {
  // Tooltip numbers follow the dashboard-wide units selector, same as the 2x2
  // totals and the grid-cell tooltip. Note that react-leaflet only runs
  // onEachFeature at layer construction, so already-bound tooltips can't be
  // rewritten in place — the caller's `key` includes the unit label for that
  // reason, remounting the layer when units change.
  const { convert, label: units } = useDisplayUnit();

  // onEachFeature only runs once, at layer construction, so a plain closure
  // over `opacity` would go stale after the slider moves — the mouseout
  // handler reads this ref instead to always reset to the current value.
  const opacityRef = useRef(opacity);
  opacityRef.current = opacity;

  // Same staleness issue for the country whose grid overlay is currently
  // rendered on top (ch4-global) — its own tooltip would otherwise clutter
  // the same spot as the grid's per-cell hover tooltip.
  const suppressRef = useRef(suppressTooltipFor);
  suppressRef.current = suppressTooltipFor;

  const styleFn = useCallback(
    (feature) => {
      const name = getFeatureName(feature);
      const row  = stateDataMap?.[name];
      const val  = row ? parseNumber(row[colKey]) : null;

      if (val == null || !Number.isFinite(val)) {
        return { fillColor: '#e2e8f0', fillOpacity: 0.5, color: '#cbd5e1', weight: 0.6 };
      }
      const t = (val - domain.min) / ((domain.max - domain.min) || 1);
      return { fillColor: stopsToColor(t, colorStops), fillOpacity: opacity, color: '#ffffff', weight: 0.6 };
    },
    [stateDataMap, colKey, domain, colorStops, opacity],
  );

  const onEachFeature = useCallback(
    (feature, layer) => {
      const name = getFeatureName(feature);
      const row  = stateDataMap?.[name];
      const val  = convert(row ? parseNumber(row[colKey]) : null);

      // Uncertainty, where the dataset supplies it, comes from the same
      // country/sector ranges the Sector Breakdown chart plots — and is
      // posterior-only. Those are +/- delta magnitudes rather than absolute
      // bounds, so boundsFromDeltas turns them into the (min, max) pair every
      // other tooltip displays.
      const entry = hasUncertainty(satellite)
        ? sectorRanges?.byCountry?.[name]?.[sector]
        : null;
      const bounds = boundsFromDeltas(entry?.post, entry?.minDelta, entry?.maxDelta);
      const range  = bounds ? formatRange(convert(bounds[0]), convert(bounds[1])) : null;

      layer.bindTooltip(
        `<strong>${name}</strong><br />${formatMassValue(val)}`
        + (range ? ` <span class="choropleth-tooltip-range">${range}</span>` : '')
        + (units ? ` <span class="choropleth-tooltip-units">${units}</span>` : ''),
        { sticky: true },
      );
      layer.on('tooltipopen', () => {
        if (name === suppressRef.current) layer.closeTooltip();
      });
      layer.on({
        click(e)     { e.originalEvent?.stopPropagation?.(); onStateClick(name); },
        mouseover(e) { e.target.setStyle({ weight: 2.5, color: '#0f172a', fillOpacity: opacityRef.current }); e.target.bringToFront(); },
        mouseout(e)  { e.target.setStyle({ weight: 0.6, color: '#ffffff', fillOpacity: opacityRef.current }); },
      });
    },
    [onStateClick, stateDataMap, colKey, convert, units, sectorRanges, sector, satellite],
  );

  if (!geojson) return null;
  return <GeoJSON data={geojson} style={styleFn} onEachFeature={onEachFeature} />;
}

// ─── StateBorderLayer ─────────────────────────────────────────────────────────

function StateBorderLayer({ geojson, selectedState, onStateClick }) {
  const styleFn = useCallback(
    (feature) => {
      const name = getFeatureName(feature);
      return {
        fillColor:   'transparent',
        fillOpacity: 0,
        color:       name === selectedState ? '#0f172a' : 'rgba(15,23,42,0.25)',
        weight:      name === selectedState ? 2 : 0.5,
      };
    },
    [selectedState],
  );

  const onEachFeature = useCallback(
    (feature, layer) => {
      const name = getFeatureName(feature);
      layer.on({
        click(e) { e.originalEvent?.stopPropagation?.(); onStateClick(name); },
      });
    },
    [onStateClick],
  );

  if (!geojson) return null;
  return (
    <GeoJSON
      data={geojson}
      style={styleFn}
      onEachFeature={onEachFeature}
    />
  );
}

// ─── MapView (exported) ───────────────────────────────────────────────────────

export function MapView() {
  const {
    activeDataset,
    controls,
    selectedState,
    setSelectedState,
    jsonGridDomain,
    setJsonGridDomain,
    pinnedGridMax,
    setPinnedGridMax,
    uploadedData,
    fitToSelection,
    urlView,
    hydrateCountry,
  } = useDatasetContext();

  const { data: baseData, loading, error } = useEmissionData();

  // Only needed for ChoroplethLayer's remount key — that layer's tooltips are
  // bound once at construction and can't be rewritten when units change.
  const { label: displayUnitLabel } = useDisplayUnit();

  const { mapConfig, display, dataRoot } = activeDataset;
  const colorStops = display.colorScale?.stops ?? [];
  // ch4-permian-weekly has no choropleth alternative (no per-state CSV data)
  // and thus no viewMode control — its "grid" is always on, like ch4-global's
  // country-mask overlay.
  const isGridMode = controls.viewMode === 'grid' || activeDataset.gridType === 'period';

  const [activeGeoRaster, setActiveGeoRaster] = useState(null);
  const [activeJsonGridValues, setActiveJsonGridValues] = useState(null);
  const [countryGridLoading, setCountryGridLoading] = useState(false);

  // ── Active uploaded sector (upload dataset only) ──────────────────────────
  const activeUploadSector = activeDataset.gridType === 'upload'
    ? uploadedData?.sectors?.[controls.sector] ?? null
    : null;

  // Clear the JSON grid domain when any grid-affecting control changes, so
  // the legend blanks out rather than showing a stale domain while the newly
  // selected sector's file loads. ch4-global's CountryGridLayer is excluded —
  // it recomputes its domain synchronously from data already in memory (no
  // refetch on sector change) and reports it via its own effect; since that
  // effect lives on a descendant component, it can run before this one in
  // the same commit, and this clear would then stomp the value it just set.
  useEffect(() => {
    if (activeDataset.gridType === 'country-mask') return;
    setJsonGridDomain(null);
  }, [activeDataset.id, activeDataset.gridType, controls.sector, controls.year, setJsonGridDomain]);

  // ── ?country= hydration ───────────────────────────────────────────────────
  // selectedState holds the GeoJSON's own feature name, so the URL's spelling
  // can only be normalised once those features are in hand. hydrateCountry
  // applies at most once per page load; a load failure still releases the
  // readiness gate rather than leaving it stuck.
  useEffect(() => {
    const features = baseData?.statesGeoJSON?.features;
    if (!features) {
      if (error) hydrateCountry([], null);
      return;
    }
    hydrateCountry(features.map(getFeatureName), activeDataset.nameAliases);
  }, [baseData, error, activeDataset.nameAliases, hydrateCountry]);

  const isPeriodGrid = activeDataset.gridType === 'period';

  // ── TIF URL (CONUS / permian-weekly grid mode) ────────────────────────────
  const tifUrl = useMemo(() => {
    if (!baseData?.manifest || !isGridMode) return null;
    const entry = isPeriodGrid
      ? getPeriodManifestEntry(baseData.manifest, controls.satellite, controls.sector, controls.period)
      : getManifestEntry(baseData.manifest, controls.sector, controls.year, controls.satellite);
    return entry?.tif ? resolveTifUrl(dataRoot ?? '', entry.tif) : null;
  }, [
    baseData?.manifest, controls.viewMode, controls.sector, isPeriodGrid,
    controls.year, controls.satellite, controls.period, dataRoot,
  ]);

  // ── Ensemble min/max URLs (posterior hover uncertainty, CONUS grid mode) ──
  // Only populated for posterior years in manifest.json -- absent for
  // "_prior" (GHGI has no ensemble) and for period-keyed manifests (permian
  // weekly has no ensemble rasters), so these resolve to null there.
  const minTifUrl = useMemo(() => {
    if (!baseData?.manifest || !isGridMode || isPeriodGrid) return null;
    const entry = getManifestEntry(
      baseData.manifest, controls.sector, controls.year, controls.satellite,
    );
    return entry?.minTif ? resolveTifUrl(dataRoot ?? '', entry.minTif) : null;
  }, [baseData?.manifest, controls.sector, controls.year, controls.satellite, isPeriodGrid, dataRoot]);

  const maxTifUrl = useMemo(() => {
    if (!baseData?.manifest || !isGridMode || isPeriodGrid) return null;
    const entry = getManifestEntry(
      baseData.manifest, controls.sector, controls.year, controls.satellite,
    );
    return entry?.maxTif ? resolveTifUrl(dataRoot ?? '', entry.maxTif) : null;
  }, [baseData?.manifest, controls.sector, controls.year, controls.satellite, isPeriodGrid, dataRoot]);

  const minGeoraster = useGeoraster(minTifUrl);
  const maxGeoraster = useGeoraster(maxTifUrl);

  // ── JSON grid file path (Colombia grid mode) ──────────────────────────────
  const jsonGridFilePath = useMemo(() => {
    if (!isGridMode || activeDataset.gridType !== 'json') return null;
    return baseData?.gridFiles?.[controls.year]?.[controls.sector] ?? null;
  }, [isGridMode, activeDataset.gridType, baseData, controls.year, controls.sector]);

  // ── JSON grid uncertainty file path (posterior hover uncertainty, Colombia) ─
  const jsonUncertaintyFilePath = useMemo(() => {
    if (!isGridMode || activeDataset.gridType !== 'json') return null;
    return baseData?.gridUncertaintyFiles?.[controls.year]?.[controls.sector] ?? null;
  }, [isGridMode, activeDataset.gridType, baseData, controls.year, controls.sector]);

  const jsonMinMax = useJsonMinMax(jsonUncertaintyFilePath);

  // ── Pinned-sector grid file path (Colombia grid mode) ─────────────────────
  // Fetched independently of controls.sector so the color scale can stay
  // pinned to the Total sector's own max instead of rescaling per sector.
  const pinnedGridFilePath = useMemo(() => {
    if (!isGridMode || activeDataset.gridType !== 'json') return null;
    const pinnedGridSector = display.colorScale?.pinnedGridSector;
    if (!pinnedGridSector) return null;
    return baseData?.gridFiles?.[controls.year]?.[pinnedGridSector] ?? null;
  }, [isGridMode, activeDataset.gridType, baseData, controls.year, display.colorScale]);

  const fetchedPinnedGridMax = useJsonGridMax(pinnedGridFilePath);
  useEffect(() => {
    setPinnedGridMax(fetchedPinnedGridMax);
  }, [fetchedPinnedGridMax, setPinnedGridMax]);

  // ── Per-country masked grid file path (ch4-global) ────────────────────────
  const countryGridFilePath = useMemo(() => {
    if (activeDataset.gridType !== 'country-mask' || !selectedState) return null;
    return `${import.meta.env.BASE_URL}data/ch4_global/country_sectors/${encodeURIComponent(selectedState.replace(/ /g, '_'))}_masked.json`;
  }, [activeDataset.gridType, selectedState]);

  // ── Raster/grid domain ────────────────────────────────────────────────────
  // Grid views pin their domain to the dataset's Total sector (see
  // display.colorScale.pinnedGridSector) rather than rescaling on every
  // sector change — the maxEmission/colorScaleMax slider still adjusts from
  // there. ch4-permian-weekly (period grids) is intentionally excluded — no
  // pinning requested for it, it keeps its existing per-variable domain.
  const rasterDomain = useMemo(() => {
    if (!isGridMode) return { min: 0, max: 1 };
    const scaleMax = controls.maxEmission ?? controls.colorScaleMax ?? 1.0;
    const pinnedGridSector = display.colorScale?.pinnedGridSector;
    if (baseData?.manifest) {
      if (isPeriodGrid) {
        const g = getPeriodGlobalDomain(baseData.manifest, controls.satellite, controls.sector);
        return { min: 0, max: g.max * scaleMax };
      }
      const g = getGlobalDomain(baseData.manifest, pinnedGridSector ?? controls.sector);
      return { min: 0, max: g.max * scaleMax };
    }
    // Colombia: pinnedGridMax is fetched independently of controls.sector, so
    // once it's loaded it stays valid across sector switches — check it
    // before jsonGridDomain (which is cleared on every sector change) so the
    // domain doesn't blank out while the newly-selected sector's own file loads.
    if (pinnedGridSector && pinnedGridMax != null) {
      return { min: 0, max: pinnedGridMax * scaleMax };
    }
    if (jsonGridDomain != null) {
      return { min: 0, max: jsonGridDomain.max * scaleMax };
    }
    return { min: 0, max: 1 };
  }, [
    controls.viewMode, baseData?.manifest, controls.sector, isPeriodGrid, controls.satellite,
    controls.maxEmission, controls.colorScaleMax, jsonGridDomain, display.colorScale, pinnedGridMax,
  ]);

  // ── Choropleth domain ─────────────────────────────────────────────────────
  const choroplethDomain = useMemo(() => {
    if (isGridMode || !baseData) return { min: 0, max: 10 };
    const domainSector = display.colorScale?.pinnedSector ?? controls.sector;
    const base = computeChoroplethDomain(
      baseData, controls.year, controls.satellite, domainSector,
    );
    const scaleMax = controls.colorScaleMax ?? 1.0;
    return { min: base.min, max: base.max * scaleMax };
  }, [
    baseData, controls.viewMode, controls.year, controls.satellite, controls.sector,
    controls.colorScaleMax, display.colorScale,
  ]);

  // ── Column key for choropleth lookup ──────────────────────────────────────
  const colKey = useMemo(
    () => centralCol(controls.sector, 'state', controls.satellite),
    [controls.sector, controls.satellite],
  );

  // ── State/province data for the selected year ─────────────────────────────
  const stateDataMap = useMemo(
    () => baseData?.byYear?.[controls.year] ?? {},
    [baseData, controls.year],
  );

  const handleStateClick = useCallback(
    (name) => {
      // ch4-global: clicking a country always (re-)activates its grid — no
      // toggle-off — and stays in whatever Map View mode is active, since the
      // grid overlays on top of the choropleth rather than replacing it.
      if (activeDataset.gridType === 'country-mask') {
        setSelectedState(name);
        return;
      }
      setSelectedState(selectedState === name ? null : name);
    },
    [activeDataset.gridType, selectedState, setSelectedState],
  );

  const { initialViewState, minZoom = 2, maxZoom = 12 } = mapConfig;

  return (
    <div className="map-wrapper">

      {loading && (
        <div className="map-overlay loading">Loading data…</div>
      )}
      {!loading && error && (
        <div className="map-overlay error">Error: {error}</div>
      )}
      {!loading && !error && !selectedState && baseData?.statesGeoJSON && (
        <div className="map-overlay hint">Click a region to view regional data</div>
      )}
      {!loading && countryGridLoading && (
        <div className="map-overlay loading">Loading country grid…</div>
      )}

      {/*
        maxBounds / maxBoundsViscosity are intentionally omitted here —
        MapContainer only reads them once. MapController keeps them current.
      */}
      <MapContainer
        className="map-container"
        center={[initialViewState.latitude, initialViewState.longitude]}
        zoom={initialViewState.zoom}
        minZoom={minZoom}
        maxZoom={maxZoom}
      >
        {/* Keeps view, bounds and zoom limits in sync after dataset switches */}
        <MapController mapConfig={mapConfig} />

        {/* ?fit=1 — frames the selected country, after MapController's setView */}
        {fitToSelection && baseData?.statesGeoJSON && (
          <FitToSelection
            geojson={baseData.statesGeoJSON}
            selectedState={selectedState}
            override={activeDataset.viewOverrides?.[selectedState]}
            urlView={urlView}
          />
        )}

        {/* Creates its own labelPane and keeps place names above the data */}
        <VectorBasemap />

        {/* Grid hover tooltip — TIF mode only */}
        {isGridMode && (!activeDataset.gridType || isPeriodGrid) && (
          <GridHoverLayer
            georaster={activeGeoRaster}
            minGeoraster={minGeoraster}
            maxGeoraster={maxGeoraster}
            units={display.legendUnits ?? display.units}
          />
        )}

        {/* Choropleth — keyed by dataset so GeoJSON remounts on dataset switch */}
        {!isGridMode && baseData?.statesGeoJSON && (
          <ChoroplethLayer
            key={`ch-${activeDataset.id}-${controls.year}-${controls.satellite}-${colKey}-${displayUnitLabel}`}
            geojson={baseData.statesGeoJSON}
            stateDataMap={stateDataMap}
            colKey={colKey}
            domain={choroplethDomain}
            colorStops={colorStops}
            opacity={
              activeDataset.gridType === 'country-mask'
                ? Math.max(0.1, (controls.opacity ?? 0.7) - 0.2)
                : (controls.choroplethOpacity ?? 0.65)
            }
            suppressTooltipFor={activeDataset.gridType === 'country-mask' ? selectedState : null}
            onStateClick={handleStateClick}
            sectorRanges={baseData.sectorRanges}
            sector={controls.sector}
            satellite={controls.satellite}
          />
        )}

        {/* Per-country masked grid (ch4-global) — overlays the choropleth on click */}
        {activeDataset.gridType === 'country-mask' && countryGridFilePath && (
          <CountryGridLayer
            key={countryGridFilePath}
            filePath={countryGridFilePath}
            colorStops={colorStops}
            opacity={controls.opacity ?? 0.7}
            pinnedSector={display.colorScale?.pinnedGridSector}
            onDomainReady={(d) => setJsonGridDomain(d)}
            onLoadingChange={setCountryGridLoading}
          />
        )}

        {/* TIF raster (CONUS / permian-weekly) */}
        {isGridMode && (!activeDataset.gridType || isPeriodGrid) && tifUrl && (
          <RasterLayer
            key={tifUrl}
            tifUrl={tifUrl}
            domainMin={rasterDomain.min}
            domainMax={rasterDomain.max}
            colorStops={colorStops}
            opacity={controls.opacity ?? 0.7}
            onGeoRasterReady={setActiveGeoRaster}
          />
        )}

        {/* JSON polygon grid (Colombia) */}
        {isGridMode && activeDataset.gridType === 'json' && jsonGridFilePath && (
          <JsonGridLayer
            key={jsonGridFilePath}
            gridMeta={baseData.gridMeta}
            filePath={jsonGridFilePath}
            domainMax={rasterDomain.max}
            colorStops={colorStops}
            opacity={controls.opacity ?? 0.65}
            onRawMaxReady={(max) =>
              setJsonGridDomain(max != null ? { min: 0, max } : null)
            }
            onValuesReady={setActiveJsonGridValues}
          />
        )}

        {/* JSON grid hover tooltip (Colombia) */}
        {isGridMode && activeDataset.gridType === 'json' && (
          <JsonGridHoverLayer
            gridMeta={baseData?.gridMeta}
            values={activeJsonGridValues}
            minValues={jsonMinMax?.min}
            maxValues={jsonMinMax?.max}
            units={display.legendUnits ?? display.units}
          />
        )}

        {/* Uploaded raster (TIF) */}
        {isGridMode && activeDataset.gridType === 'upload' && uploadedData?.kind === 'tif' && activeUploadSector && (
          <RasterLayer
            key={activeUploadSector.url}
            tifUrl={activeUploadSector.url}
            domainMin={rasterDomain.min}
            domainMax={rasterDomain.max}
            colorStops={colorStops}
            opacity={controls.opacity ?? 0.7}
            onGeoRasterReady={setActiveGeoRaster}
            onRawMaxReady={(max) =>
              setJsonGridDomain(max != null ? { min: 0, max } : null)
            }
          />
        )}

        {/* Uploaded raster hover tooltip */}
        {isGridMode && activeDataset.gridType === 'upload' && uploadedData?.kind === 'tif' && (
          <GridHoverLayer
            georaster={activeGeoRaster}
            units={uploadedData.meta?.units || (display.legendUnits ?? display.units)}
          />
        )}

        {/* Uploaded JSON polygon grid */}
        {isGridMode && activeDataset.gridType === 'upload' && uploadedData?.kind === 'json' && activeUploadSector && (
          <JsonGridLayer
            key={activeUploadSector.url}
            gridMeta={activeUploadSector.gridMeta}
            filePath={activeUploadSector.url}
            domainMax={rasterDomain.max}
            colorStops={colorStops}
            opacity={controls.opacity ?? 0.7}
            onRawMaxReady={(max) =>
              setJsonGridDomain(max != null ? { min: 0, max } : null)
            }
            onValuesReady={setActiveJsonGridValues}
          />
        )}

        {/* Uploaded JSON grid hover tooltip */}
        {isGridMode && activeDataset.gridType === 'upload' && uploadedData?.kind === 'json' && (
          <JsonGridHoverLayer
            gridMeta={activeUploadSector?.gridMeta}
            values={activeJsonGridValues}
            units={uploadedData.meta?.units || (display.legendUnits ?? display.units)}
          />
        )}

        {/* Region borders (grid mode) — keyed by dataset + selection */}
        {isGridMode && baseData?.statesGeoJSON && (
          <StateBorderLayer
            key={`borders-${activeDataset.id}-${selectedState}`}
            geojson={baseData.statesGeoJSON}
            selectedState={selectedState}
            onStateClick={handleStateClick}
          />
        )}

        {/* Last child, so its effect runs after every other layer's — tells the
            factsheet screenshot script when the view has settled */}
        <ReadinessFlag loading={loading} error={error} gridLoading={countryGridLoading} />
      </MapContainer>
    </div>
  );
}