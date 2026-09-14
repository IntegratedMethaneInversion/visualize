import React, { useMemo }         from 'react';
import { useDatasetContext }       from '../context/DatasetContext';
import { useEmissionData }         from '../hooks/useEmissionData';
import { getGlobalDomain, getPeriodGlobalDomain } from '../utils/manifestUtils';
import { computeChoroplethDomain } from '../utils/emissionsUtils';
import { useDisplayUnit }          from '../hooks/useDisplayUnit';
import { formatAxisValue }         from '../utils/units';

function buildGradient(stops) {
  if (!stops?.length) return 'none';
  const [min, max] = [stops[0][0], stops[stops.length - 1][0]];
  const span = max - min || 1;
  const stopStrings = stops.map(([v, color]) => `${color} ${((v - min) / span) * 100}%`);
  return `linear-gradient(to right, ${stopStrings.join(', ')})`;
}

export function Legend() {
  const { activeDataset, controls, selectedState, jsonGridDomain, pinnedGridMax, uploadedData } = useDatasetContext();
  const { data: baseData }                          = useEmissionData();
  const { display }                                 = activeDataset;
  const isUpload = activeDataset.id === 'user-upload';
  const gradient = useMemo(() => buildGradient(display.colorScale?.stops), [display.colorScale]);

  // ch4-global has no viewMode control — its "grid" is the masked per-country
  // overlay, active only once a country is selected.
  const isCountryGrid = activeDataset.gridType === 'country-mask' && !!selectedState;
  // ch4-permian-weekly likewise has no viewMode control — it's grid-only.
  const isGrid        = controls.viewMode === 'grid' || isCountryGrid || activeDataset.gridType === 'period';
  const isChoropleth   = !isGrid;

  const rasterDomain = useMemo(() => {
  if (!isGrid) return null;

  const scaleMax = controls.maxEmission ?? controls.colorScaleMax ?? 1.0;
  const pinnedGridSector = display.colorScale?.pinnedGridSector;

  // CONUS — manifest carries a pre-computed global max per sector/year,
  // pinned to the Total sector rather than whichever is currently selected.
  // permian-weekly (period grids) is excluded — it keeps its own per-variable domain.
  if (baseData?.manifest) {
    if (activeDataset.gridType === 'period') {
      const global = getPeriodGlobalDomain(baseData.manifest, controls.satellite, controls.sector);
      return { min: global.min, max: global.max * scaleMax };
    }
    const global = getGlobalDomain(baseData.manifest, pinnedGridSector ?? controls.sector);
    return { min: global.min, max: global.max * scaleMax };
  }

  // Colombia: pinnedGridMax is fetched independently of controls.sector, so
  // once it's loaded it stays valid across sector switches — check it before
  // jsonGridDomain (which is cleared on every sector change) so the legend
  // doesn't blank to '—' while the newly-selected sector's own file loads.
  if (pinnedGridSector && pinnedGridMax != null) {
    return { min: 0, max: pinnedGridMax * scaleMax };
  }

  // Colombia (before its pinned max has loaded) / ch4-global (country-mask) /
  // uploads — max is reported dynamically by the grid layer after it
  // finishes loading; shows '—' in the legend until that first load.
  if (jsonGridDomain != null) {
    return { min: 0, max: jsonGridDomain.max * scaleMax };
  }

  return null;
}, [
  isGrid, baseData, activeDataset.gridType, controls.sector, controls.satellite,
  controls.maxEmission, controls.colorScaleMax, jsonGridDomain, display.colorScale, pinnedGridMax,
]);

  const choroplethDomain = useMemo(() => {
    if (!isChoropleth || !baseData) return null;
    const domainSector = display.colorScale?.pinnedSector ?? controls.sector;
    const base = computeChoroplethDomain(
      baseData, controls.year, controls.satellite, domainSector,
    );
    const scaleMax = controls.colorScaleMax ?? 1.0;
    return { min: base.min, max: base.max * scaleMax };
  }, [
    isChoropleth, baseData, controls.year, controls.satellite, controls.sector,
    controls.colorScaleMax, display.colorScale,
  ]);

  const domain = isGrid ? rasterDomain : choroplethDomain;
  // The unit the domain's numbers are actually in, before the selector is
  // applied: legendUnits for grids (the raster's own units), display.units
  // for the choropleth (whose values are the same totals DataTotals shows).
  const nativeUnits = isUpload
    ? (uploadedData?.meta?.units || (display.legendUnits ?? display.units))
    : (isGrid ? (display.legendUnits ?? display.units) : display.units);
  const { label: units, convert } = useDisplayUnit(nativeUnits);
  const legendTitle = isUpload
    ? (uploadedData?.meta?.name || display.legendTitle)
    : display.legendTitle;

  // Same compact formatting the chart axes use — these two ticks sit under a
  // ~200px gradient, and a Tons-scale max is 6+ digits.
  const fmt = v => (v == null ? '' : formatAxisValue(convert(v)));

  return (
    <div className="legend">
      <div className="legend-header">
        <span className="legend-title">{legendTitle}</span>
        <span className="legend-mode-badge">
          {isGrid ? 'Grid' : 'Choropleth'}
        </span>
      </div>
      <div className="legend-gradient" style={{ background: gradient }} />
      <div className="legend-ticks">
        <span>{domain ? fmt(domain.min) : '0'}</span>
        <span>{domain ? fmt(domain.max) : '—'}</span>
      </div>
      <div className="legend-units">{units}</div>
    </div>
  );
}