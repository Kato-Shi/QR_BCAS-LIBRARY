/**
 * Authoritative monotonic clock anchored to the server / Supabase UTC clock.
 *
 * Once synced via `/api/time`, time advances strictly via `performance.now()`
 * (a monotonic timer that ignores OS/laptop wall-clock changes) and re-syncs
 * periodically or when tabs resume from sleep.
 */

const SYNC_TTL_MS = 5 * 60 * 1000;
const VISIBILITY_RESYNC_MS = 30 * 1000;

let syncedServerMs: number | null = null;
let syncedPerfMs: number | null = null;
let lastSyncAtPerf: number | null = null;
let inFlightSync: Promise<number> | null = null;

// Pre-sync baseline anchored at module load with performance.now() so even
// before the first `/api/time` response returns, OS clock jumps mid-boot
// cannot shift `getServerNowMs()`.
const fallbackWallMs = Date.now();
const fallbackPerfMs = typeof performance !== "undefined" ? performance.now() : 0;

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

function measurePerf(): number {
  return typeof performance !== "undefined" ? performance.now() : 0;
}

export function isServerClockSynced(): boolean {
  return syncedServerMs !== null && syncedPerfMs !== null;
}

/**
 * Fetches `/api/time` (which reads Supabase's NTP-backed HTTP `Date` header or
 * falls back to the Next.js server clock) and anchors the monotonic offset.
 */
export async function syncServerClock(force = false): Promise<number> {
  if (!hasWindow()) {
    return Date.now();
  }

  const nowPerf = measurePerf();
  if (
    !force &&
    syncedServerMs !== null &&
    syncedPerfMs !== null &&
    lastSyncAtPerf !== null &&
    nowPerf - lastSyncAtPerf < SYNC_TTL_MS
  ) {
    return syncedServerMs + (nowPerf - syncedPerfMs);
  }

  if (inFlightSync) {
    return inFlightSync;
  }

  inFlightSync = (async () => {
    try {
      const t0 = measurePerf();
      const res = await fetch(`/api/time?t=${Math.floor(t0)}`, {
        method: "GET",
        cache: "no-store",
      });
      const t1 = measurePerf();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { nowMs?: unknown };
      if (typeof data.nowMs !== "number" || !Number.isFinite(data.nowMs)) {
        throw new Error("Invalid time payload");
      }

      const midpointRtt = Math.max(0, Math.round((t1 - t0) / 2));
      syncedServerMs = data.nowMs + midpointRtt;
      syncedPerfMs = t1;
      lastSyncAtPerf = t1;
      return syncedServerMs;
    } catch {
      return getServerNowMs();
    } finally {
      inFlightSync = null;
    }
  })();

  return inFlightSync;
}

/** Returns the current authoritative epoch timestamp in milliseconds. */
export function getServerNowMs(): number {
  if (!hasWindow()) {
    return Date.now();
  }
  const nowPerf = measurePerf();
  if (syncedServerMs !== null && syncedPerfMs !== null) {
    return Math.round(syncedServerMs + (nowPerf - syncedPerfMs));
  }
  return Math.round(fallbackWallMs + (nowPerf - fallbackPerfMs));
}

/** Returns the current authoritative `Date` instance. */
export function getServerNow(): Date {
  return new Date(getServerNowMs());
}

/** Returns the current authoritative ISO-8601 UTC timestamp string. */
export function getServerNowIso(): string {
  return getServerNow().toISOString();
}

/** Returns the current authoritative `YYYY-MM-DD` date string (UTC). */
export function getServerDateString(): string {
  return getServerNowIso().split("T")[0];
}

/**
 * Ensures the server clock is synced (if not yet synced or stale) and returns
 * the authoritative `Date`. Use before DB writes and overdue calculations.
 */
export async function ensureServerNow(force = false): Promise<Date> {
  await syncServerClock(force);
  return getServerNow();
}

// Kick off an immediate background sync in the browser and re-anchor if a
// tab becomes visible after potential laptop sleep (where monotonic timers may pause).
if (hasWindow()) {
  void syncServerClock();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      const nowPerf = measurePerf();
      if (lastSyncAtPerf === null || nowPerf - lastSyncAtPerf >= VISIBILITY_RESYNC_MS) {
        void syncServerClock(true);
      }
    }
  });
}
