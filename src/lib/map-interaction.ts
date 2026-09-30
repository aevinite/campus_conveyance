import type * as LeafletNS from 'leaflet';
import { isNativeApp } from '@/lib/native-google-auth';

/**
 * WEBSITE-ONLY mouse exploration for every Leaflet map (student/parent route
 * map, driver live map, agency stop picker). The native app is left exactly as
 * it was: both helpers are no-ops when running inside the APK.
 *
 * The problem with a plain scroll-wheel zoom on a web page is that the map
 * "catches" the page scroll: a user scrolling down past the map suddenly zooms
 * it instead. So here the wheel scrolls the page until the user has shown they
 * want the map:
 *   • drag to pan: always works (grab / grabbing cursor)
 *   • click or drag the map, then scroll: zooms around the cursor, until the
 *     pointer leaves the map
 *   • Ctrl/⌘ + scroll (and trackpad pinch, which the browser sends as
 *     Ctrl + wheel): zooms straight away, never zooms the browser page
 *   • double-click zooms in, +/- buttons and the keyboard (arrows, +/-) also work
 * A plain scroll over an inactive map shows a short hint instead of doing
 * nothing silently.
 */

/** Extra `L.map` options for the website (smoother, finer wheel zoom). `{}` in the app. */
export function webMapOptions(): LeafletNS.MapOptions {
  if (isNativeApp()) return {};
  return {
    scrollWheelZoom: false, // turned on per-interaction by enableWebMouseExplore
    zoomSnap: 0.5,
    wheelPxPerZoomLevel: 110,
    wheelDebounceTime: 30,
    doubleClickZoom: true,
    keyboard: true,
    dragging: true,
  };
}

/**
 * Wires up the website mouse behaviour described above. Returns a cleanup
 * function (a no-op in the app). Map listeners go away on `map.remove()`; the
 * DOM listeners are removed by the returned cleanup.
 */
export function enableWebMouseExplore(map: LeafletNS.Map, hintText?: string): () => void {
  if (isNativeApp()) return () => {};
  const el = map.getContainer();
  el.classList.add('cc-web-map');

  const hint = document.createElement('div');
  hint.className = 'cc-map-hint';
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  hint.textContent =
    hintText ?? `Click the map to zoom with scroll, or use ${mac ? '⌘' : 'Ctrl'} + scroll`;
  el.appendChild(hint);
  let hintTimer: ReturnType<typeof setTimeout> | null = null;
  function showHint() {
    hint.classList.add('is-visible');
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = setTimeout(() => hint.classList.remove('is-visible'), 1600);
  }

  function activate() {
    if (!map.scrollWheelZoom.enabled()) map.scrollWheelZoom.enable();
    hint.classList.remove('is-visible');
  }
  function deactivate() {
    if (map.scrollWheelZoom.enabled()) map.scrollWheelZoom.disable();
  }

  // Capture phase so this runs before Leaflet's own wheel handler.
  function onWheel(e: WheelEvent) {
    if (map.scrollWheelZoom.enabled()) return; // Leaflet handles it
    if (e.ctrlKey || e.metaKey) {
      // Keep the browser from zooming the whole page, apply this first step
      // ourselves, then hand the next wheel events to Leaflet.
      e.preventDefault();
      e.stopPropagation();
      const pt = map.mouseEventToContainerPoint(e as unknown as MouseEvent);
      const step = Math.max(-1, Math.min(1, -e.deltaY / 100));
      map.setZoomAround(pt, map.getZoom() + step);
      activate();
      return;
    }
    showHint(); // plain scroll: the page scrolls as normal, just explain how to zoom
  }

  map.on('mousedown', activate);
  map.on('dragstart', activate);
  el.addEventListener('wheel', onWheel, { capture: true, passive: false });
  el.addEventListener('mouseleave', deactivate);

  return () => {
    if (hintTimer) clearTimeout(hintTimer);
    el.removeEventListener('wheel', onWheel, { capture: true });
    el.removeEventListener('mouseleave', deactivate);
    hint.remove();
  };
}
