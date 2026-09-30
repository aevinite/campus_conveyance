'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import { MapPin, X } from 'lucide-react';
import type * as LeafletNS from 'leaflet';
import {
  animateMarkerTo,
  bearingDeg,
  busDivIcon,
  haversineMeters,
  toKmh,
  DEFAULT_MAP_CENTER,
  type LatLng,
} from '@/lib/bus-marker';
import { escapeHtml } from '@/lib/escape-html';
import { TILE_URL, TILE_OPTIONS } from '@/lib/map-tiles';
import { enableWebMouseExplore, webMapOptions } from '@/lib/map-interaction';
import { drawRouteLine } from '@/lib/route-line';

export interface MapStop {
  name: string;
  lat: number | null;
  lng: number | null;
  description?: string | null;
  address?: string | null;
}

// How often to poll for the live bus position (balanced freshness vs. load).
const LIVE_POLL_MS = 5000;
// Below this, a new fix is treated as GPS jitter (bus stationary): don't rotate
// the icon or report speed.
const MOVE_MIN_M = 8;
// Re-fetch the area label only after the bus has moved this far.
const AREA_MIN_M = 150;
// A computed speed above this (~130 km/h) is a GPS jump, not real motion.
const MAX_PLAUSIBLE_MPS = 36;
// Refresh the rider's pickup progress (skips / boarded / passed) every Nth poll
// (~30s) rather than on every 5s location poll.
const PROGRESS_EVERY = 6;
// Client fallback for "bus passed the stop" when the driver doesn't update route
// progress: it came within ARRIVED_M of the stop and is now PASSED_M+ away.
const ARRIVED_M = 150;
const PASSED_M = 500;

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
  /** When the driver's fix was recorded (ISO). */
  updatedAt?: string | null;
  busNumber?: string | null;
  /** Rider's effective pickup + today's progress (only on `progress=1` polls;
   *  null = caller isn't a rider on this route). */
  pickup?: PickupProgress | null;
}

interface PickupProgress {
  name: string;
  lat: number | null;
  lng: number | null;
  /** WAITING | ON_BOARD | DONE | PASSED | NO_STOP */
  state: string;
}

interface LiveState {
  busNumber?: string | null;
  speedKmh: number | null;
  area: string | null;
  stopped: boolean;
  /** Estimated minutes until the bus reaches the rider's pickup stop (null when
   *  unknown — e.g. stationary or no pickup stop). */
  etaMin: number | null;
  /** Straight-line metres from the bus to the rider's pickup stop (null if no stop). */
  distM: number | null;
  /** Pickup progress: WAITING | ON_BOARD | DONE | PASSED | NO_STOP (null = unknown). */
  pickupState: string | null;
}

/**
 * Route map. With `tapToShow` (the native app's student/parent screens) the map
 * starts collapsed behind a "Show map" card and only mounts once tapped: an
 * inline map there caught the finger mid page-scroll and panned instead of
 * scrolling. Collapsed = no Leaflet and no live polling. The website never sets
 * it, so it keeps the map inline as before.
 */
export default function RouteStopsMap({
  tapToShow = false,
  ...props
}: RouteStopsMapProps & {
  /** Start collapsed behind a "Show map" button (app only). */
  tapToShow?: boolean;
}) {
  const [open, setOpen] = useState(!tapToShow);
  if (!open) {
    const live = !!props.liveRouteId;
    const n = props.stops.filter((s) => typeof s.lat === 'number' && typeof s.lng === 'number').length;
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-3.5 text-left shadow-xs transition active:scale-[0.99]"
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
          <MapPin className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{live ? 'Live bus location' : 'Stops on map'}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {live ? 'Tap to see where the bus is' : `${n} pickup stop${n === 1 ? '' : 's'} · tap to view`}
          </span>
        </span>
        <span className="shrink-0 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">
          Show map
        </span>
      </button>
    );
  }
  if (!tapToShow) return <RouteStopsMapView {...props} />;
  return (
    <div className="relative">
      <RouteStopsMapView {...props} />
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="absolute bottom-3 right-3 z-[1000] inline-flex items-center gap-1 rounded-full border border-border bg-background/90 px-3 py-1.5 text-xs font-semibold text-foreground shadow-sm backdrop-blur-sm"
      >
        <X className="size-3.5" /> Hide map
      </button>
    </div>
  );
}

