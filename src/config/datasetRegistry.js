// stores per-dataset config objects (map view, available controls, data loader)
const registry = new Map();

/**
 * Register a dataset. Called as a side effect in each dataset config file.
 * @param {DatasetConfig} config
 */

export function registerDataset(config) {
  validateConfig(config);
  registry.set(config.id, Object.freeze(config));
}

export function getDataset(id) {
  if (!registry.has(id)) throw new Error(`Dataset "${id}" not registered.`);
  return registry.get(id);
}

/** Non-throwing existence check — for validating externally supplied ids
 *  (e.g. the ?dataset= URL param) before committing to one. */
export function hasDataset(id) {
  return registry.has(id);
}

export function getAllDatasets() {
  return [...registry.values()];
}

export function getDatasetsByFamily(familyId) {
  return [...registry.values()].filter(ds => ds.family === familyId);
}

// ─── Schema validation ────────────────────────────────────────────────────────

const REQUIRED_FIELDS  = ['id', 'family', 'name', 'description', 'mapConfig', 'controls', 'display', 'dataLoader'];
const VALID_CTRL_TYPES = ['slider', 'select', 'radio', 'multiselect'];

function validateConfig(config) {
  for (const field of REQUIRED_FIELDS) {
    if (config[field] == null)
      throw new Error(`Dataset "${config.id}" missing required field: "${field}"`);
  }
  if (!Array.isArray(config.controls))
    throw new Error(`Dataset "${config.id}": controls must be an array.`);
  for (const ctrl of config.controls) {
    if (!VALID_CTRL_TYPES.includes(ctrl.type))
      throw new Error(`Dataset "${config.id}": unknown control type "${ctrl.type}"`);
    if (ctrl.default == null)
      throw new Error(`Control "${ctrl.key}" in "${config.id}" missing default.`);
  }
}