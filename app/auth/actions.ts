"use server";

import { cookies, headers } from "next/headers";
import type { StaffRole } from "@/lib/types";

export interface SessionData {
  authenticated: boolean;
  staffId: string;
  name: string;
  role: StaffRole;
}

async function isHttpsRequest(): Promise<boolean> {
  if (process.env.NODE_ENV === "production") return true;
  const headerStore = await headers();
  const proto = headerStore.get("x-forwarded-proto");
  const origin = headerStore.get("origin");
  return proto === "https" || (origin?.startsWith("https://") ?? false);
}

export async function login(staffId: string, password: string) {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ) {
    return {
      success: false,
      error:
        "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
    };
  }

  // Check against staff table
  const { getStaffByUserId } = await import("@/lib/supabase/staff");
  let staff = null;
  try {
    staff = await getStaffByUserId(staffId);
  } catch {
    return { success: false, error: "Invalid staff ID or password." };
  }

  if (staff && staff.is_active) {
    const storedPassword = staff.password_hash
      ? Buffer.from(staff.password_hash, "base64").toString("utf-8")
      : null;

    if (!storedPassword || storedPassword !== password) {
      return { success: false, error: "Invalid staff ID or password." };
    }

    const sessionData: SessionData = {
      authenticated: true,
      staffId,
      name: staff.name,
      role: staff.role,
    };

    const isHttps = await isHttpsRequest();
    const cookieStore = await cookies();
    cookieStore.set("librarian_session", JSON.stringify(sessionData), {
      httpOnly: true,
      secure: isHttps,
      sameSite: isHttps ? "none" : "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    return { success: true, role: staff.role, session: sessionData };
  }

  return { success: false, error: "Invalid staff ID or password." };
}

export async function logout() {
  const isHttps = await isHttpsRequest();
  const cookieStore = await cookies();
  cookieStore.set("librarian_session", "", {
    httpOnly: true,
    secure: isHttps,
    sameSite: isHttps ? "none" : "lax",
    path: "/",
    maxAge: 0,
  });
}

export async function getSession(): Promise<SessionData | null> {
  const cookieStore = await cookies();
  const session = cookieStore.get("librarian_session");

  if (!session?.value) return null;

  try {
    const data = JSON.parse(session.value) as SessionData;
    if (data.authenticated) return data;
    return null;
  } catch {
    return null;
  }
}

export async function hasPermission(requiredRole: StaffRole): Promise<boolean> {
  const session = await getSession();
  if (!session) return false;

  const roleHierarchy: Record<StaffRole, number> = {
    "Admin": 3,
    "Librarian": 2,
    "Staff": 1,
  };

  return roleHierarchy[session.role] >= roleHierarchy[requiredRole];
}

export async function isAdmin(): Promise<boolean> {
  const session = await getSession();
  return session?.role === "Admin";
}
