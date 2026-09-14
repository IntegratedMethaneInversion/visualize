import { useDatasetContext } from '../context/DatasetContext';
import { parseDisplayUnit, convertMass, formatDisplayUnit } from '../utils/units';

// Resolves the active dataset's native units against the dashboard-wide
// mass-unit preference. Datasets whose display.units isn't a recognized
// mass unit (e.g. CO2's ppm) fall through unconverted.
//
// nativeUnits overrides which unit string is resolved, for callers whose
// values aren't in display.units — the Legend, whose grid branch reads
// display.legendUnits instead. The same fall-through then does the right
// thing per dataset without the caller testing anything: ch4-global's
// legendUnits is 'Tg/yr' (a mass, so it tracks the selector), while
// Colombia's 'kg km⁻² h⁻¹' and permian-weekly's 'kg h⁻¹' are flux
// densities the mass selector can't rescale, and pass through as-is.
export function useDisplayUnit(nativeUnits) {
  const { activeDataset, massUnit } = useDatasetContext();
  const sourceUnits = nativeUnits ?? activeDataset.display.units;
  const { massUnit: nativeUnit, timeSuffix } = parseDisplayUnit(sourceUnits);
  const supported = nativeUnit != null;
  const unit  = supported ? massUnit : nativeUnit;
  const label = supported ? formatDisplayUnit(unit, timeSuffix) : sourceUnits;

  return {
    supported,
    label,
    convert: (value) => supported ? convertMass(value, nativeUnit, unit) : value,
  };
}
