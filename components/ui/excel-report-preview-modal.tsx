"use client";

import { useEffect, useState } from "react";
import { Download, FileSpreadsheet, X, CheckCircle2, Calendar, Clock } from "lucide-react";
import type { ExcelPreviewCell, ExcelPreviewSheet } from "@/lib/reports-excel";

interface ExcelReportPreviewModalProps {
  open: boolean;
  onClose: () => void;
  sheets: ExcelPreviewSheet[];
  weekLabel: string;
  generatedLabel: string;
  preparedBy: string;
  onDownloadExcel: () => Promise<void>;
  exporting: boolean;
  initialSheetId?: string;
}

const BADGE_STYLES: Record<NonNullable<ExcelPreviewSheet["badgeTone"]>, string> = {
  emerald: "bg-emerald-100 text-emerald-700",
  amber: "bg-amber-100 text-amber-700",
  red: "bg-red-100 text-red-700",
  blue: "bg-blue-100 text-blue-700",
  slate: "bg-slate-200 text-slate-700",
};

const CELL_TONE: Record<NonNullable<ExcelPreviewCell["tone"]>, string> = {
  default: "text-slate-700",
  bold: "font-semibold text-slate-900",
  emerald: "font-semibold text-emerald-700",
  amber: "font-semibold text-amber-700",
  red: "font-semibold text-red-700",
  blue: "font-semibold text-blue-700",
  muted: "text-slate-500",
};

export default function ExcelReportPreviewModal(props: ExcelReportPreviewModalProps) {
  if (!props.open) return null;
  return <ExcelReportPreviewDialog {...props} />;
}

function ExcelReportPreviewDialog({
  onClose,
  sheets,
  weekLabel,
  generatedLabel,
  preparedBy,
  onDownloadExcel,
  exporting,
  initialSheetId,
}: ExcelReportPreviewModalProps) {
  const [activeSheetId, setActiveSheetId] = useState<string>(
    initialSheetId || sheets[0]?.id || "summary"
  );
  const [justDownloaded, setJustDownloaded] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const activeSheet = sheets.find((s) => s.id === activeSheetId) ?? sheets[0];

  const handleDownloadClick = async () => {
    await onDownloadExcel();
    setJustDownloaded(true);
    window.setTimeout(() => setJustDownloaded(false), 3000);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 sm:p-6 no-print"
      role="dialog"
      aria-modal="true"
      aria-label="Full Library Report Excel Preview"
    >
      <div className="bg-white w-full max-w-6xl h-[88vh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
        {/* Top bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 border-b border-slate-200 bg-emerald-950 text-white">
          <div className="flex items-start sm:items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-800/80 border border-emerald-700 flex items-center justify-center shrink-0">
              <FileSpreadsheet className="w-5 h-5 text-emerald-200" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold tracking-tight">
                Full Library Report — Excel Workbook (.xlsx)
              </h2>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-emerald-200/90 mt-0.5">
                <span className="inline-flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" />
                  Week: {weekLabel}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  Generated: {generatedLabel}
                </span>
                <span>Prepared by: {preparedBy}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleDownloadClick}
              disabled={exporting}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-semibold text-sm transition-colors disabled:opacity-60"
            >
              {justDownloaded ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  Downloaded .xlsx
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  {exporting ? "Building Excel..." : "Download Excel (.xlsx)"}
                </>
              )}
            </button>
            <button
              onClick={onClose}
              aria-label="Close preview"
              className="p-2 rounded-lg text-emerald-200 hover:text-white hover:bg-emerald-900 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Excel-style worksheet tab bar */}
        <div className="flex items-center gap-1 px-4 pt-3 bg-slate-100 border-b border-slate-200 overflow-x-auto">
          {sheets.map((sheet) => {
            const isActive = sheet.id === activeSheet?.id;
            return (
              <button
                key={sheet.id}
                onClick={() => setActiveSheetId(sheet.id)}
                className={`flex items-center gap-2 px-3.5 py-2 text-xs sm:text-sm font-medium rounded-t-lg border-t border-x whitespace-nowrap transition-colors ${
                  isActive
                    ? "bg-white text-emerald-800 border-slate-200 -mb-px font-semibold"
                    : "bg-slate-200/60 text-slate-600 border-transparent hover:bg-slate-200 hover:text-slate-800"
                }`}
              >
                <span>{sheet.name}</span>
                {sheet.countBadge !== undefined && (
                  <span
                    className={`px-1.5 py-0.5 rounded text-[11px] font-semibold ${
                      BADGE_STYLES[sheet.badgeTone ?? "slate"]
                    }`}
                  >
                    {sheet.countBadge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Active sheet description bar */}
        {activeSheet && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-5 py-2.5 bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
            <p>{activeSheet.description}</p>
            {activeSheet.summaryNote && (
              <span className="font-medium text-slate-700 shrink-0">
                {activeSheet.summaryNote}
              </span>
            )}
          </div>
        )}

        {/* Spreadsheet grid */}
        {activeSheet && (
          <div className="flex-1 overflow-auto bg-white">
            <table className="w-full text-xs sm:text-sm border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-emerald-700 text-white">
                  <th className="w-10 px-2.5 py-2.5 text-center font-semibold text-emerald-200 border-r border-emerald-600 bg-emerald-800">
                    #
                  </th>
                  {activeSheet.headers.map((h) => (
                    <th
                      key={h.label}
                      className={`px-3.5 py-2.5 font-semibold whitespace-nowrap border-r border-emerald-600 last:border-r-0 ${
                        h.align === "right"
                          ? "text-right"
                          : h.align === "center"
                          ? "text-center"
                          : "text-left"
                      }`}
                    >
                      {h.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeSheet.rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={activeSheet.headers.length + 1}
                      className="px-6 py-12 text-center text-slate-400"
                    >
                      No records in this worksheet.
                    </td>
                  </tr>
                ) : (
                  activeSheet.rows.map((row, rowIdx) => (
                    <tr
                      key={rowIdx}
                      className={
                        row.isSectionHeader
                          ? "bg-emerald-50/90 border-y border-emerald-200"
                          : row.isTotal
                          ? "bg-slate-100 border-t-2 border-slate-300 font-semibold"
                          : rowIdx % 2 === 1
                          ? "bg-slate-50/60 hover:bg-emerald-50/30 border-b border-slate-200"
                          : "bg-white hover:bg-emerald-50/30 border-b border-slate-200"
                      }
                    >
                      <td className="px-2.5 py-2 text-center text-[11px] font-mono text-slate-400 bg-slate-50 border-r border-slate-200 select-none">
                        {rowIdx + 1}
                      </td>
                      {row.cells.map((c, cellIdx) => (
                        <td
                          key={cellIdx}
                          className={`px-3.5 py-2 border-r border-slate-200 last:border-r-0 whitespace-nowrap ${
                            c.align === "right"
                              ? "text-right"
                              : c.align === "center"
                              ? "text-center"
                              : "text-left"
                          } ${CELL_TONE[c.tone ?? "default"]}`}
                        >
                          {c.text}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-5 py-3 bg-slate-50 border-t border-slate-200 text-xs text-slate-500">
          <span>
            {sheets.length} worksheets included in the downloaded Excel (.xlsx) workbook • All timestamps reflect server clock.
          </span>
          <button
            onClick={onClose}
            className="self-end sm:self-auto px-3.5 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 font-medium hover:bg-slate-100 transition-colors"
          >
            Close Preview
          </button>
        </div>
      </div>
    </div>
  );
}
