'use client';
import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import type * as LeafletNS from 'leaflet';
import { Navigation, MapPin, Gauge, LocateFixed } from 'lucide-react';
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
import { cn } from '@/lib/utils';
import { TILE_URL, TILE_OPTIONS } from '@/lib/map-tiles';
import { enableWebMouseExplore, webMapOptions } from '@/lib/map-interaction';
import { isNativeApp } from '@/lib/native-google-auth';
import { drawRouteLine, pickupPin } from '@/lib/route-line';

// Below this, treat the fix as jitter (bus stationary) — don't rotate or speed.
const MOVE_MIN_M = 8;
// Re-fetch the area label only after the bus has moved this far.
const AREA_MIN_M = 150;

export interface SimpleStop {
  name: string;
  lat: number;
  lng: number;
  /** Which route the stop belongs to — one blue line is drawn per route. */
  routeId?: string;
  /** route_stops.sequence — the pin number, so a stop without a location (not
   *  passed here) leaves a gap instead of renumbering the stops after it. */
  sequence?: number | null;
}

/**
 * Navigation-style live map for the DRIVER, fed by the phone's own GPS (no
 * server round-trip — it's the driver's device). The map auto-follows the bus,
 * the icon rotates to the heading, and speed + current area are shown live.
 */
export function DriverLiveMap({
  stops,
  heightClass = 'h-[72vh]',
  bleed = false,
}: {
  stops: SimpleStop[];
  /** Map height (bigger + full-bleed in the native app). */
  heightClass?: string;
  /** Full-width edge-to-edge map (drops side border + rounding) for the app. */
  bleed?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletNS.Map | null>(null);
  const leafletRef = useRef<typeof import('leaflet') | null>(null);
  const markerRef = useRef<LeafletNS.Marker | null>(null);
  const animCancel = useRef<(() => void) | null>(null);
  const prevPos = useRef<LatLng | null>(null);
  const prevTime = useRef(0);
  const headingRef = useRef<number | null>(null);
  const areaRef = useRef<string | null>(null);
  const lastAreaPos = useRef<LatLng | null>(null);
  const watchId = useRef<number | null>(null);
  // Auto-follow the bus. On the website, dragging the map pauses it so the
  // driver can look around; "Re-center" resumes. The app always follows.
  const followRef = useRef(true);
  const [following, setFollowing] = useState(true);

  const [status, setStatus] = useState<'locating' | 'live' | 'denied' | 'error'>(
    'locating',
  );
  const [readout, setReadout] = useState<{
    speedKmh: number | null;
    area: string | null;
    stopped: boolean;
  }>({ speedKmh: null, area: null, stopped: true });

  useEffect(() => {
    let cancelled = false;
    let cleanupMouse: (() => void) | null = null;
    // Abort in-flight area lookups on unmount so they don't resolve late.
    const ac = new AbortController();
    // Only the latest fetchArea may write the label (drop stale late responses).
    let areaSeq = 0;

    async function fetchArea(p: LatLng) {
      const seq = ++areaSeq;
      try {
        const r = await fetch(`/api/reverse-geocode?lat=${p[0]}&lng=${p[1]}`, {
          cache: 'no-store',
          signal: ac.signal,
        });
        const j = (await r.json()) as { area: string | null };
        if (cancelled || seq !== areaSeq) return;
        areaRef.current = j.area ?? areaRef.current;
        setReadout((prev) => ({ ...prev, area: areaRef.current }));
      } catch {
        // ignore — keep the previous label
      }
    }

    function onPosition(p: GeolocationPosition) {
      const L = leafletRef.current;
      const m = mapRef.current;
      if (cancelled || !L || !m) return;
      const pos: LatLng = [p.coords.latitude, p.coords.longitude];
      const now = Date.now();
      let heading =
        p.coords.heading != null && !Number.isNaN(p.coords.heading)
          ? p.coords.heading
          : headingRef.current;
      let speed = toKmh(p.coords.speed); // native km/h, or null

      if (markerRef.current) {
        const prev = prevPos.current!;
        const dist = haversineMeters(prev, pos);
        const dt = (now - prevTime.current) / 1000;
        if (dist >= MOVE_MIN_M) {
          if (p.coords.heading == null || Number.isNaN(p.coords.heading)) {
            heading = bearingDeg(prev, pos);
          }
          if (speed == null && dt > 0) speed = (dist / dt) * 3.6;
          animCancel.current?.();
          animCancel.current = animateMarkerTo(
            markerRef.current,
            pos,
            Math.min(Math.max(dt * 1000, 500), 4000),
          );
        } else {
          // Cancel any in-flight glide before snapping, else its next frame
          // overrides the snap back toward the old target (brief jitter).
          speed = 0;
          animCancel.current?.();
          markerRef.current.setLatLng(pos);
        }
        headingRef.current = heading;
        markerRef.current.setIcon(busDivIcon(L, heading));
      } else {
        markerRef.current = L.marker(pos, {
          icon: busDivIcon(L, heading),
          zIndexOffset: 1000,
        }).addTo(m);
        headingRef.current = heading;
        lastAreaPos.current = pos;
        m.setView(pos, 16);
        void fetchArea(pos);
      }

      // Auto-follow (navigation view), unless the user is exploring the map.
      if (followRef.current) m.panTo(pos, { animate: true, duration: 0.5 });
      if (
        !lastAreaPos.current ||
        haversineMeters(lastAreaPos.current, pos) >= AREA_MIN_M
      ) {
        lastAreaPos.current = pos;
        void fetchArea(pos);
      }
      prevPos.current = pos;
      prevTime.current = now;
      setStatus('live');
      setReadout({
        speedKmh: speed,
        area: areaRef.current,
        stopped: !speed || speed < 3,
      });
    }

    function startWatch() {
      if (watchId.current != null) return;
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        setStatus('error');
        return;
      }
      watchId.current = navigator.geolocation.watchPosition(
        onPosition,
        (err) => {
          if (cancelled) return;
          setStatus(err.code === err.PERMISSION_DENIED ? 'denied' : 'error');
        },
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
      );
    }
    function stopWatch() {
      if (watchId.current != null && typeof navigator !== 'undefined') {
        navigator.geolocation.clearWatch(watchId.current);
        watchId.current = null;
      }
    }
    // Pause GPS + area lookups while the tab is hidden — this map is DISPLAY
    // only (the driver-tracker in the layout keeps sending the real position),
    // so a backgrounded tab shouldn't keep draining the phone's GPS/battery.
    function onVisibility() {
      if (document.hidden) stopWatch();
      else startWatch();
    }

    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !containerRef.current || mapRef.current) return;
      leafletRef.current = L;
      const m = L.map(containerRef.current, { attributionControl: false, ...webMapOptions() });
      mapRef.current = m;
      if (!isNativeApp()) {
        cleanupMouse = enableWebMouseExplore(m);
        m.on('dragstart', () => {
          followRef.current = false;
          setFollowing(false);
        });
      }
      L.tileLayer(TILE_URL, TILE_OPTIONS).addTo(m);
      const byRoute = new Map<string, SimpleStop[]>();
      stops.forEach((s) => {
        const k = s.routeId ?? '';
        byRoute.set(k, [...(byRoute.get(k) ?? []), s]);
      });
      // Per route: pickup-order blue line + numbered pickup pins (1, 2, 3 …).
      byRoute.forEach((rs) => {
        drawRouteLine(L, m, rs);
        rs.forEach((s, i) => {
          const n = s.sequence ?? i + 1;
          L.marker([s.lat, s.lng], { icon: pickupPin(L, n) })
            .addTo(m)
            .bindTooltip(`${n}. ${escapeHtml(s.name)}`, { direction: 'top' });
        });
      });
      m.setView(stops[0] ? [stops[0].lat, stops[0].lng] : DEFAULT_MAP_CENTER, 13);
      setTimeout(() => m.invalidateSize(), 0);

      if (!document.hidden) startWatch();
      document.addEventListener('visibilitychange', onVisibility);
    })();

    return () => {
      cancelled = true;
      cleanupMouse?.();
      stopWatch();
      ac.abort();
      document.removeEventListener('visibilitychange', onVisibility);
      animCancel.current?.();
      markerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function recenter() {
    followRef.current = true;
    setFollowing(true);
    const pos = markerRef.current?.getLatLng();
    if (pos) mapRef.current?.panTo(pos, { animate: true, duration: 0.5 });
  }

  const speedLabel = readout.stopped
    ? 'Stopped'
    : `${Math.round(readout.speedKmh ?? 0)} km/h`;

  return (
    <div className="relative">
      {/* Live readout: speed + current area */}
      {status === 'live' && (
        <div className="pointer-events-none absolute top-3 left-3 z-[1000] flex flex-col gap-1.5">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/15 px-2.5 py-1 text-xs font-semibold text-success shadow-sm backdrop-blur-sm">
            <Gauge className="size-3.5" /> {speedLabel}
          </span>
          {readout.area && (
            <span className="inline-flex max-w-[70vw] items-center gap-1.5 rounded-full border border-border bg-background/80 px-2.5 py-1 text-xs font-medium text-foreground shadow-sm backdrop-blur-sm">
              <MapPin className="size-3.5 text-primary" />
              <span className="truncate">{readout.area}</span>
            </span>
          )}
        </div>
      )}

      {(status === 'locating' || status === 'denied' || status === 'error') && (
        <div className="pointer-events-none absolute inset-x-0 top-3 z-[1000] flex justify-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-background/90 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur-sm">
            <Navigation className="size-3.5" />
            {status === 'locating' && 'Getting your location…'}
            {status === 'denied' &&
              'Location blocked — enable it (and use HTTPS/localhost) to see your position.'}
            {status === 'error' && 'Location isn’t available on this device.'}
          </span>
        </div>
      )}

      {!following && status === 'live' && (
        <button
          type="button"
          onClick={recenter}
          className="absolute right-3 bottom-3 z-[1000] inline-flex items-center gap-1.5 rounded-full border border-border bg-background/95 px-3 py-1.5 text-xs font-semibold text-foreground shadow-md backdrop-blur-sm transition-colors hover:bg-muted"
        >
          <LocateFixed className="size-3.5 text-primary" /> Re-center
        </button>
      )}

      <div
        ref={containerRef}
        className={cn(
          'relative z-0 isolate w-full overflow-hidden border-border shadow-sm ring-1 ring-black/5',
          bleed ? 'border-y' : 'rounded-2xl border',
          heightClass,
        )}
      />
    </div>
  );
}
