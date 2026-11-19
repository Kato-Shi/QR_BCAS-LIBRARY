import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface TimePayload {
  nowMs: number;
  iso: string;
  source: "supabase" | "server";
}

async function getAuthoritativeTime(): Promise<TimePayload> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (supabaseUrl && supabaseKey) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    try {
      const t0 = performance.now();
      const res = await fetch(`${supabaseUrl}/rest/v1/`, {
        method: "HEAD",
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
        cache: "no-store",
        signal: controller.signal,
      });
      const t1 = performance.now();
      const dateHeader = res.headers.get("date");
      if (dateHeader) {
        const parsed = Date.parse(dateHeader);
        if (!Number.isNaN(parsed)) {
          // HTTP Date headers have 1s granularity; add 500ms midpoint + half RTT.
          const adjusted = parsed + 500 + Math.round((t1 - t0) / 2);
          return {
            nowMs: adjusted,
            iso: new Date(adjusted).toISOString(),
            source: "supabase",
          };
        }
      }
    } catch {
      // Fall back to server clock below
    } finally {
      clearTimeout(timer);
    }
  }

  const nowMs = Date.now();
  return {
    nowMs,
    iso: new Date(nowMs).toISOString(),
    source: "server",
  };
}

export async function GET() {
  const payload = await getAuthoritativeTime();
  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}
