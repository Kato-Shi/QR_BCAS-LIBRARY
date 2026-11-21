import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createMockSupabaseClient } from "./mock-supabase";
import { getRuntimeServerSupabaseConfig } from "@/lib/supabase-env";

export const createClient = (
  cookieStore: Awaited<ReturnType<typeof cookies>>
) => {
  const { url: supabaseUrl, key: supabaseKey } = getRuntimeServerSupabaseConfig();

  if (!supabaseUrl || !supabaseKey) {
    console.warn(
      "[BCAS Library] Supabase env vars not configured — using mock client"
    );
    return createMockSupabaseClient() as never;
  }

  return createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // The `setAll` method was called from a Server Component.
          // This can be ignored if you have middleware refreshing
          // user sessions.
        }
      },
    },
  });
};