import { createBrowserClient } from "@supabase/ssr";
import { createMockSupabaseClient } from "./mock-supabase";
import {
  getResolvedSupabaseConfig,
  hasSupabaseConfig,
} from "@/lib/supabase-env";

function makeRealClient(url: string, key: string) {
  return createBrowserClient(url, key);
}

type BrowserSupabaseClient = ReturnType<typeof makeRealClient>;

let cachedClient: BrowserSupabaseClient | null = null;
let cachedSignature = "";
let warnedMissingConfig = false;

function getOrCreateClient(): BrowserSupabaseClient {
  const { url, key } = getResolvedSupabaseConfig();

  if (!url || !key) {
    if (!warnedMissingConfig && typeof console !== "undefined") {
      warnedMissingConfig = true;
      console.warn(
        "[BCAS Library] Supabase env vars not configured (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) — using empty fallback client."
      );
    }
    return createMockSupabaseClient() as unknown as BrowserSupabaseClient;
  }

  const signature = `${url}::${key}`;
  if (!cachedClient || cachedSignature !== signature) {
    cachedClient = makeRealClient(url, key);
    cachedSignature = signature;
  }
  return cachedClient;
}

export function isSupabaseConfigured(): boolean {
  return hasSupabaseConfig();
}

export const createClient = () => {
  // Always resolve lazily so runtime-injected config (e.g. Cloudflare Worker runtime vars)
  // works even when modules initialize `const supabase = createClient()` at import time.
  return new Proxy({} as BrowserSupabaseClient, {
    get(_target, prop, receiver) {
      const client = getOrCreateClient();
      const value = Reflect.get(client, prop, receiver);
      return typeof value === "function" ? value.bind(client) : value;
    },
  });
};