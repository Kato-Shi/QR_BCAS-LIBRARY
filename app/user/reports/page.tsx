"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Download,
  Printer,
  BarChart3,
  FileSpreadsheet,
  Eye,
  BookOpen,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Calendar,
  Layers,
  ShieldAlert,
  ShieldCheck,
  Trophy,
  Award,
  Ban,
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
  buildTopBorrowingStudents,
  evaluateAllStudentViolations,
  formatOrdinal,
  formatViolationPolicySummary,
  getDefaultViolationPolicy,
  getViolationPolicy,
  setTransactionViolationCleared,
} from "@/lib/supabase/violations";
import {
  buildSchoolYearSummaries,
  formatSchoolYearDateRange,
  getSchoolYears,
  resolveTransactionSchoolYearId,
} from "@/lib/supabase/school-years";
import { getEffectiveSession } from "@/lib/client-session";
import { canEdit } from "@/lib/permissions";
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
  MostBorrowedBookRow,
  SchoolYear,
  ViolationPolicy,
} from "@/lib/types";
import type { SessionData } from "@/app/auth/actions";

const REPORT_LABELS: Record<string, string> = {
  circulation: "Circulation Summary",
  borrowed: "Currently Borrowed (On Time)",
  overdue: "Overdue Report",
  violations: "Student Violations Report",
  "top-borrowers": "Top Borrowing Students Report",
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
  const [schoolYearFilter, setSchoolYearFilter] = useState("all");
  const [weekPreset, setWeekPreset] = useState<WeekPreset>("this-week");
  const [customWeekDate, setCustomWeekDate] = useState<string>(() => toLocalDateKey(getServerNow()));
  const [activeSnapshotTab, setActiveSnapshotTab] = useState<"borrowed" | "overdue" | "categories">("borrowed");

  const [excelModalOpen, setExcelModalOpen] = useState(false);
  const [excelInitialSheet, setExcelInitialSheet] = useState<string | undefined>(undefined);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [clearingTxId, setClearingTxId] = useState<string | null>(null);

  const [session, setSession] = useState<SessionData | null>(null);
  const [serverNow, setServerNow] = useState<Date>(() => getServerNow());
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [allTransactions, setAllTransactions] = useState<BorrowingTransactionWithDetails[]>([]);
  const [mostBorrowed, setMostBorrowed] = useState<MostBorrowedBookRow[]>([]);
  const [violationPolicy, setViolationPolicy] = useState<ViolationPolicy>(() => getDefaultViolationPolicy());
  const [schoolYears, setSchoolYears] = useState<SchoolYear[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getEffectiveSession().then(setSession).catch(() => {});
  }, []);

  const fetchReportsData = async () => {
    const [
      nowFromServer,
      statsData,
      txData,
      borrowedData,
      policyData,
      yearsData,
    ] = await Promise.all([
      ensureServerNow(),
      getDashboardStats(),
      getTransactions(),
      getMostBorrowedBooks(10),
      getViolationPolicy(),
      getSchoolYears().catch(() => [] as SchoolYear[]),
    ]);
    return {
      nowFromServer,
      statsData,
      txData,
      borrowedData,
      policyData,
      yearsData,
    };
  };

  const loadAll = async () => {
    setLoading(true);
    try {
      const data = await fetchReportsData();
      setServerNow(data.nowFromServer);
      setCustomWeekDate((prev) => prev || toLocalDateKey(data.nowFromServer));
      setStats(data.statsData);
      setAllTransactions(data.txData);
      setMostBorrowed(data.borrowedData);
      setViolationPolicy(data.policyData);
      setSchoolYears(data.yearsData);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    fetchReportsData()
      .then((data) => {
        if (!active) return;
        setServerNow(data.nowFromServer);
        setCustomWeekDate((prev) => prev || toLocalDateKey(data.nowFromServer));
        setStats(data.statsData);
        setAllTransactions(data.txData);
        setMostBorrowed(data.borrowedData);
        setViolationPolicy(data.policyData);
        setSchoolYears(data.yearsData);
      })
      .catch(() => {
        // silent
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const selectedSchoolYear = useMemo(
    () => schoolYears.find((y) => y.id === schoolYearFilter) ?? null,
    [schoolYears, schoolYearFilter]
  );

  const schoolYearScopeLabel = selectedSchoolYear
    ? `SY ${selectedSchoolYear.name}${selectedSchoolYear.is_active ? " (Active)" : ""}`
    : "All School Years";

  const transactions = useMemo(() => {
    if (schoolYearFilter === "all") return allTransactions;
    return allTransactions.filter(
      (tx) => resolveTransactionSchoolYearId(tx, schoolYears) === schoolYearFilter
    );
  }, [allTransactions, schoolYearFilter, schoolYears]);

  const schoolYearSummaries = useMemo(
    () => buildSchoolYearSummaries(allTransactions, schoolYears, serverNow),
    [allTransactions, schoolYears, serverNow]
  );

  const scopedMostBorrowed = useMemo<MostBorrowedBookRow[]>(() => {
    if (schoolYearFilter === "all") return mostBorrowed;
    const map = new Map<string, MostBorrowedBookRow>();
    for (const tx of transactions) {
      if (!tx.books) continue;
      const existing = map.get(tx.book_id);
      if (existing) {
        existing.borrow_count += 1;
      } else {
        map.set(tx.book_id, {
          id: tx.book_id,
          title: tx.books.title,
          author: tx.books.author,
          classification_name: tx.books.classifications?.name ?? "Uncategorized",
          borrow_count: 1,
          current_status: tx.books.status,
        });
      }
    }
    return Array.from(map.values())
      .sort((a, b) => b.borrow_count - a.borrow_count || a.title.localeCompare(b.title))
      .slice(0, 10);
  }, [schoolYearFilter, mostBorrowed, transactions]);

  const allowManageViolations = session ? canEdit(session.role) : true;

  // Selected Monday–Sunday calendar week
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

  // Daily Mon–Sun circulation activity for selected week
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

  // Evaluate student violations & top borrowers
  const violationBundle = useMemo(
    () => evaluateAllStudentViolations(transactions, violationPolicy, serverNow),
    [transactions, violationPolicy, serverNow]
  );

  const topBorrowers = useMemo(
    () => buildTopBorrowingStudents(transactions, violationBundle.byStudentId, serverNow),
    [transactions, violationBundle, serverNow]
  );

  // Categorized items: Borrowed (On Time) vs Overdue vs Returned + by Category
  const categorized = useMemo(
    () => categorizeTransactions(transactions, violationBundle, serverNow),
    [transactions, violationBundle, serverNow]
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
  const policySummaryText = useMemo(
    () => formatViolationPolicySummary(violationPolicy),
    [violationPolicy]
  );

  const fullReportInput: FullLibraryReportInput = useMemo(
    () => ({
      generatedAt: serverNow,
      preparedBy: preparedByLabel,
      schoolYearScopeLabel,
      weekBounds: selectedWeekBounds,
      weekPresetLabel: WEEK_PRESET_LABELS[weekPreset],
      stats,
      violationPolicy,
      violationBundle,
      weeklyCirculation,
      categorized,
      topBorrowers,
      mostBorrowed: scopedMostBorrowed,
      schoolYearSummaries,
    }),
    [
      serverNow,
      preparedByLabel,
      schoolYearScopeLabel,
      selectedWeekBounds,
      weekPreset,
      stats,
      violationPolicy,
      violationBundle,
      weeklyCirculation,
      categorized,
      topBorrowers,
      scopedMostBorrowed,
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
    const activeViolations = violationBundle.totalActiveViolations;
    const bannedCount = violationBundle.bannedStudentCount;
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
        label: "Active Violations",
        value: activeViolations.toLocaleString(),
        trend:
          bannedCount > 0
            ? `${bannedCount} student${bannedCount === 1 ? "" : "s"} restricted`
            : activeViolations > 0
            ? `${violationBundle.warnedStudentCount} warning${violationBundle.warnedStudentCount === 1 ? "" : "s"} issued`
            : "All in good standing",
        trendUp: activeViolations === 0,
        icon: "alert-triangle",
      },
    ];
  }, [loading, categorized, violationBundle]);

  const handleToggleViolationCleared = async (transactionId: string, cleared: boolean) => {
    if (!allowManageViolations) return;
    setClearingTxId(transactionId);
    try {
      await setTransactionViolationCleared(transactionId, cleared);
      await loadAll();
    } finally {
      setClearingTxId(null);
    }
  };

  const buildReportMetaRows = (title: string): unknown[][] => [
    ["BCAS Library — Official Report", title],
    ["Generated Date & Time", formatDateTime(getServerNow().toISOString())],
    ["School Year Scope", schoolYearScopeLabel],
    ["Circulation Week Filter", `${WEEK_PRESET_LABELS[weekPreset]} (${selectedWeekBounds.rangeLabel})`],
    ["Prepared By", preparedByLabel],
    ["Violation Policy", policySummaryText],
    [],
    ["Summary KPIs"],
    ["Borrowed (On Time)", categorized.borrowedOnTime.length],
    ["Overdue Items", categorized.overdueItems.length],
    ["Total Returned", categorized.returnedItems.length],
    ["Active Violations", violationBundle.totalActiveViolations],
    ["Restricted Students", violationBundle.bannedStudentCount],
    [
      "Top Borrowing Student (#1)",
      topBorrowers[0]
        ? `${topBorrowers[0].studentName} (${topBorrowers[0].totalBorrowed} books)`
        : "None",
    ],
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
        ...scopedMostBorrowed.map((r, i) => [
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
          "Violation Penalty",
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
          r.violationLabel,
        ]),
      ];
      downloadCsv(`bcas_overdue_report_${today}.csv`, rows);
      return;
    }

    if (reportType === "violations") {
      const rows: unknown[][] = [
        ...meta,
        ["Student Violations"],
        [
          "Student",
          "Student Number",
          "Section",
          "Active Violations",
          "Cleared",
          "Current Standing / Penalty",
          "Borrowing Restriction",
          "Latest Violation Date & Time",
        ],
        ...violationBundle.studentsWithViolations.map((st) => [
          st.studentName,
          st.studentNumber,
          st.studentSection,
          st.activeViolationCount,
          st.clearedViolationCount,
          st.standingLabel,
          st.isBanned
            ? st.blockedByUnreturnedOverdue
              ? "Return overdue book first"
              : st.banEndsAt
              ? `Forbidden until ${formatDateTime(st.banEndsAt)}`
              : "Restricted"
            : "Allowed to borrow",
          formatDateTime(st.latestViolationAt),
        ]),
      ];
      downloadCsv(`bcas_student_violations_${today}.csv`, rows);
      return;
    }

    if (reportType === "top-borrowers") {
      const rows: unknown[][] = [
        ...meta,
        ["Top Borrowing Students"],
        [
          "Rank",
          "Student Name",
          "Student Number",
          "Section",
          "Grade / Program",
          "Total Borrowed",
          "Currently Out",
          "Returned On Time",
          "Active Violations",
          "Standing",
          "Last Borrowed Date & Time",
        ],
        ...topBorrowers.map((tb) => [
          tb.rank,
          tb.studentName,
          tb.studentNumber,
          tb.studentSection,
          [tb.gradeLevel, tb.program].filter(Boolean).join(" • "),
          tb.totalBorrowed,
          tb.currentlyBorrowed,
          tb.returnedOnTime,
          tb.activeViolations,
          tb.standingLabel,
          formatDateTime(tb.lastBorrowedAt),
        ]),
      ];
      downloadCsv(`bcas_top_borrowers_${today}.csv`, rows);
      return;
    }

    if (reportType === "popular") {
      const rows: unknown[][] = [
        ...meta,
        ["Most Borrowed Titles"],
        ["Rank", "Title", "Author", "Category", "Checkouts", "Current Status"],
        ...scopedMostBorrowed.map((r, i) => [
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
      ["School Year Circulation & Violations Summary"],
      [
        "School Year",
        "Academic Period",
        "Active",
        "Total Loans",
        "Unique Students",
        "Borrowed (On Time)",
        "Returned",
        "Overdue",
        "Active Violations",
      ],
      ...schoolYearSummaries.map((r) => [
        r.school_year_name,
        r.start_date && r.end_date
          ? formatSchoolYearDateRange(r.start_date, r.end_date)
          : "—",
        r.is_active ? "Yes" : "No",
        r.total_transactions,
        r.unique_students ?? 0,
        r.currently_borrowed,
        r.returned,
        r.overdue,
        r.violations_count ?? 0,
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

  const topStudent = topBorrowers[0];

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
                  { label: "Student Violations", value: "violations" },
                  { label: "Top Borrowers (Students)", value: "top-borrowers" },
                  { label: "Popular Books", value: "popular" },
                  { label: "School Year Summary", value: "school-years" },
                ]}
              />
              {schoolYears.length > 0 && (
                <Select
                  value={schoolYearFilter}
                  onChange={setSchoolYearFilter}
                  options={[
                    { label: "All School Years", value: "all" },
                    ...schoolYears.map((y) => ({
                      label: `SY ${y.name}${y.is_active ? " (Active)" : ""}`,
                      value: y.id,
                    })),
                  ]}
                />
              )}
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
              <p>School Year: {schoolYearScopeLabel}</p>
              <p>
                Week: {WEEK_PRESET_LABELS[weekPreset]} ({selectedWeekBounds.rangeLabel})
              </p>
              <p>Prepared by: {preparedByLabel}</p>
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            Violation Policy: {policySummaryText}
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

        {/* Top Borrowing Student Spotlight (shown on Circulation Summary) */}
        {reportType === "circulation" && !loading && topStudent && (
          <div className="mb-6 bg-white rounded-xl border border-emerald-200 p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 animate-fade-in-up stagger-2 print-avoid-break">
            <div className="flex items-start sm:items-center gap-3.5">
              <div className="w-11 h-11 rounded-xl bg-emerald-100 border border-emerald-200 flex items-center justify-center shrink-0">
                <Trophy className="w-5 h-5 text-emerald-700" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
                  Student With Most Borrowed Books
                </p>
                <div className="flex flex-wrap items-center gap-2 mt-0.5">
                  <h3 className="text-base sm:text-lg font-bold text-slate-900">
                    {topStudent.studentName}
                  </h3>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                    {topStudent.totalBorrowed} book{topStudent.totalBorrowed === 1 ? "" : "s"} borrowed
                  </span>
                  <span
                    className={`text-xs font-semibold px-2 py-0.5 rounded ${
                      topStudent.standingTone === "red"
                        ? "bg-red-100 text-red-700"
                        : topStudent.standingTone === "amber"
                        ? "bg-amber-100 text-amber-800"
                        : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {topStudent.standingLabel}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  {topStudent.studentNumber !== "—" ? `${topStudent.studentNumber} • ` : ""}
                  {topStudent.studentSection}
                  {topStudent.program ? ` • ${topStudent.program}` : ""} • Returned on time: {topStudent.returnedOnTime} • Last borrowed: {formatDateTime(topStudent.lastBorrowedAt)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 no-print">
              <button
                type="button"
                onClick={() => setReportType("top-borrowers")}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-700 text-white text-xs sm:text-sm font-medium hover:bg-emerald-800 transition-colors"
              >
                <Award className="w-4 h-4" />
                View All Top Borrowers
              </button>
              <button
                type="button"
                onClick={() => openExcelPreview("top-borrowers")}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs sm:text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Excel Sheet
              </button>
            </div>
          </div>
        )}

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
                  Separate tracking of on-time borrowed items, overdue items with violation tier, and totals by category — with exact date &amp; time.
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
                      <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">Overdue &amp; Violation</th>
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
                            <div
                              className={`text-xs font-semibold mt-0.5 ${
                                item.violationTone === "red"
                                  ? "text-red-700"
                                  : item.violationTone === "amber"
                                  ? "text-amber-700"
                                  : "text-emerald-700"
                              }`}
                            >
                              {item.violationLabel}
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

        {/* Top Borrowing Students Report */}
        {reportType === "top-borrowers" && (
          <div className="bg-white rounded-xl border border-slate-200 animate-fade-in-up stagger-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-5 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <Trophy className="w-5 h-5 text-emerald-600" />
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Top Borrowing Students</h3>
                  <p className="text-xs text-slate-500">
                    Students ranked by total number of books borrowed (ties broken by on-time returns and fewest violations).
                  </p>
                </div>
              </div>
              <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-md">
                {topBorrowers.length} Student{topBorrowers.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-center px-4 py-3 font-semibold text-slate-500 w-16">Rank</th>
                    <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">Student</th>
                    <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500 hidden md:table-cell print:table-cell">Grade / Program</th>
                    <th className="text-right px-4 sm:px-5 py-3 font-semibold text-slate-500">Total Borrowed</th>
                    <th className="text-right px-4 sm:px-5 py-3 font-semibold text-slate-500">Currently Out</th>
                    <th className="text-right px-4 sm:px-5 py-3 font-semibold text-slate-500">On-Time Returns</th>
                    <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">Standing</th>
                    <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">Last Borrowed</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={8} className="px-5 py-8 text-center text-slate-400">Loading...</td>
                    </tr>
                  ) : topBorrowers.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-5 py-8 text-center text-slate-400">
                        No borrowing records yet.
                      </td>
                    </tr>
                  ) : (
                    topBorrowers.map((tb) => (
                      <tr
                        key={tb.studentId}
                        className={`border-b border-slate-50 last:border-0 hover:bg-slate-50 ${
                          tb.rank === 1 ? "bg-emerald-50/40" : ""
                        }`}
                      >
                        <td className="px-4 py-4 text-center">
                          <span
                            className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${
                              tb.rank === 1
                                ? "bg-amber-100 text-amber-800 border border-amber-300"
                                : tb.rank === 2
                                ? "bg-slate-200 text-slate-700"
                                : tb.rank === 3
                                ? "bg-orange-100 text-orange-800"
                                : "text-slate-500"
                            }`}
                          >
                            #{tb.rank}
                          </span>
                        </td>
                        <td className="px-4 sm:px-5 py-4">
                          <div className="font-semibold text-slate-900">{tb.studentName}</div>
                          <div className="text-xs text-slate-500">
                            {tb.studentNumber !== "—" ? `${tb.studentNumber} • ` : ""}
                            {tb.studentSection}
                          </div>
                        </td>
                        <td className="px-4 sm:px-5 py-4 text-xs text-slate-600 hidden md:table-cell print:table-cell">
                          {[tb.gradeLevel, tb.program].filter(Boolean).join(" • ") || "—"}
                        </td>
                        <td className="px-4 sm:px-5 py-4 text-right font-bold text-emerald-700 text-base">
                          {tb.totalBorrowed}
                        </td>
                        <td className="px-4 sm:px-5 py-4 text-right font-medium text-blue-700">
                          {tb.currentlyBorrowed}
                        </td>
                        <td className="px-4 sm:px-5 py-4 text-right font-medium text-slate-700">
                          {tb.returnedOnTime}
                        </td>
                        <td className="px-4 sm:px-5 py-4">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${
                              tb.standingTone === "red"
                                ? "bg-red-100 text-red-700"
                                : tb.standingTone === "amber"
                                ? "bg-amber-100 text-amber-800"
                                : "bg-emerald-100 text-emerald-700"
                            }`}
                          >
                            {tb.standingLabel}
                          </span>
                        </td>
                        <td className="px-4 sm:px-5 py-4">
                          <DateTimeCell iso={tb.lastBorrowedAt} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Student Violations Report */}
        {reportType === "violations" && (
          <div className="space-y-6 animate-fade-in-up stagger-3">
            {/* Student-level standing table */}
            <div className="bg-white rounded-xl border border-slate-200">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-5 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5 text-amber-600" />
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">Student Violations Summary</h3>
                    <p className="text-xs text-slate-500">
                      Policy: {policySummaryText}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs sm:text-sm">
                  <span className="text-red-700 font-semibold">
                    Restricted: {violationBundle.bannedStudentCount}
                  </span>
                  <span className="text-amber-700 font-semibold">
                    Warned: {violationBundle.warnedStudentCount}
                  </span>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">Student</th>
                      <th className="text-right px-4 sm:px-5 py-3 font-semibold text-slate-500">Active Violations</th>
                      <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">Current Standing / Penalty</th>
                      <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">Borrowing Access</th>
                      <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">Latest Violation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={5} className="px-5 py-8 text-center text-slate-400">Loading...</td>
                      </tr>
                    ) : violationBundle.studentsWithViolations.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-5 py-8 text-center text-slate-400">
                          No student violations recorded.
                        </td>
                      </tr>
                    ) : (
                      violationBundle.studentsWithViolations.map((st) => (
                        <tr key={st.studentId} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                          <td className="px-4 sm:px-5 py-4">
                            <div className="font-medium text-slate-800">{st.studentName}</div>
                            <div className="text-xs text-slate-500">
                              {st.studentNumber !== "—" ? `${st.studentNumber} • ` : ""}
                              {st.studentSection}
                            </div>
                          </td>
                          <td className="px-4 sm:px-5 py-4 text-right">
                            <span
                              className={`font-bold ${
                                st.activeViolationCount > 0 ? "text-red-700" : "text-slate-400"
                              }`}
                            >
                              {st.activeViolationCount}
                            </span>
                            {st.clearedViolationCount > 0 && (
                              <div className="text-xs text-emerald-600">
                                {st.clearedViolationCount} cleared
                              </div>
                            )}
                          </td>
                          <td className="px-4 sm:px-5 py-4">
                            <span
                              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-xs font-semibold ${
                                st.standingTone === "red"
                                  ? "bg-red-100 text-red-700"
                                  : st.standingTone === "amber"
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-emerald-100 text-emerald-700"
                              }`}
                            >
                              {st.standingTone === "red" ? (
                                <Ban className="w-3.5 h-3.5" />
                              ) : st.standingTone === "amber" ? (
                                <AlertTriangle className="w-3.5 h-3.5" />
                              ) : (
                                <ShieldCheck className="w-3.5 h-3.5" />
                              )}
                              {st.standingLabel}
                            </span>
                          </td>
                          <td className="px-4 sm:px-5 py-4 text-xs">
                            {st.isBanned ? (
                              <div className="text-red-700 font-medium">
                                {st.blockedByUnreturnedOverdue
                                  ? "Forbidden — return overdue book first"
                                  : st.banEndsAt
                                  ? `Forbidden until ${formatDateTime(st.banEndsAt)}`
                                  : "Borrowing suspended"}
                                {st.banRemainingLabel && !st.blockedByUnreturnedOverdue && (
                                  <div className="text-red-500 mt-0.5">{st.banRemainingLabel}</div>
                                )}
                              </div>
                            ) : (
                              <span className="text-emerald-700 font-medium">Allowed to borrow</span>
                            )}
                          </td>
                          <td className="px-4 sm:px-5 py-4">
                            <DateTimeCell iso={st.latestViolationAt} />
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Individual Violation Incidents Log */}
            <div className="bg-white rounded-xl border border-slate-200">
              <div className="p-5 border-b border-slate-100">
                <h3 className="text-base font-bold text-slate-900">Violation Incidents History</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Every overdue or late-returned book that triggered a student violation. Librarians/Admins can clear or restore an incident.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">Student</th>
                      <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">Book</th>
                      <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">Due (Date &amp; Time)</th>
                      <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">Returned (Date &amp; Time)</th>
                      <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">Offense / Penalty</th>
                      {allowManageViolations && (
                        <th className="text-right px-4 sm:px-5 py-3 font-semibold text-slate-500 no-print">Action</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {violationBundle.allIncidents.length === 0 ? (
                      <tr>
                        <td colSpan={allowManageViolations ? 6 : 5} className="px-5 py-8 text-center text-slate-400">
                          No violation incidents recorded.
                        </td>
                      </tr>
                    ) : (
                      violationBundle.allIncidents.map((inc) => (
                        <tr key={inc.transactionId} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                          <td className="px-4 sm:px-5 py-3.5">
                            <div className="font-medium text-slate-800">{inc.studentName}</div>
                            <div className="text-xs text-slate-500">{inc.studentSection}</div>
                          </td>
                          <td className="px-4 sm:px-5 py-3.5">
                            <div className="font-medium text-slate-800">{inc.bookTitle}</div>
                            <div className="text-xs text-slate-500">
                              {inc.category} • {inc.overdueLabel} late
                            </div>
                          </td>
                          <td className="px-4 sm:px-5 py-3.5">
                            <DateTimeCell iso={inc.dueDate} emphasis="red" />
                          </td>
                          <td className="px-4 sm:px-5 py-3.5">
                            {inc.dateReturned ? (
                              <DateTimeCell iso={inc.dateReturned} emphasis="blue" />
                            ) : (
                              <span className="text-xs font-semibold text-red-600">Still unreturned</span>
                            )}
                          </td>
                          <td className="px-4 sm:px-5 py-3.5">
                            {inc.cleared ? (
                              <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-700">
                                Cleared / Excused
                              </span>
                            ) : (
                              <span
                                className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${
                                  inc.ruleApplied?.action === "ban"
                                    ? "bg-red-100 text-red-700"
                                    : "bg-amber-100 text-amber-800"
                                }`}
                              >
                                {formatOrdinal(inc.offenseNumber)} — {inc.ruleApplied?.label ?? "Warning"}
                              </span>
                            )}
                          </td>
                          {allowManageViolations && (
                            <td className="px-4 sm:px-5 py-3.5 text-right no-print">
                              <button
                                type="button"
                                disabled={clearingTxId === inc.transactionId}
                                onClick={() =>
                                  handleToggleViolationCleared(inc.transactionId, !inc.cleared)
                                }
                                className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors disabled:opacity-50 ${
                                  inc.cleared
                                    ? "border-slate-200 text-slate-600 hover:bg-slate-100"
                                    : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                                }`}
                              >
                                {clearingTxId === inc.transactionId
                                  ? "Updating..."
                                  : inc.cleared
                                  ? "Restore"
                                  : "Clear"}
                              </button>
                            </td>
                          )}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* School Year Summary */}
        {reportType === "school-years" && (
          <div className="bg-white rounded-xl border border-slate-200 mb-6 animate-fade-in-up stagger-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-5 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-emerald-600" />
                <div>
                  <h3 className="text-lg font-bold text-slate-900">School Year Summary</h3>
                  <p className="text-xs text-slate-500">
                    Academic-year breakdown computed from live circulation records. Click &ldquo;Filter Report&rdquo; to inspect a specific school year.
                  </p>
                </div>
              </div>
              {schoolYearFilter !== "all" && (
                <button
                  type="button"
                  onClick={() => setSchoolYearFilter("all")}
                  className="text-xs font-medium text-emerald-700 hover:text-emerald-800 no-print self-start sm:self-auto"
                >
                  Clear School Year Filter ({schoolYearScopeLabel})
                </button>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">School Year</th>
                    <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500 hidden md:table-cell print:table-cell">Period</th>
                    <th className="text-right px-4 sm:px-5 py-3 font-semibold text-slate-500">Total Loans</th>
                    <th className="text-right px-4 sm:px-5 py-3 font-semibold text-slate-500 hidden sm:table-cell print:table-cell">Students</th>
                    <th className="text-right px-4 sm:px-5 py-3 font-semibold text-slate-500">Borrowed</th>
                    <th className="text-right px-4 sm:px-5 py-3 font-semibold text-slate-500">Returned</th>
                    <th className="text-right px-4 sm:px-5 py-3 font-semibold text-slate-500">Overdue</th>
                    <th className="text-right px-4 sm:px-5 py-3 font-semibold text-slate-500">Violations</th>
                    <th className="text-right px-4 sm:px-5 py-3 font-semibold text-slate-500 no-print">Scope</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={9} className="px-5 py-8 text-center text-slate-400">Loading...</td>
                    </tr>
                  ) : schoolYearSummaries.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-5 py-8 text-center text-slate-400">No school year data available. Configure school years in Settings.</td>
                    </tr>
                  ) : (
                    schoolYearSummaries.map((summary) => {
                      const isSelected = schoolYearFilter === summary.school_year_id;
                      return (
                        <tr
                          key={summary.school_year_id}
                          className={`border-b border-slate-50 last:border-0 transition-colors ${
                            isSelected ? "bg-emerald-50/50" : "hover:bg-slate-50"
                          }`}
                        >
                          <td className="px-4 sm:px-5 py-4 font-medium text-slate-800">
                            <div className="flex items-center gap-2">
                              <span>SY {summary.school_year_name}</span>
                              {summary.is_active && (
                                <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[10px] font-semibold">
                                  Active
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 sm:px-5 py-4 text-xs text-slate-500 hidden md:table-cell print:table-cell">
                            {summary.start_date && summary.end_date
                              ? formatSchoolYearDateRange(summary.start_date, summary.end_date)
                              : "—"}
                          </td>
                          <td className="px-4 sm:px-5 py-4 text-right font-semibold text-slate-800">
                            {summary.total_transactions}
                          </td>
                          <td className="px-4 sm:px-5 py-4 text-right text-slate-600 hidden sm:table-cell print:table-cell">
                            {summary.unique_students ?? 0}
                          </td>
                          <td className="px-4 sm:px-5 py-4 text-right text-emerald-700 font-medium">
                            {summary.currently_borrowed}
                          </td>
                          <td className="px-4 sm:px-5 py-4 text-right text-blue-700">
                            {summary.returned}
                          </td>
                          <td className={`px-4 sm:px-5 py-4 text-right font-medium ${summary.overdue > 0 ? "text-red-600" : "text-slate-500"}`}>
                            {summary.overdue}
                          </td>
                          <td className={`px-4 sm:px-5 py-4 text-right font-medium ${(summary.violations_count ?? 0) > 0 ? "text-amber-700" : "text-slate-500"}`}>
                            {summary.violations_count ?? 0}
                          </td>
                          <td className="px-4 sm:px-5 py-4 text-right no-print">
                            <button
                              type="button"
                              onClick={() => {
                                setSchoolYearFilter(isSelected ? "all" : summary.school_year_id);
                                if (!isSelected) setReportType("circulation");
                              }}
                              className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                                isSelected
                                  ? "border-emerald-300 bg-emerald-700 text-white"
                                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                              }`}
                            >
                              {isSelected ? "Filtering" : "Filter Report"}
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
        )}

        {/* Most borrowed titles table */}
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
                  ) : scopedMostBorrowed.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-5 py-8 text-center text-slate-400">No data available.</td>
                    </tr>
                  ) : (
                    scopedMostBorrowed.map((book) => (
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
                    Unreturned books past their exact due date &amp; time, with corresponding student violation tier.
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
                    <th className="text-left px-4 sm:px-5 py-3 font-semibold text-slate-500">Violation Penalty</th>
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
                          <span
                            className={`inline-block px-2.5 py-0.5 rounded text-xs font-semibold ${
                              row.violationTone === "red"
                                ? "bg-red-100 text-red-700"
                                : row.violationTone === "amber"
                                ? "bg-amber-100 text-amber-800"
                                : "bg-emerald-100 text-emerald-700"
                            }`}
                          >
                            {row.violationLabel}
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
