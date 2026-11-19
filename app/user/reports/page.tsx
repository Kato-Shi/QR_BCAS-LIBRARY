"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Download,
  Printer,
  BarChart3,
  DollarSign,
  FileSpreadsheet,
  Eye,
  BookOpen,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Calendar,
  Layers,
} from "lucide-react";
import PageHeader from "@/components/ui/page-header";
import Select from "@/components/ui/select";
import StatsCard from "@/components/ui/stats-card";
import Badge from "@/components/ui/badge";
import GroupedBarChartCard from "@/components/charts/grouped-bar-chart-card";
import DonutChartCard from "@/components/charts/donut-chart-card";
import ExcelReportPreviewModal from "@/components/ui/excel-report-preview-modal";
import {
  getDashboardStats,
  getMostBorrowedBooks,
  getWeekBounds,
  buildWeeklyCirculationFromTransactions,
  toLocalDateKey,
} from "@/lib/supabase/dashboard";
import { getTransactions } from "@/lib/supabase/transactions";
import {
  getFineSettings,
  getFinesLedger,
  type FineLedgerItem,
} from "@/lib/supabase/fines";
import { getSchoolYearSummaries } from "@/lib/supabase/school-years";
import { getEffectiveSession } from "@/lib/client-session";
import { ensureServerNow, getServerDateString, getServerNow } from "@/lib/server-clock";
import { requestPrint } from "@/lib/print";
import {
  categorizeTransactions,
  buildFullReportPreviewSheets,
  exportFullLibraryExcel,
  formatDateParts,
  formatDateTime,
  type FullLibraryReportInput,
} from "@/lib/reports-excel";
import type {
  BorrowingTransactionWithDetails,
  DashboardStats,
  FineSetting,
  MostBorrowedBookRow,
  SchoolYearSummary,
} from "@/lib/types";
import type { SessionData } from "@/app/auth/actions";

const REPORT_LABELS: Record<string, string> = {
  circulation: "Circulation Summary",
  borrowed: "Currently Borrowed (On Time)",
  overdue: "Overdue Report",
  fines: "Fines Ledger Report",
  popular: "Popular Books Report",
  "school-years": "School Year Summary",
};

type WeekPreset = "this-week" | "last-week" | "2-weeks-ago" | "3-weeks-ago" | "custom";

const WEEK_PRESET_LABELS: Record<WeekPreset, string> = {
  "this-week": "This Week",
  "last-week": "Last Week",
  "2-weeks-ago": "2 Weeks Ago",
  "3-weeks-ago": "3 Weeks Ago",
  custom: "Custom Week",
};

