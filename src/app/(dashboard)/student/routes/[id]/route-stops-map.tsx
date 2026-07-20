'use client';
import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import type * as LeafletNS from 'leaflet';
import {
  animateMarkerTo,
  bearingDeg,
  busDivIcon,
  haversineMeters,
  toKmh,
  type LatLng,
} from '@/lib/bus-marker';

export interface MapStop {
  name: string;
  lat: number | null;
  lng: number | null;
  description?: string | null;
  address?: string | null;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

// Clean, professional light basemap (CARTO Positron) — always light, no key.
const TILE_URL = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';

// How often to poll for the live bus position (balanced freshness vs. load).
const LIVE_POLL_MS = 5000;
// Below this, a new fix is treated as GPS jitter (bus stationary): don't rotate
// the icon or report speed.
const MOVE_MIN_M = 8;
// Re-fetch the area label only after the bus has moved this far.
const AREA_MIN_M = 150;

function numberedPin(L: typeof import('leaflet'), n: number): LeafletNS.DivIcon {
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

interface LiveResponse {
  live: boolean;
  lat?: number;
  lng?: number;
  busNumber?: string | null;
}

interface LiveState {
  busNumber?: string | null;
  speedKmh: number | null;
  area: string | null;
  stopped: boolean;
}

export default function RouteStopsMap({
  stops,
  liveRouteId,
}: {
  stops: MapStop[];
  /** When set, poll for and show this route's live bus position. */
  liveRouteId?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletNS.Map | null>(null);
  const leafletRef = useRef<typeof import('leaflet') | null>(null);
  const busMarkerRef = useRef<LeafletNS.Marker | null>(null);
  const centeredOnBus = useRef(false);
  // Motion state derived from successive polled positions.
  const prevBusPos = useRef<LatLng | null>(null);
  const prevBusTime = useRef(0);
  const headingRef = useRef<number | null>(null);
  const speedRef = useRef<number | null>(null); // metres/second, smoothed
  const areaRef = useRef<string | null>(null);
  const lastAreaPos = useRef<LatLng | null>(null);
  const animCancel = useRef<(() => void) | null>(null);
  const [live, setLive] = useState<LiveState | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      leafletRef.current = L;
      if (cancelled || !containerRef.current || mapRef.current) return;
      const pts = stops.filter(
        (s): s is MapStop & { lat: number; lng: number } =>
          typeof s.lat === 'number' && typeof s.lng === 'number',
      );
      const m = L.map(containerRef.current, { attributionControl: false, scrollWheelZoom: false });
      mapRef.current = m;
      L.tileLayer(TILE_URL, { subdomains: 'abcd', maxZoom: 20 }).addTo(m);
      pts.forEach((s, i) => {
        const desc = s.description?.trim();
        const addr = s.address?.trim();
        const popup =
          `<div style="font:500 13px system-ui,sans-serif;min-width:160px;max-width:220px">` +
          `<div style="font-weight:700;margin-bottom:2px">${i + 1}. ${escapeHtml(s.name)}</div>` +
          (desc ? `<div style="color:#4b5563">${escapeHtml(desc)}</div>` : '') +
          (addr ? `<div style="color:#9ca3af;font-size:11px;margin-top:2px">${escapeHtml(addr)}</div>` : '') +
          `</div>`;
        L.marker([s.lat, s.lng], { icon: numberedPin(L, i + 1) })
          .addTo(m)
          .bindTooltip(`${i + 1}. ${s.name}`, { direction: 'top' })
          .bindPopup(popup);
      });
      if (pts.length === 1) {
        m.setView([pts[0].lat, pts[0].lng], 15);
      } else if (pts.length > 1) {
        m.fitBounds(L.latLngBounds(pts.map((s) => [s.lat, s.lng] as [number, number])).pad(0.3));
      } else {
        m.setView([23.0225, 72.5714], 11);
      }
      setTimeout(() => m.invalidateSize(), 0);
    })();
    return () => {
      cancelled = true;
      animCancel.current?.();
      busMarkerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [stops]);

  // Poll the live bus position and reflect it with a moving, rotating marker that
  // shows speed + current area. The poll PAUSES while the tab is hidden
  // (backgrounded/forgotten tabs would otherwise fetch forever, so server load
  // scaled with open tabs — and the parent dashboard renders one per child trip).
  // It resumes and refreshes immediately when the tab becomes visible again.
  useEffect(() => {
    if (!liveRouteId) return;
    let stopped = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    async function fetchArea(p: LatLng) {
      try {
        const r = await fetch(`/api/reverse-geocode?lat=${p[0]}&lng=${p[1]}`, { cache: 'no-store' });
        const j = (await r.json()) as { area: string | null };
        if (stopped) return;
        areaRef.current = j.area ?? areaRef.current;
        setLive((prev) => (prev ? { ...prev, area: areaRef.current } : prev));
      } catch {
        // keep the previous label
      }
    }

    async function tick() {
      try {
        const res = await fetch(`/api/bus-location?routeId=${liveRouteId}`, { cache: 'no-store' });
        const data = (await res.json()) as LiveResponse;
        if (stopped) return;
        const L = leafletRef.current;
        const m = mapRef.current;
        if (data.live && data.lat != null && data.lng != null && L && m) {
          const pos: LatLng = [data.lat, data.lng];
          const now = Date.now();
          if (!busMarkerRef.current) {
            busMarkerRef.current = L.marker(pos, { icon: busDivIcon(L, null), zIndexOffset: 1000 })
              .addTo(m)
              .bindTooltip(data.busNumber ? `Bus ${data.busNumber} (live)` : 'Bus (live)', {
                direction: 'top',
              });
            prevBusPos.current = pos;
            prevBusTime.current = now;
            lastAreaPos.current = pos;
            if (!centeredOnBus.current) {
              m.setView(pos, Math.max(m.getZoom(), 14));
              centeredOnBus.current = true;
            }
            void fetchArea(pos);
            setLive({ busNumber: data.busNumber, speedKmh: null, area: areaRef.current, stopped: true });
          } else {
            const prev = prevBusPos.current!;
            const dist = haversineMeters(prev, pos);
            const dt = (now - prevBusTime.current) / 1000;
            if (dist >= MOVE_MIN_M) {
              const hdg = bearingDeg(prev, pos);
              headingRef.current = hdg;
              const inst = dt > 0 ? dist / dt : 0; // m/s
              speedRef.current = speedRef.current == null ? inst : speedRef.current * 0.5 + inst * 0.5;
              animCancel.current?.();
              animCancel.current = animateMarkerTo(
                busMarkerRef.current,
                pos,
                Math.min(Math.max(dt * 1000, 600), 6000),
              );
              busMarkerRef.current.setIcon(busDivIcon(L, hdg));
              if (!lastAreaPos.current || haversineMeters(lastAreaPos.current, pos) >= AREA_MIN_M) {
                lastAreaPos.current = pos;
                void fetchArea(pos);
              }
              setLive({
                busNumber: data.busNumber,
                speedKmh: toKmh(speedRef.current),
                area: areaRef.current,
                stopped: false,
              });
            } else {
              // Stationary: snap to correct drift, report stopped.
              speedRef.current = 0;
              busMarkerRef.current.setLatLng(pos);
              setLive({ busNumber: data.busNumber, speedKmh: 0, area: areaRef.current, stopped: true });
            }
            prevBusPos.current = pos;
            prevBusTime.current = now;
          }
        } else {
          animCancel.current?.();
          if (busMarkerRef.current && m) {
            m.removeLayer(busMarkerRef.current);
            busMarkerRef.current = null;
          }
          prevBusPos.current = null;
          speedRef.current = null;
          headingRef.current = null;
          centeredOnBus.current = false;
          setLive(null);
        }
      } catch {
        // Transient network error — try again on the next tick.
      }
    }

    function start() {
      if (intervalId != null) return;
      void tick();
      intervalId = setInterval(tick, LIVE_POLL_MS);
    }
    function stop() {
      if (intervalId != null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    }
    function onVisibility() {
      if (document.hidden) stop();
      else start();
    }

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      stop();
      animCancel.current?.();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [liveRouteId]);

  const speedLabel = live?.stopped ? 'Stopped' : `${Math.round(live?.speedKmh ?? 0)} km/h`;

  return (
    <div className="relative">
      {live && (
        <div className="pointer-events-none absolute top-3 right-3 z-[1000] flex flex-col items-end gap-1.5">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/15 px-2.5 py-1 text-xs font-semibold text-success shadow-sm backdrop-blur-sm">
            <span className="size-1.5 animate-pulse rounded-full bg-success" />
            Bus live{live.busNumber ? ` · Bus ${live.busNumber}` : ''}
          </span>
          <span className="inline-flex max-w-[75%] items-center gap-1.5 rounded-full border border-border bg-background/80 px-2.5 py-1 text-xs font-medium text-foreground shadow-sm backdrop-blur-sm">
            {speedLabel}
            {live.area ? <span className="truncate">· {live.area}</span> : null}
          </span>
        </div>
      )}
      <div
        ref={containerRef}
        // `relative z-0 isolate` contains Leaflet's internal z-indexes (panes/
        // controls go up to 1000) inside this box's own stacking context, so the
        // map can't paint over the sticky header/footer when scrolling.
        className="relative z-0 isolate h-[24rem] w-full overflow-hidden rounded-2xl border border-border shadow-sm ring-1 ring-black/5"
      />
    </div>
  );
}
