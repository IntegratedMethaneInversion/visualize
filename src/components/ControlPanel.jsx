import React from 'react';
import { useDatasetContext } from '../context/DatasetContext';
import { useEmissionData }   from '../hooks/useEmissionData';
import { SECTOR_CONTROL_KEY, resolveControlOptions } from '../utils/controls';

const ControlRenderers = {
  slider:      SliderControl,
  select:      SelectControl,
  radio:       RadioControl,
  multiselect: MultiSelectControl,
};

export function ControlPanel() {
  const { activeDataset, controls, setControl, selectedState, uploadedData } = useDatasetContext();
  const { data: baseData } = useEmissionData();

  // Resolve visibility and options for every control up front
  const resolvedControls = activeDataset.controls
    .map(def => {
      if (def.key === SECTOR_CONTROL_KEY) return null;
      if (!ControlRenderers[def.type]) return null;

      const options = resolveControlOptions(def, { controls, selectedState, baseData, uploadedData });
      return options && { ...def, options };
    })
    .filter(Boolean);

  // Build render items: ungrouped controls render individually;
  // controls sharing a `group` key render together as a CSS grid row
  // at the position of the first member encountered.
  const renderItems = [];
  const seenGroups  = new Set();

  for (const def of resolvedControls) {
    if (!def.group) {
      renderItems.push({ kind: 'single', def });
    } else if (!seenGroups.has(def.group)) {
      seenGroups.add(def.group);
      const defs = resolvedControls.filter(d => d.group === def.group);
      renderItems.push({ kind: 'group', id: def.group, defs });
    }
  }

  return (
    <div className="control-panel">
      <span className="control-panel-title">Filters</span>

      {renderItems.map(item => {
        if (item.kind === 'single') {
          const { def } = item;
          const Renderer = ControlRenderers[def.type];
          return (
            <div key={def.key} className="control-group">
              <label className="control-label">{def.label}</label>
              <Renderer
                def={def}
                value={controls[def.key]}
                onChange={v => setControl(def.key, v)}
              />
            </div>
          );
        }

        // Grouped row — column count matches the number of visible members
        return (
          <div
            key={item.id}
            className="control-group-row"
            style={{ gridTemplateColumns: `repeat(${item.defs.length}, 1fr)` }}
          >
            {item.defs.map(def => {
              const Renderer = ControlRenderers[def.type];
              return (
                <div key={def.key} className="control-group-cell">
                  <label className="control-label">{def.label}</label>
                  <Renderer
                    def={def}
                    value={controls[def.key]}
                    onChange={v => setControl(def.key, v)}
                  />
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function SliderControl({ def, value, onChange }) {
  const { options } = def;
  const min = options[0];
  const max = options[options.length - 1];

  function handleChange(e) {
    const raw     = Number(e.target.value);
    const snapped = options.reduce((a, b) =>
      Math.abs(b - raw) < Math.abs(a - raw) ? b : a
    );
    onChange(snapped);
  }

  return (
    <div className="slider-control">
      <input
        type="range"
        min={min}
        max={max}
        step={(max - min) / (options.length - 1)}
        value={value}
        onChange={handleChange}
        list={`ticks-${def.key}`}
      />
      <datalist id={`ticks-${def.key}`}>
        {options.map(v => <option key={v} value={v} />)}
      </datalist>
      <span className="slider-value">
        {def.format ? def.format(value) : value}
      </span>
    </div>
  );
}

function SelectControl({ def, value, onChange }) {
  // If options carry numeric values, coerce the HTML string back to a number
  const isNumeric = def.options.length > 0 && typeof def.options[0].value === 'number';

  return (
    <select
      className="select-control"
      value={value}
      onChange={e => onChange(isNumeric ? Number(e.target.value) : e.target.value)}
    >
      {def.options.map(opt => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  );
}

function RadioControl({ def, value, onChange }) {
  return (
    <div className="radio-control">
      {def.options.map(opt => (
        <label
          key={opt.value}
          className={`radio-option ${value === opt.value ? 'active' : ''}`}
        >
          <input
            type="radio"
            name={def.key}
            value={opt.value}
            checked={value === opt.value}
            onChange={() => onChange(opt.value)}
          />
          {opt.label}
        </label>
      ))}
    </div>
  );
}

function MultiSelectControl({ def, value = [], onChange }) {
  function toggle(v) {
    onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v]);
  }
  return (
    <div className="radio-control">
      {def.options.map(opt => (
        <label
          key={opt.value}
          className={`radio-option ${value.includes(opt.value) ? 'active' : ''}`}
        >
          <input
            type="checkbox"
            checked={value.includes(opt.value)}
            onChange={() => toggle(opt.value)}
          />
          {opt.label}
        </label>
      ))}
    </div>
  );
}