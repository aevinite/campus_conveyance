'use client';
import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';
import type * as LeafletNS from 'leaflet';

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

export default function RouteStopsMap({ stops }: { stops: MapStop[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletNS.Map | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
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
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [stops]);

  return (
    <div
      ref={containerRef}
      // `relative z-0 isolate` contains Leaflet's internal z-indexes (panes/
      // controls go up to 1000) inside this box's own stacking context, so the
      // map can't paint over the sticky header/footer when scrolling.
      className="relative z-0 isolate h-[24rem] w-full overflow-hidden rounded-2xl border border-border shadow-sm ring-1 ring-black/5"
    />
  );
}
