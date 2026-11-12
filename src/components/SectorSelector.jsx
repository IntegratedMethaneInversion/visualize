import { useDatasetContext }  from '../context/DatasetContext';
import { useEmissionData }    from '../hooks/useEmissionData';
import { SECTOR_CONTROL_KEY, YEAR_CONTROL_KEY, resolveControlOptions } from '../utils/controls';

// Sidebar tab rows for the dataset's sector and year controls, rendered as
// bubbles rather than Map Settings dropdowns. Options resolve exactly as they
// would in ControlPanel, so datasets whose sectors come from the loaded data
// (CONUS, Permian) or from uploads work too.

// Totals lead the row whatever order the dataset lists them in — CONUS sectors
// arrive alphabetically from the data, which would bury "Total" mid-row.
// Stable, so datasets with several totals (ch4-global) keep their own order.
const isTotal = opt => /^total\b/i.test(opt.label);
const totalsFirst = options => [
  ...options.filter(isTotal),
  ...options.filter(opt => !isTotal(opt)),
];

export function SectorSelector() {
  return <ControlTabs controlKey={SECTOR_CONTROL_KEY} sortOptions={totalsFirst} />;
}

export function YearSelector() {
  return <ControlTabs controlKey={YEAR_CONTROL_KEY} />;
}

function ControlTabs({ controlKey, sortOptions = o => o }) {
  const { activeDataset, controls, setControl, selectedState, uploadedData } = useDatasetContext();
  const { data: baseData } = useEmissionData();

  const def = activeDataset.controls.find(c => c.key === controlKey);
  const resolved = def && resolveControlOptions(def, { controls, selectedState, baseData, uploadedData });
  if (!resolved) return null;

  // Slider-type controls (the CO₂ year) list bare values rather than {value, label}.
  const options = sortOptions(resolved.map(opt =>
    typeof opt === 'object' ? opt : { value: opt, label: String(opt) }
  ));
  const value = controls[def.key];
  // Options may carry a `note` (e.g. CONUS's gridded-prior fallback year),
  // shown under the row while that option is selected.
  const note = options.find(opt => opt.value === value)?.note;

  return (
    <div className="dataset-selector">
      <span className="selector-label">{def.label}</span>
      <div className="selector-tabs-col">
        <div className="selector-tabs wrap" role="tablist" aria-label={def.label}>
          {options.map(opt => (
            <button
              key={opt.value}
              role="tab"
              aria-selected={value === opt.value}
              className={`selector-tab ${value === opt.value ? 'active' : ''}`}
              onClick={() => setControl(def.key, opt.value)}
              title={opt.note}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {note && <p className="selector-note">{note}</p>}
      </div>
    </div>
  );
}
