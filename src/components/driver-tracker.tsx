'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { setDriverOnlineAction } from '@/features/driver/actions';
import { cn } from '@/lib/utils';

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

// Don't hammer the server on every GPS tick — one write at most this often.
const MIN_SEND_MS = 9000;
// A stationary bus emits no watchPosition callbacks, so its stored location goes
// stale and bus_live_location's 2-minute freshness window flips the rider's
// marker to offline mid-trip. Re-send the last known fix every 30s (well under 2
// min) so a couple of dropped pings can't push a parked bus past the window.
const HEARTBEAT_MS = 30000;

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

  // Signal offline when the tab is really torn down (close / hard-nav), so the
  // rider map stops immediately instead of waiting out the 2-min freshness
  // window. Guard on !persisted so a mobile app-switch (bfcache) — where the
  // heartbeat resumes on return — doesn't flip the bus offline mid-trip.
  useEffect(() => {
    if (!online) return;
    const onPageHide = (e: PageTransitionEvent) => {
      if (e.persisted) return;
      navigator.sendBeacon?.('/api/driver-offline');
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [online]);

  // On unmount while still online (leaving the driver panel via a soft nav that
  // isn't logout), signal offline so the family map stops instead of waiting out
  // the freshness window. (Logout is handled server-side in logoutAction, since
  // the session is gone by the time this beacon would fire.)
  useEffect(() => {
    return () => {
      if (onlineRef.current) navigator.sendBeacon?.('/api/driver-offline');
    };
  }, []);

  // Heartbeat: while online, re-send the last known fix if nothing has been sent
  // recently. Keeps a stationary bus's location fresh (watchPosition only fires
  // on movement), so it doesn't fall out of the 2-minute freshness window.
  useEffect(() => {
    if (!online) return;
    const id = setInterval(() => {
      const c = lastCoords.current;
      if (!c || !onlineRef.current) return;
      if (Date.now() - lastSent.current < HEARTBEAT_MS) return; // movement kept it fresh
      lastSent.current = Date.now();
      setLastFix(Date.now());
      sendLocation(c.lat, c.lng);
    }, HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [online]);

  async function toggle() {
    const next = !online;
    // Gate location writes on the new state immediately (before the async
    // round-trip), so any in-flight GPS/heartbeat callback stops writing at once.
    onlineRef.current = next;
    setBusy(true);
    if (next) {
      // Ask for the fix first — no point flipping online if we can't track.
      const started = startWatch();
      if (!started) {
        onlineRef.current = false; // never actually went online
        setBusy(false);
        return;
      }
    } else {
      stopWatch();
      lastSent.current = 0;
      lastCoords.current = null;
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
                ? `Location updated at ${new Date(lastFix).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`
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
