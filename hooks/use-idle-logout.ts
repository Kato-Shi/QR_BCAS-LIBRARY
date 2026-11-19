"use client";

import { useEffect, useRef } from "react";
import { getServerNowMs, syncServerClock } from "@/lib/server-clock";

// Log out after 2 minutes of inactivity.
export const IDLE_TIMEOUT_MS = 2 * 60 * 1000;

const LAST_ACTIVITY_KEY = "bcas_last_activity_v2";
export const LOGOUT_REASON_KEY = "bcas_logout_reason";

const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "scroll",
  "touchstart",
  "wheel",
] as const;

function readLastActivity(): number | null {
  try {
    const v = localStorage.getItem(LAST_ACTIVITY_KEY);
    if (!v) return null;
    const parsed = Number(v);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeLastActivity(ts: number) {
  try {
    localStorage.setItem(LAST_ACTIVITY_KEY, String(Math.round(ts)));
  } catch {
    // storage unavailable — the in-memory timer still works
  }
}

export function clearLastActivity() {
  try {
    localStorage.removeItem(LAST_ACTIVITY_KEY);
    localStorage.removeItem("bcas_last_activity");
  } catch {}
}

/**
 * Calls `onIdle` once the user has been inactive for `timeoutMs`.
 * Uses the server-anchored monotonic clock (`getServerNowMs` + `performance.now()`)
 * so changing the local computer's system time cannot trigger premature logouts.
 */
export function useIdleLogout(onIdle: () => void, timeoutMs = IDLE_TIMEOUT_MS) {
  const onIdleRef = useRef(onIdle);
  useEffect(() => {
    onIdleRef.current = onIdle;
  }, [onIdle]);

  useEffect(() => {
    let cancelled = false;
    let fired = false;
    let clockReady = false;
    let lastWritePerf = -Infinity;
    let lastLocalPerf = typeof performance !== "undefined" ? performance.now() : 0;

    const markActive = () => {
      const nowPerf = typeof performance !== "undefined" ? performance.now() : 0;
      lastLocalPerf = nowPerf;
      if (!clockReady) return;
      // Throttle storage writes (mousemove fires constantly).
      if (nowPerf - lastWritePerf > 1000) {
        lastWritePerf = nowPerf;
        writeLastActivity(getServerNowMs());
      }
    };

    const check = () => {
      if (cancelled || fired || !clockReady) return;
      const nowPerf = typeof performance !== "undefined" ? performance.now() : 0;
      const nowServerMs = getServerNowMs();
      const stored = readLastActivity();
      if (stored === null || stored > nowServerMs + 5000) {
        writeLastActivity(nowServerMs);
        return;
      }
      // Require both server-clock elapsed time and no local activity in this tab.
      if (nowServerMs - stored >= timeoutMs && nowPerf - lastLocalPerf >= timeoutMs) {
        fired = true;
        onIdleRef.current();
      }
    };

    ACTIVITY_EVENTS.forEach((e) =>
      window.addEventListener(e, markActive, { passive: true })
    );
    document.addEventListener("visibilitychange", check);
    const interval = setInterval(check, 1000);

    // Wait for authoritative server clock before evaluating stored activity timestamps.
    syncServerClock().then(() => {
      if (cancelled) return;
      const nowServerMs = getServerNowMs();
      const stored = readLastActivity();
      if (stored !== null && stored <= nowServerMs + 5000 && nowServerMs - stored >= timeoutMs) {
        // Only treat stale if user hasn't interacted since mount.
        const nowPerf = typeof performance !== "undefined" ? performance.now() : 0;
        if (nowPerf - lastLocalPerf >= Math.min(timeoutMs, 1000)) {
          // If stored timestamp is stale from a previous closed session, log out.
          fired = true;
          onIdleRef.current();
          return;
        }
      }
      if (stored === null || stored > nowServerMs + 5000) {
        writeLastActivity(nowServerMs);
      }
      clockReady = true;
    });

    return () => {
      cancelled = true;
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, markActive));
      document.removeEventListener("visibilitychange", check);
      clearInterval(interval);
    };
  }, [timeoutMs]);
}
