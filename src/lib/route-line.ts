import type * as LeafletNS from 'leaflet';

/**
 * Blue "whole route" line shared by every bus map (student/parent/admin route
 * maps, the app home map and the driver live map).
 *
 * Pickup-point wise: a straight segment from pickup 1 → 2 → 3 … in the route's
 * stop order (callers pass stops sorted by sequence). The line sits in its own
 * pane BELOW the stop pins and the bus so it never covers them.
 */

const ROUTE_BLUE = '#2563eb';
const PANE = 'cc-route-line';

/** Numbered pickup pin (1, 2, 3 …) matching the rider route map's pins. */
export function pickupPin(L: typeof import('leaflet'), n: number): LeafletNS.DivIcon {
  return L.divIcon({
    className: 'cc-pin',
    html: `<svg width="30" height="40" viewBox="0 0 30 40" xmlns="http://www.w3.org/2000/svg">
      <path d="M15 0C6.716 0 0 6.716 0 15c0 9.9 13.2 23.5 14.02 24.32a1.4 1.4 0 0 0 1.96 0C16.8 38.5 30 24.9 30 15 30 6.716 23.284 0 15 0z" fill="#6d5efc" stroke="#ffffff" stroke-width="1.5"/>
      <circle cx="15" cy="15" r="9" fill="#ffffff"/>
      <text x="15" y="15" text-anchor="middle" dominant-baseline="central" font-family="system-ui,sans-serif" font-size="12" font-weight="700" fill="#6d5efc">${n}</text>
    </svg>`,
    iconSize: [30, 40],
    iconAnchor: [15, 40],
    tooltipAnchor: [0, -34],
  });
}

/** Add the pickup-order route line to `map`. Returns a cleanup that removes it. */
export function drawRouteLine(
  L: typeof import('leaflet'),
  map: LeafletNS.Map,
  stops: { lat: number; lng: number }[],
): () => void {
  if (stops.length < 2) return () => {};
  if (!map.getPane(PANE)) {
    const pane = map.createPane(PANE);
    pane.style.zIndex = '390'; // above tiles (200), below overlays/markers (400+)
    pane.style.pointerEvents = 'none';
  }
  const pts = stops.map((s) => [s.lat, s.lng] as [number, number]);
  const group = L.layerGroup().addTo(map);
  // White casing underneath so the blue reads on any basemap.
  L.polyline(pts, {
    pane: PANE,
    color: '#ffffff',
    weight: 9,
    opacity: 0.9,
    lineCap: 'round',
    lineJoin: 'round',
    interactive: false,
  }).addTo(group);
  L.polyline(pts, {
    pane: PANE,
    color: ROUTE_BLUE,
    weight: 5,
    opacity: 0.9,
    lineCap: 'round',
    lineJoin: 'round',
    interactive: false,
  }).addTo(group);
  return () => group.remove();
}
