import { getSession, type SessionData } from "@/app/auth/actions";

const SESSION_KEY = "bcas_librarian_session";

export function saveClientSession(session: SessionData): void {
  if (typeof window === "undefined") return;
  const serialized = JSON.stringify(session);
  try {
    window.sessionStorage.setItem(SESSION_KEY, serialized);
  } catch {}
  try {
    window.localStorage.setItem(SESSION_KEY, serialized);
  } catch {}
}

export function readClientSession(): SessionData | null {
  if (typeof window === "undefined") return null;
  for (const storage of [window.sessionStorage, window.localStorage]) {
    try {
      const raw = storage.getItem(SESSION_KEY);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as SessionData;
      if (parsed?.authenticated) return parsed;
    } catch {}
  }
  return null;
}

export function clearClientSession(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(SESSION_KEY);
  } catch {}
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {}
}

export async function getEffectiveSession(): Promise<SessionData | null> {
  const local = readClientSession();
  if (local) return local;
  try {
    const server = await getSession();
    if (server) {
      saveClientSession(server);
      return server;
    }
  } catch {}
  return null;
}
