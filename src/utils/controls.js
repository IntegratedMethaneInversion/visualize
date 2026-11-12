// The sector and year controls are pulled out of ControlPanel (the Map
// Settings popover) and rendered as tab rows in the sidebar by SectorSelector
// and YearSelector.
export const SECTOR_CONTROL_KEY = 'sector';
export const YEAR_CONTROL_KEY   = 'year';
export const SIDEBAR_CONTROL_KEYS = new Set([SECTOR_CONTROL_KEY, YEAR_CONTROL_KEY]);

// Options can be a static list, derived from other controls, or read from the
// loaded data. Returns null when the control is hidden or has nothing to offer.
export function resolveControlOptions(def, { controls, selectedState, baseData, uploadedData }) {
  if (def.visible && !def.visible(controls, { selectedState })) return null;

  let options = def.options;
  if (typeof options === 'function') options = options(controls);
  if (def.getOptions) options = def.getOptions(baseData, { uploadedData });
  return options?.length ? options : null;
}
