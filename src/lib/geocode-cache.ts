import 'server-only';

// Shared cache + outbound throttle for the two geocoding proxies
// (src/app/api/geocode + src/app/api/reverse-geocode).
//
// Why this exists — those routes call Photon/Nominatim once per client request.
// Moving buses (reverse-geocode fires as the bus moves) and per-keystroke
// autocomplete fan MANY client requests into upstream calls, all leaving from
// the server's IP. Nominatim's usage policy caps that at 1 req/s per IP;
// exceeding it gets the IP banned.
//
// IMPORTANT (serverless): prod runs on Vercel, where each route is a lambda that
// can scale to MANY instances, so module-level state here is PER-INSTANCE, not
// truly global. The pieces below are best-effort per-instance PRE-FILTERS that
// cut the vast majority of upstream calls but must NOT be relied on as the
// authoritative cap:
//   1. TtlCache — a cache HIT never touches upstream. Reverse-geocode keys are
//      grid-rounded, so a bus creeping through the same ~100 m cell reuses one
//      lookup; autocomplete keys are the normalized query. (Per-instance, so
//      hit-rate dilutes ~N× under scale-out — acceptable; it's only a cache.)
//   2. photonGate — spaces Photon request starts within a single instance.
// The AUTHORITATIVE, cross-instance caps all live in the DB (rateLimit(), backed
// by the rate_limit_events table) at the route call sites, so they hold no
// matter how many lambdas are warm:
//   • Nominatim: rateLimit('geo:nominatim','global',1,4) — 1 per 4s (= fetch
//     timeout) ⇒ ~1 in flight cross-instance. The ban risk.
//   • Photon:    rateLimit('geo:photon','global',16,4) — 16 per 4s ⇒ ~16 in
//     flight cross-instance (start-rate window sized to bound concurrency).
//   • Per-caller: rateLimit('geo:caller'|'rgeo:caller', sub, …) — anti-monopoly.
// See src/app/api/{geocode,reverse-geocode}/route.ts.

// ── TTL + LRU cache ──────────────────────────────────────────────────────────

type Entry<T> = { value: T; expires: number };

export class TtlCache<T> {
  private map = new Map<string, Entry<T>>();

  constructor(
    private readonly max: number,
    private readonly ttlMs: number,
  ) {}

  /** Fresh (unexpired) value, or undefined. Refreshes LRU recency on a hit. */
  get(key: string): T | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.expires <= Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    // Re-insert to mark as most-recently-used.
    this.map.delete(key);
    this.map.set(key, e);
    return e.value;
  }

  /** Last known value even if expired — used to serve stale when throttled. */
  getStale(key: string): T | undefined {
    return this.map.get(key)?.value;
  }

  /** Cache `value`. Pass `ttlMs` to override the default TTL (e.g. a shorter one
   *  for empty/negative results so a momentarily sparse upstream isn't pinned). */
  set(key: string, value: T, ttlMs?: number): void {
    this.map.delete(key);
    this.map.set(key, { value, expires: Date.now() + (ttlMs ?? this.ttlMs) });
    // Evict oldest (insertion-order = LRU here) until under the cap.
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }
}

// ── Outbound min-interval throttle ───────────────────────────────────────────

class Gate {
  private last = 0;
  private tail: Promise<void> = Promise.resolve();
  private waiting = 0;

  constructor(
    private readonly minIntervalMs: number,
    private readonly maxQueue: number,
  ) {}

  /**
   * Reserve the next outbound slot, resolving once at least `minIntervalMs` has
   * elapsed since the previous slot. Returns false immediately (without
   * queueing) when `maxQueue` callers are already waiting — the signal to serve
   * a cached/stale value instead of adding upstream load.
   */
  async acquire(): Promise<boolean> {
    if (this.waiting >= this.maxQueue) return false;
    this.waiting++;
    const prev = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((r) => (release = r));
    try {
      await prev;
      const wait = this.last + this.minIntervalMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.last = Date.now();
      return true;
    } finally {
      this.waiting--;
      release();
    }
  }
}

// Per-instance spacing for Photon (lenient host). The Nominatim cap is NOT an
// in-memory Gate — it must hold across serverless instances, so it's enforced in
// the DB via rateLimit() at the call sites instead (see the routes).
export const photonGate = new Gate(200, 12);

/** fetch() with an abort timeout so one slow upstream can't stall the app. */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 4000,
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// Serialize Nominatim calls WITHIN an instance to at most one in flight. The DB
// cap (rateLimit) bounds the start RATE (~1/s) across instances, but with the 4s
// fetch timeout a slow upstream could otherwise leave several requests open at
// once — edging toward Nominatim's "no parallel use" policy. This mutex bounds
// concurrency; combined with the DB cap, at most ~1 in-flight per instance.
let nominatimChain: Promise<unknown> = Promise.resolve();
export function nominatimSlot<T>(fn: () => Promise<T>): Promise<T> {
  const run = nominatimChain.then(fn, fn);
  // Swallow rejections on the chain so one failure doesn't reject the next slot.
  nominatimChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

// Bounded-concurrency semaphore. Photon is tried FIRST on every geocode/reverse
// call, so with a 4s timeout the start-rate cap alone could leave many requests
// in flight per instance → risk a 429/ban from public Photon. Cap concurrency.
class Semaphore {
  private active = 0;
  private waiters: (() => void)[] = [];
  constructor(private readonly max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiters.shift()?.();
    }
  }
}
const photonSem = new Semaphore(4);
export function photonSlot<T>(fn: () => Promise<T>): Promise<T> {
  return photonSem.run(fn);
}
