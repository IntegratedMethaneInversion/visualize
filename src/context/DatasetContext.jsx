import React, {
  createContext, useContext, useReducer,
  useState, useCallback, useMemo, useEffect, useRef
} from 'react';
import { getDataset, hasDataset, getAllDatasets, getDatasetsByFamily } from '../config/datasetRegistry';
import { getFamily, getAllFamilies }                        from '../config/familyRegistry';
import { readUrlParams, controlsFromUrl, resolveFeatureName, reflectUrl } from '../utils/urlParams';
import '../config/families/index';
import '../config/datasets/index';

function defaultControls(dataset) {
  return Object.fromEntries(dataset.controls.map(c => [c.key, c.default]));
}

// Any control whose valid options depend on another control's value (e.g. a
// "week" slider scoped to the selected "year") gets reclamped to its nearest
// valid value if some other change just made its current value stale.
// `fixed` names the controls that were just set deliberately, which must be
// left exactly as asked.
function reclampControls(dataset, controls, fixed) {
  const next = { ...controls };
  for (const c of dataset.controls) {
    if (fixed.has(c.key) || typeof c.options !== 'function') continue;
    const validValues = c.options(next).map(o => (o && typeof o === 'object' ? o.value : o));
    if (validValues.length && !validValues.includes(next[c.key])) {
      const current = next[c.key];
      // Numeric controls (e.g. a "week" slider scoped to a "year" select)
      // snap to the nearest still-valid value; others keep the original
      // "most recent" fallback (e.g. satellite change narrowing years).
      next[c.key] = typeof current === 'number'
        ? validValues.reduce((a, b) => Math.abs(b - current) < Math.abs(a - current) ? b : a)
        : validValues[validValues.length - 1];
    }
  }
  return next;
}

function reducer(state, action) {
  switch (action.type) {

    case 'SET_FAMILY': {
      const datasetsInFamily = getDatasetsByFamily(action.id);
      if (!datasetsInFamily.length) return state;
      const restoredId = state.lastDatasetByFamily[action.id] ?? datasetsInFamily[0].id;
      const dataset    = getDataset(restoredId);
      return {
        ...state,
        activeFamily:    action.id,
        activeDatasetId: restoredId,
        controls:        defaultControls(dataset),
      };
    }

    case 'SET_DATASET': {
      const dataset = getDataset(action.id);
      return {
        ...state,
        activeDatasetId: action.id,
        controls:        defaultControls(dataset),
        lastDatasetByFamily: {
          ...state.lastDatasetByFamily,
          [state.activeFamily]: action.id,
        },
      };
    }

    case 'SET_CONTROL': {
      const dataset = getDataset(state.activeDatasetId);
      return {
        ...state,
        controls: reclampControls(
          dataset,
          { ...state.controls, [action.key]: action.value },
          new Set([action.key]),
        ),
      };
    }

    default:
      return state;
  }
}

// ─── Initial state ────────────────────────────────────────────────────────────
// The query string (?dataset=…&sector=…&year=…) is applied here rather than in
// a mount effect on purpose: SET_DATASET resets every control and clears the
// selection, so a re-dispatch would have to be sequenced across commits and
// would flash the default view first — which is exactly what an automated
// screenshot would capture if it fired early.

function initState({ initialFamilyId, initialDatasetId }) {
  const allFamilies = getAllFamilies();
  const url         = readUrlParams();

  let resolvedDatasetId, resolvedFamilyId;
  if (initialDatasetId) {
    const ds          = getDataset(initialDatasetId);
    resolvedDatasetId = ds.id;
    resolvedFamilyId  = ds.family;
  } else {
    resolvedFamilyId  = initialFamilyId ?? allFamilies[0].id;
    resolvedDatasetId = getDatasetsByFamily(resolvedFamilyId)[0]?.id;
  }

  // What the app would have loaded with no query string — kept so the URL
  // reflection below can leave the default view on a bare path.
  const defaultDatasetId = resolvedDatasetId;

  // An unknown ?dataset= id is ignored rather than fatal: a bad param should
  // degrade to the default view, never to a blank page.
  if (url.datasetId && hasDataset(url.datasetId)) {
    const ds          = getDataset(url.datasetId);
    resolvedDatasetId = ds.id;
    resolvedFamilyId  = ds.family;
  }

  const dataset             = getDataset(resolvedDatasetId);
  const { controls, touched } = controlsFromUrl(dataset, url.params, defaultControls(dataset));

  return {
    activeFamily:        resolvedFamilyId,
    activeDatasetId:     resolvedDatasetId,
    // A URL-set control can invalidate a default one it scopes (e.g. satellite
    // narrowing the year list), same as changing it through the UI would.
    controls:            reclampControls(dataset, controls, touched),
    lastDatasetByFamily: { [resolvedFamilyId]: resolvedDatasetId },
    defaultDatasetId,
  };
}

const DatasetContext = createContext(null);

