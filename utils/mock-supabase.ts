// Fallback mock Supabase client used only when NEXT_PUBLIC_SUPABASE_URL
// or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are not configured.
// Allows the Next.js app to build and boot cleanly without crashing on import.

type QueryResult = {
  data: unknown;
  error: { message: string } | null;
  count?: number | null;
};

function createQueryBuilder(isSingle = false): unknown {
  const result: QueryResult = isSingle
    ? { data: null, error: null }
    : { data: [], error: null, count: 0 };

  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop) {
      if (prop === "then") {
        return (resolve: (value: QueryResult) => void) => resolve(result);
      }
      if (prop === "single" || prop === "maybeSingle") {
        return () => createQueryBuilder(true);
      }
      return () => createQueryBuilder(isSingle);
    },
  };

  return new Proxy({}, handler);
}

export function createMockSupabaseClient() {
  return {
    from: () => createQueryBuilder(false),
    rpc: () => Promise.resolve({ data: null, error: null }),
    auth: {
      getUser: () => Promise.resolve({ data: { user: null }, error: null }),
      getSession: () => Promise.resolve({ data: { session: null }, error: null }),
      signOut: () => Promise.resolve({ error: null }),
    },
  };
}