function escCsv(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function downloadCsv(filename: string, rows: unknown[][]) {
  const csv = rows.map((row) => row.map(escCsv).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function parseLocalDateInput(dateStr: string, fallback: Date): Date {
  const parts = dateStr.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return fallback;
  return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0);
}

function DateTimeCell({ iso, emphasis }: { iso: string | null | undefined; emphasis?: "red" | "blue" }) {
  const { date, time } = formatDateParts(iso);
  return (
    <div className="leading-tight whitespace-nowrap">
      <div
        className={`text-sm font-medium ${
          emphasis === "red"
            ? "text-red-700"
            : emphasis === "blue"
            ? "text-blue-700"
            : "text-slate-700"
        }`}
      >
        {date}
      </div>
      {time && <div className="text-xs text-slate-400 mt-0.5">{time}</div>}
    </div>
  );
}

export default function ReportsPage() {
  const [reportType, setReportType] = useState("circulation");
  const [weekPreset, setWeekPreset] = useState<WeekPreset>("this-week");
  const [customWeekDate, setCustomWeekDate] = useState<string>(() => toLocalDateKey(getServerNow()));
  const [activeSnapshotTab, setActiveSnapshotTab] = useState<"borrowed" | "overdue" | "categories">("borrowed");

  const [excelModalOpen, setExcelModalOpen] = useState(false);
  const [excelInitialSheet, setExcelInitialSheet] = useState<string | undefined>(undefined);
  const [exportingExcel, setExportingExcel] = useState(false);

  const [session, setSession] = useState<SessionData | null>(null);
  const [serverNow, setServerNow] = useState<Date>(() => getServerNow());
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [transactions, setTransactions] = useState<BorrowingTransactionWithDetails[]>([]);
  const [mostBorrowed, setMostBorrowed] = useState<MostBorrowedBookRow[]>([]);
  const [fineSettings, setFineSettings] = useState<Pick<FineSetting, "fine_rate_per_day" | "max_fine">>({
    fine_rate_per_day: 5,
    max_fine: 500,
  });
  const [finesLedger, setFinesLedger] = useState<FineLedgerItem[]>([]);
  const [pendingFines, setPendingFines] = useState(0);
  const [paidFines, setPaidFines] = useState(0);
  const [schoolYearSummaries, setSchoolYearSummaries] = useState<SchoolYearSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getEffectiveSession().then(setSession).catch(() => {});
  }, []);

  useEffect(() => {
    async function fetchAll() {
      setLoading(true);
      try {
        const [
          nowFromServer,
          statsData,
          txData,
          borrowedData,
          settingsData,
          ledgerData,
          summaries,
        ] = await Promise.all([
          ensureServerNow(),
          getDashboardStats(),
          getTransactions(),
          getMostBorrowedBooks(10),
          getFineSettings(),
          getFinesLedger(),
          getSchoolYearSummaries(),
        ]);
        setServerNow(nowFromServer);
        setCustomWeekDate(toLocalDateKey(nowFromServer));
        setStats(statsData);
        setTransactions(txData);
        setMostBorrowed(borrowedData);
        setFineSettings({
          fine_rate_per_day: settingsData.fine_rate_per_day,
          max_fine: settingsData.max_fine,
        });
        setFinesLedger(ledgerData.items);
        setPendingFines(ledgerData.pendingTotal);
        setPaidFines(ledgerData.paidTotal);
        setSchoolYearSummaries(summaries);
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    }
    fetchAll();
  }, []);

  // Resolve the selected Monday–Sunday calendar week
  const selectedWeekBounds = useMemo(() => {
    const base = new Date(serverNow);
    if (weekPreset === "this-week") return getWeekBounds(base);
    if (weekPreset === "last-week") {
      base.setDate(base.getDate() - 7);
      return getWeekBounds(base);
    }
    if (weekPreset === "2-weeks-ago") {
      base.setDate(base.getDate() - 14);
      return getWeekBounds(base);
    }
    if (weekPreset === "3-weeks-ago") {
      base.setDate(base.getDate() - 21);
      return getWeekBounds(base);
    }
    return getWeekBounds(parseLocalDateInput(customWeekDate, serverNow));
  }, [weekPreset, customWeekDate, serverNow]);

  const currentWeekIsoStart = useMemo(
    () => getWeekBounds(serverNow).isoStart,
    [serverNow]
  );

  const shiftSelectedWeek = (deltaWeeks: number) => {
    const target = new Date(selectedWeekBounds.start);
    target.setDate(target.getDate() + deltaWeeks * 7);
    const targetBounds = getWeekBounds(target);

    // Match back to a named preset when possible
    const thisWeekStart = getWeekBounds(serverNow).start;
    const diffDays = Math.round(
      (thisWeekStart.getTime() - targetBounds.start.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (diffDays === 0) {
      setWeekPreset("this-week");
    } else if (diffDays === 7) {
      setWeekPreset("last-week");
    } else if (diffDays === 14) {
      setWeekPreset("2-weeks-ago");
    } else if (diffDays === 21) {
      setWeekPreset("3-weeks-ago");
    } else {
      setWeekPreset("custom");
      setCustomWeekDate(targetBounds.isoStart);
    }
  };

  // Daily Mon–Sun circulation activity for the selected week
  const weeklyCirculation = useMemo(
    () =>
      buildWeeklyCirculationFromTransactions(
        transactions,
        selectedWeekBounds,
        serverNow
      ),
    [transactions, selectedWeekBounds, serverNow]
  );

  const weeklySummary = useMemo(() => {
    const totalBorrows = weeklyCirculation.reduce((s, d) => s + d.borrows, 0);
    const totalReturns = weeklyCirculation.reduce((s, d) => s + d.returns, 0);
    const totalOverdueDue = weeklyCirculation.reduce((s, d) => s + d.overdueDue, 0);
    let peakDay = "None";
    let peakCount = 0;
    for (const d of weeklyCirculation) {
      const activity = d.borrows + d.returns;
      if (activity > peakCount) {
        peakCount = activity;
        peakDay = `${d.shortLabel} (${activity})`;
      }
    }
    return { totalBorrows, totalReturns, totalOverdueDue, peakDay };
  }, [weeklyCirculation]);

  // Properly categorized items: Borrowed (On Time) vs Overdue vs Returned + by Category
  const categorized = useMemo(
    () =>
      categorizeTransactions(
        transactions,
        fineSettings.fine_rate_per_day,
        fineSettings.max_fine,
        serverNow
      ),
    [transactions, fineSettings, serverNow]
  );

  const overdueSlices = useMemo(
    () => [
      {
        name: "1–7 Days",
        value: categorized.overdueItems.filter((o) => o.agingBucket === "1–7 Days").length,
        color: "#047857",
      },
      {
        name: "8–14 Days",
        value: categorized.overdueItems.filter((o) => o.agingBucket === "8–14 Days").length,
        color: "#f59e0b",
      },
      {
        name: "15+ Days",
        value: categorized.overdueItems.filter((o) => o.agingBucket === "15+ Days").length,
        color: "#dc2626",
      },
    ],
    [categorized.overdueItems]
  );

  const preparedByLabel = session ? `${session.name} (${session.role})` : "Library Staff";

  const fullReportInput: FullLibraryReportInput = useMemo(
    () => ({
      generatedAt: serverNow,
      preparedBy: preparedByLabel,
      weekBounds: selectedWeekBounds,
      weekPresetLabel: WEEK_PRESET_LABELS[weekPreset],
      stats,
      fineSettings,
      weeklyCirculation,
      categorized,
      finesLedger,
      pendingFines,
      paidFines,
      mostBorrowed,
      schoolYearSummaries,
    }),
    [
      serverNow,
      preparedByLabel,
      selectedWeekBounds,
      weekPreset,
      stats,
      fineSettings,
      weeklyCirculation,
      categorized,
      finesLedger,
      pendingFines,
      paidFines,
      mostBorrowed,
      schoolYearSummaries,
    ]
  );

  const previewSheets = useMemo(
    () => buildFullReportPreviewSheets(fullReportInput),
    [fullReportInput]
  );

  const reportStats = useMemo(() => {
    if (loading) return [];
    const onTimeCount = categorized.borrowedOnTime.length;
    const overdueCount = categorized.overdueItems.length;
    const returnedCount = categorized.returnedItems.length;
    return [
      {
        label: "Borrowed (On Time)",
        value: onTimeCount.toLocaleString(),
        trend: `${onTimeCount + overdueCount} total currently out`,
        trendUp: true,
        icon: "arrows-right-left",
      },
      {
        label: "Overdue Items",
        value: overdueCount.toLocaleString(),
        trend: overdueCount > 0 ? "Past due — needs follow-up" : "All clear",
        trendUp: overdueCount === 0,
        icon: "alert-triangle",
      },
      {
        label: "Total Returned",
        value: returnedCount.toLocaleString(),
        trend: "Completed returns",
        trendUp: true,
        icon: "users",
      },
      {
        label: "Pending Fines",
        value: `₱${pendingFines.toFixed(2)}`,
        trend: `Collected: ₱${paidFines.toFixed(2)}`,
        trendUp: pendingFines === 0,
        icon: "alert-triangle",
      },
    ];
  }, [loading, categorized, pendingFines, paidFines]);

  const buildReportMetaRows = (title: string): unknown[][] => [
    ["BCAS Library — Official Report", title],
    ["Generated Date & Time", formatDateTime(getServerNow().toISOString())],
    ["Circulation Week Filter", `${WEEK_PRESET_LABELS[weekPreset]} (${selectedWeekBounds.rangeLabel})`],
    ["Prepared By", preparedByLabel],
    [
      "Fine Policy",
      `₱${fineSettings.fine_rate_per_day.toFixed(2)} / day (Max ₱${fineSettings.max_fine.toFixed(2)})`,
    ],
    [],
    ["Summary KPIs"],
    ["Borrowed (On Time)", categorized.borrowedOnTime.length],
    ["Overdue Items", categorized.overdueItems.length],
    ["Total Returned", categorized.returnedItems.length],
    ["Pending Fines (PHP)", pendingFines.toFixed(2)],
    ["Collected Fines (PHP)", paidFines.toFixed(2)],
    [],
  ];

  const handleExportCSV = () => {
    const today = getServerDateString();
    const meta = buildReportMetaRows(REPORT_LABELS[reportType] ?? "Library Report");

    if (reportType === "circulation") {
      const rows: unknown[][] = [
        ...meta,
        [`Circulation Activity (${selectedWeekBounds.rangeLabel})`],
        ["Day", "Calendar Date", "Books Borrowed", "Books Returned", "Overdue Due", "Total Activity"],
        ...weeklyCirculation.map((r) => [
          r.day,
          r.fullDate,
          r.borrows,
          r.returns,
          r.overdueDue,
          r.borrows + r.returns,
        ]),
        [],
        ["Most Borrowed Titles"],
        ["Rank", "Title", "Author", "Category", "Checkouts", "Current Status"],
        ...mostBorrowed.map((r, i) => [
          i + 1,
          r.title,
          r.author,
          r.classification_name,
          r.borrow_count,
          r.current_status,
        ]),
      ];
      downloadCsv(`bcas_circulation_${selectedWeekBounds.isoStart}_to_${selectedWeekBounds.isoEnd}.csv`, rows);
      return;
    }

    if (reportType === "borrowed") {
      const rows: unknown[][] = [
        ...meta,
        ["Currently Borrowed (On Time)"],
        [
          "Book Title",
          "Author",
          "Accession #",
          "Category",
          "Student",
          "Student #",
          "Section",
          "Borrowed Date & Time",
          "Due Date & Time",
          "Time Remaining",
          "Handled By",
        ],
        ...categorized.borrowedOnTime.map((r) => [
          r.bookTitle,
          r.bookAuthor,
          r.accessionNumber,
          r.category,
          r.studentName,
          r.studentNumber,
          r.studentSection,
          formatDateTime(r.dateBorrowed),
          formatDateTime(r.dueDate),
          r.remainingLabel,
          r.handledBy,
        ]),
      ];
      downloadCsv(`bcas_currently_borrowed_${today}.csv`, rows);
      return;
    }

    if (reportType === "overdue") {
      const rows: unknown[][] = [
        ...meta,
        ["Overdue Items"],
        [
          "Student",
          "Student #",
          "Section",
          "Book Title",
          "Author",
          "Accession #",
          "Category",
          "Borrowed Date & Time",
          "Due Date & Time",
          "Overdue By",
          "Aging Bucket",
          "Accruing Fine (PHP)",
        ],
        ...categorized.overdueItems.map((r) => [
          r.studentName,
          r.studentNumber,
          r.studentSection,
          r.bookTitle,
          r.bookAuthor,
          r.accessionNumber,
          r.category,
          formatDateTime(r.dateBorrowed),
          formatDateTime(r.dueDate),
          r.overdueLabel,
          r.agingBucket,
          r.fineAmount.toFixed(2),
        ]),
      ];
      downloadCsv(`bcas_overdue_report_${today}.csv`, rows);
      return;
    }

    if (reportType === "fines") {
      const rows: unknown[][] = [
        ...meta,
        ["Fines Ledger"],
        [
          "Student",
          "Student Number",
          "Section",
          "Book Title",
          "Accession #",
          "Loan Status",
          "Borrowed Date & Time",
          "Due Date & Time",
          "Returned Date & Time",
          "Days Overdue",
          "Fine (PHP)",
          "Fine Status",
        ],
        ...finesLedger.map((f) => [
          f.student_name,
          f.student_number,
          f.student_section,
          f.book_title,
          f.accession_number,
          f.status,
          formatDateTime(f.date_borrowed),
          formatDateTime(f.due_date),
          formatDateTime(f.date_returned),
          f.days_overdue,
          f.fine_amount.toFixed(2),
          f.fine_paid ? "Paid" : f.is_accruing ? "Accruing" : "Unpaid",
        ]),
      ];
      downloadCsv(`bcas_fines_ledger_${today}.csv`, rows);
      return;
    }

    if (reportType === "popular") {
      const rows: unknown[][] = [
        ...meta,
        ["Most Borrowed Titles"],
        ["Rank", "Title", "Author", "Category", "Checkouts", "Current Status"],
        ...mostBorrowed.map((r, i) => [
          i + 1,
          r.title,
          r.author,
          r.classification_name,
          r.borrow_count,
          r.current_status,
        ]),
      ];
      downloadCsv(`bcas_popular_books_${today}.csv`, rows);
      return;
    }

    const rows: unknown[][] = [
      ...meta,
      ["School Year Circulation Summary"],
      [
        "School Year",
        "Total Transactions",
        "Currently Borrowed",
        "Returned",
        "Overdue",
        "Total Fines (PHP)",
        "Fines Collected (PHP)",
      ],
      ...schoolYearSummaries.map((r) => [
        r.school_year_name,
        r.total_transactions,
        r.currently_borrowed,
        r.returned,
        r.overdue,
        Number(r.total_fines ?? 0).toFixed(2),
        Number(r.fines_collected ?? 0).toFixed(2),
      ]),
    ];
    downloadCsv(`bcas_school_year_summary_${today}.csv`, rows);
  };

  const handleExportFullExcel = async () => {
    setExportingExcel(true);
    try {
      await exportFullLibraryExcel({
        ...fullReportInput,
        generatedAt: getServerNow(),
      });
    } finally {
      setExportingExcel(false);
    }
  };

  const openExcelPreview = (sheetId?: string) => {
    setExcelInitialSheet(sheetId);
    setExcelModalOpen(true);
  };

  const handlePrint = () => {
    requestPrint({
      title: REPORT_LABELS[reportType] ?? "Library Report",
      filename: `bcas_${reportType}_print_${getServerDateString()}.html`,
    });
  };

  return (
    <>
      <div className="animate-fade-in-up stagger-1 no-print">
        <PageHeader
          title="Reports & Analytics"
          actions={
            <>
              <Select
                value={reportType}
                onChange={setReportType}
                options={[
                  { label: "Circulation Summary", value: "circulation" },
                  { label: "Currently Borrowed (On Time)", value: "borrowed" },
                  { label: "Overdue Report", value: "overdue" },
                  { label: "Fines Ledger", value: "fines" },
                  { label: "Popular Books", value: "popular" },
                  { label: "School Year Summary", value: "school-years" },
                ]}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => openExcelPreview("summary")}
                  disabled={loading}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-700 text-white text-sm font-medium hover:bg-emerald-800 transition-colors disabled:opacity-50"
                >
                  <Eye className="w-4 h-4" />
                  View Full Report
                </button>
                <button
                  onClick={handleExportFullExcel}
                  disabled={loading || exportingExcel}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 text-sm font-medium hover:bg-emerald-100 transition-colors disabled:opacity-50"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  {exportingExcel ? "Exporting..." : "Export Excel (.xlsx)"}
                </button>
                <button
                  onClick={handleExportCSV}
                  disabled={loading}
                  className="flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 transition-colors disabled:opacity-50"
                  title="Download the currently selected report view as CSV"
                >
                  <Download className="w-4 h-4" />
                  CSV
                </button>
                <button
                  onClick={handlePrint}
                  className="flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 transition-colors"
                >
                  <Printer className="w-4 h-4" />
                  Print
                </button>
              </div>
            </>
          }
        />
      </div>

      <div data-print-area>
        {/* Formal Print-only Library Report Header */}
        <div className="hidden print:block mb-5 pb-4 border-b-2 border-slate-300">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
                Batangas College of Arts and Sciences — Library
              </p>
              <h2 className="text-2xl font-bold text-slate-900 mt-0.5">
                {REPORT_LABELS[reportType] ?? "Library Report"}
              </h2>
            </div>
            <div className="text-right text-xs text-slate-500">
              <p>Generated: {formatDateTime(getServerNow().toISOString())}</p>
              <p>
                Week: {WEEK_PRESET_LABELS[weekPreset]} ({selectedWeekBounds.rangeLabel})
              </p>
              <p>Prepared by: {preparedByLabel}</p>
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            Fine Policy: ₱{fineSettings.fine_rate_per_day.toFixed(2)}/day • Max Fine: ₱{fineSettings.max_fine.toFixed(2)}
          </p>
        </div>

        {/* Stats cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 print:grid-cols-4 gap-4 mb-6 animate-fade-in-up stagger-2">
          {loading
            ? Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="bg-white rounded-xl border border-slate-200 p-5 animate-pulse">
                  <div className="h-4 bg-slate-100 rounded w-24 mb-3" />
                  <div className="h-8 bg-slate-100 rounded w-16" />
                </div>
              ))
            : reportStats.map((stat) => (
                <div key={stat.label} className="print-avoid-break">
                  <StatsCard {...stat} />
                </div>
              ))}
        </div>

        {/* Charts row (screen only — print uses structured tables below so SVGs never clip) */}
        {(reportType === "circulation" || reportType === "overdue" || reportType === "borrowed") && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-6 animate-fade-in-up stagger-3 print:hidden">
            <div className="xl:col-span-2">
              <GroupedBarChartCard
                title="Weekly Circulation Activity"
                subtitle={`Daily checkouts vs. returns • ${selectedWeekBounds.rangeLabel} (Mon–Sun)`}
                headerRight={
                  <div className="flex flex-wrap items-center gap-1.5">
                    <div className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                      <button
                        type="button"
                        onClick={() => shiftSelectedWeek(-1)}
                        title="Previous week"
                        aria-label="Previous week"
                        className="p-1.5 rounded-md text-slate-600 hover:bg-white hover:text-slate-900 transition-colors"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => shiftSelectedWeek(1)}
                        disabled={selectedWeekBounds.isoStart >= currentWeekIsoStart}
                        title="Next week"
                        aria-label="Next week"
                        className="p-1.5 rounded-md text-slate-600 hover:bg-white hover:text-slate-900 transition-colors disabled:opacity-35 disabled:cursor-not-allowed"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>

                    <select
                      aria-label="Select circulation week"
                      value={weekPreset}
                      onChange={(e) => {
                        const next = e.target.value as WeekPreset;
                        setWeekPreset(next);
                        if (next === "custom") {
                          setCustomWeekDate(selectedWeekBounds.isoStart);
                        }
                      }}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs sm:text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                    >
                      <option value="this-week">This Week</option>
                      <option value="last-week">Last Week</option>
                      <option value="2-weeks-ago">2 Weeks Ago</option>
                      <option value="3-weeks-ago">3 Weeks Ago</option>
                      <option value="custom">Pick a Week Date...</option>
                    </select>

                    {weekPreset === "custom" && (
                      <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50/70 text-xs text-emerald-900">
                        <Calendar className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                        <input
                          type="date"
                          aria-label="Pick any date in the target week"
                          value={customWeekDate}
                          onChange={(e) => {
                            if (e.target.value) setCustomWeekDate(e.target.value);
                          }}
                          className="bg-transparent text-xs font-medium text-emerald-900 focus:outline-none"
                        />
                      </label>
                    )}
                  </div>
                }
                summaryItems={[
                  { label: "Books Borrowed", value: weeklySummary.totalBorrows, tone: "emerald" },
                  { label: "Books Returned", value: weeklySummary.totalReturns, tone: "blue" },
                  { label: "Overdue Due", value: weeklySummary.totalOverdueDue, tone: "amber" },
                  { label: "Busiest Day", value: weeklySummary.peakDay, tone: "slate" },
                ]}
                emptyMessage={`No checkouts or returns recorded during ${selectedWeekBounds.rangeLabel}.`}
                data={weeklyCirculation}
                xAxisKey="shortLabel"
                bars={[
                  { dataKey: "borrows", fill: "#047857", name: "Books Borrowed" },
                  { dataKey: "returns", fill: "#3b82f6", name: "Books Returned" },
                ]}
                tooltipLabelFormatter={(label, payload) => {
                  const full = payload?.[0]?.payload?.fullDate;
                  return typeof full === "string" ? full : label;
                }}
              />
            </div>
            <div>
              <DonutChartCard
                title="Overdue Aging"
                data={overdueSlices}
                centerLabel="Overdue"
              />
            </div>
          </div>
        )}

        {/* Print-only structured breakdown for charts */}
        {(reportType === "circulation" || reportType === "overdue" || reportType === "borrowed") && (
          <div className="hidden print:grid grid-cols-2 gap-6 mb-6 print-avoid-break">
            <div className="border border-slate-200 rounded-lg p-4">
              <h3 className="text-sm font-bold text-slate-900 mb-2">
                Weekly Circulation Activity ({selectedWeekBounds.rangeLabel})
              </h3>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left py-1.5 font-semibold text-slate-500">Date</th>
                    <th className="text-right py-1.5 font-semibold text-slate-500">Borrowed</th>
                    <th className="text-right py-1.5 font-semibold text-slate-500">Returned</th>
                    <th className="text-right py-1.5 font-semibold text-slate-500">Overdue Due</th>
                  </tr>
                </thead>
                <tbody>
                  {weeklyCirculation.map((row) => (
                    <tr key={row.dateKey} className="border-b border-slate-100 last:border-0">
                      <td className="py-1.5 text-slate-700">{row.fullDate}</td>
                      <td className="py-1.5 text-right font-medium text-slate-900">{row.borrows}</td>
                      <td className="py-1.5 text-right font-medium text-slate-900">{row.returns}</td>
                      <td className="py-1.5 text-right font-medium text-slate-900">{row.overdueDue}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-slate-300 font-semibold">
                    <td className="py-1.5 text-slate-900">Week Total</td>
                    <td className="py-1.5 text-right text-slate-900">{weeklySummary.totalBorrows}</td>
                    <td className="py-1.5 text-right text-slate-900">{weeklySummary.totalReturns}</td>
                    <td className="py-1.5 text-right text-slate-900">{weeklySummary.totalOverdueDue}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="border border-slate-200 rounded-lg p-4">
              <h3 className="text-sm font-bold text-slate-900 mb-2">Overdue Aging Breakdown</h3>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left py-1.5 font-semibold text-slate-500">Aging Bucket</th>
                    <th className="text-right py-1.5 font-semibold text-slate-500">Items</th>
                  </tr>
                </thead>
                <tbody>
                  {overdueSlices.map((slice) => (
                    <tr key={slice.name} className="border-b border-slate-100 last:border-0">
                      <td className="py-1.5 text-slate-700">{slice.name}</td>
                      <td className="py-1.5 text-right font-medium text-slate-900">{slice.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Categorized Active Circulation Snapshot (shown on Circulation Summary) */}
        {reportType === "circulation" && (
          <div className="bg-white rounded-xl border border-slate-200 mb-6 animate-fade-in-up stagger-3">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 p-5 border-b border-slate-100">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  Categorized Circulation Status
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Separate tracking of on-time borrowed items, overdue items, and circulation totals by category — with exact date &amp; time.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 no-print">
                <div className="inline-flex rounded-lg bg-slate-100 p-1">
                  <button
                    type="button"
                    onClick={() => setActiveSnapshotTab("borrowed")}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                      activeSnapshotTab === "borrowed"
                        ? "bg-white text-emerald-700 shadow-xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    Borrowed ({categorized.borrowedOnTime.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveSnapshotTab("overdue")}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                      activeSnapshotTab === "overdue"
                        ? "bg-white text-red-700 shadow-xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Overdue ({categorized.overdueItems.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveSnapshotTab("categories")}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                      activeSnapshotTab === "categories"
                        ? "bg-white text-slate-900 shadow-xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    <Layers className="w-3.5 h-3.5" />
                    By Category ({categorized.byClassification.length})
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    openExcelPreview(
                      activeSnapshotTab === "borrowed"
                        ? "borrowed"
                        : activeSnapshotTab === "overdue"
                        ? "overdue"
                        : "summary"
                    )
                  }
                  className="text-xs font-medium text-emerald-700 hover:text-emerald-800 px-2.5 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50/70 hover:bg-emerald-50 transition-colors"
                >
                  Open in Excel View
                </button>
              </div>
            </div>

            {activeSnapshotTab === "borrowed" && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/60">
                      <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">Book &amp; Category</th>
                      <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">Student</th>
                      <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">Borrowed (Date &amp; Time)</th>
                      <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">Due (Date &amp; Time)</th>
                      <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={5} className="px-5 py-8 text-center text-slate-400">Loading...</td>
                      </tr>
                    ) : categorized.borrowedOnTime.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-5 py-8 text-center text-slate-400">
                          No books are currently borrowed on time.
                        </td>
                      </tr>
                    ) : (
                      categorized.borrowedOnTime.map((item) => (
                        <tr key={item.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                          <td className="px-4 sm:px-5 py-3.5">
                            <div className="font-medium text-slate-800">{item.bookTitle}</div>
                            <div className="text-xs text-slate-500">
                              {item.category} • #{item.accessionNumber}
                            </div>
                          </td>
                          <td className="px-4 sm:px-5 py-3.5">
                            <div className="font-medium text-slate-800">{item.studentName}</div>
                            <div className="text-xs text-slate-500">
                              {item.studentNumber !== "—" ? `${item.studentNumber} • ` : ""}
                              {item.studentSection}
                            </div>
                          </td>
                          <td className="px-4 sm:px-5 py-3.5">
                            <DateTimeCell iso={item.dateBorrowed} />
                          </td>
                          <td className="px-4 sm:px-5 py-3.5">
                            <DateTimeCell iso={item.dueDate} />
                          </td>
                          <td className="px-4 sm:px-5 py-3.5">
                            <span className="inline-block px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              On Time • {item.remainingLabel}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {activeSnapshotTab === "overdue" && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-red-50/40">
                      <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">Book &amp; Category</th>
                      <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">Student</th>
                      <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">Borrowed (Date &amp; Time)</th>
                      <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">Due (Date &amp; Time)</th>
                      <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">Overdue / Fine</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={5} className="px-5 py-8 text-center text-slate-400">Loading...</td>
                      </tr>
                    ) : categorized.overdueItems.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-5 py-8 text-center text-slate-400">
                          All clear — no overdue items right now.
                        </td>
                      </tr>
                    ) : (
                      categorized.overdueItems.map((item) => (
                        <tr key={item.id} className="border-b border-slate-50 last:border-0 hover:bg-red-50/30">
                          <td className="px-4 sm:px-5 py-3.5">
                            <div className="font-medium text-slate-800">{item.bookTitle}</div>
                            <div className="text-xs text-slate-500">
                              {item.category} • #{item.accessionNumber}
                            </div>
                          </td>
                          <td className="px-4 sm:px-5 py-3.5">
                            <div className="font-medium text-slate-800">{item.studentName}</div>
                            <div className="text-xs text-slate-500">
                              {item.studentNumber !== "—" ? `${item.studentNumber} • ` : ""}
                              {item.studentSection}
                            </div>
                          </td>
                          <td className="px-4 sm:px-5 py-3.5">
                            <DateTimeCell iso={item.dateBorrowed} />
                          </td>
                          <td className="px-4 sm:px-5 py-3.5">
                            <DateTimeCell iso={item.dueDate} emphasis="red" />
                          </td>
                          <td className="px-4 sm:px-5 py-3.5">
                            <div className="font-semibold text-red-700">
                              {item.overdueLabel} ({item.agingBucket})
                            </div>
                            <div className="text-xs font-semibold text-amber-700 mt-0.5">
                              Fine: ₱{item.fineAmount.toFixed(2)} • {item.fineStatus}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {activeSnapshotTab === "categories" && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/60">
                      <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">Category / Classification</th>
                      <th className="text-right px-4 sm:px-5 py-3 font-semibold text-slate-500">Total Loans</th>
                      <th className="text-right px-4 sm:px-5 py-3 font-semibold text-slate-500">Borrowed (On Time)</th>
                      <th className="text-right px-4 sm:px-5 py-3 font-semibold text-slate-500">Overdue</th>
                      <th className="text-right px-4 sm:px-5 py-3 font-semibold text-slate-500">Returned</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={5} className="px-5 py-8 text-center text-slate-400">Loading...</td>
                      </tr>
                    ) : categorized.byClassification.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-5 py-8 text-center text-slate-400">
                          No circulation category data yet.
                        </td>
                      </tr>
                    ) : (
                      categorized.byClassification.map((cat) => (
                        <tr key={cat.classification} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                          <td className="px-4 sm:px-5 py-3.5 font-medium text-slate-800">{cat.classification}</td>
                          <td className="px-4 sm:px-5 py-3.5 text-right font-semibold text-slate-900">{cat.totalLoans}</td>
                          <td className="px-4 sm:px-5 py-3.5 text-right font-semibold text-emerald-700">{cat.borrowedOnTime}</td>
                          <td className={`px-4 sm:px-5 py-3.5 text-right font-semibold ${cat.overdue > 0 ? "text-red-700" : "text-slate-400"}`}>
                            {cat.overdue}
                          </td>
                          <td className="px-4 sm:px-5 py-3.5 text-right font-medium text-blue-700">{cat.returned}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Dedicated Currently Borrowed (On Time) View */}
        {reportType === "borrowed" && (
          <div className="bg-white rounded-xl border border-slate-200 animate-fade-in-up stagger-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-5 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-emerald-600" />
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Currently Borrowed (On Time)</h3>
                  <p className="text-xs text-slate-500">
                    Active checkouts within their due date &amp; time, sorted by soonest due first.
                  </p>
                </div>
              </div>
              <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-md">
                {categorized.borrowedOnTime.length} Active Loans
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">Student</th>
                    <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">Book &amp; Category</th>
                    <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">Borrowed (Date &amp; Time)</th>
                    <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">Due (Date &amp; Time)</th>
                    <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">Time Remaining</th>
                    <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500 hidden lg:table-cell print:table-cell">Handled By</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-8 text-center text-slate-400">Loading...</td>
                    </tr>
                  ) : categorized.borrowedOnTime.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-8 text-center text-slate-400">No items currently borrowed on time.</td>
                    </tr>
                  ) : (
                    categorized.borrowedOnTime.map((row) => (
                      <tr key={row.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                        <td className="px-4 sm:px-5 py-4">
                          <div className="font-medium text-slate-800">{row.studentName}</div>
                          <div className="text-xs text-slate-500">
                            {row.studentNumber !== "—" ? `${row.studentNumber} • ` : ""}
                            {row.studentSection}
                          </div>
                        </td>
                        <td className="px-4 sm:px-5 py-4">
                          <div className="font-medium text-slate-800">{row.bookTitle}</div>
                          <div className="text-xs text-slate-500">
                            {row.bookAuthor} • {row.category} • #{row.accessionNumber}
                          </div>
                        </td>
                        <td className="px-4 sm:px-5 py-4">
                          <DateTimeCell iso={row.dateBorrowed} />
                        </td>
                        <td className="px-4 sm:px-5 py-4">
                          <DateTimeCell iso={row.dueDate} />
                        </td>
                        <td className="px-4 sm:px-5 py-4">
                          <span className="inline-block px-2.5 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-700">
                            {row.remainingLabel}
                          </span>
                        </td>
                        <td className="px-4 sm:px-5 py-4 text-xs text-slate-500 hidden lg:table-cell print:table-cell">
                          {row.handledBy}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* School Year Summary */}
        {reportType === "school-years" && (
          <div className="bg-white rounded-xl border border-slate-200 mb-6 animate-fade-in-up stagger-3">
            <div className="flex items-center gap-2 p-5 border-b border-slate-100">
              <BarChart3 className="w-5 h-5 text-emerald-600" />
              <h3 className="text-lg font-bold text-slate-900">School Year Summary</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">School Year</th>
                    <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">Total Transactions</th>
                    <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">Borrowed</th>
                    <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">Returned</th>
                    <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">Overdue</th>
                    <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">Total Fines</th>
                    <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">Fines Collected</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="px-5 py-8 text-center text-slate-400">Loading...</td>
                    </tr>
                  ) : schoolYearSummaries.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-5 py-8 text-center text-slate-400">No school year data available.</td>
                    </tr>
                  ) : (
                    schoolYearSummaries.map((summary) => (
                      <tr key={summary.school_year_id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                        <td className="px-4 sm:px-5 py-4 font-medium text-slate-800">{summary.school_year_name}</td>
                        <td className="px-4 sm:px-5 py-4 text-slate-600">{summary.total_transactions}</td>
                        <td className="px-4 sm:px-5 py-4 text-slate-600">{summary.currently_borrowed}</td>
                        <td className="px-4 sm:px-5 py-4 text-slate-600">{summary.returned}</td>
                        <td className="px-4 sm:px-5 py-4 text-slate-600">{summary.overdue}</td>
                        <td className="px-4 sm:px-5 py-4 text-slate-600">₱{Number(summary.total_fines ?? 0).toFixed(2)}</td>
                        <td className="px-4 sm:px-5 py-4 text-emerald-600">₱{Number(summary.fines_collected ?? 0).toFixed(2)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Most borrowed table */}
        {(reportType === "circulation" || reportType === "popular") && (
          <div className="bg-white rounded-xl border border-slate-200 animate-fade-in-up stagger-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-5 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-900">Most Borrowed Titles</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">
                      Title &amp; Author
                    </th>
                    <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500 hidden sm:table-cell print:table-cell">
                      Category
                    </th>
                    <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">
                      Checkouts
                    </th>
                    <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={4} className="px-5 py-8 text-center text-slate-400">Loading...</td>
                    </tr>
                  ) : mostBorrowed.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-5 py-8 text-center text-slate-400">No data available.</td>
                    </tr>
                  ) : (
                    mostBorrowed.map((book) => (
                      <tr
                        key={book.id}
                        className="border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors"
                      >
                        <td className="px-4 sm:px-5 py-4">
                          <div className="font-medium text-slate-800">{book.title}</div>
                          <div className="text-xs text-slate-500">{book.author}</div>
                          <div className="text-xs text-slate-400 sm:hidden print:hidden mt-0.5">{book.classification_name}</div>
                        </td>
                        <td className="px-4 sm:px-5 py-4 text-slate-600 hidden sm:table-cell print:table-cell">{book.classification_name}</td>
                        <td className="px-4 sm:px-5 py-4 font-semibold text-slate-800">
                          {book.borrow_count}
                        </td>
                        <td className="px-4 sm:px-5 py-4">
                          <Badge label={book.current_status} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Overdue Report */}
        {reportType === "overdue" && (
          <div className="bg-white rounded-xl border border-slate-200 animate-fade-in-up stagger-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-5 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-500" />
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Overdue Books</h3>
                  <p className="text-xs text-slate-500">
                    Unreturned books past their exact due date &amp; time, sorted by oldest due date first.
                  </p>
                </div>
              </div>
              <span className="text-xs font-semibold text-red-700 bg-red-50 border border-red-200 px-3 py-1 rounded-md">
                {categorized.overdueItems.length} Overdue Item{categorized.overdueItems.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">Student</th>
                    <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">Book &amp; Category</th>
                    <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">Borrowed (Date &amp; Time)</th>
                    <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">Due (Date &amp; Time)</th>
                    <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">Overdue By</th>
                    <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">Accruing Fine</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-8 text-center text-slate-400">Loading...</td>
                    </tr>
                  ) : categorized.overdueItems.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-8 text-center text-slate-400">No overdue books.</td>
                    </tr>
                  ) : (
                    categorized.overdueItems.map((row) => (
                      <tr key={row.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                        <td className="px-4 sm:px-5 py-4">
                          <div className="font-medium text-slate-800">{row.studentName}</div>
                          <div className="text-xs text-slate-500">
                            {row.studentNumber !== "—" ? `${row.studentNumber} • ` : ""}
                            {row.studentSection}
                          </div>
                        </td>
                        <td className="px-4 sm:px-5 py-4">
                          <div className="font-medium text-slate-800">{row.bookTitle}</div>
                          <div className="text-xs text-slate-500">
                            {row.bookAuthor} • {row.category} • #{row.accessionNumber}
                          </div>
                        </td>
                        <td className="px-4 sm:px-5 py-4">
                          <DateTimeCell iso={row.dateBorrowed} />
                        </td>
                        <td className="px-4 sm:px-5 py-4">
                          <DateTimeCell iso={row.dueDate} emphasis="red" />
                        </td>
                        <td className="px-4 sm:px-5 py-4">
                          <div
                            className={`font-semibold ${
                              row.daysOverdue > 14
                                ? "text-red-600"
                                : row.daysOverdue > 7
                                ? "text-amber-600"
                                : "text-red-700"
                            }`}
                          >
                            {row.overdueLabel}
                          </div>
                          <div className="text-xs text-slate-400">{row.agingBucket}</div>
                        </td>
                        <td className="px-4 sm:px-5 py-4">
                          <div className="font-semibold text-amber-700">
                            ₱{row.fineAmount.toFixed(2)}
                          </div>
                          <div className="text-xs text-slate-400">{row.fineStatus}</div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Fines Ledger Report */}
        {reportType === "fines" && (
          <div className="bg-white rounded-xl border border-slate-200 animate-fade-in-up stagger-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-5 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-amber-500" />
                <h3 className="text-lg font-bold text-slate-900">Fines Ledger</h3>
              </div>
              <div className="flex items-center gap-4 text-xs sm:text-sm">
                <span className="text-amber-700 font-medium">Pending: ₱{pendingFines.toFixed(2)}</span>
                <span className="text-emerald-700 font-medium">Collected: ₱{paidFines.toFixed(2)}</span>
                <span className="text-slate-700 font-semibold">Total: ₱{(pendingFines + paidFines).toFixed(2)}</span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">Student</th>
                    <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">Book</th>
                    <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">Due (Date &amp; Time)</th>
                    <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">Returned (Date &amp; Time)</th>
                    <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">Days Overdue</th>
                    <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">Fine Amount</th>
                    <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="px-5 py-8 text-center text-slate-400">Loading...</td>
                    </tr>
                  ) : finesLedger.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-5 py-8 text-center text-slate-400">No fines recorded or accruing.</td>
                    </tr>
                  ) : (
                    finesLedger.map((item) => (
                      <tr key={item.transaction_id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                        <td className="px-4 sm:px-5 py-4">
                          <div className="font-medium text-slate-800">{item.student_name}</div>
                          <div className="text-xs text-slate-500">
                            {item.student_number || item.student_section || "—"}
                          </div>
                        </td>
                        <td className="px-4 sm:px-5 py-4">
                          <div className="font-medium text-slate-800">{item.book_title}</div>
                          <div className="text-xs text-slate-500">
                            {item.accession_number ? `#${item.accession_number}` : item.book_author}
                          </div>
                        </td>
                        <td className="px-4 sm:px-5 py-4">
                          <DateTimeCell iso={item.due_date} />
                        </td>
                        <td className="px-4 sm:px-5 py-4">
                          <DateTimeCell iso={item.date_returned} emphasis={item.date_returned ? "blue" : undefined} />
                        </td>
                        <td className="px-4 sm:px-5 py-4 text-slate-600">
                          {item.days_overdue} days
                        </td>
                        <td className="px-4 sm:px-5 py-4 font-semibold text-slate-800">
                          ₱{item.fine_amount.toFixed(2)}
                        </td>
                        <td className="px-4 sm:px-5 py-4">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${
                              item.fine_paid
                                ? "bg-emerald-100 text-emerald-700"
                                : item.is_accruing
                                ? "bg-amber-100 text-amber-700"
                                : "bg-red-100 text-red-700"
                            }`}
                          >
                            {item.fine_paid ? "Paid" : item.is_accruing ? "Accruing" : "Unpaid"}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Print-only Librarian Sign-off Footer */}
        <div className="hidden print:grid grid-cols-2 gap-16 mt-12 pt-6 border-t border-slate-200 print-avoid-break">
          <div>
            <p className="text-xs text-slate-500 mb-8">Prepared by:</p>
            <div className="border-t border-slate-400 pt-1">
              <p className="text-sm font-semibold text-slate-900">
                {session?.name ?? "Library Staff"}
              </p>
              <p className="text-xs text-slate-500">{session?.role ?? "Librarian"}</p>
            </div>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-8">Noted by:</p>
            <div className="border-t border-slate-400 pt-1">
              <p className="text-sm font-semibold text-slate-900">Head Librarian / Administrator</p>
              <p className="text-xs text-slate-500">BCAS Library</p>
            </div>
          </div>
        </div>
      </div>

      {/* Viewable Excel Workbook Preview Modal */}
      <ExcelReportPreviewModal
        open={excelModalOpen}
        onClose={() => setExcelModalOpen(false)}
        sheets={previewSheets}
        weekLabel={`${WEEK_PRESET_LABELS[weekPreset]} (${selectedWeekBounds.rangeLabel})`}
        generatedLabel={formatDateTime(serverNow.toISOString())}
        preparedBy={preparedByLabel}
        onDownloadExcel={handleExportFullExcel}
        exporting={exportingExcel}
        initialSheetId={excelInitialSheet}
      />
    </>
  );
}
