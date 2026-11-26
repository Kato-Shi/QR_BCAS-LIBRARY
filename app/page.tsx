"use client";

import { useState, useEffect, useSyncExternalStore } from "react";
import Image from "next/image";
import {
  AlertCircle,
  Clock,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  UserRound,
} from "lucide-react";
import { login } from "@/app/auth/actions";
import { useRouter } from "next/navigation";
import { clearLastActivity, LOGOUT_REASON_KEY } from "@/hooks/use-idle-logout";
import { saveClientSession, readClientSession } from "@/lib/client-session";
import libraryPhoto from "@/public/assets/aistudio/image_d364d63c.png";
import bcasLogo from "@/public/assets/aistudio/pngfind.com-kiss-logo-png-5961706_26a4cb6e.png";

export default function BCASLibraryLogin() {
  const [showPassword, setShowPassword] = useState(false);
  const [staffId, setStaffId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (readClientSession()) {
      router.replace("/user");
    }
  }, [router]);

  const loggedOutForIdle = useSyncExternalStore(
    () => () => {},
    () => {
      try {
        return sessionStorage.getItem(LOGOUT_REASON_KEY) === "idle";
      } catch {
        return false;
      }
    },
    () => false
  );
  const [idleNoticeDismissed, setIdleNoticeDismissed] = useState(false);
  const idleNotice =
    loggedOutForIdle && !idleNoticeDismissed && !error
      ? "You were logged out due to inactivity. Please sign in again."
      : null;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setIdleNoticeDismissed(true);
    try {
      sessionStorage.removeItem(LOGOUT_REASON_KEY);
    } catch {}
    setLoading(true);
    try {
      const result = await login(staffId, password);
      if (result.success) {
        if (result.session) {
          saveClientSession(result.session);
        }
        clearLastActivity();
        router.push("/user");
      } else {
        setError(result.error ?? "Login failed.");
      }
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="relative isolate min-h-dvh w-full flex items-center justify-center overflow-hidden p-4 sm:p-6 bg-slate-950">
      {/* Full-bleed library photo behind everything */}
      <Image
        src={libraryPhoto}
        alt="BCAS Library interior"
        fill
        sizes="100vw"
        priority
        placeholder="blur"
        referrerPolicy="no-referrer"
        className="object-cover object-center -z-20"
      />
      {/* Balanced dark gradient keeps the centered glass card readable over the photo */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-gradient-to-br from-slate-950/75 via-slate-900/55 to-emerald-950/65"
      />

      <div className="animate-fade-in-up w-full max-w-md rounded-2xl border border-white/20 bg-slate-950/45 p-6 sm:p-8 shadow-2xl shadow-black/50 backdrop-blur-xl backdrop-saturate-150">
        <div className="flex items-center gap-3.5 mb-6">
          <Image
            src={bcasLogo}
            alt="Batangas College of Arts and Sciences logo"
            width={56}
            height={56}
            priority
            referrerPolicy="no-referrer"
            className="h-14 w-14 shrink-0 rounded-full object-contain drop-shadow-md"
          />
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
              BCAS Library
            </h1>
            <p className="text-white/75 text-sm">
              Sign in to manage library resources.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="staffId"
              className="block text-sm font-medium text-white/90 mb-1.5"
            >
              Staff ID
            </label>
            <div className="relative">
              <UserRound
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/60"
                aria-hidden="true"
              />
              <input
                id="staffId"
                name="staffId"
                type="text"
                autoComplete="username"
                autoFocus
                value={staffId}
                onChange={(e) => setStaffId(e.target.value)}
                placeholder="Enter your staff ID"
                disabled={loading}
                required
                className="h-11 w-full pl-10 pr-3.5 rounded-xl border border-white/25 bg-white/10 text-sm text-white placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 focus:bg-white/15 transition-colors disabled:opacity-60"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-white/90 mb-1.5"
            >
              Password
            </label>
            <div className="relative">
              <Lock
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/60"
                aria-hidden="true"
              />
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                disabled={loading}
                required
                className="h-11 w-full pl-10 pr-11 rounded-xl border border-white/25 bg-white/10 text-sm text-white placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 focus:bg-white/15 transition-colors disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                disabled={loading}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-lg text-white/65 hover:text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 transition-colors"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4" aria-hidden="true" />
                ) : (
                  <Eye className="w-4 h-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-xl border border-red-300/40 bg-red-500/20 px-3.5 py-2.5 text-sm text-red-100"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          {idleNotice && (
            <div
              role="status"
              className="flex items-start gap-2 rounded-xl border border-amber-300/40 bg-amber-500/20 px-3.5 py-2.5 text-sm text-amber-100"
            >
              <Clock className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{idleNotice}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-white text-sm font-semibold shadow-lg shadow-emerald-950/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                <span>Signing in...</span>
              </>
            ) : (
              "Sign In"
            )}
          </button>
        </form>
      </div>
    </main>
  );
}
