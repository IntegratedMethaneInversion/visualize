# ch4_global data

Data for the `ch4-global` dataset (East et al., 2025), one folder per year:

```
public/data/ch4_global/
  <year>/
    countries.csv            per-country totals, read by the choropleth, totals table and Sector Breakdown chart
    grid/<Country>.json.gz   per-country gridded emissions, read when a country is clicked
src/config/datasets/ch4/globalYears.json   { "years": [...] } — the list of years the site offers
```

## `<year>/countries.csv`

One row per country (`countries` column), with
`<Col>_prior`, `<Col>_post`, `<Col>_post_min`, `<Col>_post_max` for each `Col` in
`Livestock, Waste, Oil-Gas, Rice, Coal, Reservoirs, Other, BiomassBurn, Wetlands, Termites, Seeps, AnthroTotal, Total`,
plus `sensitivity` (unused by the site; blank for 2024). Units are Tg/yr.
`_post_min` / `_post_max` are **+/- deltas** from `_post`, not absolute bounds.

## `<year>/grid/<Country>.json.gz`

One gzipped JSON per country, named after the `ADMIN` name in `public/data/world-countries.json`
with spaces replaced by `_`. Format `ch4-global-country-grid/1`:

```jsonc
{
  "format": "ch4-global-country-grid/1",
  "country": "China", "year": 2024,
  "units": "Tg/yr per grid cell (already integrated over the cell area)",
  "grid": { "nlon": 1152, "lat_res": 0.25, "lon_res": 0.3125, "lat_origin": -90.0, "lon_origin": -180.0 },
  "cells": [523017, 523018, ...],   // cell id = row * nlon + col, sorted
  "post":  { "Livestock": [...], "OG": [...], ..., "Total": [...] },  // central estimate, aligned with cells
  "prior": { ... },                 // bottom-up
  "min":   { ... },                 // ensemble minimum of the posterior — absolute, not a delta; may contain null
  "max":   { ... }                  // ensemble maximum of the posterior — absolute; may contain null
}
```

- Cell centre: `lat = lat_origin + row * lat_res`, `lon = lon_origin + col * lon_res`, with
  `row = floor(id / nlon)` and `col = id % nlon`. The cell is the centre ± half a cell, latitude clipped to ±90.
- Sector keys are the model's native ones: `Reservoirs, Termites, Lakes, Seeps, Wetlands, BiomassBurn,
  OtherAnth, Rice, Wastewater, Landfills, Livestock, Coal, OG`, plus `Total` (all sectors, soil excluded).
  The site's aggregate sectors (Total anthropogenic, Waste, Other natural) are summed from these — see
  `SECTORS` in `src/config/datasets/ch4/global.js`.
- A sector missing from a block is zero in every cell. A `null` in `min`/`max` means the ensemble has no range
  for that cell.
- All values, including min/max, are Tg/yr.

The site fetches these as opaque `.gz` bytes and decompresses them in the browser (GitHub Pages serves them
without `Content-Encoding`; Vite's dev server sends `Content-Encoding: gzip` and the browser decodes them itself).

## Adding a year

> TODO: `scripts/build_ch4_global.py` is not in the repo yet — add it before following these steps.

```bash
python3 scripts/build_ch4_global.py from-nc <ensemble_results_YYYY.nc> --year YYYY
# writes public/data/ch4_global/YYYY/ and adds YYYY to src/config/datasets/ch4/globalYears.json
```

- For a NetCDF in kg m⁻² s⁻¹, add `--flux-units --area-file <global_025x03125_grid.nc>`.
- `--reduced-members` (on by default) uses only the first 3 ensemble members for the United States, Mexico and
  Canada ranges, as was done for 2024.
- Requires Python ≥ 3.9 with `numpy`, `netCDF4` and `shapely` ≥ 2.

The site picks up the new year from `globalYears.json` and defaults to the latest.

## Known differences between years

- 2024 ranges for the United States, Mexico and Canada use only the first 3 ensemble members (2023 used all 7).
- 2024 `sensitivity` is blank.
- 2023 values were repacked from the previously published files rather than recomputed: central values are
  bit-identical; ensemble min/max were converted from Gg to Tg.