export function DatasetProvider({ initialFamilyId, initialDatasetId, children }) {
  const allFamilies = getAllFamilies();

  const [state, dispatch] = useReducer(
    reducer, { initialFamilyId, initialDatasetId }, initState,
  );

  // ── URL-supplied initial state ───────────────────────────────────────────
  // Dataset and controls were already applied by initState; the country param
  // can't be, because the canonical spelling it has to normalise to lives in
  // the dataset's GeoJSON, which hasn't loaded yet. MapView calls
  // hydrateCountry once it has.
  const url = readUrlParams();
  const [selectedState, setSelectedStateRaw] = useState(null);
  const [urlHydrated, setUrlHydrated]        = useState(!url.country);
  // The feature name ?country= resolved to, so ?zoom=/?center= can stay scoped
  // to it rather than following the user onto the next country they click.
  const [urlCountry, setUrlCountry]          = useState(null);
  const countryHydratedRef                   = useRef(false);

  const hydrateCountry = useCallback((featureNames, aliases) => {
    if (countryHydratedRef.current) return;
    countryHydratedRef.current = true;
    // An unrecognised country leaves the world view in place rather than
    // erroring — same rule as an unknown dataset id.
    const name = resolveFeatureName(url.country, featureNames, aliases);
    if (name) { setSelectedStateRaw(name); setUrlCountry(name); }
    setUrlHydrated(true);
  }, [url.country]);

  // The ad-hoc framing override, live only while its own country is selected.
  const urlView = (urlCountry && selectedState === urlCountry) ? url.view : null;

  // ── JSON grid domain (reported by JsonGridLayer, consumed by Legend) ──────
  const [jsonGridDomain, setJsonGridDomain] = useState(null);

  // ── Pinned-sector grid max (Colombia only — the Total sector's own grid max,
  // fetched independently of whichever sector is currently displayed, so the
  // color scale can stay pinned instead of rescaling on every sector change).
  // Shared between MapView (actual rendering) and Legend (tick display) so
  // they read the exact same fetch rather than duplicating it.
  const [pinnedGridMax, setPinnedGridMax] = useState(null);

  // ── Uploaded files (session-only, reported by UploadPanel) ────────────────
  // Shape: { kind: 'tif'|'json', sectors: { [name]: {url, gridMeta, size} }, meta: {name, units} }
  const [uploadedData, setUploadedData] = useState(null);

  // ── Display mass unit (Tg/Gg/tons) — a dashboard-wide preference, not a
  // per-dataset control, so it persists as the user switches datasets.
  // Datasets whose display.units isn't a recognized mass unit (e.g. CO2's
  // ppm) ignore it; see useDisplayUnit.
  const [massUnit, setMassUnit] = useState('Tg');

  const setSelectedState = useCallback((stateName) => {
    setSelectedStateRaw(stateName);
  }, []);

  const clearUploadedData = useCallback(() => {
    setUploadedData(prev => {
      for (const s of Object.values(prev?.sectors ?? {})) {
        if (s?.url) URL.revokeObjectURL(s.url);
      }
      return null;
    });
  }, []);

  const setActiveFamily = useCallback((id) => {
    dispatch({ type: 'SET_FAMILY', id });
    setSelectedStateRaw(null);
    setJsonGridDomain(null);
    setPinnedGridMax(null);
    clearUploadedData();
  }, [clearUploadedData]);

  const setActiveDataset = useCallback((id) => {
    dispatch({ type: 'SET_DATASET', id });
    setSelectedStateRaw(null);
    setJsonGridDomain(null);
    setPinnedGridMax(null);
    clearUploadedData();
  }, [clearUploadedData]);

  const setControl = useCallback((key, value) => {
    dispatch({ type: 'SET_CONTROL', key, value });
    if (key === 'mode') setSelectedStateRaw(null);
  }, []);

  // ── Reflect the current view back into the URL ───────────────────────────
  // So a link can be copied out of the address bar, and so the right param
  // values can be discovered by clicking around. Held until hydration is done,
  // or this would overwrite the very params it's still waiting to apply.
  useEffect(() => {
    if (!urlHydrated) return;
    reflectUrl({
      dataset:          getDataset(state.activeDatasetId),
      defaultDatasetId: state.defaultDatasetId,
      controls:         state.controls,
      country:          selectedState,
      fit:              url.fit,
      view:             urlView,
    });
  }, [
    urlHydrated, state.activeDatasetId, state.controls, state.defaultDatasetId,
    selectedState, url.fit, urlView,
  ]);

  const value = useMemo(() => ({
    activeFamily:           getFamily(state.activeFamily),
    allFamilies,
    datasetsInActiveFamily: getDatasetsByFamily(state.activeFamily),
    setActiveFamily,
    activeDataset:  getDataset(state.activeDatasetId),
    allDatasets:    getAllDatasets(),
    setActiveDataset,
    controls:       state.controls,
    setControl,
    selectedState,
    setSelectedState,
    jsonGridDomain,
    setJsonGridDomain,
    pinnedGridMax,
    setPinnedGridMax,
    uploadedData,
    setUploadedData,
    clearUploadedData,
    massUnit,
    setMassUnit,
    // ?fit=1 — MapView zooms to the selected country's bounds instead of
    // leaving the viewport on the whole-world default.
    fitToSelection: url.fit,
    // ?zoom=/?center= — a one-page-load framing override for the URL's own
    // country, ahead of the dataset's viewOverrides table.
    urlView,
    urlHydrated,
    hydrateCountry,
  }), [
    state, allFamilies, selectedState, jsonGridDomain, pinnedGridMax, uploadedData, massUnit,
    setActiveFamily, setActiveDataset, setControl, setSelectedState,
    setUploadedData, clearUploadedData, url.fit, urlView, urlHydrated, hydrateCountry,
  ]);

  return (
    <DatasetContext.Provider value={value}>
      {children}
    </DatasetContext.Provider>
  );
}

export function useDatasetContext() {
  const ctx = useContext(DatasetContext);
  if (!ctx) throw new Error('useDatasetContext must be used inside <DatasetProvider>');
  return ctx;
}