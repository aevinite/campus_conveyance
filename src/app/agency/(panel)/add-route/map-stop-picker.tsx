'use client';
import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import type * as LeafletNS from 'leaflet';
import { LocateFixed, MapPin, Search, X } from 'lucide-react';

export interface Stop {
  name: string;
  description: string;
  lat: number;
  lng: number;
  address: string | null;
}

interface Suggestion {
  primary: string;
  full: string;
  lat: number;
  lng: number;
}

// Clean, professional light basemap (CARTO Positron) — always light, no key.
const TILE_URL = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';

// Custom numbered teardrop pin in the brand colour — far nicer than the default.
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

const inputCls =
  'flex h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm shadow-2xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 dark:bg-input/30';

export default function MapStopPicker({
  value,
  onChange,
}: {
  value: Stop[];
  onChange: (stops: Stop[]) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const searchWrapRef = useRef<HTMLDivElement>(null);
  const LRef = useRef<typeof import('leaflet') | null>(null);
  const mapRef = useRef<LeafletNS.Map | null>(null);
  const layerRef = useRef<LeafletNS.LayerGroup | null>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  valueRef.current = value;
  onChangeRef.current = onChange;

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);

  function addStop(lat: number, lng: number, name?: string, address?: string | null) {
    const cur = valueRef.current;
    onChangeRef.current([
      ...cur,
      { name: name || `Stop ${cur.length + 1}`, description: '', lat, lng, address: address ?? null },
    ]);
  }

  function redraw() {
    const L = LRef.current;
    const layer = layerRef.current;
    if (!L || !layer) return;
    layer.clearLayers();
    valueRef.current.forEach((s, i) => {
      L.marker([s.lat, s.lng], { icon: numberedPin(L, i + 1) })
        .addTo(layer)
        .bindTooltip(`${i + 1}. ${s.name}`, { direction: 'top' });
    });
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !containerRef.current || mapRef.current) return;
      LRef.current = L;
      const m = L.map(containerRef.current, {
        zoomControl: true,
        attributionControl: false,
        scrollWheelZoom: false, // page scroll shouldn't zoom; use pinch or the +/- buttons
      }).setView([23.0225, 72.5714], 12);
      L.tileLayer(TILE_URL, { subdomains: 'abcd', maxZoom: 20 }).addTo(m);
      layerRef.current = L.layerGroup().addTo(m);
      mapRef.current = m;
      // Click-to-drop: the copy has always promised this, but the handler was
      // missing — so if address search returned nothing, an agency had no way to
      // place a stop and could not create the route at all. Reads from refs, so
      // it stays correct as the stop list changes without re-binding.
      m.on('click', (e: LeafletNS.LeafletMouseEvent) => {
        addStop(e.latlng.lat, e.latlng.lng);
      });
      setTimeout(() => m.invalidateSize(), 0);
      redraw();
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // Redraw markers only when the marker-affecting data changes (positions +
  // count) — NOT on every `value` change. Editing a stop's name/description
  // produces a new value array each keystroke, which was clearing and re-adding
  // all markers on every character. redraw() still reads the latest names via
  // valueRef, so tooltips stay correct the next time a marker actually moves.
  const markerSig = value.map((s) => `${s.lat},${s.lng}`).join('|');
  useEffect(() => {
    redraw();
  }, [markerSig]);

  // Debounced autocomplete via our server proxy (reliable + India-biased).
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    setOpen(true);
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        // Bias to the map's current centre so nearby places rank first.
        const c = mapRef.current?.getCenter();
        const bias = c ? `&lat=${c.lat}&lon=${c.lng}` : '';
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}${bias}`);
        const data = (await res.json()) as Suggestion[];
        setResults(Array.isArray(data) ? data : []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  function useMyLocation() {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        mapRef.current?.setView([pos.coords.latitude, pos.coords.longitude], 15);
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  // Close the suggestions dropdown when clicking outside the search box.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (searchWrapRef.current && !searchWrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function pick(r: Suggestion) {
    mapRef.current?.setView([r.lat, r.lng], 16);
    addStop(r.lat, r.lng, r.primary, r.full);
    setQuery('');
    setResults([]);
    setOpen(false);
  }

  function rename(i: number, name: string) {
    onChange(value.map((s, idx) => (idx === i ? { ...s, name } : s)));
  }
  function describe(i: number, description: string) {
    onChange(value.map((s, idx) => (idx === i ? { ...s, description } : s)));
  }
  function remove(i: number) {
    onChange(value.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-3">
      <div ref={searchWrapRef} className="relative">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => results.length > 0 && setOpen(true)}
              placeholder="Search a nearby area, e.g. Prahlad Nagar"
              className={`${inputCls} pl-9`}
            />
            {searching && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">…</span>
            )}
          </div>
          <button
            type="button"
            onClick={useMyLocation}
            disabled={locating}
            title="Center the map on my location so nearby places show first"
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-input bg-transparent px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50 dark:bg-input/30"
          >
            <LocateFixed className="size-4" />
            <span className="hidden sm:inline">{locating ? 'Locating…' : 'My location'}</span>
          </button>
        </div>
        {open && query.trim().length >= 2 && (
          <div className="absolute left-0 right-0 top-full z-[1000] mt-1 max-h-72 overflow-y-auto rounded-lg border border-border bg-popover text-popover-foreground shadow-lg">
            {searching && (
              <p className="px-3 py-3 text-sm text-muted-foreground">Searching…</p>
            )}
            {!searching && results.length === 0 && (
              <p className="px-3 py-3 text-sm text-muted-foreground">
                No matches. Try adding the city, or click the map to drop a stop.
              </p>
            )}
            {results.map((r, i) => (
              <button
                key={i}
                type="button"
                onClick={() => pick(r)}
                className="flex w-full items-start gap-2.5 border-b border-border/60 px-3 py-2.5 text-left transition-colors last:border-0 hover:bg-muted"
              >
                <MapPin className="mt-0.5 size-4 shrink-0 text-primary" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{r.primary}</span>
                  <span className="block text-xs leading-snug text-muted-foreground">{r.full}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div
        ref={containerRef}
        className="h-[28rem] w-full overflow-hidden rounded-2xl border border-border shadow-sm ring-1 ring-black/5"
      />
      <p className="text-xs text-muted-foreground">
        Search a place to add a pickup stop — results near the map&apos;s current area show first. Use “My location”
        or pan/zoom the map to your city for better matches. Each result shows the area, PIN &amp; state so you can
        confirm the exact spot.
      </p>

      {value.length === 0 ? (
        <p className="text-sm text-muted-foreground">No pickup stops added yet.</p>
      ) : (
        <ol className="space-y-2">
          {value.map((s, i) => {
            const missingDesc = s.description.trim().length === 0;
            return (
              <li key={i} className="space-y-2 rounded-lg border border-border p-2.5">
                <div className="flex items-center gap-2">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                    {i + 1}
                  </span>
                  <input
                    value={s.name}
                    onChange={(e) => rename(i, e.target.value)}
                    className="flex-1 bg-transparent text-sm font-medium outline-none"
                    aria-label={`Stop ${i + 1} name`}
                    placeholder="Stop name (e.g. Prahlad Nagar)"
                  />
                  <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                    {s.lat.toFixed(4)}, {s.lng.toFixed(4)}
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    aria-label={`Remove stop ${i + 1}`}
                    className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <X className="size-4" />
                  </button>
                </div>
                {s.address && <p className="pl-8 text-xs text-muted-foreground">{s.address}</p>}
                <input
                  value={s.description}
                  onChange={(e) => describe(i, e.target.value)}
                  className={`${inputCls} ${missingDesc ? 'border-warning' : ''}`}
                  aria-label={`Stop ${i + 1} description`}
                  placeholder="Exact spot — e.g. at the crossroad near the petrol pump (required)"
                />
                {missingDesc && (
                  <p className="text-xs text-warning">Describe the exact pickup spot — this is required.</p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
