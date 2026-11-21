export interface SupabasePublicConfig {
  url: string;
  key: string;
}

declare global {
  interface Window {
    __SUPABASE_PUBLIC_CONFIG__?: Partial<SupabasePublicConfig>;
  }
}

/**
 * Reads Next.js build-time inlined NEXT_PUBLIC_* environment variables.
 * Static dot-access is required so Next.js/Turbopack can inline these into browser bundles.
 */
export function getBuildTimeSupabaseConfig(): SupabasePublicConfig {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const key = (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    ""
  ).trim();
  return { url, key };
}

/**
 * Reads runtime server environment variables (e.g. Cloudflare Workers runtime bindings,
 * Cloud Run secrets, or local .env.local). Uses dynamic indexing so Next.js does not
 * replace them with `undefined` during build when build-time vars are omitted.
 */
export function getRuntimeServerSupabaseConfig(): SupabasePublicConfig {
  const buildTime = getBuildTimeSupabaseConfig();
  if (typeof process === "undefined" || !process.env) {
    return buildTime;
  }

  const env = process.env as Record<string, string | undefined>;
  const url = (
    buildTime.url ||
    env["NEXT_PUBLIC_SUPABASE_URL"] ||
    env["SUPABASE_URL"] ||
    ""
  ).trim();
  const key = (
    buildTime.key ||
    env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] ||
    env["NEXT_PUBLIC_SUPABASE_ANON_KEY"] ||
    env["SUPABASE_PUBLISHABLE_KEY"] ||
    env["SUPABASE_ANON_KEY"] ||
    ""
  ).trim();

  return { url, key };
}

/**
 * Resolves the active public Supabase URL & publishable key in either browser or server contexts:
 * 1. Build-time NEXT_PUBLIC_* values (local dev & build-time configured deploys)
 * 2. Runtime window.__SUPABASE_PUBLIC_CONFIG__ injected by app/layout.tsx (Cloudflare runtime vars)
 * 3. Server runtime process.env values (SSR & Server Actions)
 */
export function getResolvedSupabaseConfig(): SupabasePublicConfig {
  const buildTime = getBuildTimeSupabaseConfig();
  if (buildTime.url && buildTime.key) {
    return buildTime;
  }

  if (typeof window !== "undefined") {
    const injected = window.__SUPABASE_PUBLIC_CONFIG__;
    const url = (buildTime.url || injected?.url || "").trim();
    const key = (buildTime.key || injected?.key || "").trim();
    return { url, key };
  }

  return getRuntimeServerSupabaseConfig();
}

export function hasSupabaseConfig(): boolean {
  const { url, key } = getResolvedSupabaseConfig();
  return Boolean(url && key);
}
