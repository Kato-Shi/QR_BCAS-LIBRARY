"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Camera,
  CameraOff,
  CheckCircle,
  Search,
  AlertTriangle,
  Ban,
  RotateCcw,
  Clock,
} from "lucide-react";
import PageHeader from "@/components/ui/page-header";
import TransactionSubnav from "@/components/transactions/transaction-subnav";
import Badge from "@/components/ui/badge";
import { ConfirmModal } from "@/components/ui/modal";
import { getBookByAccessionNumber, getBookById } from "@/lib/supabase/books";
import { getTransactions, returnBook } from "@/lib/supabase/transactions";
import {
  formatBanDuration,
  formatOrdinal,
  getStudentViolationStatus,
} from "@/lib/supabase/violations";
import {
  getMaterialMeta,
  LIBRARY_MATERIAL_TYPES,
  normalizeMaterialType,
} from "@/lib/materials";
import { formatDateTime } from "@/lib/reports-excel";
import { ensureServerNow, getServerNow } from "@/lib/server-clock";
import type { BorrowingTransactionWithDetails } from "@/lib/types";

const QRScanner = dynamic(() => import("@/components/qr-scanner"), {
  ssr: false,
  loading: () => (
    <div className="w-[288px] h-[288px] mx-auto bg-slate-100 rounded-lg flex items-center justify-center">
      <p className="text-slate-500 text-sm">Loading scanner...</p>
    </div>
  ),
});

interface ReturnFeedback {
  type: "success" | "error";
  message: string;
  violationNotice?: {
    offenseNumber: number;
    isBan: boolean;
    label: string;
    description: string;
    banEndsAt: string | null;
    banDurationLabel: string;
  } | null;
}

