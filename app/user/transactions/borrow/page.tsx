"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  ArrowUpRight,
  ArrowDownLeft,
  Camera,
  CameraOff,
  CheckCircle,
  Search,
  Ban,
  AlertTriangle,
  ShieldCheck,
  BookOpen,
  User,
  Clock,
  RotateCcw,
} from "lucide-react";
import PageHeader from "@/components/ui/page-header";
import TransactionSubnav from "@/components/transactions/transaction-subnav";
import Badge from "@/components/ui/badge";
import {
  getAvailableBooks,
  getBookByAccessionNumber,
  getBookById,
} from "@/lib/supabase/books";
import { getStudentByNumber } from "@/lib/supabase/students";
import { borrowBook, getActiveTransactions } from "@/lib/supabase/transactions";
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
import type {
  BookWithClassification,
  BorrowingTransactionWithDetails,
  Student,
  StudentViolationStatus,
} from "@/lib/types";

const QRScanner = dynamic(() => import("@/components/qr-scanner"), {
  ssr: false,
  loading: () => (
    <div className="w-[288px] h-[288px] mx-auto bg-slate-100 rounded-lg flex items-center justify-center">
      <p className="text-slate-500 text-sm">Loading scanner...</p>
    </div>
  ),
});

export default function BorrowTransactionPage() {
  const [availableMaterials, setAvailableMaterials] = useState<BookWithClassification[]>([]);
  const [activeBorrows, setActiveBorrows] = useState<BorrowingTransactionWithDetails[]>([]);
  const [serverNow, setServerNow] = useState<Date>(() => getServerNow());
  const [loadingData, setLoadingData] = useState(true);

  // Borrow form state
  const [scannerActive, setScannerActive] = useState(false);
  const [materialSearch, setMaterialSearch] = useState("");
  const [materialTypeFilter, setMaterialTypeFilter] = useState("all");
  const [selectedMaterial, setSelectedMaterial] = useState<BookWithClassification | null>(null);

  const [studentNumber, setStudentNumber] = useState("");
  const [student, setStudent] = useState<Student | null>(null);
  const [studentViolation, setStudentViolation] = useState<StudentViolationStatus | null>(null);
  const [studentLoading, setStudentLoading] = useState(false);
  const [studentError, setStudentError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // Active borrows list search/filter
  const [activeSearch, setActiveSearch] = useState("");
  const [activeTypeFilter, setActiveTypeFilter] = useState("all");

  const loadData = useCallback(async () => {
    try {
      const [avail, active, now] = await Promise.all([
        getAvailableBooks(),
        getActiveTransactions(),
        ensureServerNow(),
      ]);
      setAvailableMaterials(avail);
      setActiveBorrows(active);
      setServerNow(now);
    } catch {
      // silent
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    Promise.all([getAvailableBooks(), getActiveTransactions(), ensureServerNow()])
      .then(([avail, active, now]) => {
        if (!mounted) return;
        setAvailableMaterials(avail);
        setActiveBorrows(active);
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

  const handleScanCode = useCallback(async (decodedText: string) => {
    setScannerActive(false);
    setFeedback(null);

    const trimmed = decodedText.trim();
    let found: BookWithClassification | null = null;

    try {
      const url = new URL(trimmed, window.location.origin);
      const bookId = url.searchParams.get("bookId");
      if (bookId) {
        found = await getBookById(bookId).catch(() => null);
      }
    } catch {
      // not a URL
    }

    if (!found && trimmed) {
      found = await getBookByAccessionNumber(trimmed).catch(() => null);
    }
    if (!found && /^[0-9a-f-]{36}$/i.test(trimmed)) {
      found = await getBookById(trimmed).catch(() => null);
    }

    if (!found) {
      setFeedback({
        type: "error",
        message: `No library material found for code "${trimmed}".`,
      });
      return;
    }

    if (found.status !== "Available") {
      setFeedback({
        type: "error",
        message: `"${found.title}" is currently ${found.status}. Use the Return submenu if it needs to be returned.`,
      });
      return;
    }

    if (found.is_library_use_only) {
      setFeedback({
        type: "error",
        message: `"${found.title}" is marked Library Use Only and cannot be borrowed.`,
      });
      return;
    }

    setSelectedMaterial(found);
  }, []);

  const handleStudentLookup = async (value: string) => {
    setStudentNumber(value);
    setStudentError(null);
    setStudentViolation(null);
    if (!value.trim()) {
      setStudent(null);
      return;
    }
    setStudentLoading(true);
    try {
      const found = await getStudentByNumber(value.trim());
      setStudent(found);
      if (!found) {
        setStudentError(`No student found with ID "${value.trim()}".`);
      } else {
        const vStatus = await getStudentViolationStatus(found.id).catch(() => null);
        setStudentViolation(vStatus);
      }
    } catch {
      setStudent(null);
      setStudentError(`No student found with ID "${value.trim()}".`);
    } finally {
      setStudentLoading(false);
    }
  };

  const handleConfirmBorrow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMaterial || !student || !studentNumber.trim()) return;
    if (studentViolation?.isBanned) return;

    setSubmitting(true);
    setFeedback(null);
    try {
      await borrowBook(studentNumber.trim(), selectedMaterial.id, undefined, {
        borrowOnly: true,
      });
      const meta = getMaterialMeta(selectedMaterial.material_type);
      setFeedback({
        type: "success",
        message: `Checked out ${meta.label.toLowerCase()} "${selectedMaterial.title}" to ${student.name}. Due in 5 days.`,
      });
      setSelectedMaterial(null);
      setStudentNumber("");
      setStudent(null);
      setStudentViolation(null);
      setMaterialSearch("");
      await loadData();
    } catch (err: unknown) {
      setFeedback({
        type: "error",
        message:
          err instanceof Error ? err.message : "Failed to process borrow.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const filteredAvailable = useMemo(() => {
    const q = materialSearch.trim().toLowerCase();
    return availableMaterials.filter((m) => {
      const mType = normalizeMaterialType(m.material_type);
      const matchesType =
        materialTypeFilter === "all" || mType === materialTypeFilter;
      const matchesSearch =
        !q ||
        m.title.toLowerCase().includes(q) ||
        m.author.toLowerCase().includes(q) ||
        m.accession_number.toLowerCase().includes(q) ||
        mType.toLowerCase().includes(q);
      return matchesType && matchesSearch;
    });
  }, [availableMaterials, materialSearch, materialTypeFilter]);

  const filteredActive = useMemo(() => {
    const q = activeSearch.trim().toLowerCase();
    return activeBorrows.filter((tx) => {
      const mType = normalizeMaterialType(tx.books?.material_type);
      const matchesType = activeTypeFilter === "all" || mType === activeTypeFilter;
      const matchesSearch =
        !q ||
        (tx.students?.name ?? "").toLowerCase().includes(q) ||
        (tx.students?.student_number ?? "").toLowerCase().includes(q) ||
        (tx.books?.title ?? "").toLowerCase().includes(q) ||
        (tx.books?.accession_number ?? "").toLowerCase().includes(q);
      return matchesType && matchesSearch;
    });
  }, [activeBorrows, activeSearch, activeTypeFilter]);

  const isBorrowBlocked = Boolean(studentViolation?.isBanned);
  const duePreview = useMemo(() => {
    const due = new Date(serverNow.getTime() + 5 * 24 * 60 * 60 * 1000);
    return due.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }, [serverNow]);

  return (
    <>
      <div className="animate-fade-in-up stagger-1">
        <PageHeader
          title="Borrow Material"
          subtitle="Check out available books, magazines, journals, newspapers, theses, and other library materials."
          actions={
            <Link
              href="/user/transactions/return"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <ArrowDownLeft className="w-4 h-4 text-emerald-700" />
              Switch to Return
            </Link>
          }
        />
      </div>

      <TransactionSubnav />

      {feedback && (
        <div
          className={`mb-5 p-4 rounded-xl border flex items-start justify-between gap-3 ${
            feedback.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-900"
              : "bg-red-50 border-red-200 text-red-800"
          }`}
        >
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
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Borrow Form & QR Scanner */}
        <div className="lg:col-span-5 space-y-5">
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center justify-between gap-2 mb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <ArrowUpRight className="w-4 h-4 text-emerald-700" />
                  New Borrow Checkout
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Select an available item or scan its QR code, then enter the student ID.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setScannerActive((prev) => !prev)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0 ${
                  scannerActive
                    ? "bg-red-50 text-red-700 hover:bg-red-100"
                    : "bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100"
                }`}
              >
                {scannerActive ? (
                  <>
                    <CameraOff className="w-3.5 h-3.5" />
                    Close Scanner
                  </>
                ) : (
                  <>
                    <Camera className="w-3.5 h-3.5" />
                    Scan QR
                  </>
                )}
              </button>
            </div>

            {scannerActive && (
              <div className="mb-5 pb-5 border-b border-slate-100">
                <QRScanner onScan={handleScanCode} isActive={scannerActive} />
              </div>
            )}

            <form onSubmit={handleConfirmBorrow} className="space-y-4">
              {/* Step 1: Material Selection */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
                  1. Select Library Material
                </label>

                {selectedMaterial ? (
                  <div className="p-3.5 rounded-lg bg-emerald-50/70 border border-emerald-200 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 mb-1">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ${
                            getMaterialMeta(selectedMaterial.material_type).badgeClass
                          }`}
                        >
                          {getMaterialMeta(selectedMaterial.material_type).label}
                        </span>
                        <span className="font-mono text-xs text-slate-500">
                          {selectedMaterial.accession_number}
                        </span>
                      </div>
                      <p className="text-sm font-semibold text-slate-900 truncate">
                        {selectedMaterial.title}
                      </p>
                      <p className="text-xs text-slate-600">
                        {selectedMaterial.author}
                        {selectedMaterial.classifications?.name
                          ? ` • ${selectedMaterial.classifications.name}`
                          : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedMaterial(null)}
                      className="text-xs font-medium text-emerald-700 hover:text-emerald-900 shrink-0"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          type="text"
                          value={materialSearch}
                          onChange={(e) => setMaterialSearch(e.target.value)}
                          placeholder="Search title, creator, or accession #..."
                          className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>
                      <select
                        value={materialTypeFilter}
                        onChange={(e) => setMaterialTypeFilter(e.target.value)}
                        className="px-2.5 py-2 rounded-lg border border-slate-200 bg-slate-50 text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      >
                        <option value="all">All Types</option>
                        {LIBRARY_MATERIAL_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="max-h-52 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100 bg-white">
                      {loadingData ? (
                        <p className="p-4 text-xs text-center text-slate-400">
                          Loading available materials...
                        </p>
                      ) : filteredAvailable.length === 0 ? (
                        <p className="p-4 text-xs text-center text-slate-400">
                          No borrowable materials match your search.
                        </p>
                      ) : (
                        filteredAvailable.slice(0, 30).map((item) => {
                          const meta = getMaterialMeta(item.material_type);
                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => setSelectedMaterial(item)}
                              className="w-full text-left px-3 py-2.5 hover:bg-emerald-50/60 transition-colors flex items-start justify-between gap-2"
                            >
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-slate-900 truncate">
                                  {item.title}
                                </p>
                                <p className="text-xs text-slate-500 truncate">
                                  {item.author} •{" "}
                                  <span className="font-mono">{item.accession_number}</span>
                                </p>
                              </div>
                              <span
                                className={`shrink-0 px-2 py-0.5 rounded text-[11px] font-semibold ${meta.badgeClass}`}
                              >
                                {meta.label}
                              </span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Step 2: Student Lookup */}
              <div>
                <label
                  htmlFor="borrow-student-id"
                  className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5"
                >
                  2. Student ID Number
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="borrow-student-id"
                    type="text"
                    value={studentNumber}
                    onChange={(e) => handleStudentLookup(e.target.value)}
                    placeholder="Enter student ID (e.g. 2024-0001)"
                    className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                {studentLoading && (
                  <p className="text-xs text-slate-400 mt-1.5">Looking up student...</p>
                )}
                {studentError && (
                  <p className="text-xs text-red-600 mt-1.5">{studentError}</p>
                )}
                {student && (
                  <div className="mt-2 p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          {student.name}
                        </p>
                        <p className="text-xs text-slate-500">
                          {student.student_number}
                          {student.section ? ` • ${student.section}` : ""}
                        </p>
                      </div>
                      {studentViolation && (
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold ${
                            studentViolation.standingTone === "red"
                              ? "bg-red-100 text-red-700"
                              : studentViolation.standingTone === "amber"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-emerald-100 text-emerald-700"
                          }`}
                        >
                          {studentViolation.standingTone === "red" ? (
                            <Ban className="w-3 h-3" />
                          ) : studentViolation.standingTone === "amber" ? (
                            <AlertTriangle className="w-3 h-3" />
                          ) : (
                            <ShieldCheck className="w-3 h-3" />
                          )}
                          {studentViolation.standingLabel}
                        </span>
                      )}
                    </div>

                    {studentViolation?.isBanned && (
                      <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
                        <p className="font-semibold">
                          Borrowing Restricted (
                          {formatOrdinal(studentViolation.activeViolationCount)} violation —{" "}
                          {studentViolation.currentRule
                            ? formatBanDuration(studentViolation.currentRule.banDays)
                            : "Suspended"}
                          )
                        </p>
                        <p className="mt-0.5">
                          {studentViolation.blockedByUnreturnedOverdue
                            ? "Student must return their overdue material before borrowing again."
                            : studentViolation.banEndsAt
                            ? `Restricted until ${formatDateTime(studentViolation.banEndsAt)}.`
                            : "Student is currently restricted from borrowing."}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Loan Info */}
              <div className="flex items-center justify-between text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">
                <span className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  Standard 5-day loan period
                </span>
                <span className="font-medium text-slate-700">Due {duePreview}</span>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="submit"
                  disabled={
                    !selectedMaterial ||
                    !student ||
                    isBorrowBlocked ||
                    submitting
                  }
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-700 text-white text-sm font-semibold hover:bg-emerald-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <CheckCircle className="w-4 h-4" />
                  {submitting
                    ? "Processing..."
                    : isBorrowBlocked
                    ? "Borrowing Restricted"
                    : "Confirm Borrow"}
                </button>
                {(selectedMaterial || studentNumber) && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedMaterial(null);
                      setStudentNumber("");
                      setStudent(null);
                      setStudentViolation(null);
                      setStudentError(null);
                    }}
                    className="p-2.5 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-700 hover:bg-slate-50"
                    title="Clear form"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>

        {/* Right: Currently Borrowed Items */}
        <div className="lg:col-span-7">
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-emerald-700" />
                  Currently Borrowed ({activeBorrows.length})
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Materials currently checked out to students.
                </p>
              </div>
              <div className="flex gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={activeSearch}
                    onChange={(e) => setActiveSearch(e.target.value)}
                    placeholder="Filter borrows..."
                    className="pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 w-40 sm:w-48"
                  />
                </div>
                <select
                  value={activeTypeFilter}
                  onChange={(e) => setActiveTypeFilter(e.target.value)}
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
                    <th className="py-2.5 px-3">Student</th>
                    <th className="py-2.5 px-3">Borrowed / Due</th>
                    <th className="py-2.5 pl-3 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loadingData ? (
                    <tr>
                      <td colSpan={4} className="py-10 text-center text-slate-400 text-sm">
                        Loading borrowed items...
                      </td>
                    </tr>
                  ) : filteredActive.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-10 text-center text-slate-400 text-sm">
                        No active borrowed items found.
                      </td>
                    </tr>
                  ) : (
                    filteredActive.map((tx) => {
                      const isOverdue =
                        tx.status === "Overdue" ||
                        new Date(tx.due_date) < serverNow;
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
                            <p className="font-medium text-slate-900 leading-snug">
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
                          <td className="py-3 px-3 text-xs">
                            <p className="text-slate-700">
                              {formatDateTime(tx.date_borrowed)}
                            </p>
                            <p
                              className={
                                isOverdue
                                  ? "text-red-600 font-semibold mt-0.5"
                                  : "text-slate-500 mt-0.5"
                              }
                            >
                              Due {formatDateTime(tx.due_date)}
                            </p>
                          </td>
                          <td className="py-3 pl-3 text-right">
                            <Badge label={isOverdue ? "Overdue" : "Active"} />
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
