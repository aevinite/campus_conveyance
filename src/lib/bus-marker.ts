import type * as LeafletNS from 'leaflet';

// Shared helpers for the live "moving bus" marker used on the driver, parent and
// student maps: distance/bearing math, a rotating bus DivIcon, and a small
// requestAnimationFrame tween so the marker glides between GPS fixes instead of
// teleporting (Google-Maps-navigation feel).

export type LatLng = [number, number];

// Fallback map center when there are no stops/GPS to frame yet (Ahmedabad — the
// app's primary operating city). Shared so the several maps agree.
export const DEFAULT_MAP_CENTER: LatLng = [23.0225, 72.5714];

const EARTH_M = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Great-circle distance between two points, in metres. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const lat1 = rad(a[0]);
  const lat2 = rad(b[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Compass bearing a→b in degrees (0 = north, clockwise). */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const lat1 = rad(a[0]);
  const lat2 = rad(b[0]);
  const dLng = rad(b[1] - a[1]);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** metres-per-second → km/h, or null when speed is unknown/invalid. */
export function toKmh(mps: number | null | undefined): number | null {
  if (mps == null || !Number.isFinite(mps) || mps < 0) return null;
  return mps * 3.6;
}

/**
 * A green bus badge with a pulse ring and, when a heading is known, a small
 * arrow that rotates to point the way the bus is travelling. The bus glyph
 * itself stays upright (only the arrow rotates), so it never appears upside-down.
 */
export function busDivIcon(
  L: typeof import('leaflet'),
  heading: number | null,
): LeafletNS.DivIcon {
  const arrow =
    heading == null
      ? ''
      : `<div style="position:absolute;inset:0;transform:rotate(${heading}deg)">
           <svg width="44" height="44" viewBox="0 0 44 44" style="position:absolute;inset:0">
             <path d="M22 0.5 L27.5 11 L22 8 L16.5 11 Z" fill="#16a34a" stroke="#ffffff" stroke-width="1"/>
           </svg>
         </div>`;
  return L.divIcon({
    className: 'cc-bus',
    html: `<div style="position:relative;width:44px;height:44px">
      <span style="position:absolute;left:7px;top:7px;width:30px;height:30px;border-radius:9999px;background:#16a34a;opacity:.25;animation:cc-ping 1.6s cubic-bezier(0,0,.2,1) infinite"></span>
      ${arrow}
      <span style="position:absolute;left:9px;top:9px;width:26px;height:26px;display:grid;place-items:center;border-radius:9999px;background:#16a34a;border:2px solid #ffffff;box-shadow:0 1px 4px rgba(0,0,0,.35)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6v6"/><path d="M15 6v6"/><path d="M2 12h19.6"/><path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"/><circle cx="7" cy="18" r="2"/><path d="M9 18h5"/><circle cx="16" cy="18" r="2"/></svg>
      </span>
      <style>@keyframes cc-ping{75%,100%{transform:scale(1.9);opacity:0}}</style>
    </div>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    tooltipAnchor: [0, -24],
  });
}

/**
 * Tween a Leaflet marker from where it is now to `to` over `durationMs`.
 * Returns a cancel function; call it before starting a new tween.
 */
export function animateMarkerTo(
  marker: LeafletNS.Marker,
  to: LatLng,
  durationMs: number,
): () => void {
  const from = marker.getLatLng();
  const start =
    typeof performance !== 'undefined' ? performance.now() : Date.now();
  const dur = Math.max(1, durationMs);
  let raf = 0;
  let cancelled = false;

  function frame(now: number) {
    if (cancelled) return;
    const t = Math.min(1, (now - start) / dur);
    const e = 1 - (1 - t) * (1 - t); // easeOutQuad
    marker.setLatLng([
      from.lat + (to[0] - from.lat) * e,
      from.lng + (to[1] - from.lng) * e,
    ]);
    if (t < 1) raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  return () => {
    cancelled = true;
    cancelAnimationFrame(raf);
  };
}
