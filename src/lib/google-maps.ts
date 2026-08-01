// Google Maps loader + shared marker helpers. The SDK is loaded once (singleton)
// and every map component awaits the same promise, so we never inject the script
// twice. Marker DOM builders + the glide tween are the Google equivalents of the
// old Leaflet DivIcons in bus-marker.ts (which keeps the map-agnostic math).
import { Loader } from '@googlemaps/js-api-loader';
import type { LatLng } from './bus-marker';

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';
/** Vector Map ID — required for Advanced Markers + custom styling. */
export const GOOGLE_MAPS_MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || undefined;

/** True when the browser key is configured (so a map can render at all). */
export function hasGoogleMapsKey(): boolean {
  return API_KEY.length > 0;
}

let loaderPromise: Promise<typeof google> | null = null;

/** Load the Google Maps JS SDK once (maps + marker + places + geometry). */
export function loadGoogleMaps(): Promise<typeof google> {
  if (!loaderPromise) {
    const loader = new Loader({
      apiKey: API_KEY,
      version: 'weekly',
      libraries: ['maps', 'marker', 'places', 'geometry'],
    });
    loaderPromise = loader.load();
  }
  return loaderPromise;
}

// ---------------------------------------------------------------------------
// Marker DOM builders (used as AdvancedMarkerElement `content`).
// ---------------------------------------------------------------------------

/**
 * A green bus badge with a pulse ring and, when a heading is known, a small
 * arrow that rotates to point the way the bus is travelling (the bus glyph stays
 * upright, only the arrow rotates). Ported from the old Leaflet `busDivIcon`.
 */
export function busMarkerEl(heading: number | null): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'cc-bus';
  const arrow =
    heading == null
      ? ''
      : `<div style="position:absolute;inset:0;transform:rotate(${heading}deg)">
           <svg width="44" height="44" viewBox="0 0 44 44" style="position:absolute;inset:0">
             <path d="M22 0.5 L27.5 11 L22 8 L16.5 11 Z" fill="#16a34a" stroke="#ffffff" stroke-width="1"/>
           </svg>
         </div>`;
  el.innerHTML = `<div style="position:relative;width:44px;height:44px">
      <span style="position:absolute;left:7px;top:7px;width:30px;height:30px;border-radius:9999px;background:#16a34a;opacity:.25;animation:cc-ping 1.6s cubic-bezier(0,0,.2,1) infinite"></span>
      ${arrow}
      <span style="position:absolute;left:9px;top:9px;width:26px;height:26px;display:grid;place-items:center;border-radius:9999px;background:#16a34a;border:2px solid #ffffff;box-shadow:0 1px 4px rgba(0,0,0,.35)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6v6"/><path d="M15 6v6"/><path d="M2 12h19.6"/><path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"/><circle cx="7" cy="18" r="2"/><path d="M9 18h5"/><circle cx="16" cy="18" r="2"/></svg>
      </span>
    </div>`;
  return el;
}

/** A numbered teardrop pin (brand purple) for a route stop. */
export function numberedPinEl(n: number | string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'cc-pin';
  el.innerHTML = `<svg width="30" height="40" viewBox="0 0 30 40" xmlns="http://www.w3.org/2000/svg" style="display:block">
      <path d="M15 0C6.716 0 0 6.716 0 15c0 9.9 13.2 23.5 14.02 24.32a1.4 1.4 0 0 0 1.96 0C16.8 38.5 30 24.9 30 15 30 6.716 23.284 0 15 0z" fill="#6d5efc" stroke="#ffffff" stroke-width="1.5"/>
      <circle cx="15" cy="15" r="9" fill="#ffffff"/>
      <text x="15" y="15" text-anchor="middle" dominant-baseline="central" font-family="system-ui,sans-serif" font-size="12" font-weight="700" fill="#6d5efc">${n}</text>
    </svg>`;
  return el;
}

/** A small dot marker (used for context stops on the driver follow-map). */
export function dotMarkerEl(): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText =
    'width:12px;height:12px;border-radius:9999px;background:#6d5efc;border:2px solid #ffffff;box-shadow:0 1px 3px rgba(0,0,0,.4)';
  return el;
}

// ---------------------------------------------------------------------------
// Position glide tween — the Google equivalent of Leaflet's animateMarkerTo, so
// the bus marker slides between GPS fixes instead of teleporting.
// ---------------------------------------------------------------------------

function coord(
  p: google.maps.LatLng | google.maps.LatLngLiteral | null | undefined,
): { lat: number; lng: number } | null {
  if (!p) return null;
  const lat = typeof p.lat === 'function' ? p.lat() : p.lat;
  const lng = typeof p.lng === 'function' ? p.lng() : p.lng;
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

/**
 * Tween an AdvancedMarkerElement from its current position to `to` over
 * `durationMs`. Returns a cancel function; call it before starting a new tween.
 */
export function animateAdvancedMarkerTo(
  marker: google.maps.marker.AdvancedMarkerElement,
  to: LatLng,
  durationMs: number,
): () => void {
  const from = coord(marker.position as google.maps.LatLng | google.maps.LatLngLiteral | null);
  if (!from) {
    marker.position = { lat: to[0], lng: to[1] };
    return () => {};
  }
  const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const dur = Math.max(1, durationMs);
  let raf = 0;
  let cancelled = false;

  function frame(now: number) {
    if (cancelled) return;
    const t = Math.min(1, (now - start) / dur);
    const e = 1 - (1 - t) * (1 - t); // easeOutQuad
    marker.position = {
      lat: from!.lat + (to[0] - from!.lat) * e,
      lng: from!.lng + (to[1] - from!.lng) * e,
    };
    if (t < 1) raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  return () => {
    cancelled = true;
    cancelAnimationFrame(raf);
  };
}

/** Build the free "open turn-by-turn in Google Maps" deep link to a destination. */
export function googleMapsDirectionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
}
