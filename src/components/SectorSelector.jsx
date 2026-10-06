import { useDatasetContext }  from '../context/DatasetContext';
import { useEmissionData }    from '../hooks/useEmissionData';
import { SECTOR_CONTROL_KEY, resolveControlOptions } from '../utils/controls';

// The dataset's sector control, rendered as tabs rather than a Filters dropdown.
// Options resolve exactly as they would in ControlPanel, so datasets whose
// sectors come from the loaded data (CONUS, Permian) or from uploads work too.

// Totals lead the row whatever order the dataset lists them in — CONUS sectors
// arrive alphabetically from the data, which would bury "Total" mid-row.
// Stable, so datasets with several totals (ch4-global) keep their own order.
const isTotal = opt => /^total\b/i.test(opt.label);
const totalsFirst = options => [
  ...options.filter(isTotal),
  ...options.filter(opt => !isTotal(opt)),
];

export function SectorSelector() {
  const { activeDataset, controls, setControl, selectedState, uploadedData } = useDatasetContext();
  const { data: baseData } = useEmissionData();

  const def = activeDataset.controls.find(c => c.key === SECTOR_CONTROL_KEY);
  const resolved = def && resolveControlOptions(def, { controls, selectedState, baseData, uploadedData });
  if (!resolved) return null;
  const options = totalsFirst(resolved);

  return (
    <div className="dataset-selector">
      <span className="selector-label">{def.label}</span>
      <div className="selector-tabs wrap" role="tablist">
        {options.map(opt => (
          <button
            key={opt.value}
            role="tab"
            aria-selected={controls[def.key] === opt.value}
            className={`selector-tab ${controls[def.key] === opt.value ? 'active' : ''}`}
            onClick={() => setControl(def.key, opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
