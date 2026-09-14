import { useState, useEffect } from 'react';
import { useDatasetContext }   from '../context/DatasetContext';

// ─── Shared load cache ────────────────────────────────────────────────────────
// Six components call useEmissionData() — MapView, Legend, ControlPanel,
// DataTotals, SectorBarChart and TimeSeriesPlot — and each used to run the
// dataset's dataLoader itself. That meant one ch4-global page load fetched and
// parsed world-countries.json (25 MB) six times in parallel, before any copy
// had landed in the browser cache for the others to reuse.
//
// Keyed on exactly what the load depends on: the dataset, plus the control
// values its reloadTrigger names (see triggerKey below). Every dataset's
// dataLoader is either zero-argument or, for the CO2 stubs, reads `controls`
// while declaring no reloadTrigger — in which case triggerKey covers every
// control anyway. So a shared entry can never be staler than the per-component
// load it replaces.
//
// Promises rather than resolved values, so components mounting in the same
// commit share the one in-flight request instead of racing to start six.

// Small enough to bound memory (a resolved entry holds a parsed country
// GeoJSON), large enough that switching datasets and back is instant.
const CACHE_LIMIT = 3;

const cache = new Map(); // `${datasetId}::${triggerKey}` -> Promise<data>

function loadEmissionData(dataset, controls, key) {
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);   // re-insert to mark most recently used
    cache.set(key, hit);
    return hit;
  }

  const pending = dataset.dataLoader(controls).catch((err) => {
    // Never cache a failure: a transient fetch error shouldn't wedge the
    // dataset for the rest of the session. Same convention as MapView's
    // ensembleMinMaxPromise.
    cache.delete(key);
    throw err;
  });

  cache.set(key, pending);
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return pending;
}

export function useEmissionData() {
  const { activeDataset, controls } = useDatasetContext();
  const [state, setState] = useState({ data: null, loading: true, error: null });

  // Collapse the variable-length trigger values into a single stable string
  // so the useEffect dependency array never changes size between renders.
  //
  // reloadTrigger: []           → only reload on dataset switch
  // reloadTrigger: ['satellite'] → also reload when satellite changes
  // undefined / 'all'           → reload on any control change
  const trigger = activeDataset.reloadTrigger;
  const triggerKey = JSON.stringify(
    trigger === undefined || trigger === 'all'
      ? Object.values(controls)
      : trigger.map(k => controls[k])
  );

  useEffect(() => {
    let cancelled = false;
    setState({ data: null, loading: true, error: null });

    loadEmissionData(activeDataset, controls, `${activeDataset.id}::${triggerKey}`)
      .then(data => { if (!cancelled) setState({ data, loading: false, error: null }); })
      .catch(err  => { if (!cancelled) setState({ data: null, loading: false, error: err.message }); });

    return () => { cancelled = true; };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDataset.id, triggerKey]);

  return state;
}
