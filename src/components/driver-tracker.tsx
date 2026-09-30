'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { setDriverOnlineAction } from '@/features/driver/actions';
import { cn } from '@/lib/utils';
import { formatTime } from '@/lib/format-date';

// Fire-and-forget GPS ping via a light API route (not a server action — this
// runs every ~9s while online). Silently ignores transient failures.
function sendLocation(lat: number, lng: number) {
  void fetch('/api/driver-location', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lat, lng }),
    keepalive: true,
  }).catch(() => {});
}

// Resolve exactly one GPS fix (or reject). Used to confirm the driver actually
// granted location permission BEFORE we flip them online — watchPosition returns
// a watch id synchronously, so it can't tell us whether the prompt was accepted.
function getFirstFix(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 20000,
    });
  });
}

// Don't hammer the server on every GPS tick — one write at most this often.
const MIN_SEND_MS = 9000;
// A stationary bus emits no watchPosition callbacks, so its stored location goes
// stale and bus_live_location's 2-minute freshness window flips the rider's
// marker to offline mid-trip. The heartbeat CHECKS every HEARTBEAT_TICK_MS and
// sends a fresh fix once HEARTBEAT_MS has passed since the last write. (Checking
// only every 30s and skipping when the last send was 29s ago let the gap drift to
// ~60s + GPS time, too close to the window.) Worst case now ≈ 40s + fix time,
// leaving ~3x margin under 2 min for dropped pings / background throttling.
const HEARTBEAT_MS = 30000;
const HEARTBEAT_TICK_MS = 10000;
// If a fresh fix can't be had right now (indoors / GPS warm-up), a real fix this
// recent may still be re-sent so a parked bus doesn't blink offline — but never
// older, so a genuinely lost GPS still lets the bus drop off the map.
const REUSE_FIX_MAX_MS = 60000;

/**
 * Persistent online/offline toggle for drivers. Rendered in the driver panel
 * layout so it keeps running as the driver moves between panel pages. While
 * online, the phone's GPS is streamed to the server so riders can watch the bus
 * live; going offline stops tracking and clears the stored location.
 */
