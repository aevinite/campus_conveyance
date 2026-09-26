import type * as LeafletNS from 'leaflet';

/**
 * Central basemap tile config for EVERY Leaflet map in the app (student route
 * map, driver live map, agency stop picker, and the admin/parent maps that reuse
 * them).
 *
 * Why this exists: CARTO discontinued keyless basemaps — their public
 * `basemaps.cartocdn.com` URLs now return an "API KEY REQUIRED" placeholder tile
 * for every request, which is what showed up (most visibly while zooming, since
 * each newly loaded tile was one of those placeholders).
 *
 * Fix: use MapTiler's light "dataviz" style when a key is configured (keeps the
 * clean, low-ink Positron-like look, supports retina + high zoom), and fall back
 * to keyless OpenStreetMap raster tiles so the map is NEVER blank or watermarked
 * even before the key is set. Add the key as `NEXT_PUBLIC_MAPTILER_KEY` (a
 * NEXT_PUBLIC_ var so it's available in these client components) and the app
 * upgrades to MapTiler automatically on the next build.
 */

const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY?.trim();

// MapTiler "dataviz-light": clean, light, low-ink basemap — closest match to the
// old CARTO Positron. `{r}` → `@2x` retina tiles; native tiles up to z22.
const MAPTILER_URL = MAPTILER_KEY
  ? `https://api.maptiler.com/maps/dataviz-light/{z}/{x}/{y}{r}.png?key=${MAPTILER_KEY}`
  : null;

// Keyless fallback: OpenStreetMap standard raster (single host, no retina, native
// tiles only to z19).
const OSM_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/** True when a MapTiler key is configured (else the keyless OSM fallback). */
export const USING_MAPTILER = MAPTILER_URL != null;

/** Basemap tile URL template to pass to `L.tileLayer`. */
export const TILE_URL = MAPTILER_URL ?? OSM_URL;

/**
 * Options to pass alongside {@link TILE_URL} to `L.tileLayer`.
 *
 * `maxZoom` is the furthest the user may zoom; `maxNativeZoom` caps the deepest
 * zoom we actually REQUEST tiles for — beyond it Leaflet upscales the last real
 * tiles instead of fetching non-existent ones (which would 404 / show a blank or
 * placeholder tile). The keyless OSM fallback is lightly muted (see the
 * `.cc-tile-muted` rule in globals.css) so it still reads as a calm, light map.
 */
// Loading/zoom tuning shared by both providers:
//  • keepBuffer — keep extra rings of tiles around the viewport cached, so
//    panning and zoom-out show instantly instead of flashing grey while loading.
//  • updateWhenZooming:false — don't fire a storm of tile requests DURING the
//    pinch/zoom animation; load once the zoom settles. Fewer requests = faster,
//    and it stops the mid-zoom flicker.
//  • updateWhenIdle:false — still refresh tiles while panning (mobile default is
//    true, which can leave gaps until you lift your finger).
const SHARED: LeafletNS.TileLayerOptions = {
  keepBuffer: 4,
  updateWhenZooming: false,
  updateWhenIdle: false,
};

export const TILE_OPTIONS: LeafletNS.TileLayerOptions = USING_MAPTILER
  ? {
      ...SHARED,
      // MapTiler serves native tiles well past street level, so we can allow a
      // deeper crisp zoom than the OSM fallback.
      maxZoom: 20,
      maxNativeZoom: 20,
      attribution:
        '© <a href="https://www.maptiler.com/">MapTiler</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }
  : {
      ...SHARED,
      subdomains: 'abc',
      // OSM standard tiles only exist to z19 — cap the user's zoom AT the native
      // level so we never upscale (blurry) tiles. Deeper zoom needs MapTiler.
      maxZoom: 19,
      maxNativeZoom: 19,
      className: 'cc-tile-muted',
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    };
