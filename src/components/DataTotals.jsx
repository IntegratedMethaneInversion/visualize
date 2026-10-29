import React, { useMemo } from 'react';
import { useDatasetContext } from '../context/DatasetContext';
import { useEmissionData }   from '../hooks/useEmissionData';
import { useDisplayUnit }    from '../hooks/useDisplayUnit';
import { formatMassValue, formatRange, boundsFromDeltas } from '../utils/units';
import { parseNumber }       from '../utils/emissionsUtils';
import { PERMIAN_TOTAL_VARIABLE, getPeriodAnthroTotal } from '../utils/manifestUtils';

const SUPPORTED = new Set(['ch4-conus', 'ch4-colombia', 'ch4-global', 'ch4-permian-weekly']);

// Manifest total_kg values are in the tens-of-millions for a whole-basin
// week; Gg (1e6 kg) keeps them readable, matching the two plots.
const KG_TO_GG = 1e6;

// ch4-global sector keys whose deltas add up to the Natural row's IMI range.
const NATURAL_RANGE_SECTORS = ['Wetlands', 'BiomassBurn', 'Natural'];

export function DataTotals() {
  const { activeDataset, controls, selectedState } = useDatasetContext();
  const { data: baseData } = useEmissionData();
  const { label: units, convert } = useDisplayUnit();

  const { year, satellite } = controls;
  const isState = !!selectedState;
  const isPermian = activeDataset.id === 'ch4-permian-weekly';

  const { totalBottomUp, anthroBottomUp, totalPost, anthroPost } = useMemo(() => {
    const empty = { totalBottomUp: null, anthroBottomUp: null, totalPost: null, anthroPost: null };
    if (!SUPPORTED.has(activeDataset.id) || !baseData) return empty;

    // ── Permian weekly ───────────────────────────────────────────────────────
    // Manifest has no separate "Anthropogenic" aggregate (unlike the CONUS/
    // Colombia/global CSVs) — only per-sector totals — so it's summed
    // client-side; see PERMIAN_NATURAL_VARIABLES in manifestUtils.js to
    // change the categorization. Both sources are always shown regardless
    // of the Data Source control, same as ch4-global below — that control
    // only drives the map's layer.
    if (isPermian) {
      const key   = String(controls.period);
      const prior = baseData.manifest?.data?.prior?.[PERMIAN_TOTAL_VARIABLE]?.[key];
      const post  = baseData.manifest?.data?.posterior?.[PERMIAN_TOTAL_VARIABLE]?.[key];
      const anthroPriorTotal = getPeriodAnthroTotal(baseData.manifest, 'prior', key);
      const anthroPostTotal  = getPeriodAnthroTotal(baseData.manifest, 'posterior', key);
      return {
        totalBottomUp:  prior?.total_kg != null ? prior.total_kg / KG_TO_GG : null,
        anthroBottomUp: anthroPriorTotal != null ? anthroPriorTotal / KG_TO_GG : null,
        totalPost:      post?.total_kg  != null ? post.total_kg  / KG_TO_GG : null,
        anthroPost:     anthroPostTotal  != null ? anthroPostTotal  / KG_TO_GG : null,
      };
    }

    // ── Colombia ─────────────────────────────────────────────────────────────
    // No bottom-up data yet; total = anthro (all sectors are anthropogenic)
    if (activeDataset.id === 'ch4-colombia') {
      const row = isState
        ? baseData.byYear?.[year]?.[selectedState]
        : baseData.nationalPosterior?.[year];
      const v = parseNumber(isState ? row?.TotalAnth_posterior : row?.TotalAnth);
      return { totalBottomUp: null, anthroBottomUp: null, totalPost: v, anthroPost: v };
    }

    // ── Global (countries) ──────────────────────────────────────────────────
    // Both prior and posterior are always available (unlike CONUS's
    // years-limited bottom-up), so both are shown regardless of the
    // Data Source control — that only drives the map's coloring.
    if (activeDataset.id === 'ch4-global') {
      if (!isState) {
        const priorRow = baseData.nationalPrior?.[year];
        const postRow  = baseData.nationalPosterior?.[year];
        return {
          totalBottomUp:  priorRow ? parseNumber(priorRow.Total)     : null,
          anthroBottomUp: priorRow ? parseNumber(priorRow.TotalAnth) : null,
          totalPost:      postRow  ? parseNumber(postRow.Total)      : null,
          anthroPost:     postRow  ? parseNumber(postRow.TotalAnth)  : null,
        };
      }
      const priorRow = baseData.stateByYearPrior?.[year]?.[selectedState];
      const postRow  = baseData.byYear?.[year]?.[selectedState];
      return {
        totalBottomUp:  priorRow ? parseNumber(priorRow.Total)               : null,
        anthroBottomUp: priorRow ? parseNumber(priorRow.TotalAnth)           : null,
        totalPost:      postRow  ? parseNumber(postRow.Total_posterior)     : null,
        anthroPost:     postRow  ? parseNumber(postRow.TotalAnth_posterior) : null,
      };
    }

    // ── CONUS national ────────────────────────────────────────────────────────
    // Bottom-up is the GHGI prior for 2019–2020 and the summed state-CSV
    // prior for 2021–2024 (see conus.js dataLoader).
    // Posterior is only shown when satellite = posterior.
    if (!isState) {
      const priorRow = baseData.nationalPrior?.[year];
      const postRow  = satellite === 'posterior'
        ? baseData.nationalPosterior?.[year]
        : null;

      return {
        totalBottomUp:  priorRow ? parseNumber(priorRow.Total_ExclSoilAbs) : null,
        anthroBottomUp: priorRow ? parseNumber(priorRow.Anthropogenic)      : null,
        totalPost:      postRow  ? parseNumber(postRow.Total_ExclSoilAbs)   : null,
        anthroPost:     postRow  ? parseNumber(postRow.Anthropogenic)        : null,
      };
    }

    // ── CONUS state ───────────────────────────────────────────────────────────
    // sectorKeys includes 'Total_ExclSoilAbs' itself (it's a valid Sector-dropdown
    // choice), so it must be excluded from any component sum — otherwise it gets
    // added on top of the components it already aggregates, roughly doubling totals.
    const { sectorKeys } = baseData;
    if (!sectorKeys?.length) return empty;
    const componentKeys = sectorKeys.filter(s => s !== 'Total_ExclSoilAbs');

    // Bottom-up: bare sector keys in stateByYearPrior
    const priorRow = baseData.stateByYearPrior?.[year]?.[selectedState];
    const getBottomUp = (s) => {
      const v = parseNumber(priorRow?.[s]);
      return Number.isFinite(v) ? v : null;
    };
    const priorAvail = priorRow ? componentKeys.filter(s => getBottomUp(s) != null) : [];

    // Posterior: _posterior suffix in byYear (only when posterior)
    const postRow = satellite === 'posterior'
      ? baseData.byYear?.[year]?.[selectedState]
      : null;
    const getPost = (s) => {
      const v = parseNumber(postRow?.[`${s}_posterior`]);
      return Number.isFinite(v) ? v : null;
    };
    const postAvail = postRow ? componentKeys.filter(s => getPost(s) != null) : [];

    return {
      totalBottomUp:  priorRow ? parseNumber(priorRow.Total_ExclSoilAbs)           : null,
      totalPost:      postRow  ? parseNumber(postRow.Total_ExclSoilAbs_posterior) : null,
      anthroBottomUp: priorAvail.length
        ? priorAvail.filter(s => s !== 'Wetlands').reduce((acc, s) => acc + getBottomUp(s), 0)
        : null,
      anthroPost: postAvail.length
        ? postAvail.filter(s => s !== 'Wetlands').reduce((acc, s) => acc + getPost(s), 0)
        : null,
    };
  }, [activeDataset.id, baseData, year, satellite, isState, selectedState, isPermian, controls.period]);

  if (!SUPPORTED.has(activeDataset.id) || !baseData) return null;

  const fmt = formatMassValue;

  // Natural = Total minus Anthropogenic, derived rather than sourced directly
  // — every branch above already computes both, so this needs no per-dataset case.
  // Scaling is linear, so converting before or after the subtraction is equivalent.
  const naturalBottomUp = (totalBottomUp != null && anthroBottomUp != null) ? convert(totalBottomUp - anthroBottomUp) : null;
  const naturalPost      = (totalPost != null && anthroPost != null) ? convert(totalPost - anthroPost) : null;
  const anthroBottomUpDisplay = convert(anthroBottomUp);
  const anthroPostDisplay     = convert(anthroPost);

  // IMI uncertainty ranges — only ch4-global's dataLoader provides
  // sectorRanges, so every other dataset shows bare values. Anthropogenic
  // reads AnthroTotal's own propagated deltas. Natural has no propagated
  // delta in the file, so it sums its three bars' (Wetlands, Biomass
  // burning, Other Natural) — a worst-case widening, the same caveat as the
  // Other Natural bar. (Those three are exactly Total - AnthroTotal per
  // country, so the central value here matches naturalPost.)
  const rangeEntry = activeDataset.id === 'ch4-global'
    ? (isState ? baseData.sectorRanges?.byCountry?.[selectedState] : baseData.sectorRanges?.world)
    : null;
  const sumDeltas = (field, keys) => {
    const parts = keys.map(k => rangeEntry?.[k]?.[field]);
    return parts.some(v => v == null) ? null : parts.reduce((a, b) => a + b, 0);
  };
  const toDisplayRange = (bounds) =>
    bounds ? formatRange(convert(bounds[0]), convert(bounds[1])) : null;
  const anthroPostRange = toDisplayRange(boundsFromDeltas(
    anthroPost,
    rangeEntry?.TotalAnth?.minDelta,
    rangeEntry?.TotalAnth?.maxDelta,
  ));
  const naturalPostRange = toDisplayRange(boundsFromDeltas(
    (totalPost != null && anthroPost != null) ? totalPost - anthroPost : null,
    sumDeltas('minDelta', NATURAL_RANGE_SECTORS),
    sumDeltas('maxDelta', NATURAL_RANGE_SECTORS),
  ));

  const placeLabel = selectedState
    ? selectedState.toUpperCase()
    : activeDataset.id === 'ch4-colombia' ? 'COLOMBIA'
    : activeDataset.id === 'ch4-global'   ? 'WORLD'
    : isPermian                           ? 'PERMIAN BASIN'
    : 'NATIONAL';

  // Weekly data reads better as its actual start date than the coarser Year control
  const periodLabel = isPermian
    ? (baseData.manifest?.periods?.find(p => p.key === String(controls.period))?.start ?? year)
    : year;

  // Column headers live on each dataset's config (display.totalsLabels) so
  // they can be edited per dataset without touching this component.
  const { bottomUp: bottomUpLabel, posterior: posteriorLabel } = activeDataset.display.totalsLabels ?? {};

  // Helper: render a number cell — accented if populated, dimmed if not.
  // Units live once in the place/period header rather than in every cell.
  function NumCell({ value, range }) {
    const populated = value != null && Number.isFinite(value);
    return (
      <div className={`dtc-num ${populated ? 'dtc-accent' : 'dtc-dim'}`}>
        {fmt(value)}
        {populated && range && <> <span className="dtc-range">{range}</span></>}
      </div>
    );
  }

  return (
    <div className="data-totals-panel">
      <div className="data-totals-place">
        {placeLabel}{' - '}{periodLabel}
        {' '}<span className="dtc-units">{units}</span>
      </div>

      <div className="data-totals-table">
        <div className="dtc-col-header" />
        <div className="dtc-col-header">{bottomUpLabel}</div>
        <div className="dtc-col-header">{posteriorLabel}</div>

        <div className="dtc-label">Anthropogenic</div>
        <NumCell value={anthroBottomUpDisplay} />
        <NumCell value={anthroPostDisplay} range={anthroPostRange} />

        <div className="dtc-label">Natural</div>
        <NumCell value={naturalBottomUp} />
        <NumCell value={naturalPost} range={naturalPostRange} />
      </div>
    </div>
  );
}