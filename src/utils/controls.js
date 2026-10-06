// The sector control is pulled out of ControlPanel's Filters list and rendered
// as tabs at the top of the sidebar by SectorSelector.
export const SECTOR_CONTROL_KEY = 'sector';

// Options can be a static list, derived from other controls, or read from the
// loaded data. Returns null when the control is hidden or has nothing to offer.
export function resolveControlOptions(def, { controls, selectedState, baseData, uploadedData }) {
  if (def.visible && !def.visible(controls, { selectedState })) return null;

  let options = def.options;
  if (typeof options === 'function') options = options(controls);
  if (def.getOptions) options = def.getOptions(baseData, { uploadedData });
  return options?.length ? options : null;
}
