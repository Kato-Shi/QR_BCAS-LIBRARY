"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Html5Qrcode, type CameraDevice } from "html5-qrcode";
import { AlertTriangle, Camera, ImageUp, RefreshCw, SwitchCamera } from "lucide-react";

interface QRScannerProps {
  onScan: (decodedText: string) => void;
  isActive: boolean;
}

function isBenignPlayInterruption(err: unknown) {
  if (!err) return false;
  const name =
    err instanceof DOMException ? err.name : (err as { name?: unknown }).name;
  const message =
    err instanceof Error
      ? err.message
      : String((err as { message?: unknown }).message ?? err);
  if (name === "AbortError") return true;
  return (
    typeof message === "string" &&
    (message.includes("play() request was interrupted") ||
      message.includes("media was removed from the document"))
  );
}

function isIgnorableShutdownError(err: unknown) {
  if (isBenignPlayInterruption(err)) return true;
  const message =
    err instanceof Error
      ? `${err.name}: ${err.message}`
      : String((err as { message?: unknown }).message ?? err);
  return (
    /removeChild/i.test(message) ||
    /not of type 'Node'|not of type "Node"/i.test(message) ||
    /NotFoundError/i.test(message) ||
    /not.*(scann|start|run)|no.*scann/i.test(message) ||
    /clear/i.test(message)
  );
}

function formatCameraError(err: unknown): { title: string; detail: string } {
  const name =
    err instanceof DOMException
      ? err.name
      : String((err as { name?: unknown })?.name ?? "");
  const raw =
    err instanceof Error
      ? err.message
      : String((err as { message?: unknown })?.message ?? err ?? "");
  const combined = `${name} ${raw}`.toLowerCase();

  if (
    combined.includes("notallowederror") ||
    combined.includes("permission denied") ||
    combined.includes("permission dismissed") ||
    combined.includes("permissions policy") ||
    combined.includes("not allowed")
  ) {
    return {
      title: "Camera permission blocked",
      detail:
        "Allow camera access in your browser bar (and reload the preview if you just enabled it), or upload a QR image below.",
    };
  }

  if (
    combined.includes("notfounderror") ||
    combined.includes("requested device not found") ||
    combined.includes("no camera")
  ) {
    return {
      title: "No camera detected",
      detail:
        "Connect a webcam or use your phone camera. You can also scan a QR image file or enter an accession number below.",
    };
  }

  if (
    combined.includes("notreadableerror") ||
    combined.includes("trackstarterror") ||
    combined.includes("could not start video source")
  ) {
    return {
      title: "Camera is busy",
      detail:
        "Another app or browser tab is currently using the camera. Close it and click Retry Camera.",
    };
  }

  if (combined.includes("insecure") || combined.includes("https")) {
    return {
      title: "HTTPS required for camera",
      detail:
        "Browsers only allow camera access on HTTPS pages or localhost. Open this app over HTTPS.",
    };
  }

  return {
    title: "Unable to start camera",
    detail: raw || "Check browser camera permissions and try again.",
  };
}

let mediaGuardInstalled = false;

function ensureMediaPlayGuard() {
  if (mediaGuardInstalled) return;
  if (typeof window === "undefined" || typeof HTMLMediaElement === "undefined")
    return;
  mediaGuardInstalled = true;

  window.addEventListener("unhandledrejection", (event) => {
    if (isBenignPlayInterruption(event.reason)) event.preventDefault();
  });

  const proto = HTMLMediaElement.prototype;
  const original = proto.play;
  if (typeof original !== "function") return;

  function wrapped(this: HTMLMediaElement) {
    let result: Promise<void>;
    try {
      result = original.call(this) as unknown as Promise<void>;
    } catch (err) {
      if (!isBenignPlayInterruption(err)) throw err;
      return Promise.resolve();
    }
    if (!result || typeof result.catch !== "function") return result;
    return result.catch((err: unknown) => {
      if (isBenignPlayInterruption(err)) return;
      console.error("Media play failed:", err);
    });
  }

  proto.play = wrapped as typeof original;
}

function pauseVideosSync(root: ParentNode | null) {
  if (!root) return;
  root.querySelectorAll("video").forEach((video) => {
    try {
      video.pause();
    } catch {
      // safe to ignore
    }
  });
}

function stopTracksSync(root: ParentNode | null) {
  if (!root) return;
  root.querySelectorAll("video").forEach((video) => {
    const stream = video.srcObject as MediaStream | null;
    if (stream) {
      stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore
        }
      });
      video.srcObject = null;
    }
    video.removeAttribute("src");
  });
}