export default function ReturnTransactionPage() {
  const [allTransactions, setAllTransactions] = useState<BorrowingTransactionWithDetails[]>([]);
  const [serverNow, setServerNow] = useState<Date>(() => getServerNow());
  const [loadingData, setLoadingData] = useState(true);

  const [scannerActive, setScannerActive] = useState(false);
  const [manualReturnCode, setManualReturnCode] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "overdue" | "on-time">("all");
  const [materialTypeFilter, setMaterialTypeFilter] = useState("all");

  const [confirmingTx, setConfirmingTx] = useState<BorrowingTransactionWithDetails | null>(null);
  const [processingReturn, setProcessingReturn] = useState(false);
  const [feedback, setFeedback] = useState<ReturnFeedback | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [txData, now] = await Promise.all([
        getTransactions(),
        ensureServerNow(),
      ]);
      setAllTransactions(txData);
      setServerNow(now);
    } catch {
      // silent
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    Promise.all([getTransactions(), ensureServerNow()])
      .then(([txData, now]) => {
        if (!mounted) return;
        setAllTransactions(txData);
        setServerNow(now);
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setLoadingData(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const activeBorrows = useMemo(() => {
    return allTransactions
      .filter((tx) => tx.status === "Active" || tx.status === "Overdue")
      .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());
  }, [allTransactions]);

  const recentReturns = useMemo(() => {
    return allTransactions
      .filter((tx) => tx.status === "Returned")
      .sort(
        (a, b) =>
          new Date(b.date_returned ?? b.created_at).getTime() -
          new Date(a.date_returned ?? a.created_at).getTime()
      )
      .slice(0, 10);
  }, [allTransactions]);

  const executeReturn = useCallback(
    async (tx: BorrowingTransactionWithDetails) => {
      setProcessingReturn(true);
      setFeedback(null);
      try {
        const updated = await returnBook(tx.id);
        const wasLate =
          Boolean(updated.date_returned) &&
          new Date(updated.date_returned as string).getTime() >
            new Date(updated.due_date).getTime();

        let violationNotice: ReturnFeedback["violationNotice"] = null;
        if (wasLate && tx.student_id) {
          try {
            const vStatus = await getStudentViolationStatus(tx.student_id);
            if (vStatus.activeViolationCount > 0 && vStatus.currentRule) {
              const isBan =
                vStatus.currentRule.action === "ban" &&
                vStatus.currentRule.banDays > 0;
              violationNotice = {
                offenseNumber: vStatus.activeViolationCount,
                isBan,
                label: vStatus.currentRule.label,
                description: vStatus.currentRule.description,
                banEndsAt: vStatus.banEndsAt,
                banDurationLabel: formatBanDuration(vStatus.currentRule.banDays),
              };
            }
          } catch {
            // non-fatal
          }
        }

        const meta = getMaterialMeta(tx.books?.material_type);
        setFeedback({
          type: "success",
          message: wasLate
            ? `Returned ${meta.label.toLowerCase()} "${tx.books?.title ?? "material"}" from ${tx.students?.name ?? "student"} (late return — student violation recorded).`
            : `Successfully returned ${meta.label.toLowerCase()} "${tx.books?.title ?? "material"}" from ${tx.students?.name ?? "student"} on time.`,
          violationNotice,
        });
        setConfirmingTx(null);
        setManualReturnCode("");
        await loadData();
      } catch (err: unknown) {
        setFeedback({
          type: "error",
          message:
            err instanceof Error ? err.message : "Failed to process return.",
        });
      } finally {
        setProcessingReturn(false);
      }
    },
    [loadData]
  );

  const handleScanOrLookup = useCallback(
    async (decodedText: string) => {
      setScannerActive(false);
      setFeedback(null);

      const trimmed = decodedText.trim();
      if (!trimmed) return;

      let bookId: string | null = null;
      try {
        const url = new URL(trimmed, window.location.origin);
        bookId = url.searchParams.get("bookId");
      } catch {
        // not a URL
      }

      if (!bookId && /^[0-9a-f-]{36}$/i.test(trimmed)) {
        const b = await getBookById(trimmed).catch(() => null);
        bookId = b?.id ?? null;
      }
      if (!bookId) {
        const b = await getBookByAccessionNumber(trimmed).catch(() => null);
        bookId = b?.id ?? null;
      }

      const matchingTx = activeBorrows.find(
        (tx) =>
          (bookId && tx.book_id === bookId) ||
          tx.books?.accession_number?.toLowerCase() === trimmed.toLowerCase()
      );

      if (!matchingTx) {
        setFeedback({
          type: "error",
          message: `No active borrow found for "${trimmed}". It may already be returned or not checked out.`,
        });
        return;
      }

      setConfirmingTx(matchingTx);
    },
    [activeBorrows]
  );

  const filteredActive = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activeBorrows.filter((tx) => {
      const isOverdue =
        tx.status === "Overdue" || new Date(tx.due_date) < serverNow;
      if (statusFilter === "overdue" && !isOverdue) return false;
      if (statusFilter === "on-time" && isOverdue) return false;

      const mType = normalizeMaterialType(tx.books?.material_type);
      if (materialTypeFilter !== "all" && mType !== materialTypeFilter) {
        return false;
      }

      if (!q) return true;
      return (
        (tx.students?.name ?? "").toLowerCase().includes(q) ||
        (tx.students?.student_number ?? "").toLowerCase().includes(q) ||
        (tx.books?.title ?? "").toLowerCase().includes(q) ||
        (tx.books?.accession_number ?? "").toLowerCase().includes(q)
      );
    });
  }, [activeBorrows, search, statusFilter, materialTypeFilter, serverNow]);

  const overdueCount = useMemo(
    () =>
      activeBorrows.filter(
        (tx) => tx.status === "Overdue" || new Date(tx.due_date) < serverNow
      ).length,
    [activeBorrows, serverNow]
  );

  return (
    <>
      <div className="animate-fade-in-up stagger-1">
        <PageHeader
          title="Return Material"
          subtitle="Scan a material QR code or select an active loan below to process returns."
          actions={
            <Link
              href="/user/transactions/borrow"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-700 text-white text-sm font-medium hover:bg-emerald-800 transition-colors"
            >
              <ArrowUpRight className="w-4 h-4" />
              Go to Borrow
            </Link>
          }
        />
      </div>

      <TransactionSubnav />

      {feedback && (
        <div
          className={`mb-5 p-4 rounded-xl border ${
            feedback.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-900"
              : "bg-red-50 border-red-200 text-red-800"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5 text-sm">
              {feedback.type === "success" ? (
                <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              )}
              <p className="font-medium">{feedback.message}</p>
            </div>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="text-xs underline opacity-75 hover:opacity-100 shrink-0"
            >
              Dismiss
            </button>
          </div>

          {feedback.violationNotice && (
            <div
              className={`mt-3 p-3 rounded-lg border text-xs flex items-start gap-2.5 ${
                feedback.violationNotice.isBan
                  ? "bg-red-50 border-red-200 text-red-900"
                  : "bg-amber-50 border-amber-200 text-amber-900"
              }`}
            >
              {feedback.violationNotice.isBan ? (
                <Ban className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              )}
              <div>
                <p className="font-semibold">
                  {formatOrdinal(feedback.violationNotice.offenseNumber)} Violation —{" "}
                  {feedback.violationNotice.label} (
                  {feedback.violationNotice.banDurationLabel})
                </p>
                <p className="mt-0.5">{feedback.violationNotice.description}</p>
                {feedback.violationNotice.isBan && feedback.violationNotice.banEndsAt && (
                  <p className="mt-1 font-medium">
                    Borrowing restricted until{" "}
                    {formatDateTime(feedback.violationNotice.banEndsAt)}.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Quick Return Scanner Bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <ArrowDownLeft className="w-4 h-4 text-emerald-700" />
              Quick Return Lookup
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Scan the returning material&apos;s QR code or enter its Accession Number.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleScanOrLookup(manualReturnCode);
              }}
              className="flex gap-2 flex-1 sm:flex-none"
            >
              <input
                type="text"
                value={manualReturnCode}
                onChange={(e) => setManualReturnCode(e.target.value)}
                placeholder="Accession # or QR URL..."
                className="px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm w-48 sm:w-56 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <button
                type="submit"
                disabled={!manualReturnCode.trim()}
                className="px-3.5 py-2 rounded-lg bg-slate-800 text-white text-sm font-medium hover:bg-slate-900 disabled:opacity-40"
              >
                Find Loan
              </button>
            </form>
            <button
              type="button"
              onClick={() => setScannerActive((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                scannerActive
                  ? "bg-red-50 text-red-700 hover:bg-red-100"
                  : "bg-emerald-700 text-white hover:bg-emerald-800"
              }`}
            >
              {scannerActive ? (
                <>
                  <CameraOff className="w-4 h-4" />
                  Stop Scanner
                </>
              ) : (
                <>
                  <Camera className="w-4 h-4" />
                  Scan QR to Return
                </>
              )}
            </button>
          </div>
        </div>

        {scannerActive && (
          <div className="mt-5 pt-5 border-t border-slate-100">
            <QRScanner onScan={handleScanOrLookup} isActive={scannerActive} />
          </div>
        )}
      </div>

      {/* Active Loans Ready for Return */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <h3 className="text-base font-bold text-slate-900">
              Active Borrowed Items ({activeBorrows.length})
            </h3>
            {overdueCount > 0 && (
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                {overdueCount} Overdue
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 sm:flex-none">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search student, title, or accession..."
                className="w-full sm:w-56 pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as "all" | "overdue" | "on-time")
              }
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="all">All Active</option>
              <option value="overdue">Overdue Only</option>
              <option value="on-time">On Time Only</option>
            </select>
            <select
              value={materialTypeFilter}
              onChange={(e) => setMaterialTypeFilter(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="all">All Materials</option>
              {LIBRARY_MATERIAL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-500">
                <th className="py-2.5 pr-3">Material</th>
                <th className="py-2.5 px-3">Borrower</th>
                <th className="py-2.5 px-3">Date Borrowed</th>
                <th className="py-2.5 px-3">Due Date</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 pl-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loadingData ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-400">
                    Loading active loans...
                  </td>
                </tr>
              ) : filteredActive.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-400">
                    No active borrowed items pending return.
                  </td>
                </tr>
              ) : (
                filteredActive.map((tx) => {
                  const dueTime = new Date(tx.due_date).getTime();
                  const isOverdue =
                    tx.status === "Overdue" || dueTime < serverNow.getTime();
                  const daysLate = isOverdue
                    ? Math.max(
                        1,
                        Math.floor(
                          (serverNow.getTime() - dueTime) / (1000 * 60 * 60 * 24)
                        )
                      )
                    : 0;
                  const meta = getMaterialMeta(tx.books?.material_type);
                  return (
                    <tr key={tx.id} className="hover:bg-slate-50/70">
                      <td className="py-3 pr-3">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span
                            className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold ${meta.badgeClass}`}
                          >
                            {meta.label}
                          </span>
                          <span className="font-mono text-[11px] text-slate-400">
                            {tx.books?.accession_number}
                          </span>
                        </div>
                        <p className="font-medium text-slate-900">
                          {tx.books?.title ?? "—"}
                        </p>
                      </td>
                      <td className="py-3 px-3">
                        <p className="font-medium text-slate-800">
                          {tx.students?.name ?? "—"}
                        </p>
                        <p className="text-xs text-slate-500">
                          {tx.students?.student_number || tx.students?.section || ""}
                        </p>
                      </td>
                      <td className="py-3 px-3 text-xs text-slate-600">
                        {formatDateTime(tx.date_borrowed)}
                      </td>
                      <td className="py-3 px-3 text-xs">
                        <p
                          className={
                            isOverdue
                              ? "text-red-600 font-semibold"
                              : "text-slate-700"
                          }
                        >
                          {formatDateTime(tx.due_date)}
                        </p>
                        {isOverdue && (
                          <p className="text-[11px] text-red-500 mt-0.5">
                            {daysLate} day{daysLate === 1 ? "" : "s"} overdue
                          </p>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        <Badge label={isOverdue ? "Overdue" : "Active"} />
                      </td>
                      <td className="py-3 pl-3 text-right">
                        <button
                          type="button"
                          onClick={() => setConfirmingTx(tx)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800 transition-colors"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Return Item
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recently Returned Log */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2 mb-3">
          <Clock className="w-4 h-4 text-slate-500" />
          Recently Returned
        </h3>
        {recentReturns.length === 0 ? (
          <p className="text-xs text-slate-400 py-4 text-center">
            No returned transactions yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="py-2 pr-3">Material</th>
                  <th className="py-2 px-3">Student</th>
                  <th className="py-2 px-3">Returned Date &amp; Time</th>
                  <th className="py-2 pl-3 text-right">Return Standing</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentReturns.map((tx) => {
                  const wasLate =
                    Boolean(tx.date_returned) &&
                    new Date(tx.date_returned as string).getTime() >
                      new Date(tx.due_date).getTime();
                  const meta = getMaterialMeta(tx.books?.material_type);
                  return (
                    <tr key={tx.id}>
                      <td className="py-2.5 pr-3">
                        <span
                          className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold mr-1.5 ${meta.badgeClass}`}
                        >
                          {meta.label}
                        </span>
                        <span className="font-medium text-slate-800">
                          {tx.books?.title ?? "—"}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-slate-700">
                        {tx.students?.name ?? "—"}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600">
                        {tx.date_returned ? formatDateTime(tx.date_returned) : "—"}
                      </td>
                      <td className="py-2.5 pl-3 text-right">
                        {wasLate ? (
                          <span className="inline-flex px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold">
                            Late Return
                          </span>
                        ) : (
                          <span className="inline-flex px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-semibold">
                            On Time
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmModal
        open={Boolean(confirmingTx)}
        onClose={() => !processingReturn && setConfirmingTx(null)}
        onConfirm={() => {
          if (confirmingTx) void executeReturn(confirmingTx);
        }}
        title="Confirm Material Return"
        message={
          confirmingTx
            ? `Mark "${confirmingTx.books?.title ?? "this material"}" (${getMaterialMeta(confirmingTx.books?.material_type).label}) borrowed by ${confirmingTx.students?.name ?? "student"} as returned now?`
            : ""
        }
        confirmLabel="Confirm Return"
        confirming={processingReturn}
      />
    </>
  );
}
