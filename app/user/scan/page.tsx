"use client";

import { useState, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import {
  Camera,
  CameraOff,
  CheckCircle,
  RotateCcw,
  ShieldAlert,
  AlertTriangle,
  Ban,
  ShieldCheck,
  Search,
} from "lucide-react";
import Modal from "@/components/ui/modal";
import { getBookById, getBookByAccessionNumber } from "@/lib/supabase/books";
import { getStudentByNumber } from "@/lib/supabase/students";
import { borrowBook } from "@/lib/supabase/transactions";
import {
  formatBanDuration,
  formatOrdinal,
  getStudentViolationStatus,
} from "@/lib/supabase/violations";
import { formatDateTime } from "@/lib/reports-excel";
import { getServerDateString, syncServerClock } from "@/lib/server-clock";
import type { BookWithClassification, Student, StudentViolationStatus } from "@/lib/types";

const QRScanner = dynamic(() => import("@/components/qr-scanner"), {
  ssr: false,
  loading: () => (
    <div className="w-[288px] h-[288px] mx-auto bg-slate-100 rounded-lg flex items-center justify-center">
      <p className="text-slate-500 text-sm">Loading scanner...</p>
    </div>
  ),
});

type Step = "scan" | "form" | "result";

export default function ScanPage() {
  const [step, setStep] = useState<Step>("scan");
  const [scannerActive, setScannerActive] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [bookInfo, setBookInfo] = useState<BookWithClassification | null>(null);
  const [studentName, setStudentName] = useState("");
  const [student, setStudent] = useState<Student | null>(null);
  const [studentViolation, setStudentViolation] = useState<StudentViolationStatus | null>(null);
  const [studentLoading, setStudentLoading] = useState(false);
  const [studentError, setStudentError] = useState<string | null>(null);
  const [dateBorrowed, setDateBorrowed] = useState(() => getServerDateString());

  useEffect(() => {
    syncServerClock().then(() => {
      setDateBorrowed(getServerDateString());
    });
  }, []);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
    violationNotice?: {
      offenseNumber: number;
      isBan: boolean;
      label: string;
      description: string;
      banEndsAt: string | null;
      banDurationLabel: string;
    } | null;
  } | null>(null);

  const buildLateReturnNotice = async (studentId: string) => {
    try {
      const status = await getStudentViolationStatus(studentId);
      if (status.activeViolationCount <= 0 || !status.currentRule) return null;
      const isBan = status.currentRule.action === "ban" && status.currentRule.banDays > 0;
      return {
        offenseNumber: status.activeViolationCount,
        isBan,
        label: status.currentRule.label,
        description: status.currentRule.description,
        banEndsAt: status.banEndsAt,
        banDurationLabel: formatBanDuration(status.currentRule.banDays),
      };
    } catch {
      return null;
    }
  };

  const handleQRScan = useCallback(async (decodedText: string) => {
    setScannerActive(false);
    setLoading(true);

    try {
      const trimmed = decodedText.trim();
      let book: BookWithClassification | null = null;

      try {
        const url = new URL(trimmed, window.location.origin);
        const bookId = url.searchParams.get("bookId");
        if (bookId) {
          book = await getBookById(bookId).catch(() => null);
        }
      } catch {
        // Not a valid URL
      }

      if (!book && trimmed) {
        book = await getBookByAccessionNumber(trimmed).catch(() => null);
      }
      if (!book && /^[0-9a-f-]{36}$/i.test(trimmed)) {
        book = await getBookById(trimmed).catch(() => null);
      }

      if (!book) {
        setResult({
          success: false,
          message: `No book found for code: ${decodedText}`,
        });
        setStep("result");
        return;
      }

      setBookInfo(book);

      // If book is already borrowed, auto-return it
      if (book.status === "Borrowed") {
        setLoading(true);
        try {
          const tx = await borrowBook("", book.id);
          const wasLate =
            Boolean(tx.date_returned) &&
            new Date(tx.date_returned as string).getTime() > new Date(tx.due_date).getTime();
          const violationNotice = wasLate
            ? await buildLateReturnNotice(tx.student_id)
            : null;
          setResult({
            success: true,
            message: wasLate
              ? `Returned "${book.title}" (overdue return — student violation recorded).`
              : `Successfully returned "${book.title}" on time.`,
            violationNotice,
          });
          setStep("result");
        } catch (err: unknown) {
          setResult({
            success: false,
            message:
              err instanceof Error ? err.message : "Failed to return book.",
          });
          setStep("result");
        } finally {
          setLoading(false);
        }
        return;
      }

      // Book is available, show borrow form
      setStep("form");
    } catch {
      setResult({
        success: false,
        message: "Failed to look up book. Please try again.",
      });
      setStep("result");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleStudentLookup = async (value: string) => {
    setStudentName(value);
    setStudentError(null);
    setStudentViolation(null);
    if (!value.trim()) {
      setStudent(null);
      return;
    }
    setStudentLoading(true);
    try {
      const s = await getStudentByNumber(value.trim());
      setStudent(s);
      if (!s) {
        setStudentError(`No student found with ID "${value.trim()}".`);
      } else {
        const vStatus = await getStudentViolationStatus(s.id).catch(() => null);
        setStudentViolation(vStatus);
      }
    } catch {
      setStudent(null);
      setStudentError(`No student found with ID "${value.trim()}".`);
    } finally {
      setStudentLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!bookInfo || !studentName.trim()) return;
    if (!student) {
      setStudentError("Please enter a valid student ID.");
      return;
    }

    setLoading(true);
    try {
      const tx = await borrowBook(studentName.trim(), bookInfo.id);
      const wasReturned = tx.status === "Returned";
      const wasLate =
        wasReturned &&
        Boolean(tx.date_returned) &&
        new Date(tx.date_returned as string).getTime() > new Date(tx.due_date).getTime();
      const violationNotice = wasLate
        ? await buildLateReturnNotice(tx.student_id)
        : null;

      setResult({
        success: true,
        message: wasReturned
          ? wasLate
            ? `Returned "${bookInfo.title}" for ${student.name} (late return — violation recorded).`
            : `Successfully returned "${bookInfo.title}" for ${student.name}.`
          : `Successfully borrowed "${bookInfo.title}" for ${student.name}.`,
        violationNotice,
      });
      setStep("result");
    } catch (err: unknown) {
      setResult({
        success: false,
        message:
          err instanceof Error ? err.message : "Failed to process borrow.",
      });
      setStep("result");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setStep("scan");
    setScannerActive(false);
    setManualCode("");
    setBookInfo(null);
    setStudentName("");
    setStudent(null);
    setStudentViolation(null);
    setStudentError(null);
    setDateBorrowed(getServerDateString());
    setResult(null);
  };

  const isBorrowBlocked = Boolean(studentViolation?.isBanned);

  return (
    <>
      {/* Header */}
      <div className="mb-6 animate-fade-in-up stagger-1">
        <h2 className="text-xl sm:text-2xl font-bold text-slate-900">
          Borrow / Return
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          Scan a book QR code to borrow or return a library item.
        </p>
      </div>

      <div className="max-w-2xl mx-auto">
        {/* Step Indicator */}
        <div className="flex items-center justify-center gap-2 mb-6 animate-fade-in-up stagger-2">
          {["scan", "form", "result"].map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${
                  step === s
                    ? "bg-emerald-700 text-white"
                    : i < ["scan", "form", "result"].indexOf(step)
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-slate-100 text-slate-400"
                }`}
              >
                {i + 1}
              </div>
              {i < 2 && (
                <div
                  className={`w-12 h-0.5 ${
                    i < ["scan", "form", "result"].indexOf(step)
                      ? "bg-emerald-700"
                      : "bg-slate-200"
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        {/* Scanner Step */}
        {step === "scan" && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 animate-fade-in-up stagger-3">
            <div className="text-center mb-4">
              <h3 className="text-lg font-bold text-slate-900">
                Scan Book QR Code
              </h3>
              <p className="text-sm text-slate-500 mt-1">
                {scannerActive
                  ? "Point your camera at the book's QR code."
                  : "Press Start Scanner to turn on your camera."}
              </p>
            </div>

            {scannerActive ? (
              <QRScanner onScan={handleQRScan} isActive={scannerActive} />
            ) : (
              <div className="w-[288px] h-[288px] mx-auto bg-slate-100 rounded-lg flex flex-col items-center justify-center gap-3">
                <Camera className="w-8 h-8 text-slate-400" />
                <p className="text-xs text-slate-500 px-6 text-center">
                  Camera is off. Starting it with a tap keeps playback
                  inside a user gesture.
                </p>
              </div>
            )}

            <div className="flex justify-center mt-4">
              <button
                onClick={() => setScannerActive(!scannerActive)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
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
                    Start Scanner
                  </>
                )}
              </button>
            </div>

            {/* Manual Accession # / USB Scanner Fallback */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (manualCode.trim()) {
                  void handleQRScan(manualCode.trim());
                }
              }}
              className="mt-6 pt-5 border-t border-slate-100 max-w-md mx-auto"
            >
              <label
                htmlFor="manual-book-code"
                className="block text-xs font-medium text-slate-500 mb-1.5 text-center"
              >
                Or enter Book Accession Number / QR link manually
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="manual-book-code"
                    type="text"
                    value={manualCode}
                    onChange={(e) => setManualCode(e.target.value)}
                    placeholder="e.g. ACC-0001 or paste QR URL"
                    className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!manualCode.trim() || loading}
                  className="px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-medium hover:bg-slate-900 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                >
                  {loading ? "Looking up..." : "Lookup"}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Borrowing Details Modal */}
        <Modal
          open={step === "form" && !!bookInfo}
          onClose={handleReset}
          title="Borrowing Details"
          subtitle={bookInfo ? `${bookInfo.title} • ${bookInfo.accession_number}` : undefined}
          size="lg"
          footer={
            <>
              <button
                onClick={handleReset}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                Scan New Book
              </button>
              <button
                onClick={handleSubmit}
                disabled={!studentName.trim() || !student || isBorrowBlocked || loading}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg bg-emerald-700 text-white text-sm font-semibold hover:bg-emerald-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <CheckCircle className="w-4 h-4" />
                {loading
                  ? "Processing..."
                  : isBorrowBlocked
                  ? "Borrowing Restricted"
                  : "Confirm Borrow"}
              </button>
            </>
          }
        >
          {bookInfo && (
            <div className="space-y-6">
              <div>
                <h4 className="text-sm font-semibold text-slate-700 mb-3">
                  Book Information
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      Title
                    </label>
                    <input
                      type="text"
                      value={bookInfo.title}
                      readOnly
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-slate-50 text-slate-700"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      Author
                    </label>
                    <input
                      type="text"
                      value={bookInfo.author}
                      readOnly
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-slate-50 text-slate-700"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      Accession Number
                    </label>
                    <input
                      type="text"
                      value={bookInfo.accession_number}
                      readOnly
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-slate-50 text-slate-700"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      Status
                    </label>
                    <input
                      type="text"
                      value={bookInfo.status}
                      readOnly
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-slate-50 text-slate-700"
                    />
                  </div>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-slate-700 mb-3">
                  Student Information
                </h4>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Student ID
                </label>
                <input
                  type="text"
                  value={studentName}
                  onChange={(e) => handleStudentLookup(e.target.value)}
                  placeholder="Enter student ID"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                />
                {studentLoading && (
                  <p className="text-xs text-slate-400 mt-1">Looking up student &amp; violation record...</p>
                )}
                {studentError && (
                  <p className="text-xs text-red-600 mt-1">{studentError}</p>
                )}
                {student && !studentLoading && (
                  <div className="mt-2 space-y-2">
                    <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium text-emerald-900">{student.name}</p>
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
                              <Ban className="w-3.5 h-3.5" />
                            ) : studentViolation.standingTone === "amber" ? (
                              <AlertTriangle className="w-3.5 h-3.5" />
                            ) : (
                              <ShieldCheck className="w-3.5 h-3.5" />
                            )}
                            {studentViolation.standingLabel}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-emerald-700 mt-0.5">Section: {student.section}</p>
                      {student.grade_level && (
                        <p className="text-xs text-emerald-700">Grade: {student.grade_level}</p>
                      )}
                      {student.program && (
                        <p className="text-xs text-emerald-700">Program: {student.program}</p>
                      )}
                    </div>

                    {studentViolation?.isBanned && (
                      <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 flex items-start gap-2">
                        <ShieldAlert className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold text-red-900">
                            Borrowing Forbidden — {formatOrdinal(studentViolation.activeViolationCount)} Violation
                          </p>
                          <p className="mt-0.5">
                            {studentViolation.blockedByUnreturnedOverdue
                              ? "Student still has an unreturned overdue book. Return it first before borrowing."
                              : studentViolation.banEndsAt
                              ? `Restricted until ${formatDateTime(studentViolation.banEndsAt)} (${studentViolation.banRemainingLabel}).`
                              : studentViolation.currentRule?.description}
                          </p>
                        </div>
                      </div>
                    )}

                    {studentViolation && !studentViolation.isBanned && studentViolation.activeViolationCount > 0 && (
                      <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold text-amber-900">
                            Prior Violation Notice ({studentViolation.activeViolationCount} active)
                          </p>
                          <p className="mt-0.5">
                            Borrowing is allowed, but the next late return will escalate to the{" "}
                            {formatOrdinal(studentViolation.activeViolationCount + 1)} violation tier.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div>
                <h4 className="text-sm font-semibold text-slate-700 mb-3">
                  Transaction Details
                </h4>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Date Borrowed
                </label>
                <input
                  type="date"
                  value={dateBorrowed}
                  readOnly
                  className="w-full sm:w-auto px-3 py-2 rounded-lg border border-slate-200 text-sm bg-slate-50 text-slate-600"
                />
              </div>
            </div>
          )}
        </Modal>

        {/* Result Modal */}
        <Modal
          open={step === "result" && !!result}
          onClose={handleReset}
          title={result?.success ? "Success" : "Borrowing Blocked / Error"}
          size="sm"
          footer={
            <button
              onClick={handleReset}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-emerald-700 text-white text-sm font-semibold hover:bg-emerald-800 transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Scan Another Book
            </button>
          }
        >
          {result && (
            <div className="text-center">
              <p className="text-sm text-slate-600 mb-4">{result.message}</p>
              {result.violationNotice && (
                <div
                  className={`mb-2 p-4 rounded-lg border text-left ${
                    result.violationNotice.isBan
                      ? "bg-red-50 border-red-200"
                      : "bg-amber-50 border-amber-200"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    {result.violationNotice.isBan ? (
                      <Ban className="w-5 h-5 text-red-600 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
                    )}
                    <span
                      className={`font-semibold text-sm ${
                        result.violationNotice.isBan ? "text-red-900" : "text-amber-900"
                      }`}
                    >
                      {formatOrdinal(result.violationNotice.offenseNumber)} Violation —{" "}
                      {result.violationNotice.label}
                    </span>
                  </div>
                  <p
                    className={`text-xs ${
                      result.violationNotice.isBan ? "text-red-700" : "text-amber-800"
                    }`}
                  >
                    {result.violationNotice.description}
                  </p>
                  {result.violationNotice.isBan && result.violationNotice.banEndsAt && (
                    <p className="text-xs font-semibold text-red-800 mt-2">
                      Forbidden from borrowing for {result.violationNotice.banDurationLabel} (until{" "}
                      {formatDateTime(result.violationNotice.banEndsAt)}).
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </Modal>
      </div>
    </>
  );
}