async function shutdownScanner(scanner: Html5Qrcode, host: HTMLElement | null) {
  try {
    await scanner.stop();
  } catch (err) {
    if (!isIgnorableShutdownError(err)) console.error("Scanner stop:", err);
  }
  stopTracksSync(host);
  try {
    scanner.clear();
  } catch (err) {
    if (!isIgnorableShutdownError(err)) console.error("Scanner clear:", err);
  }
}

export default function QRScanner({ onScan, isActive }: QRScannerProps) {
  const reactId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const runRef = useRef(0);
  const onScanRef = useRef(onScan);

  const [status, setStatus] = useState<"starting" | "running" | "error">("starting");
  const [cameraError, setCameraError] = useState<{ title: string; detail: string } | null>(null);
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>("");
  const [retryToken, setRetryToken] = useState(0);
  const [fileScanError, setFileScanError] = useState<string | null>(null);
  const [scanningFile, setScanningFile] = useState(false);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!isActive || !containerRef.current) return;

    ensureMediaPlayGuard();

    const container = containerRef.current;
    const run = ++runRef.current;
    const host = document.createElement("div");
    host.id = `qr-reader-${reactId}-${run}-${Date.now().toString(36)}`;
    host.style.width = "100%";
    host.style.height = "100%";
    container.appendChild(host);

    const scanner = new Html5Qrcode(host.id);
    let tornDown = false;
    let observer: MutationObserver | null = null;

    if (typeof MutationObserver !== "undefined") {
      observer = new MutationObserver(() => {
        host.querySelectorAll("video").forEach((video) => {
          if (!video.muted) video.muted = true;
          video.setAttribute("muted", "");
          video.setAttribute("playsinline", "");
          video.setAttribute("autoplay", "");
          (video as HTMLVideoElement & { playsInline?: boolean }).playsInline = true;
        });
      });
      observer.observe(host, { childList: true, subtree: true });
    }

    const scanConfig = {
      fps: 10,
      qrbox: { width: 220, height: 220 },
    };

    const startWithFallbacks = async () => {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          "Camera API (navigator.mediaDevices.getUserMedia) is unavailable in this browser context. Ensure HTTPS and camera permissions are enabled."
        );
      }

      // Build ordered list of camera constraints to try so both mobile rear cameras
      // and laptop/USB front webcams work seamlessly.
      const candidates: Array<string | MediaTrackConstraints> = [];

      if (selectedCameraId) {
        candidates.push(selectedCameraId);
      } else {
        candidates.push({ facingMode: "environment" });
        candidates.push({ facingMode: "user" });
      }

      let lastErr: unknown = null;
      let started = false;

      for (const candidate of candidates) {
        if (tornDown) return;
        try {
          await scanner.start(
            candidate,
            scanConfig,
            (decodedText) => {
              if (!tornDown) onScanRef.current(decodedText);
            },
            () => {}
          );
          started = true;
          break;
        } catch (err) {
          lastErr = err;
          if (tornDown || isBenignPlayInterruption(err)) return;
          // Stop trying fallbacks on explicit permission denial.
          const errStr = String(
            err instanceof Error ? `${err.name} ${err.message}` : err
          ).toLowerCase();
          if (
            errStr.includes("notallowederror") ||
            errStr.includes("permission denied") ||
            errStr.includes("permissions policy")
          ) {
            break;
          }
        }
      }

      // Final fallback: enumerate cameras explicitly and start the first available device ID.
      if (!started && !tornDown) {
        try {
          const devices = await Html5Qrcode.getCameras();
          if (!tornDown && devices.length > 0) {
            setCameras(devices);
            const preferred =
              devices.find((d) => /back|rear|environment/i.test(d.label)) ?? devices[0];
            await scanner.start(
              preferred.id,
              scanConfig,
              (decodedText) => {
                if (!tornDown) onScanRef.current(decodedText);
              },
              () => {}
            );
            started = true;
          }
        } catch (err) {
          lastErr = lastErr ?? err;
        }
      }

      if (!started) {
        throw lastErr ?? new Error("Unable to start camera.");
      }

      if (!tornDown) {
        setStatus("running");
        setCameraError(null);
        // Populate camera switcher list now that permission has been granted.
        Html5Qrcode.getCameras()
          .then((devices) => {
            if (!tornDown && devices.length > 0) {
              setCameras(devices);
            }
          })
          .catch(() => {});
      }
    };

    const startPromise = startWithFallbacks().catch((err) => {
      if (!tornDown && !isBenignPlayInterruption(err)) {
        console.error("QR Scanner error:", err);
        setStatus("error");
        setCameraError(formatCameraError(err));
      }
    });

    const teardown = () => {
      if (tornDown) return;
      tornDown = true;
      pauseVideosSync(host);
      observer?.disconnect();
      void (async () => {
        try {
          await startPromise;
        } catch {
          // already handled
        }
        await shutdownScanner(scanner, host);
        try {
          host.remove();
        } catch (err) {
          if (!isIgnorableShutdownError(err)) console.error("Scanner cleanup:", err);
        }
      })();
    };

    window.addEventListener("pagehide", teardown);

    return () => {
      window.removeEventListener("pagehide", teardown);
      teardown();
    };
  }, [isActive, reactId, selectedCameraId, retryToken]);

  const handleRetry = useCallback(() => {
    setStatus("starting");
    setCameraError(null);
    setRetryToken((n) => n + 1);
  }, []);

  const handleSwitchCamera = useCallback(() => {
    if (cameras.length < 2) return;
    const currentIndex = cameras.findIndex((c) => c.id === selectedCameraId);
    const nextCamera = cameras[(currentIndex + 1) % cameras.length];
    if (nextCamera) {
      setStatus("starting");
      setCameraError(null);
      setSelectedCameraId(nextCamera.id);
    }
  }, [cameras, selectedCameraId]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setFileScanError(null);
    setScanningFile(true);
    const tempId = `qr-file-reader-${reactId}-${Date.now().toString(36)}`;
    const tempDiv = document.createElement("div");
    tempDiv.id = tempId;
    tempDiv.style.display = "none";
    document.body.appendChild(tempDiv);

    try {
      const fileScanner = new Html5Qrcode(tempId);
      const decoded = await fileScanner.scanFile(file, false);
      fileScanner.clear();
      onScanRef.current(decoded);
    } catch {
      setFileScanError("No readable QR code found in that image. Try a clearer photo.");
    } finally {
      tempDiv.remove();
      setScanningFile(false);
    }
  };

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-[288px] h-[288px] mx-auto rounded-lg overflow-hidden border-2 border-slate-200 bg-slate-950">
        <div
          ref={containerRef}
          className="w-full h-full [&_video]:!w-full [&_video]:!h-full [&_video]:!object-cover [&_#qr-shaded-region]:!border-emerald-500/40"
        />

        {isActive && status === "running" && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="w-56 h-56 border-2 border-emerald-400 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.28)]" />
          </div>
        )}

        {isActive && status === "starting" && (
          <div className="absolute inset-0 bg-slate-900/85 flex flex-col items-center justify-center gap-2 text-white px-4 text-center">
            <Camera className="w-7 h-7 text-emerald-400 animate-pulse" />
            <p className="text-xs font-medium">Starting camera...</p>
            <p className="text-[11px] text-slate-300">
              Approve the camera prompt if asked.
            </p>
          </div>
        )}

        {isActive && status === "error" && cameraError && (
          <div className="absolute inset-0 bg-slate-50 flex flex-col items-center justify-center gap-2.5 p-5 text-center">
            <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
            </div>
            <p className="text-sm font-semibold text-slate-900">
              {cameraError.title}
            </p>
            <p className="text-xs text-slate-600 leading-relaxed">
              {cameraError.detail}
            </p>
            <button
              type="button"
              onClick={handleRetry}
              className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-700 text-white text-xs font-medium hover:bg-emerald-800 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Retry Camera
            </button>
          </div>
        )}
      </div>

      {/* Camera Switcher & QR Image Upload Fallback */}
      <div className="flex flex-wrap items-center justify-center gap-2 mt-3">
        {cameras.length > 1 && status === "running" && (
          <button
            type="button"
            onClick={handleSwitchCamera}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <SwitchCamera className="w-3.5 h-3.5 text-emerald-700" />
            Switch Camera
          </button>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileUpload}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={scanningFile}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
        >
          <ImageUp className="w-3.5 h-3.5 text-emerald-700" />
          {scanningFile ? "Reading QR..." : "Scan QR Image"}
        </button>
      </div>

      {fileScanError && (
        <p className="mt-2 text-xs text-red-600 text-center max-w-xs">
          {fileScanError}
        </p>
      )}
    </div>
  );
}
