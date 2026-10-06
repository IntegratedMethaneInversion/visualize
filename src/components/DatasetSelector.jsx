import React from 'react';
import { useDatasetContext } from '../context/DatasetContext';

export function DatasetSelector() {
  const { activeDataset, datasetsInActiveFamily, setActiveDataset } = useDatasetContext();

  return (
    <div className="dataset-selector">
      <label className="selector-label" htmlFor="dataset-select">Dataset</label>
      <select
        id="dataset-select"
        className="select-control dataset-select"
        value={activeDataset.id}
        onChange={e => setActiveDataset(e.target.value)}
      >
        {datasetsInActiveFamily.map(ds => (
          <option key={ds.id} value={ds.id} title={ds.description}>
            {ds.dropdownName}
          </option>
        ))}
      </select>
    </div>
  );
}
