'use client';
import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import type * as LeafletNS from 'leaflet';
import { Navigation, MapPin, Gauge } from 'lucide-react';
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

const TILE_URL = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
// Below this, treat the fix as jitter (bus stationary) — don't rotate or speed.
const MOVE_MIN_M = 8;
// Re-fetch the area label only after the bus has moved this far.
const AREA_MIN_M = 150;

export interface SimpleStop {
  name: string;
  lat: number;
  lng: number;
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
          speed = 0;
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

      // Auto-follow (navigation view).
      m.panTo(pos, { animate: true, duration: 0.5 });
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
      const m = L.map(containerRef.current, { attributionControl: false });
      mapRef.current = m;
      L.tileLayer(TILE_URL, { subdomains: 'abcd', maxZoom: 20 }).addTo(m);
      // Light route context — small dots for the pickup stops.
      stops.forEach((s) =>
        L.circleMarker([s.lat, s.lng], {
          radius: 5,
          color: '#6d5efc',
          weight: 2,
          fillColor: '#ffffff',
          fillOpacity: 1,
        })
          .addTo(m)
          .bindTooltip(escapeHtml(s.name), { direction: 'top' }),
      );
      m.setView(stops[0] ? [stops[0].lat, stops[0].lng] : DEFAULT_MAP_CENTER, 13);
      setTimeout(() => m.invalidateSize(), 0);

      if (!document.hidden) startWatch();
      document.addEventListener('visibilitychange', onVisibility);
    })();

    return () => {
      cancelled = true;
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
