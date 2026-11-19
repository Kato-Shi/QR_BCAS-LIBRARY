import { createBrowserClient } from "@supabase/ssr";
import { createMockSupabaseClient } from "./mock-supabase";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const createClient = () => {
  if (!supabaseUrl || !supabaseKey) {
    if (typeof console !== "undefined") {
      console.warn(
        "[AI Studio] Supabase env vars not configured — using mock client"
      );
    }
    return createMockSupabaseClient() as never;
  }

  return createBrowserClient(supabaseUrl, supabaseKey);
};