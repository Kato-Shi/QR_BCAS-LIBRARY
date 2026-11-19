"use client";

import { useEffect, useState } from "react";
import { Download, ExternalLink, Printer, X, Info } from "lucide-react";
import {
  buildStandalonePrintHtml,
  registerPrintPreviewHandler,
  type PrintPreviewPayload,
} from "@/lib/print";

export default function PrintPreviewHost() {
  const [payload, setPayload] = useState<PrintPreviewPayload | null>(null);
  const [standaloneUrl, setStandaloneUrl] = useState<string | null>(null);

  useEffect(() => {
    registerPrintPreviewHandler((next) => {
      setStandaloneUrl(null);
      setPayload(next);
    });
    return () => {
      registerPrintPreviewHandler(null);
    };
  }, []);

  useEffect(() => {
    if (!payload) return;

    let cancelled = false;
    let createdUrl: string | null = null;

    buildStandalonePrintHtml(payload)
      .then((docHtml) => {
        if (cancelled) return;
        const blob = new Blob([docHtml], { type: "text/html;charset=utf-8;" });
        createdUrl = URL.createObjectURL(blob);
        setStandaloneUrl(createdUrl);
      })
      .catch(() => {
        if (!cancelled) setStandaloneUrl(null);
      });

    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [payload]);

  useEffect(() => {
    if (!payload) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPayload(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [payload]);

  if (!payload) return null;

  const activeUrl = standaloneUrl;

  const handleDownloadPrintable = async () => {
    if (activeUrl) {
      const link = document.createElement("a");
      link.href = activeUrl;
      link.download = payload.filename;
      link.click();
      return;
    }

    const docHtml = await buildStandalonePrintHtml(payload);
    const blob = new Blob([docHtml], { type: "text/html;charset=utf-8;" });
    const tempUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = tempUrl;
    link.download = payload.filename;
    link.click();
    URL.revokeObjectURL(tempUrl);
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 z-[70] flex items-center justify-center p-3 sm:p-6 print:hidden"
      onClick={() => setPayload(null)}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <div>
            <h3 className="text-base sm:text-lg font-bold text-slate-900">
              Print Preview — {payload.title}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Formatted library print sheet ready for paper or PDF output.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setPayload(null)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            aria-label="Close print preview"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Preview Notice */}
        <div className="px-5 py-2.5 bg-emerald-50 border-b border-emerald-100 flex items-center gap-2 text-xs text-emerald-800 shrink-0">
          <Info className="w-4 h-4 shrink-0 text-emerald-700" />
          <span>
            Embedded live previews restrict the native print dialog. Review the formatted sheet below, open it in a new browser tab, or download a self-contained printable file to print / Save as PDF.
          </span>
        </div>

        {/* Paper Sheet Preview */}
        <div className="flex-1 overflow-y-auto bg-slate-200/70 p-4 sm:p-6">
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 sm:p-8 mx-auto max-w-4xl">
            <div
              className="print-preview-sheet"
              data-label-mode={payload.labelMode ? "true" : "false"}
              dangerouslySetInnerHTML={{ __html: payload.html }}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center justify-end gap-2.5 px-5 py-4 border-t border-slate-200 bg-slate-50 shrink-0">
          <button
            type="button"
            onClick={() => setPayload(null)}
            className="px-4 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors"
          >
            Close
          </button>

          <button
            type="button"
            onClick={handleDownloadPrintable}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-emerald-200 bg-emerald-50 text-sm font-medium text-emerald-800 hover:bg-emerald-100 transition-colors"
          >
            <Download className="w-4 h-4" />
            Download Printable (.html)
          </button>

          {activeUrl && (
            <a
              href={activeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-700 text-white text-sm font-semibold hover:bg-emerald-800 transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              Open Print Tab
            </a>
          )}

          <button
            type="button"
            onClick={() => {
              if (payload.labelMode) {
                document.body.classList.add("print-label-mode");
              }
              try {
                window.print();
              } finally {
                window.setTimeout(() => {
                  document.body.classList.remove("print-label-mode");
                }, 200);
              }
            }}
            className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors"
            title="Triggers browser print dialog when not restricted by an embedded frame"
          >
            <Printer className="w-4 h-4" />
            Browser Print
          </button>
        </div>
      </div>
    </div>
  );
}