export function DriverTracker({ initialOnline }: { initialOnline: boolean }) {
  const [online, setOnline] = useState(initialOnline);
  const [busy, setBusy] = useState(false);
  const [lastFix, setLastFix] = useState<number | null>(null);
  const watchId = useRef<number | null>(null);
  const lastSent = useRef(0);
  // Most recent GPS fix — re-sent by the heartbeat so a parked bus stays live.
  const lastCoords = useRef<{ lat: number; lng: number } | null>(null);
  // When lastCoords was actually measured by the GPS (not when it was sent).
  const lastCoordsAt = useRef(0);
  // Mirror of `online`, kept in sync synchronously in toggle(). All location
  // writes gate on this so a GPS/heartbeat callback that fires just after "Go
  // offline" can't silently re-online the driver.
  const onlineRef = useRef(online);
  useEffect(() => {
    onlineRef.current = online;
  }, [online]);

  const stopWatch = useCallback(() => {
    if (watchId.current !== null && typeof navigator !== 'undefined') {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
  }, []);

  const startWatch = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      toast.error('Location isn’t available on this device/browser.');
      return false;
    }
    stopWatch();
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        // Remember the fix even when throttled, so the heartbeat can re-send it.
        lastCoords.current = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        lastCoordsAt.current = pos.timestamp || Date.now();
        if (!onlineRef.current) return; // a late callback after Go offline must not write
        const now = Date.now();
        if (now - lastSent.current < MIN_SEND_MS) return;
        lastSent.current = now;
        setLastFix(now);
        sendLocation(pos.coords.latitude, pos.coords.longitude);
      },
      (err) => {
        toast.error(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission denied — enable it to go online.'
            : 'Couldn’t read your location.',
        );
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    return true;
  }, [stopWatch]);

  // Clean up the geolocation watcher if the panel unmounts (logout/navigation
  // away). The server's 2-minute freshness check then marks the bus offline.
  useEffect(() => stopWatch, [stopWatch]);

  // If the driver was already online (e.g. after a refresh), resume streaming.
  useEffect(() => {
    if (initialOnline) startWatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // NOTE: no pagehide / unmount "go offline" beacon on purpose. A pagehide can't
  // tell a reload (or the WebView being recreated) from a real close, so the old
  // beacon took the bus offline on every mid-trip reload — and the reloaded page
  // then rendered "Offline". Going offline is now only ever explicit ("Go
  // offline" / logout, handled server-side in logoutAction). An abandoned tab just
  // stops pinging: riders' maps drop the bus after the 2-min freshness window and
  // the clear_stale_driver_online cron clears the flag after 10 min.

  // Heartbeat: while online, keep a stationary bus's location fresh (watchPosition
  // only fires on movement). Crucially, each tick fetches a NEW fix rather than
  // re-sending the cached one forever — otherwise a mid-trip GPS drop (or a
  // parked/forgotten tab that's still alive) would keep pushing the last known
  // coords and riders would see a frozen "Bus live" marker indefinitely. If the
  // fresh fix fails (GPS lost), we send nothing and let the server's 2-minute
  // freshness window mark the bus offline.
  useEffect(() => {
    if (!online) return;
    let fixInFlight = false;
    const id = setInterval(() => {
      if (!onlineRef.current || typeof navigator === 'undefined' || !navigator.geolocation) return;
      if (Date.now() - lastSent.current < HEARTBEAT_MS) return; // movement kept it fresh
      if (fixInFlight) return; // previous heartbeat fix still pending
      fixInFlight = true;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          fixInFlight = false;
          if (!onlineRef.current) return; // went offline while the fix was in flight
          lastCoords.current = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          lastCoordsAt.current = pos.timestamp || Date.now();
          lastSent.current = Date.now();
          setLastFix(Date.now());
          sendLocation(pos.coords.latitude, pos.coords.longitude);
        },
        () => {
          fixInFlight = false;
          // GPS unavailable right now. Re-send the last fix ONLY if it was really
          // measured within REUSE_FIX_MAX_MS (e.g. a parked bus indoors); never
          // older coords, so a genuinely lost GPS still drops the bus offline.
          const c = lastCoords.current;
          if (!onlineRef.current || !c || Date.now() - lastCoordsAt.current > REUSE_FIX_MAX_MS) return;
          lastSent.current = Date.now();
          setLastFix(Date.now());
          sendLocation(c.lat, c.lng);
        },
        // Accept an OS-cached fix up to 30s old — a stationary phone often has no
        // "new" fix to give, and that's still an honest position.
        { enableHighAccuracy: true, maximumAge: 30000, timeout: 15000 },
      );
    }, HEARTBEAT_TICK_MS);
    return () => clearInterval(id);
  }, [online]);

  async function toggle() {
    const next = !online;
    // Gating is asymmetric on purpose:
    //  - Going OFFLINE: stop writes IMMEDIATELY (before the round-trip), so an
    //    in-flight GPS/heartbeat callback can't keep streaming.
    //  - Going ONLINE: do NOT enable writes yet. If the watch's first fix (or the
    //    heartbeat) fired during the approval round-trip and the server call then
    //    failed, a premature ping would mark the bus online while the UI shows
    //    offline. Writes are enabled only after the server confirms (below).
    if (!next) onlineRef.current = false;
    setBusy(true);
    if (next) {
      // Confirm we can actually track BEFORE flipping online. watchPosition()
      // returns a watch id synchronously — even if the driver later DENIES the
      // permission prompt — so it can't gate going online. getCurrentPosition
      // only resolves once the prompt is granted AND a real fix arrives; it
      // rejects on denial/timeout, so a denied driver never shows as "online".
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        toast.error('Location isn’t available on this device/browser.');
        onlineRef.current = false; // never actually went online
        setBusy(false);
        return;
      }
      try {
        const pos = await getFirstFix();
        // Seed the first fix so riders see the bus immediately (and the
        // heartbeat has something to re-send before the watch fires again).
        lastCoords.current = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        lastCoordsAt.current = pos.timestamp || Date.now();
      } catch (err) {
        const denied =
          typeof GeolocationPositionError !== 'undefined' &&
          err instanceof GeolocationPositionError &&
          err.code === err.PERMISSION_DENIED;
        toast.error(
          denied
            ? 'Location permission denied — enable it to go online.'
            : 'Couldn’t get your location — try again.',
        );
        onlineRef.current = false; // never actually went online
        setBusy(false);
        return;
      }
      startWatch();
    } else {
      stopWatch();
      lastSent.current = 0;
      lastCoords.current = null;
      lastCoordsAt.current = 0;
      setLastFix(null);
    }
    const res = await setDriverOnlineAction(next);
    setBusy(false);
    if (res.error) {
      // Action failed → state is unchanged. Keep GPS matching it: if a go-online
      // failed, ensure the watch is stopped; if a go-OFFLINE failed (we stopped
      // the watch pre-emptively), resume it so we're not "online on the server
      // but not streaming" until the 2-min window lapses.
      if (next) stopWatch();
      else startWatch();
      onlineRef.current = online;
      toast.error(res.error);
      return;
    }
    setOnline(next);
    // Server confirmed → now it's safe to let GPS/heartbeat callbacks stream.
    if (next) onlineRef.current = true;
    // Push the first fix right away so the bus appears on rider maps instantly,
    // instead of waiting for the next throttled watch/heartbeat tick.
    if (next && lastCoords.current) {
      lastSent.current = Date.now();
      setLastFix(lastSent.current);
      sendLocation(lastCoords.current.lat, lastCoords.current.lng);
    }
    toast.success(next ? 'You’re online — sharing live location.' : 'You’re offline.');
  }

  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 shadow-xs">
      <div className="flex items-center gap-3">
        <span
          className={cn(
            'grid size-10 place-items-center rounded-full',
            online ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground',
          )}
        >
          <span className={cn('size-2.5 rounded-full', online ? 'bg-success' : 'bg-muted-foreground/50')}>
            {online && (
              <span className="block size-2.5 animate-ping rounded-full bg-success/70" />
            )}
          </span>
        </span>
        <div>
          <p className="text-sm font-semibold">
            {online ? 'Online — sharing live location' : 'Offline'}
          </p>
          <p className="text-xs text-muted-foreground">
            {online
              ? lastFix
                ? `Location updated at ${formatTime(lastFix)}`
                : 'Getting your location…'
              : 'Go online when your trip starts so riders can track the bus.'}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-pressed={online}
        className={cn(
          'inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-60',
          online
            ? 'border border-border bg-secondary text-foreground hover:bg-secondary/70'
            : 'bg-primary text-primary-foreground hover:bg-primary/90',
        )}
      >
        {busy && <Loader2 className="size-4 animate-spin" />}
        {online ? 'Go offline' : 'Go online'}
      </button>
    </div>
  );
}
