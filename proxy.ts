import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const sessionCookie = request.cookies.get("librarian_session");
  const isAuthenticated = !!sessionCookie?.value;

  if (request.nextUrl.pathname.startsWith("/user")) {
    // Staff accounts are limited to adding + borrowing: block Import
    // even when navigated to directly (sidebar already hides it).
    if (isAuthenticated && request.nextUrl.pathname.startsWith("/user/import")) {
      try {
        const session = JSON.parse(sessionCookie!.value) as { role?: string };
        if (session.role === "Staff") {
          return NextResponse.redirect(new URL("/user", request.url));
        }
      } catch {
        // Malformed session — fall through to the page (it handles auth).
      }
    }
    // Note: when running inside a cross-site iframe (e.g. AI Studio preview)
    // with third-party cookies blocked, UserLayout enforces the auth guard
    // using the client session fallback.
    return NextResponse.next();
  }

  if (request.nextUrl.pathname === "/") {
    if (isAuthenticated) {
      return NextResponse.redirect(new URL("/user", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/user/:path*"],
};