interface RouteStopsMapProps {
  stops: MapStop[];
  /** When set, poll for and show this route's live bus position. */
  liveRouteId?: string;
  /** The viewing rider's own pickup stop — enables the "N min away" ETA badge. */
  pickupStop?: { lat: number; lng: number; name: string } | null;
  /** Tailwind height class for the map box (e.g. a taller map on the home page). */
  heightClass?: string;
}

function RouteStopsMapView({
  stops,
  liveRouteId,
  pickupStop,
  heightClass = 'h-[24rem]',
}: RouteStopsMapProps) {
  // Read the latest pickup stop from a ref so the poll effect (keyed on
  // liveRouteId) never has to re-subscribe when the prop object identity changes.
  const pickupRef = useRef(pickupStop);
  // Keep the latest pickup stop in a ref the interval poll reads, so the poll
  // effect (keyed on liveRouteId) never re-subscribes on a prop identity change.
  // eslint-disable-next-line react-hooks/refs
  pickupRef.current = pickupStop;
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
  // Server-side pickup progress (undefined = not fetched yet) + the client-side
  // "came close, now moving away" fallback for the same target stop.
  const progressRef = useRef<PickupProgress | null | undefined>(undefined);
  const closestRef = useRef<{ key: string; minD: number; passed: boolean } | null>(null);
  const [live, setLive] = useState<LiveState | null>(null);

  // Rebuild the Leaflet map only when the stops' CONTENT changes, not when the
  // parent hands us a fresh array reference (parent/page.tsx passes `?? []`).
  // Keying the init effect on a stable signature avoids a needless teardown that
  // would drop the live bus marker / flicker the map.
  const stopsSig = useMemo(
    () => stops.map((s) => `${s.name}|${s.lat}|${s.lng}`).join('~'),
    [stops],
  );

  useEffect(() => {
    let cancelled = false;
    let cleanupMouse: (() => void) | null = null;
    (async () => {
      const L = (await import('leaflet')).default;
      leafletRef.current = L;
      if (cancelled || !containerRef.current || mapRef.current) return;
      const pts = stops.filter(
        (s): s is MapStop & { lat: number; lng: number } =>
          typeof s.lat === 'number' && typeof s.lng === 'number',
      );
      const m = L.map(containerRef.current, {
        attributionControl: false,
        scrollWheelZoom: false,
        ...webMapOptions(),
      });
      mapRef.current = m;
      // Website: drag to pan, click/Ctrl + scroll to zoom (no-op in the app).
      cleanupMouse = enableWebMouseExplore(m);
      centeredOnBus.current = false; // fresh map — allow the next fix to recenter
      L.tileLayer(TILE_URL, TILE_OPTIONS).addTo(m);
      // Blue line tracing this bus's whole route, stop to stop.
      drawRouteLine(L, m, pts);
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
          .bindTooltip(`${i + 1}. ${escapeHtml(s.name)}`, { direction: 'top' })
          .bindPopup(popup);
      });
      if (pts.length === 1) {
        m.setView([pts[0].lat, pts[0].lng], 15);
      } else if (pts.length > 1) {
        m.fitBounds(L.latLngBounds(pts.map((s) => [s.lat, s.lng] as [number, number])).pad(0.3));
      } else {
        m.setView(DEFAULT_MAP_CENTER, 11);
      }
      setTimeout(() => m.invalidateSize(), 0);
    })();
    return () => {
      cancelled = true;
      cleanupMouse?.();
      animCancel.current?.();
      busMarkerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // Keyed on the content signature, not the array identity (see stopsSig).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopsSig]);

  // Poll the live bus position and reflect it with a moving, rotating marker that
  // shows speed + current area. The poll PAUSES while the tab is hidden
  // (backgrounded/forgotten tabs would otherwise fetch forever, so server load
  // scaled with open tabs — and the parent dashboard renders one per child trip).
  // It resumes and refreshes immediately when the tab becomes visible again.
  useEffect(() => {
    if (!liveRouteId) return;
    let stopped = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    // Skip a tick while the previous /api/bus-location request is still in
    // flight. Without this, a response that stalls >LIVE_POLL_MS lets the next
    // tick start and the two can resolve out of order — each overwrites
    // prevBusPos/prevBusTime, producing negative dt, a garbage bearing and a
    // backwards marker animation.
    let inFlight = false;
    // Tolerate a single stale/`live:false` poll before tearing the marker down —
    // a lone blip (e.g. a GPS write crossing the 2-min freshness boundary) would
    // otherwise remove + re-center the bus and flicker on the very next poll.
    let missedPolls = 0;
    const STALE_MISSES = 2;
    // Abort any in-flight polls on unmount / route change so they don't resolve
    // against a torn-down map (the `stopped` flag guards state, but the requests
    // themselves would otherwise still complete).
    const ac = new AbortController();
    // Monotonic guard: only the latest fetchArea may write the label, so a slow
    // older response can't clobber a newer area.
    let areaSeq = 0;

    async function fetchArea(p: LatLng) {
      const seq = ++areaSeq;
      try {
        const r = await fetch(`/api/reverse-geocode?lat=${p[0]}&lng=${p[1]}`, {
          cache: 'no-store',
          signal: ac.signal,
        });
        const j = (await r.json()) as { area: string | null };
        if (stopped || seq !== areaSeq) return; // superseded by a newer request
        areaRef.current = j.area ?? areaRef.current;
        setLive((prev) => (prev ? { ...prev, area: areaRef.current } : prev));
      } catch {
        // keep the previous label
      }
    }

    // Remove the live marker and reset all derived-motion state. Shared by the
    // "gone stale" path, the persistent-error path, and the effect cleanup so a
    // route change / offline bus never leaves a frozen marker or carries stale
    // heading/speed into the next route.
    function teardownMarker() {
      animCancel.current?.();
      const m = mapRef.current;
      if (busMarkerRef.current && m) m.removeLayer(busMarkerRef.current);
      busMarkerRef.current = null;
      prevBusPos.current = null;
      speedRef.current = null;
      headingRef.current = null;
      centeredOnBus.current = false;
      progressRef.current = undefined;
      closestRef.current = null;
    }

    // Distance + ETA from the current bus fix to the viewing rider's pickup stop.
    // ETA needs a real speed (m/s); while stopped we only know the distance.
    // The target is the server's EFFECTIVE pickup (honours today's skips) when
    // known, else the page-supplied stop. Once the bus has been to that stop
    // (boarded / passed / trip done), the ETA is dropped in favour of a status.
    function pickupEta(pos: LatLng): Pick<LiveState, 'etaMin' | 'distM' | 'pickupState'> {
      const prog = progressRef.current;
      const p =
        prog && prog.lat != null && prog.lng != null
          ? { lat: prog.lat, lng: prog.lng }
          : prog === undefined
            ? pickupRef.current
            : null;
      const serverState = prog?.state ?? null;
      if (!p) return { etaMin: null, distM: null, pickupState: serverState };
      const d = haversineMeters(pos, [p.lat, p.lng]);
      // Client fallback: closest approach so far to THIS target stop.
      const key = `${p.lat},${p.lng}`;
      const c =
        closestRef.current?.key === key
          ? closestRef.current
          : (closestRef.current = { key, minD: d, passed: false });
      c.minD = Math.min(c.minD, d);
      if (c.minD <= ARRIVED_M && d >= PASSED_M) c.passed = true;
      const pickupState =
        serverState && serverState !== 'WAITING' ? serverState : c.passed ? 'PASSED' : serverState;
      const spd = speedRef.current; // metres/second (smoothed)
      const etaMin = spd && spd > 0.7 ? Math.max(1, Math.ceil(d / spd / 60)) : null;
      return { etaMin, distM: d, pickupState };
    }
    let pollCount = 0;

    async function tick() {
      // Skip until the async Leaflet import + map init finished — otherwise the
      // first tick fetches a fix we can't render yet (wasted poll). Self-resumes.
      if (!leafletRef.current || !mapRef.current) return;
      if (inFlight) return; // don't overlap with a still-pending poll
      inFlight = true;
      try {
        // Ask for pickup progress on the first live poll and then every ~30s.
        const wantProgress = progressRef.current === undefined || pollCount % PROGRESS_EVERY === 0;
        pollCount++;
        const res = await fetch(`/api/bus-location?routeId=${liveRouteId}${wantProgress ? '&progress=1' : ''}`, {
          cache: 'no-store',
          signal: ac.signal,
        });
        // A 429 (per-caller cap) is NOT a "bus offline" signal — bail without
        // touching missedPolls so a transient cap breach (parent tracking several
        // routes + tab churn) can't remove a marker for a bus still streaming.
        // A persistent NON-429 error (e.g. 5xx), however, must NOT freeze a stale
        // marker forever — count it like a missed poll so the bus is eventually
        // removed if the endpoint stays down.
        if (!res.ok) {
          if (res.status === 429) return;
          if (++missedPolls >= STALE_MISSES) {
            teardownMarker();
            setLive(null);
          }
          return;
        }
        const data = (await res.json()) as LiveResponse;
        if (stopped) return;
        const L = leafletRef.current;
        const m = mapRef.current;
        if (data.live && data.lat != null && data.lng != null && L && m) {
          missedPolls = 0; // fresh fix — reset the tolerance counter
          if (data.pickup !== undefined) progressRef.current = data.pickup;
          const pos: LatLng = [data.lat, data.lng];
          // Time of the driver's FIX, not of this poll. We poll faster than the
          // driver pings, so the same fix often comes back twice: using poll time
          // showed "Stopped" for the repeat and then doubled the speed on the next
          // real fix. A repeated fix is simply ignored (state kept as it was).
          const fixMs = data.updatedAt ? Date.parse(data.updatedAt) : NaN;
          const now = Number.isFinite(fixMs) ? fixMs : Date.now();
          if (busMarkerRef.current && Number.isFinite(fixMs) && fixMs <= prevBusTime.current) return;
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
            setLive({ busNumber: data.busNumber, speedKmh: null, area: areaRef.current, stopped: true, ...pickupEta(pos) });
          } else {
            const prev = prevBusPos.current!;
            const dist = haversineMeters(prev, pos);
            const dt = (now - prevBusTime.current) / 1000;
            if (dist >= MOVE_MIN_M) {
              const hdg = bearingDeg(prev, pos);
              headingRef.current = hdg;
              const inst = dt > 0 ? dist / dt : 0; // m/s
              // Ignore an implausible jump for the speed estimate (keep the last one).
              if (inst <= MAX_PLAUSIBLE_MPS) {
                speedRef.current = speedRef.current == null ? inst : speedRef.current * 0.6 + inst * 0.4;
              }
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
                ...pickupEta(pos),
              });
            } else {
              // Stationary: snap to correct drift, report stopped. Cancel any
              // in-flight glide first, else its next frame overrides the snap
              // back toward the old target (brief marker jitter).
              speedRef.current = 0;
              animCancel.current?.();
              busMarkerRef.current.setLatLng(pos);
              setLive({ busNumber: data.busNumber, speedKmh: 0, area: areaRef.current, stopped: true, ...pickupEta(pos) });
            }
            prevBusPos.current = pos;
            prevBusTime.current = now;
          }
        } else if (++missedPolls >= STALE_MISSES) {
          // Genuinely not live (driver offline / fix gone stale) — remove after a
          // couple of consecutive misses, not a single blip.
          teardownMarker();
          setLive(null);
        }
      } catch {
        // Transient network error — try again on the next tick.
      } finally {
        inFlight = false;
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
      ac.abort();
      // Drop the old route's marker + motion state so a liveRouteId change (map
      // NOT rebuilt, since it's keyed on stopsSig) doesn't leave the previous
      // bus on screen or feed its last position into the new route's bearing.
      teardownMarker();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [liveRouteId]);

  const speedLabel = live?.stopped ? 'Stopped' : `${Math.round(live?.speedKmh ?? 0)} km/h`;

  // Once the bus has been to the rider's stop the countdown is replaced:
  // "On board" / "Bus passed your stop"; hidden when the trip is done or the stop
  // (and every later one) is skipped. Otherwise "N min away" (moving, ETA known) /
  // "Arriving now" (within ~150 m) / distance.
  const etaLabel =
    live?.pickupState === 'ON_BOARD'
      ? 'On board'
      : live?.pickupState === 'PASSED'
        ? 'Bus passed your stop'
        : live?.pickupState === 'DONE' || live?.pickupState === 'NO_STOP'
          ? null
          : live?.distM == null
            ? null
            : live.distM <= ARRIVED_M
              ? 'Arriving now'
              : live.etaMin != null
                ? `~${live.etaMin} min away`
                : `${(live.distM / 1000).toFixed(1)} km away`;

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
          {etaLabel && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/15 px-2.5 py-1 text-xs font-semibold text-primary shadow-sm backdrop-blur-sm">
              {etaLabel}
            </span>
          )}
        </div>
      )}
      <div
        ref={containerRef}
        // `relative z-0 isolate` contains Leaflet's internal z-indexes (panes/
        // controls go up to 1000) inside this box's own stacking context, so the
        // map can't paint over the sticky header/footer when scrolling.
        className={`relative z-0 isolate ${heightClass} w-full overflow-hidden rounded-2xl border border-border shadow-sm ring-1 ring-black/5`}
      />
    </div>
  );
}
