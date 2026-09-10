// ─── Framing the map on a selected region ────────────────────────────────────
// Shared by MapView's FitToSelection (?fit=1) and CountryGridLayer's own
// zoom-on-load, so both frame a country the same way and honour the same
// per-country overrides.

import L from 'leaflet';

export const FIT_PADDING  = [24, 24];
// Without a clamp, small island states zoom in absurdly far.
export const FIT_MAX_ZOOM = 6;

// Walks any GeoJSON node — FeatureCollection, Feature, geometry or
// GeometryCollection — visiting every (lng, lat) position.
function eachPosition(node, visit) {
  if (!node) return;
  if (Array.isArray(node.features))   { node.features.forEach(f => eachPosition(f, visit)); return; }
  if (node.geometry)                  { eachPosition(node.geometry, visit); return; }
  if (Array.isArray(node.geometries)) { node.geometries.forEach(g => eachPosition(g, visit)); return; }
  if (!Array.isArray(node.coordinates)) return;

  const walk = (c) => {
    if (typeof c[0] === 'number') { visit(c[0], c[1]); return; }
    c.forEach(walk);
  };
  walk(node.coordinates);
}

/**
 * Bounding box of a GeoJSON region, measured so that territory straddling the
 * antimeridian frames as one country rather than as the whole planet.
 *
 * Natural Earth stores coordinates in raw [-180, 180], so Russia's Chukotka
 * lobe sits at +180 while the rest of the country runs from +19, and Fiji has
 * islands on both sides of the line. A naive box round either spans all 360°
 * of longitude, and "zoom to country" lands on a zoomed-out world map.
 * Re-measuring with negative longitudes lifted by 360 puts those pieces back
 * beside their own country: Russia 360° -> 171°, Fiji 360° -> 7°, New Zealand
 * 357° -> 23°, the United States 359° -> 121°.
 *
 * The lifted measurement is only used when it is genuinely tighter, so a
 * country that really does span half the globe (Antarctica) is left alone, as
 * is every country that doesn't touch the line. The returned bounds may carry
 * a longitude above 180 — Leaflet projects and pans across the seam happily,
 * and only wraps when explicitly asked to.
 */
export function boundsOf(geojson) {
  let minLat = Infinity, maxLat = -Infinity;
  let rawMin = Infinity, rawMax = -Infinity;      // longitudes as stored
  let liftMin = Infinity, liftMax = -Infinity;    // negatives lifted by 360
  let seen = 0;

  eachPosition(geojson, (lng, lat) => {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
    seen++;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < rawMin) rawMin = lng;
    if (lng > rawMax) rawMax = lng;
    const lifted = lng < 0 ? lng + 360 : lng;
    if (lifted < liftMin) liftMin = lifted;
    if (lifted > liftMax) liftMax = lifted;
  });

  if (!seen) return null;

  const [west, east] = (liftMax - liftMin) < (rawMax - rawMin)
    ? [liftMin, liftMax]
    : [rawMin, rawMax];
  return L.latLngBounds([minLat, west], [maxLat, east]);
}

/**
 * Frames `map` on a region. Precedence, highest first:
 *
 *   1. `urlView`   ?center=/&zoom= — an ad-hoc override for one page load,
 *                  and how values for an override entry get discovered.
 *   2. `override`  the dataset's viewOverrides entry for this region, i.e. a
 *                  standing decision about how this country should be shown.
 *   3. `bounds`    the region's own geometry, via boundsOf above.
 *
 * center and zoom are independent at every level: supplying one takes the
 * other from the bounds, so `?zoom=3` loosens the framing while keeping the
 * region centred.
 *
 * `maxZoom` clamps a bounds-derived zoom only; an explicit center/zoom pair is
 * taken at face value, since asking for a zoom and then not getting it would
 * make the override useless for the small countries that most need one.
 * Returns true when a view was applied.
 */
export function applyRegionView(map, {
  bounds, override = null, urlView = null,
  maxZoom = null, animate = false, duration,
}) {
  const limit  = override?.maxZoom ?? maxZoom ?? null;
  const target = override?.bounds ? L.latLngBounds(override.bounds) : bounds;
  const center = urlView?.center ?? override?.center ?? null;
  const zoom   = urlView?.zoom   ?? override?.zoom   ?? null;

  if (center != null && zoom != null) {
    map.setView(center, zoom, { animate, duration });
    return true;
  }
  if (!target?.isValid?.()) return false;

  if (center == null && zoom == null) {
    map.fitBounds(target, {
      padding: FIT_PADDING,
      animate,
      duration,
      ...(limit != null ? { maxZoom: limit } : {}),
    });
    return true;
  }

  // getBoundsZoom's padding is the total to subtract, where fitBounds' is per
  // side — doubling keeps the two paths framing identically.
  let fitZoom = map.getBoundsZoom(
    target, false, L.point(FIT_PADDING[0] * 2, FIT_PADDING[1] * 2),
  );
  if (limit != null) fitZoom = Math.min(limit, fitZoom);

  map.setView(center ?? target.getCenter(), zoom ?? fitZoom, { animate, duration });
  return true;
}
