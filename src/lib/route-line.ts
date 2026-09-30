import type * as LeafletNS from 'leaflet';

/**
 * Blue "whole route" line shared by every bus map (student/parent/admin route
 * maps, the app home map and the driver live map).
 *
 * Draws a straight stop-to-stop line immediately, then swaps in the
 * road-following path from /api/route-path once it arrives (kept as the
 * straight line if routing is unavailable). The line sits in its own pane
 * BELOW the stop markers and the bus so it never covers them.
 */

const ROUTE_BLUE = '#2563eb';
const PANE = 'cc-route-line';

// Per-tab memo so remounting a map (navigation, parent re-render) doesn't
// refetch the same route.
const pathMemo = new Map<string, Promise<[number, number][] | null>>();

function fetchPath(pts: [number, number][]): Promise<[number, number][] | null> {
  const q = pts.map(([la, ln]) => `${la.toFixed(5)},${ln.toFixed(5)}`).join(';');
  let p = pathMemo.get(q);
  if (!p) {
    p = fetch(`/api/route-path?pts=${encodeURIComponent(q)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { path: null }))
      .then((j: { path: [number, number][] | null }) => j.path ?? null)
      .catch(() => null);
    pathMemo.set(q, p);
    // Don't pin a failure for the tab's lifetime — allow a retry on next mount.
    void p.then((v) => {
      if (!v) pathMemo.delete(q);
    });
  }
  return p;
}

/** Add the route line to `map`. Returns a cleanup that removes it. */
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
  let disposed = false;

  const paint = (latlngs: [number, number][], dashed: boolean) => {
    group.clearLayers();
    // White casing underneath so the blue reads on any basemap.
    L.polyline(latlngs, {
      pane: PANE,
      color: '#ffffff',
      weight: 9,
      opacity: 0.9,
      lineCap: 'round',
      lineJoin: 'round',
      interactive: false,
    }).addTo(group);
    L.polyline(latlngs, {
      pane: PANE,
      color: ROUTE_BLUE,
      weight: 5,
      opacity: 0.9,
      lineCap: 'round',
      lineJoin: 'round',
      dashArray: dashed ? '8 10' : undefined,
      interactive: false,
    }).addTo(group);
  };

  paint(pts, true);
  void fetchPath(pts).then((path) => {
    if (!disposed && path && path.length > 1) paint(path, false);
  });

  return () => {
    disposed = true;
    group.remove();
  };
}
