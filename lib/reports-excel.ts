import writeXlsxFile, {
  type Sheet,
  type Row,
  type CellObject,
} from "write-excel-file/browser";
import type {
  BorrowingTransactionWithDetails,
  DashboardStats,
  MostBorrowedBookRow,
  SchoolYearSummary,
  TopBorrowerStudentRow,
  ViolationPolicy,
} from "@/lib/types";
import type { WeekBounds, WeeklyCirculationDay } from "@/lib/supabase/dashboard";
import {
  formatBanDuration,
  formatOrdinal,
  formatViolationPolicySummary,
  type ViolationEvaluationBundle,
} from "@/lib/supabase/violations";
import { formatSchoolYearDateRange } from "@/lib/supabase/school-years";
import { getServerDateString } from "@/lib/server-clock";

// ── Date & Time Formatting ────────────────────────────────────

const DATE_FMT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
};

const TIME_FMT: Intl.DateTimeFormatOptions = {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
};

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "—";
  return `${dt.toLocaleDateString("en-US", DATE_FMT)}, ${dt.toLocaleTimeString("en-US", TIME_FMT)}`;
}

export function formatDateParts(
  iso: string | null | undefined
): { date: string; time: string } {
  if (!iso) return { date: "—", time: "" };
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return { date: "—", time: "" };
  return {
    date: dt.toLocaleDateString("en-US", DATE_FMT),
    time: dt.toLocaleTimeString("en-US", TIME_FMT),
  };
}

// ── Transaction Categorization ────────────────────────────────

export interface CategorizedLoanItem {
  id: string;
  bookTitle: string;
  bookAuthor: string;
  accessionNumber: string;
  category: string;
  studentId: string;
  studentName: string;
  studentNumber: string;
  studentSection: string;
  dateBorrowed: string;
  dueDate: string;
  dateReturned: string | null;
  status: "Borrowed (On Time)" | "Overdue" | "Returned";
  daysRemaining: number;
  remainingLabel: string;
  daysOverdue: number;
  overdueLabel: string;
  agingBucket: "1–7 Days" | "8–14 Days" | "15+ Days" | "—";
  violationOffense: number;
  violationLabel: string;
  violationTone: "emerald" | "amber" | "red" | "muted";
  violationCleared: boolean;
  wasLate: boolean;
  handledBy: string;
}

export interface ClassificationBreakdownRow {
  classification: string;
  totalLoans: number;
  borrowedOnTime: number;
  overdue: number;
  returned: number;
}

export interface CategorizedTransactionsResult {
  borrowedOnTime: CategorizedLoanItem[];
  overdueItems: CategorizedLoanItem[];
  returnedItems: CategorizedLoanItem[];
  byClassification: ClassificationBreakdownRow[];
}

function getAgingBucket(daysOverdue: number): "1–7 Days" | "8–14 Days" | "15+ Days" {
  if (daysOverdue > 14) return "15+ Days";
  if (daysOverdue > 7) return "8–14 Days";
  return "1–7 Days";
}

function formatRemainingLabel(dueDate: Date, now: Date): { days: number; label: string } {
  const diffMs = dueDate.getTime() - now.getTime();
  if (diffMs <= 0) return { days: 0, label: "Due now" };
  const hours = Math.ceil(diffMs / (1000 * 60 * 60));
  if (hours < 24) {
    return { days: 0, label: `${hours} hr${hours === 1 ? "" : "s"} left` };
  }
  const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  return { days, label: `${days} day${days === 1 ? "" : "s"} left` };
}

function formatOverdueLabel(dueDate: Date, endDate: Date): { days: number; label: string } {
  const diffMs = Math.max(0, endDate.getTime() - dueDate.getTime());
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days >= 1) {
    return { days, label: `${days} day${days === 1 ? "" : "s"}` };
  }
  const hours = Math.max(1, Math.floor(diffMs / (1000 * 60 * 60)));
  return { days: 0, label: `${hours} hr${hours === 1 ? "" : "s"}` };
}

export function categorizeTransactions(
  transactions: BorrowingTransactionWithDetails[],
  violationBundle: ViolationEvaluationBundle,
  referenceNow: Date
): CategorizedTransactionsResult {
  const borrowedOnTime: CategorizedLoanItem[] = [];
  const overdueItems: CategorizedLoanItem[] = [];
  const returnedItems: CategorizedLoanItem[] = [];
  const categoryMap = new Map<string, ClassificationBreakdownRow>();

  for (const tx of transactions) {
    const book = tx.books;
    const student = tx.students;
    const category = book?.classifications?.name || "Uncategorized";
    const due = new Date(tx.due_date);
    const isReturned = tx.status === "Returned" || Boolean(tx.date_returned);
    const isOverdue = !isReturned && (tx.status === "Overdue" || due.getTime() < referenceNow.getTime());

    const incident = violationBundle.byTransactionId.get(tx.id);
    const handledBy = tx.handled_by_name
      ? tx.handled_by_role
        ? `${tx.handled_by_name} (${tx.handled_by_role})`
        : tx.handled_by_name
      : "—";

    if (!categoryMap.has(category)) {
      categoryMap.set(category, {
        classification: category,
        totalLoans: 0,
        borrowedOnTime: 0,
        overdue: 0,
        returned: 0,
      });
    }
    const catRow = categoryMap.get(category)!;
    catRow.totalLoans += 1;

    let violationLabel = "None";
    let violationTone: CategorizedLoanItem["violationTone"] = "muted";
    let violationOffense = 0;
    let violationCleared = false;

    if (incident) {
      violationCleared = incident.cleared;
      if (incident.cleared) {
        violationLabel = "Cleared / Excused";
        violationTone = "emerald";
      } else {
        violationOffense = incident.offenseNumber;
        const rule = incident.ruleApplied;
        const isBan = rule?.action === "ban" && (rule.banDays ?? 0) > 0;
        violationLabel = isBan
          ? `${formatOrdinal(incident.offenseNumber)} — ${formatBanDuration(rule!.banDays)} Ban`
          : `${formatOrdinal(incident.offenseNumber)} — ${rule?.label ?? "Warning"}`;
        violationTone = isBan ? "red" : "amber";
      }
    }

    const baseItem = {
      id: tx.id,
      bookTitle: book?.title ?? "Unknown Book",
      bookAuthor: book?.author ?? "—",
      accessionNumber: book?.accession_number ?? "—",
      category,
      studentId: tx.student_id,
      studentName: student?.name ?? "Unknown Student",
      studentNumber: student?.student_number ?? "—",
      studentSection: student?.section ?? "—",
      dateBorrowed: tx.date_borrowed,
      dueDate: tx.due_date,
      dateReturned: tx.date_returned,
      violationOffense,
      violationLabel,
      violationTone,
      violationCleared,
      handledBy,
    };

    if (isReturned) {
      catRow.returned += 1;
      const returnDate = tx.date_returned ? new Date(tx.date_returned) : referenceNow;
      const wasLate = returnDate.getTime() > due.getTime();
      const span = wasLate ? formatOverdueLabel(due, returnDate) : { days: 0, label: "On time" };

      returnedItems.push({
        ...baseItem,
        status: "Returned",
        daysRemaining: 0,
        remainingLabel: "—",
        daysOverdue: span.days,
        overdueLabel: span.label,
        agingBucket: "—",
        wasLate,
      });
    } else if (isOverdue) {
      catRow.overdue += 1;
      const span = formatOverdueLabel(due, referenceNow);

      overdueItems.push({
        ...baseItem,
        status: "Overdue",
        daysRemaining: 0,
        remainingLabel: "Past due",
        daysOverdue: span.days,
        overdueLabel: span.label,
        agingBucket: getAgingBucket(span.days),
        wasLate: true,
      });
    } else {
      catRow.borrowedOnTime += 1;
      const rem = formatRemainingLabel(due, referenceNow);
      borrowedOnTime.push({
        ...baseItem,
        status: "Borrowed (On Time)",
        daysRemaining: rem.days,
        remainingLabel: rem.label,
        daysOverdue: 0,
        overdueLabel: "—",
        agingBucket: "—",
        wasLate: false,
      });
    }
  }

  borrowedOnTime.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
  overdueItems.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
  returnedItems.sort(
    (a, b) =>
      new Date(b.dateReturned ?? b.dateBorrowed).getTime() -
      new Date(a.dateReturned ?? a.dateBorrowed).getTime()
  );

  const byClassification = Array.from(categoryMap.values()).sort(
    (a, b) => b.totalLoans - a.totalLoans || a.classification.localeCompare(b.classification)
  );

  return {
    borrowedOnTime,
    overdueItems,
    returnedItems,
    byClassification,
  };
}

// ── Shared Report Input Type ──────────────────────────────────

export interface FullLibraryReportInput {
  generatedAt: Date;
  preparedBy: string;
  schoolYearScopeLabel?: string;
  weekBounds: WeekBounds;
  weekPresetLabel: string;
  stats: DashboardStats | null;
  violationPolicy: ViolationPolicy;
  violationBundle: ViolationEvaluationBundle;
  weeklyCirculation: WeeklyCirculationDay[];
  categorized: CategorizedTransactionsResult;
  topBorrowers: TopBorrowerStudentRow[];
  mostBorrowed: MostBorrowedBookRow[];
  schoolYearSummaries: SchoolYearSummary[];
}

// ── In-App Workbook Preview Model ─────────────────────────────

export interface ExcelPreviewCell {
  text: string;
  align?: "left" | "center" | "right";
  tone?: "default" | "emerald" | "amber" | "red" | "blue" | "muted" | "bold";
}

export interface ExcelPreviewRow {
  cells: ExcelPreviewCell[];
  isTotal?: boolean;
  isSectionHeader?: boolean;
}

export interface ExcelPreviewSheet {
  id: string;
  name: string;
  description: string;
  countBadge?: string;
  badgeTone?: "emerald" | "amber" | "red" | "blue" | "slate";
  headers: { label: string; align?: "left" | "center" | "right" }[];
  rows: ExcelPreviewRow[];
  summaryNote?: string;
}

function cell(
  text: string | number,
  align: "left" | "center" | "right" = "left",
  tone: ExcelPreviewCell["tone"] = "default"
): ExcelPreviewCell {
  return { text: String(text), align, tone };
}

export function buildFullReportPreviewSheets(
  input: FullLibraryReportInput
): ExcelPreviewSheet[] {
  const {
    generatedAt,
    preparedBy,
    schoolYearScopeLabel,
    weekBounds,
    weekPresetLabel,
    violationPolicy,
    violationBundle,
    weeklyCirculation,
    categorized,
    topBorrowers,
    mostBorrowed,
    schoolYearSummaries,
  } = input;

  const totalBorrowedCount = categorized.borrowedOnTime.length;
  const totalOverdueCount = categorized.overdueItems.length;
  const totalReturnedCount = categorized.returnedItems.length;
  const totalAllTransactions =
    totalBorrowedCount + totalOverdueCount + totalReturnedCount;

  const aging1to7 = categorized.overdueItems.filter((i) => i.agingBucket === "1–7 Days").length;
  const aging8to14 = categorized.overdueItems.filter((i) => i.agingBucket === "8–14 Days").length;
  const aging15plus = categorized.overdueItems.filter((i) => i.agingBucket === "15+ Days").length;

  const policySummary = formatViolationPolicySummary(violationPolicy);
  const topStudent = topBorrowers[0];

  // 1. Executive Summary
  const summaryRows: ExcelPreviewRow[] = [
    {
      isSectionHeader: true,
      cells: [
        cell("Report Metadata", "left", "bold"),
        cell("Value", "left", "bold"),
        cell("Notes / Policy", "left", "bold"),
      ],
    },
    {
      cells: [
        cell("Institution"),
        cell("Batangas College of Arts and Sciences — Library", "left", "bold"),
        cell("Official Circulation, Violations & Analytics Workbook", "left", "muted"),
      ],
    },
    {
      cells: [
        cell("Generated Date & Time"),
        cell(formatDateTime(generatedAt.toISOString()), "left", "bold"),
        cell("Anchored to authoritative server clock", "left", "muted"),
      ],
    },
    {
      cells: [
        cell("Circulation Week Filter"),
        cell(`${weekPresetLabel} (${weekBounds.rangeLabel})`, "left", "bold"),
        cell("Monday – Sunday calendar week", "left", "muted"),
      ],
    },
    {
      cells: [
        cell("School Year Scope"),
        cell(schoolYearScopeLabel || "All School Years", "left", "bold"),
        cell("Scope applied to KPIs, violations, borrowers & transactions", "left", "muted"),
      ],
    },
    {
      cells: [
        cell("Prepared By"),
        cell(preparedBy, "left", "bold"),
        cell(`Violation Policy: ${policySummary}`, "left", "muted"),
      ],
    },
    {
      isSectionHeader: true,
      cells: [
        cell("Library Operations KPI", "left", "bold"),
        cell("Count / Highlight", "right", "bold"),
        cell("Details & Status", "left", "bold"),
      ],
    },
    {
      cells: [
        cell("Currently Borrowed (On Time)"),
        cell(totalBorrowedCount, "right", "emerald"),
        cell("Active loans within due date", "left", "muted"),
      ],
    },
    {
      cells: [
        cell("Overdue Items"),
        cell(totalOverdueCount, "right", totalOverdueCount > 0 ? "red" : "emerald"),
        cell(
          `1–7d: ${aging1to7} • 8–14d: ${aging8to14} • 15+d: ${aging15plus}`,
          "left",
          "muted"
        ),
      ],
    },
    {
      cells: [
        cell("Total Active Checkouts (On Time + Overdue)"),
        cell(totalBorrowedCount + totalOverdueCount, "right", "bold"),
        cell("All items currently out with students", "left", "muted"),
      ],
    },
    {
      cells: [
        cell("Returned Transactions"),
        cell(totalReturnedCount, "right", "blue"),
        cell("Completed returns across all records", "left", "muted"),
      ],
    },
    {
      cells: [
        cell("Total Recorded Transactions"),
        cell(totalAllTransactions, "right", "bold"),
        cell("All circulation history", "left", "muted"),
      ],
    },
    {
      cells: [
        cell("Active Student Violations"),
        cell(
          violationBundle.totalActiveViolations,
          "right",
          violationBundle.totalActiveViolations > 0 ? "amber" : "emerald"
        ),
        cell(
          `Restricted/Banned: ${violationBundle.bannedStudentCount} • Warned: ${violationBundle.warnedStudentCount}`,
          "left",
          violationBundle.bannedStudentCount > 0 ? "red" : "muted"
        ),
      ],
    },
    {
      cells: [
        cell("Top Borrowing Student (#1)"),
        cell(
          topStudent ? `${topStudent.totalBorrowed} books` : "—",
          "right",
          "emerald"
        ),
        cell(
          topStudent
            ? `${topStudent.studentName} (${topStudent.studentSection}) — ${topStudent.standingLabel}`
            : "No borrowing history yet",
          "left",
          "bold"
        ),
      ],
    },
    {
      isSectionHeader: true,
      cells: [
        cell("Circulation by Category / Classification", "left", "bold"),
        cell("Total Loans", "right", "bold"),
        cell("Borrowed (On Time) / Overdue / Returned", "left", "bold"),
      ],
    },
    ...categorized.byClassification.map((c) => ({
      cells: [
        cell(c.classification, "left", "bold"),
        cell(c.totalLoans, "right", "bold"),
        cell(
          `On Time: ${c.borrowedOnTime}  •  Overdue: ${c.overdue}  •  Returned: ${c.returned}`,
          "left",
          c.overdue > 0 ? "amber" : "default"
        ),
      ],
    })),
  ];

  // 2. Circulation Activity (Selected Week)
  const weekBorrows = weeklyCirculation.reduce((s, d) => s + d.borrows, 0);
  const weekReturns = weeklyCirculation.reduce((s, d) => s + d.returns, 0);
  const weekOverdueDue = weeklyCirculation.reduce((s, d) => s + d.overdueDue, 0);

  const circulationRows: ExcelPreviewRow[] = [
    ...weeklyCirculation.map((d) => {
      const net = d.borrows - d.returns;
      return {
        cells: [
          cell(d.day, "left", "bold"),
          cell(d.fullDate),
          cell(d.borrows, "right", d.borrows > 0 ? "emerald" : "muted"),
          cell(d.returns, "right", d.returns > 0 ? "blue" : "muted"),
          cell(d.overdueDue, "right", d.overdueDue > 0 ? "red" : "muted"),
          cell(net > 0 ? `+${net}` : String(net), "right", "default"),
          cell(d.borrows + d.returns, "right", "bold"),
        ],
      };
    }),
    {
      isTotal: true,
      cells: [
        cell("WEEK TOTAL", "left", "bold"),
        cell(weekBounds.rangeLabel, "left", "bold"),
        cell(weekBorrows, "right", "emerald"),
        cell(weekReturns, "right", "blue"),
        cell(weekOverdueDue, "right", weekOverdueDue > 0 ? "red" : "default"),
        cell(
          weekBorrows - weekReturns > 0
            ? `+${weekBorrows - weekReturns}`
            : String(weekBorrows - weekReturns),
          "right",
          "bold"
        ),
        cell(weekBorrows + weekReturns, "right", "bold"),
      ],
    },
  ];

  // 3. Borrowed (On Time)
  const borrowedRows: ExcelPreviewRow[] = categorized.borrowedOnTime.map((item) => ({
    cells: [
      cell(item.bookTitle, "left", "bold"),
      cell(item.bookAuthor),
      cell(item.accessionNumber),
      cell(item.category),
      cell(item.studentName, "left", "bold"),
      cell(item.studentNumber),
      cell(item.studentSection),
      cell(formatDateTime(item.dateBorrowed)),
      cell(formatDateTime(item.dueDate)),
      cell(item.remainingLabel, "center", "emerald"),
      cell(item.handledBy, "left", "muted"),
    ],
  }));

  // 4. Overdue Items
  const overdueRows: ExcelPreviewRow[] = categorized.overdueItems.map((item) => ({
    cells: [
      cell(item.bookTitle, "left", "bold"),
      cell(item.accessionNumber),
      cell(item.category),
      cell(item.studentName, "left", "bold"),
      cell(item.studentNumber),
      cell(item.studentSection),
      cell(formatDateTime(item.dateBorrowed)),
      cell(formatDateTime(item.dueDate), "left", "red"),
      cell(item.overdueLabel, "center", "red"),
      cell(item.agingBucket, "center", item.agingBucket === "15+ Days" ? "red" : "amber"),
      cell(item.violationLabel, "center", item.violationTone),
    ],
  }));

  // 5. Returned Items
  const returnedRows: ExcelPreviewRow[] = categorized.returnedItems.map((item) => ({
    cells: [
      cell(item.bookTitle, "left", "bold"),
      cell(item.accessionNumber),
      cell(item.category),
      cell(item.studentName, "left", "bold"),
      cell(item.studentSection),
      cell(formatDateTime(item.dateBorrowed)),
      cell(formatDateTime(item.dueDate)),
      cell(formatDateTime(item.dateReturned), "left", "blue"),
      cell(item.wasLate ? `Late (${item.overdueLabel})` : "On Time", "center", item.wasLate ? "amber" : "emerald"),
      cell(item.violationLabel, "center", item.violationTone),
    ],
  }));

  // 6. Student Violations
  const violationRows: ExcelPreviewRow[] = violationBundle.studentsWithViolations.map((st) => ({
    cells: [
      cell(st.studentName, "left", "bold"),
      cell(st.studentNumber),
      cell(st.studentSection),
      cell(st.activeViolationCount, "right", st.activeViolationCount > 0 ? "red" : "muted"),
      cell(st.clearedViolationCount, "right", st.clearedViolationCount > 0 ? "emerald" : "muted"),
      cell(st.standingLabel, "left", st.standingTone),
      cell(
        st.isBanned
          ? st.blockedByUnreturnedOverdue
            ? "Return overdue book first"
            : st.banEndsAt
            ? `${formatDateTime(st.banEndsAt)} (${st.banRemainingLabel})`
            : "Restricted"
          : "Allowed to borrow",
        "left",
        st.isBanned ? "red" : "emerald"
      ),
      cell(formatDateTime(st.latestViolationAt)),
    ],
  }));

  // 7. Top Borrowers (Students)
  const topBorrowerRows: ExcelPreviewRow[] = topBorrowers.map((tb) => ({
    cells: [
      cell(`#${tb.rank}`, "center", "bold"),
      cell(tb.studentName, "left", "bold"),
      cell(tb.studentNumber),
      cell(tb.studentSection),
      cell([tb.gradeLevel, tb.program].filter(Boolean).join(" • ") || "—"),
      cell(tb.totalBorrowed, "right", "emerald"),
      cell(tb.currentlyBorrowed, "right", tb.currentlyBorrowed > 0 ? "blue" : "muted"),
      cell(tb.returnedOnTime, "right", "default"),
      cell(tb.activeViolations, "right", tb.activeViolations > 0 ? "red" : "muted"),
      cell(tb.standingLabel, "center", tb.standingTone),
      cell(formatDateTime(tb.lastBorrowedAt)),
    ],
  }));

  // 8. Popular Books
  const popularRows: ExcelPreviewRow[] = mostBorrowed.map((b, idx) => ({
    cells: [
      cell(`#${idx + 1}`, "center", "bold"),
      cell(b.title, "left", "bold"),
      cell(b.author),
      cell(b.classification_name || "Uncategorized"),
      cell(b.borrow_count, "right", "emerald"),
      cell(b.current_status, "center", b.current_status === "Available" ? "emerald" : "amber"),
    ],
  }));

  // 9. School Year Summary
  const syRows: ExcelPreviewRow[] = schoolYearSummaries.map((sy) => ({
    cells: [
      cell(
        `${sy.school_year_name}${sy.is_active ? " (Active)" : ""}`,
        "left",
        sy.is_active ? "emerald" : "bold"
      ),
      cell(
        sy.start_date && sy.end_date
          ? formatSchoolYearDateRange(sy.start_date, sy.end_date)
          : "—",
        "left",
        "muted"
      ),
      cell(sy.total_transactions, "right", "bold"),
      cell(sy.unique_students ?? 0, "right"),
      cell(sy.currently_borrowed, "right", "emerald"),
      cell(sy.returned, "right", "blue"),
      cell(sy.overdue, "right", sy.overdue > 0 ? "red" : "muted"),
      cell(
        sy.violations_count ?? 0,
        "right",
        (sy.violations_count ?? 0) > 0 ? "amber" : "muted"
      ),
    ],
  }));

  return [
    {
      id: "summary",
      name: "Executive Summary",
      description: "Library KPIs, violation policy summary, top borrowing student, and circulation by category.",
      badgeTone: "emerald",
      headers: [
        { label: "Metric / Category" },
        { label: "Value / Count", align: "right" },
        { label: "Breakdown & Notes" },
      ],
      rows: summaryRows,
    },
    {
      id: "circulation",
      name: "Circulation Activity",
      description: `Daily checkouts, returns, and overdue due dates for ${weekPresetLabel} (${weekBounds.rangeLabel}).`,
      countBadge: `${weekBorrows + weekReturns}`,
      badgeTone: "blue",
      headers: [
        { label: "Day" },
        { label: "Calendar Date" },
        { label: "Books Borrowed", align: "right" },
        { label: "Books Returned", align: "right" },
        { label: "Overdue Due", align: "right" },
        { label: "Net Out", align: "right" },
        { label: "Total Activity", align: "right" },
      ],
      rows: circulationRows,
    },
    {
      id: "borrowed",
      name: "Borrowed (On Time)",
      description: "All items currently checked out and within their due date & time.",
      countBadge: String(totalBorrowedCount),
      badgeTone: "emerald",
      headers: [
        { label: "Book Title" },
        { label: "Author" },
        { label: "Accession #" },
        { label: "Category" },
        { label: "Student" },
        { label: "Student #" },
        { label: "Section" },
        { label: "Borrowed Date & Time" },
        { label: "Due Date & Time" },
        { label: "Time Remaining", align: "center" },
        { label: "Handled By" },
      ],
      rows: borrowedRows,
      summaryNote:
        totalBorrowedCount === 0
          ? "No active on-time loans at this moment."
          : `${totalBorrowedCount} active loan${totalBorrowedCount === 1 ? "" : "s"} currently on schedule.`,
    },
    {
      id: "overdue",
      name: "Overdue Items",
      description: "Unreturned items past their due date & time, with student violation escalation status.",
      countBadge: String(totalOverdueCount),
      badgeTone: totalOverdueCount > 0 ? "red" : "slate",
      headers: [
        { label: "Book Title" },
        { label: "Accession #" },
        { label: "Category" },
        { label: "Student" },
        { label: "Student #" },
        { label: "Section" },
        { label: "Borrowed Date & Time" },
        { label: "Due Date & Time" },
        { label: "Overdue By", align: "center" },
        { label: "Aging Bucket", align: "center" },
        { label: "Violation Penalty", align: "center" },
      ],
      rows: overdueRows,
      summaryNote:
        totalOverdueCount === 0
          ? "All clear — no overdue books right now."
          : `${totalOverdueCount} overdue item${totalOverdueCount === 1 ? "" : "s"} requiring follow-up.`,
    },
    {
      id: "returned",
      name: "Returned Items",
      description: "Completed book returns with exact borrow, due, and return date & time.",
      countBadge: String(totalReturnedCount),
      badgeTone: "slate",
      headers: [
        { label: "Book Title" },
        { label: "Accession #" },
        { label: "Category" },
        { label: "Student" },
        { label: "Section" },
        { label: "Borrowed Date & Time" },
        { label: "Due Date & Time" },
        { label: "Returned Date & Time" },
        { label: "Return Timing", align: "center" },
        { label: "Violation Status", align: "center" },
      ],
      rows: returnedRows,
    },
    {
      id: "violations",
      name: "Student Violations",
      description: `Student violation counts, active warnings, and borrowing bans (${policySummary}).`,
      countBadge: String(violationBundle.totalActiveViolations),
      badgeTone: violationBundle.bannedStudentCount > 0 ? "red" : violationBundle.totalActiveViolations > 0 ? "amber" : "slate",
      headers: [
        { label: "Student" },
        { label: "Student #" },
        { label: "Section" },
        { label: "Active Violations", align: "right" },
        { label: "Cleared", align: "right" },
        { label: "Current Standing / Penalty" },
        { label: "Borrowing Access / Restriction" },
        { label: "Latest Violation Date & Time" },
      ],
      rows: violationRows,
    },
    {
      id: "top-borrowers",
      name: "Top Borrowers",
      description: "Ranked students with the highest number of borrowed books.",
      countBadge: String(topBorrowers.length),
      badgeTone: "emerald",
      headers: [
        { label: "Rank", align: "center" },
        { label: "Student Name" },
        { label: "Student #" },
        { label: "Section" },
        { label: "Grade / Program" },
        { label: "Total Borrowed", align: "right" },
        { label: "Currently Out", align: "right" },
        { label: "Returned On Time", align: "right" },
        { label: "Violations", align: "right" },
        { label: "Standing", align: "center" },
        { label: "Last Borrowed Date & Time" },
      ],
      rows: topBorrowerRows,
      summaryNote: topStudent
        ? `#1 Most Borrowed: ${topStudent.studentName} (${topStudent.totalBorrowed} books)`
        : undefined,
    },
    {
      id: "popular",
      name: "Popular Books",
      description: "Most frequently borrowed titles ranked by checkout count.",
      countBadge: String(mostBorrowed.length),
      badgeTone: "slate",
      headers: [
        { label: "Rank", align: "center" },
        { label: "Book Title" },
        { label: "Author" },
        { label: "Category" },
        { label: "Checkouts", align: "right" },
        { label: "Current Status", align: "center" },
      ],
      rows: popularRows,
    },
    {
      id: "school-years",
      name: "School Year Summary",
      description: "Academic-year totals for transactions, unique students, active loans, returns, overdue items, and violations.",
      countBadge: String(schoolYearSummaries.length),
      badgeTone: "slate",
      headers: [
        { label: "School Year" },
        { label: "Academic Period" },
        { label: "Total Loans", align: "right" },
        { label: "Unique Students", align: "right" },
        { label: "Borrowed (On Time)", align: "right" },
        { label: "Returned", align: "right" },
        { label: "Overdue", align: "right" },
        { label: "Active Violations", align: "right" },
      ],
      rows: syRows,
    },
  ];
}

// ── Real .xlsx Excel Workbook Generator ───────────────────────

const BORDER_LIGHT = "#CBD5E1";
const INT_FORMAT = "#,##0";

function bannerRow(title: string, colCount: number, bg = "#065F46"): Row {
  const row: Row = [
    {
      value: title,
      type: String,
      fontWeight: "bold",
      fontSize: 13,
      textColor: "#FFFFFF",
      backgroundColor: bg,
      alignVertical: "center",
      height: 28,
      columnSpan: colCount,
    },
  ];
  for (let i = 1; i < colCount; i++) row.push(null);
  return row;
}

function subtitleRow(text: string, colCount: number): Row {
  const row: Row = [
    {
      value: text,
      type: String,
      fontStyle: "italic",
      fontSize: 10,
      textColor: "#334155",
      backgroundColor: "#F1F5F9",
      alignVertical: "center",
      height: 20,
      columnSpan: colCount,
    },
  ];
  for (let i = 1; i < colCount; i++) row.push(null);
  return row;
}

function sectionHeaderRow(text: string, colCount: number): Row {
  const row: Row = [
    {
      value: text,
      type: String,
      fontWeight: "bold",
      fontSize: 11,
      textColor: "#065F46",
      backgroundColor: "#ECFDF5",
      borderColor: "#A7F3D0",
      borderStyle: "thin",
      alignVertical: "center",
      height: 22,
      columnSpan: colCount,
    },
  ];
  for (let i = 1; i < colCount; i++) row.push(null);
  return row;
}

function tableHeaderRow(
  headers: Array<{ label: string; align?: "left" | "center" | "right" }>,
  bg = "#047857"
): Row {
  return headers.map((h) => ({
    value: h.label,
    type: String,
    fontWeight: "bold",
    fontSize: 10,
    textColor: "#FFFFFF",
    backgroundColor: bg,
    align: h.align ?? "left",
    alignVertical: "center",
    borderColor: bg,
    borderStyle: "thin",
    height: 24,
    wrap: true,
  }));
}

function strCell(value: string, opts?: Partial<CellObject>): CellObject {
  return {
    value,
    type: String,
    borderColor: BORDER_LIGHT,
    borderStyle: "thin",
    alignVertical: "center",
    ...opts,
  };
}

function numCell(value: number, opts?: Partial<CellObject>): CellObject {
  return {
    value,
    type: Number,
    format: INT_FORMAT,
    align: "right",
    borderColor: BORDER_LIGHT,
    borderStyle: "thin",
    alignVertical: "center",
    ...opts,
  };
}

function emptyNoticeRow(message: string, colCount: number): Row {
  const row: Row = [
    {
      value: message,
      type: String,
      fontStyle: "italic",
      textColor: "#64748B",
      backgroundColor: "#F8FAFC",
      borderColor: BORDER_LIGHT,
      borderStyle: "thin",
      align: "center",
      alignVertical: "center",
      height: 24,
      columnSpan: colCount,
    },
  ];
  for (let i = 1; i < colCount; i++) row.push(null);
  return row;
}

export async function exportFullLibraryExcel(
  input: FullLibraryReportInput
): Promise<string> {
  const {
    generatedAt,
    preparedBy,
    schoolYearScopeLabel,
    weekBounds,
    weekPresetLabel,
    violationPolicy,
    violationBundle,
    weeklyCirculation,
    categorized,
    topBorrowers,
    mostBorrowed,
    schoolYearSummaries,
  } = input;

  const generatedStamp = formatDateTime(generatedAt.toISOString());
  const policySummary = formatViolationPolicySummary(violationPolicy);
  const syScope = schoolYearScopeLabel || "All School Years";
  const metaLine = `Generated: ${generatedStamp}  |  School Year: ${syScope}  |  Week Filter: ${weekPresetLabel} (${weekBounds.rangeLabel})  |  Prepared by: ${preparedBy}  |  Violation Policy: ${policySummary}`;

  const totalBorrowedOnTime = categorized.borrowedOnTime.length;
  const totalOverdue = categorized.overdueItems.length;
  const totalReturned = categorized.returnedItems.length;
  const aging1to7 = categorized.overdueItems.filter((i) => i.agingBucket === "1–7 Days").length;
  const aging8to14 = categorized.overdueItems.filter((i) => i.agingBucket === "8–14 Days").length;
  const aging15plus = categorized.overdueItems.filter((i) => i.agingBucket === "15+ Days").length;
  const topStudent = topBorrowers[0];

  // ── Sheet 1: Executive Summary ──
  const summaryData: Row[] = [
    bannerRow("BCAS LIBRARY — COMPLETE OPERATIONS, VIOLATIONS & ANALYTICS REPORT", 5),
    subtitleRow(metaLine, 5),
    [],
    sectionHeaderRow("1. KEY PERFORMANCE INDICATORS", 5),
    tableHeaderRow([
      { label: "Metric" },
      { label: "Value", align: "right" },
      { label: "Details / Notes" },
      { label: "Category" },
      { label: "Status", align: "center" },
    ]),
    [
      strCell("Currently Borrowed (On Time)", { fontWeight: "bold" }),
      numCell(totalBorrowedOnTime, { fontWeight: "bold", textColor: "#047857" }),
      strCell("Active loans currently within their due date & time"),
      strCell("Circulation"),
      strCell("On Schedule", { align: "center", backgroundColor: "#ECFDF5", textColor: "#047857", fontWeight: "bold" }),
    ],
    [
      strCell("Overdue Items", { fontWeight: "bold" }),
      numCell(totalOverdue, { fontWeight: "bold", textColor: totalOverdue > 0 ? "#B91C1C" : "#047857" }),
      strCell(`1–7 Days: ${aging1to7}  |  8–14 Days: ${aging8to14}  |  15+ Days: ${aging15plus}`),
      strCell("Overdue Tracking"),
      strCell(totalOverdue > 0 ? "Action Needed" : "All Clear", {
        align: "center",
        backgroundColor: totalOverdue > 0 ? "#FEF2F2" : "#ECFDF5",
        textColor: totalOverdue > 0 ? "#B91C1C" : "#047857",
        fontWeight: "bold",
      }),
    ],
    [
      strCell("Total Returned", { fontWeight: "bold" }),
      numCell(totalReturned, { fontWeight: "bold", textColor: "#1D4ED8" }),
      strCell("All completed book returns"),
      strCell("Circulation"),
      strCell("Completed", { align: "center", backgroundColor: "#EFF6FF", textColor: "#1D4ED8" }),
    ],
    [
      strCell("Active Student Violations", { fontWeight: "bold" }),
      numCell(violationBundle.totalActiveViolations, {
        fontWeight: "bold",
        textColor: violationBundle.totalActiveViolations > 0 ? "#B45309" : "#047857",
      }),
      strCell(
        `Restricted/Banned: ${violationBundle.bannedStudentCount}  |  Warned: ${violationBundle.warnedStudentCount}  |  Policy: ${policySummary}`
      ),
      strCell("Violations"),
      strCell(violationBundle.bannedStudentCount > 0 ? "Restrictions Active" : "Monitoring", {
        align: "center",
        backgroundColor: violationBundle.bannedStudentCount > 0 ? "#FEF2F2" : "#ECFDF5",
        textColor: violationBundle.bannedStudentCount > 0 ? "#B91C1C" : "#047857",
        fontWeight: "bold",
      }),
    ],
    [
      strCell("Top Borrowing Student (#1)", { fontWeight: "bold" }),
      numCell(topStudent?.totalBorrowed ?? 0, { fontWeight: "bold", textColor: "#047857" }),
      strCell(
        topStudent
          ? `${topStudent.studentName} (${topStudent.studentSection}) — ${topStudent.standingLabel}`
          : "No borrowing records yet"
      ),
      strCell("Top Readers"),
      strCell(topStudent ? "Top Reader" : "—", {
        align: "center",
        backgroundColor: "#ECFDF5",
        textColor: "#047857",
        fontWeight: "bold",
      }),
    ],
    [],
    sectionHeaderRow("2. CIRCULATION BY CLASSIFICATION / CATEGORY", 5),
    tableHeaderRow([
      { label: "Category / Classification" },
      { label: "Total Loans", align: "right" },
      { label: "Borrowed (On Time)", align: "right" },
      { label: "Overdue", align: "right" },
      { label: "Returned", align: "right" },
    ]),
    ...(categorized.byClassification.length > 0
      ? categorized.byClassification.map((c, i) => {
          const bg = i % 2 === 1 ? "#F8FAFC" : undefined;
          return [
            strCell(c.classification, { fontWeight: "bold", backgroundColor: bg }),
            numCell(c.totalLoans, { fontWeight: "bold", backgroundColor: bg }),
            numCell(c.borrowedOnTime, { textColor: "#047857", backgroundColor: bg }),
            numCell(c.overdue, { textColor: c.overdue > 0 ? "#B91C1C" : "#64748B", backgroundColor: bg }),
            numCell(c.returned, { textColor: "#1D4ED8", backgroundColor: bg }),
          ];
        })
      : [emptyNoticeRow("No categorized transactions recorded yet.", 5)]),
  ];

  // ── Sheet 2: Circulation Activity (Selected Week) ──
  const weekBorrows = weeklyCirculation.reduce((s, d) => s + d.borrows, 0);
  const weekReturns = weeklyCirculation.reduce((s, d) => s + d.returns, 0);
  const weekOverdueDue = weeklyCirculation.reduce((s, d) => s + d.overdueDue, 0);

  const circulationData: Row[] = [
    bannerRow(`CIRCULATION ACTIVITY — ${weekPresetLabel.toUpperCase()} (${weekBounds.rangeLabel})`, 7, "#065F46"),
    subtitleRow(metaLine, 7),
    tableHeaderRow([
      { label: "Day" },
      { label: "Calendar Date" },
      { label: "Books Borrowed", align: "right" },
      { label: "Books Returned", align: "right" },
      { label: "Overdue Due That Day", align: "right" },
      { label: "Net Out (Borrowed - Returned)", align: "right" },
      { label: "Total Activity", align: "right" },
    ]),
    ...weeklyCirculation.map((d, i) => {
      const bg = i % 2 === 1 ? "#F8FAFC" : undefined;
      return [
        strCell(d.day, { fontWeight: "bold", backgroundColor: bg }),
        strCell(d.fullDate, { backgroundColor: bg }),
        numCell(d.borrows, { textColor: "#047857", backgroundColor: bg }),
        numCell(d.returns, { textColor: "#1D4ED8", backgroundColor: bg }),
        numCell(d.overdueDue, { textColor: d.overdueDue > 0 ? "#B91C1C" : "#64748B", backgroundColor: bg }),
        numCell(d.borrows - d.returns, { backgroundColor: bg }),
        numCell(d.borrows + d.returns, { fontWeight: "bold", backgroundColor: bg }),
      ];
    }),
    [
      strCell("WEEK TOTAL", { fontWeight: "bold", backgroundColor: "#ECFDF5" }),
      strCell(weekBounds.rangeLabel, { fontWeight: "bold", backgroundColor: "#ECFDF5" }),
      numCell(weekBorrows, { fontWeight: "bold", textColor: "#047857", backgroundColor: "#ECFDF5" }),
      numCell(weekReturns, { fontWeight: "bold", textColor: "#1D4ED8", backgroundColor: "#ECFDF5" }),
      numCell(weekOverdueDue, { fontWeight: "bold", textColor: weekOverdueDue > 0 ? "#B91C1C" : "#334155", backgroundColor: "#ECFDF5" }),
      numCell(weekBorrows - weekReturns, { fontWeight: "bold", backgroundColor: "#ECFDF5" }),
      numCell(weekBorrows + weekReturns, { fontWeight: "bold", backgroundColor: "#ECFDF5" }),
    ],
  ];

  // ── Sheet 3: Borrowed (On Time) ──
  const borrowedData: Row[] = [
    bannerRow(`CURRENTLY BORROWED — ON TIME (${totalBorrowedOnTime} ITEMS)`, 11, "#047857"),
    subtitleRow(metaLine, 11),
    tableHeaderRow([
      { label: "Book Title" },
      { label: "Author" },
      { label: "Accession #" },
      { label: "Category" },
      { label: "Student Name" },
      { label: "Student #" },
      { label: "Section" },
      { label: "Borrowed Date & Time" },
      { label: "Due Date & Time" },
      { label: "Time Remaining", align: "center" },
      { label: "Handled By" },
    ]),
    ...(categorized.borrowedOnTime.length > 0
      ? categorized.borrowedOnTime.map((item, i) => {
          const bg = i % 2 === 1 ? "#F8FAFC" : undefined;
          return [
            strCell(item.bookTitle, { fontWeight: "bold", backgroundColor: bg }),
            strCell(item.bookAuthor, { backgroundColor: bg }),
            strCell(item.accessionNumber, { backgroundColor: bg }),
            strCell(item.category, { backgroundColor: bg }),
            strCell(item.studentName, { fontWeight: "bold", backgroundColor: bg }),
            strCell(item.studentNumber, { backgroundColor: bg }),
            strCell(item.studentSection, { backgroundColor: bg }),
            strCell(formatDateTime(item.dateBorrowed), { backgroundColor: bg }),
            strCell(formatDateTime(item.dueDate), { backgroundColor: bg }),
            strCell(item.remainingLabel, {
              align: "center",
              textColor: "#047857",
              backgroundColor: "#ECFDF5",
              fontWeight: "bold",
            }),
            strCell(item.handledBy, { backgroundColor: bg }),
          ];
        })
      : [emptyNoticeRow("No items currently borrowed on time.", 11)]),
  ];

  // ── Sheet 4: Overdue Items ──
  const overdueData: Row[] = [
    bannerRow(`OVERDUE ITEMS (${totalOverdue} ITEMS)`, 12, "#991B1B"),
    subtitleRow(metaLine, 12),
    tableHeaderRow(
      [
        { label: "Book Title" },
        { label: "Author" },
        { label: "Accession #" },
        { label: "Category" },
        { label: "Student Name" },
        { label: "Student #" },
        { label: "Section" },
        { label: "Borrowed Date & Time" },
        { label: "Due Date & Time" },
        { label: "Overdue Duration", align: "center" },
        { label: "Aging Bucket", align: "center" },
        { label: "Violation Penalty", align: "center" },
      ],
      "#B91C1C"
    ),
    ...(categorized.overdueItems.length > 0
      ? categorized.overdueItems.map((item, i) => {
          const bg = i % 2 === 1 ? "#FEF2F2" : undefined;
          return [
            strCell(item.bookTitle, { fontWeight: "bold", backgroundColor: bg }),
            strCell(item.bookAuthor, { backgroundColor: bg }),
            strCell(item.accessionNumber, { backgroundColor: bg }),
            strCell(item.category, { backgroundColor: bg }),
            strCell(item.studentName, { fontWeight: "bold", backgroundColor: bg }),
            strCell(item.studentNumber, { backgroundColor: bg }),
            strCell(item.studentSection, { backgroundColor: bg }),
            strCell(formatDateTime(item.dateBorrowed), { backgroundColor: bg }),
            strCell(formatDateTime(item.dueDate), { textColor: "#B91C1C", fontWeight: "bold", backgroundColor: bg }),
            strCell(item.overdueLabel, { align: "center", textColor: "#B91C1C", fontWeight: "bold", backgroundColor: bg }),
            strCell(item.agingBucket, { align: "center", backgroundColor: bg }),
            strCell(item.violationLabel, {
              align: "center",
              fontWeight: "bold",
              backgroundColor: item.violationTone === "red" ? "#FEE2E2" : item.violationTone === "amber" ? "#FEF3C7" : "#ECFDF5",
              textColor: item.violationTone === "red" ? "#991B1B" : item.violationTone === "amber" ? "#92400E" : "#047857",
            }),
          ];
        })
      : [emptyNoticeRow("No overdue items — all active loans are within their due dates.", 12)]),
  ];

  // ── Sheet 5: Returned Items ──
  const returnedData: Row[] = [
    bannerRow(`RETURNED ITEMS HISTORY (${totalReturned} ITEMS)`, 11, "#1E3A8A"),
    subtitleRow(metaLine, 11),
    tableHeaderRow(
      [
        { label: "Book Title" },
        { label: "Accession #" },
        { label: "Category" },
        { label: "Student Name" },
        { label: "Student #" },
        { label: "Section" },
        { label: "Borrowed Date & Time" },
        { label: "Due Date & Time" },
        { label: "Returned Date & Time" },
        { label: "Return Timing", align: "center" },
        { label: "Violation Status", align: "center" },
      ],
      "#1D4ED8"
    ),
    ...(categorized.returnedItems.length > 0
      ? categorized.returnedItems.map((item, i) => {
          const bg = i % 2 === 1 ? "#F8FAFC" : undefined;
          return [
            strCell(item.bookTitle, { fontWeight: "bold", backgroundColor: bg }),
            strCell(item.accessionNumber, { backgroundColor: bg }),
            strCell(item.category, { backgroundColor: bg }),
            strCell(item.studentName, { fontWeight: "bold", backgroundColor: bg }),
            strCell(item.studentNumber, { backgroundColor: bg }),
            strCell(item.studentSection, { backgroundColor: bg }),
            strCell(formatDateTime(item.dateBorrowed), { backgroundColor: bg }),
            strCell(formatDateTime(item.dueDate), { backgroundColor: bg }),
            strCell(formatDateTime(item.dateReturned), { textColor: "#1D4ED8", backgroundColor: bg }),
            strCell(item.wasLate ? `Late (${item.overdueLabel})` : "On Time", {
              align: "center",
              textColor: item.wasLate ? "#B45309" : "#047857",
              backgroundColor: item.wasLate ? "#FFFBEB" : "#ECFDF5",
              fontWeight: "bold",
            }),
            strCell(item.violationLabel, { align: "center", backgroundColor: bg }),
          ];
        })
      : [emptyNoticeRow("No returned transactions recorded yet.", 11)]),
  ];

  // ── Sheet 6: Student Violations ──
  const violationsData: Row[] = [
    bannerRow(`STUDENT VIOLATIONS LOG (${violationBundle.totalActiveViolations} ACTIVE VIOLATIONS)`, 8, "#92400E"),
    subtitleRow(metaLine, 8),
    tableHeaderRow(
      [
        { label: "Student Name" },
        { label: "Student #" },
        { label: "Section" },
        { label: "Active Violations", align: "right" },
        { label: "Cleared", align: "right" },
        { label: "Current Standing / Penalty" },
        { label: "Borrowing Restriction" },
        { label: "Latest Violation Date & Time" },
      ],
      "#B45309"
    ),
    ...(violationBundle.studentsWithViolations.length > 0
      ? violationBundle.studentsWithViolations.map((st, i) => {
          const bg = i % 2 === 1 ? "#FFFBEB" : undefined;
          return [
            strCell(st.studentName, { fontWeight: "bold", backgroundColor: bg }),
            strCell(st.studentNumber, { backgroundColor: bg }),
            strCell(st.studentSection, { backgroundColor: bg }),
            numCell(st.activeViolationCount, {
              fontWeight: "bold",
              textColor: st.activeViolationCount > 0 ? "#B91C1C" : "#64748B",
              backgroundColor: bg,
            }),
            numCell(st.clearedViolationCount, { textColor: "#047857", backgroundColor: bg }),
            strCell(st.standingLabel, {
              fontWeight: "bold",
              backgroundColor: st.standingTone === "red" ? "#FEE2E2" : st.standingTone === "amber" ? "#FEF3C7" : "#ECFDF5",
              textColor: st.standingTone === "red" ? "#991B1B" : st.standingTone === "amber" ? "#92400E" : "#047857",
            }),
            strCell(
              st.isBanned
                ? st.blockedByUnreturnedOverdue
                  ? "Return overdue book first"
                  : st.banEndsAt
                  ? `Forbidden until ${formatDateTime(st.banEndsAt)} (${st.banRemainingLabel})`
                  : "Borrowing restricted"
                : "Allowed to borrow",
              {
                textColor: st.isBanned ? "#991B1B" : "#047857",
                backgroundColor: bg,
              }
            ),
            strCell(formatDateTime(st.latestViolationAt), { backgroundColor: bg }),
          ];
        })
      : [emptyNoticeRow("No student violations recorded.", 8)]),
  ];

  // ── Sheet 7: Top Borrowers (Students) ──
  const topBorrowersData: Row[] = [
    bannerRow(`TOP BORROWING STUDENTS (${topBorrowers.length} STUDENTS)`, 11, "#065F46"),
    subtitleRow(metaLine, 11),
    tableHeaderRow([
      { label: "Rank", align: "center" },
      { label: "Student Name" },
      { label: "Student #" },
      { label: "Section" },
      { label: "Grade / Program" },
      { label: "Total Borrowed", align: "right" },
      { label: "Currently Out", align: "right" },
      { label: "Returned On Time", align: "right" },
      { label: "Active Violations", align: "right" },
      { label: "Standing", align: "center" },
      { label: "Last Borrowed Date & Time" },
    ]),
    ...(topBorrowers.length > 0
      ? topBorrowers.map((tb, i) => {
          const bg = i === 0 ? "#ECFDF5" : i % 2 === 1 ? "#F8FAFC" : undefined;
          return [
            numCell(tb.rank, { align: "center", fontWeight: "bold", backgroundColor: bg }),
            strCell(tb.studentName, { fontWeight: "bold", backgroundColor: bg }),
            strCell(tb.studentNumber, { backgroundColor: bg }),
            strCell(tb.studentSection, { backgroundColor: bg }),
            strCell([tb.gradeLevel, tb.program].filter(Boolean).join(" • ") || "—", { backgroundColor: bg }),
            numCell(tb.totalBorrowed, { fontWeight: "bold", textColor: "#047857", backgroundColor: bg }),
            numCell(tb.currentlyBorrowed, { textColor: "#1D4ED8", backgroundColor: bg }),
            numCell(tb.returnedOnTime, { backgroundColor: bg }),
            numCell(tb.activeViolations, { textColor: tb.activeViolations > 0 ? "#B91C1C" : "#64748B", backgroundColor: bg }),
            strCell(tb.standingLabel, {
              align: "center",
              fontWeight: "bold",
              backgroundColor: tb.standingTone === "red" ? "#FEE2E2" : tb.standingTone === "amber" ? "#FEF3C7" : "#ECFDF5",
              textColor: tb.standingTone === "red" ? "#991B1B" : tb.standingTone === "amber" ? "#92400E" : "#047857",
            }),
            strCell(formatDateTime(tb.lastBorrowedAt), { backgroundColor: bg }),
          ];
        })
      : [emptyNoticeRow("No student borrowing history recorded yet.", 11)]),
  ];

  // ── Sheet 8: Popular Books ──
  const popularData: Row[] = [
    bannerRow("MOST BORROWED TITLES", 6, "#065F46"),
    subtitleRow(metaLine, 6),
    tableHeaderRow([
      { label: "Rank", align: "center" },
      { label: "Book Title" },
      { label: "Author" },
      { label: "Category" },
      { label: "Total Checkouts", align: "right" },
      { label: "Current Status", align: "center" },
    ]),
    ...(mostBorrowed.length > 0
      ? mostBorrowed.map((b, i) => {
          const bg = i % 2 === 1 ? "#F8FAFC" : undefined;
          return [
            numCell(i + 1, { align: "center", fontWeight: "bold", backgroundColor: bg }),
            strCell(b.title, { fontWeight: "bold", backgroundColor: bg }),
            strCell(b.author, { backgroundColor: bg }),
            strCell(b.classification_name || "Uncategorized", { backgroundColor: bg }),
            numCell(b.borrow_count, { fontWeight: "bold", textColor: "#047857", backgroundColor: bg }),
            strCell(b.current_status, {
              align: "center",
              backgroundColor: b.current_status === "Available" ? "#ECFDF5" : "#FFFBEB",
              textColor: b.current_status === "Available" ? "#047857" : "#B45309",
              fontWeight: "bold",
            }),
          ];
        })
      : [emptyNoticeRow("No checkout data available.", 6)]),
  ];

  // ── Sheet 9: School Year Summary ──
  const syData: Row[] = [
    bannerRow("SCHOOL YEAR CIRCULATION & VIOLATIONS SUMMARY", 8, "#065F46"),
    subtitleRow(metaLine, 8),
    tableHeaderRow([
      { label: "School Year" },
      { label: "Academic Period" },
      { label: "Total Loans", align: "right" },
      { label: "Unique Students", align: "right" },
      { label: "Borrowed (On Time)", align: "right" },
      { label: "Returned", align: "right" },
      { label: "Overdue", align: "right" },
      { label: "Active Violations", align: "right" },
    ]),
    ...(schoolYearSummaries.length > 0
      ? schoolYearSummaries.map((sy, i) => {
          const bg = i % 2 === 1 ? "#F8FAFC" : undefined;
          const period =
            sy.start_date && sy.end_date
              ? formatSchoolYearDateRange(sy.start_date, sy.end_date)
              : "—";
          return [
            strCell(`${sy.school_year_name}${sy.is_active ? " (Active)" : ""}`, {
              fontWeight: "bold",
              textColor: sy.is_active ? "#047857" : "#0F172A",
              backgroundColor: bg,
            }),
            strCell(period, { textColor: "#475569", backgroundColor: bg }),
            numCell(sy.total_transactions, { fontWeight: "bold", backgroundColor: bg }),
            numCell(sy.unique_students ?? 0, { backgroundColor: bg }),
            numCell(sy.currently_borrowed, { textColor: "#047857", backgroundColor: bg }),
            numCell(sy.returned, { textColor: "#1D4ED8", backgroundColor: bg }),
            numCell(sy.overdue, { textColor: sy.overdue > 0 ? "#B91C1C" : "#64748B", backgroundColor: bg }),
            numCell(sy.violations_count ?? 0, {
              textColor: (sy.violations_count ?? 0) > 0 ? "#B45309" : "#64748B",
              backgroundColor: bg,
            }),
          ];
        })
      : [emptyNoticeRow("No school year summaries available.", 8)]),
  ];

  const sheets: Sheet<File | Blob | ArrayBuffer>[] = [
    {
      sheet: "Executive Summary",
      data: summaryData,
      orientation: "landscape",
      columns: [{ width: 38 }, { width: 18 }, { width: 48 }, { width: 20 }, { width: 18 }],
    },
    {
      sheet: "Circulation Activity",
      data: circulationData,
      orientation: "landscape",
      stickyRowsCount: 3,
      columns: [
        { width: 12 },
        { width: 24 },
        { width: 18 },
        { width: 18 },
        { width: 20 },
        { width: 26 },
        { width: 16 },
      ],
    },
    {
      sheet: "Borrowed (On Time)",
      data: borrowedData,
      orientation: "landscape",
      stickyRowsCount: 3,
      columns: [
        { width: 30 },
        { width: 22 },
        { width: 16 },
        { width: 18 },
        { width: 24 },
        { width: 15 },
        { width: 16 },
        { width: 24 },
        { width: 24 },
        { width: 16 },
        { width: 22 },
      ],
    },
    {
      sheet: "Overdue Items",
      data: overdueData,
      orientation: "landscape",
      stickyRowsCount: 3,
      columns: [
        { width: 30 },
        { width: 22 },
        { width: 16 },
        { width: 18 },
        { width: 24 },
        { width: 15 },
        { width: 16 },
        { width: 24 },
        { width: 24 },
        { width: 16 },
        { width: 14 },
        { width: 26 },
      ],
    },
    {
      sheet: "Returned Items",
      data: returnedData,
      orientation: "landscape",
      stickyRowsCount: 3,
      columns: [
        { width: 30 },
        { width: 16 },
        { width: 18 },
        { width: 24 },
        { width: 15 },
        { width: 16 },
        { width: 24 },
        { width: 24 },
        { width: 24 },
        { width: 18 },
        { width: 26 },
      ],
    },
    {
      sheet: "Student Violations",
      data: violationsData,
      orientation: "landscape",
      stickyRowsCount: 3,
      columns: [
        { width: 26 },
        { width: 16 },
        { width: 16 },
        { width: 18 },
        { width: 12 },
        { width: 28 },
        { width: 34 },
        { width: 24 },
      ],
    },
    {
      sheet: "Top Borrowers",
      data: topBorrowersData,
      orientation: "landscape",
      stickyRowsCount: 3,
      columns: [
        { width: 10 },
        { width: 26 },
        { width: 16 },
        { width: 16 },
        { width: 22 },
        { width: 16 },
        { width: 15 },
        { width: 18 },
        { width: 16 },
        { width: 24 },
        { width: 24 },
      ],
    },
    {
      sheet: "Popular Books",
      data: popularData,
      orientation: "landscape",
      stickyRowsCount: 3,
      columns: [
        { width: 10 },
        { width: 34 },
        { width: 24 },
        { width: 20 },
        { width: 18 },
        { width: 16 },
      ],
    },
    {
      sheet: "School Year Summary",
      data: syData,
      orientation: "landscape",
      stickyRowsCount: 3,
      columns: [
        { width: 22 },
        { width: 26 },
        { width: 15 },
        { width: 16 },
        { width: 20 },
        { width: 14 },
        { width: 14 },
        { width: 18 },
      ],
    },
  ];

  const filename = `BCAS_Library_Full_Report_${weekBounds.isoStart}_to_${weekBounds.isoEnd}_${getServerDateString()}.xlsx`;
  const blob = await writeXlsxFile(sheets, {
    fontFamily: "Calibri",
    fontSize: 11,
  }).toBlob();

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);

  return filename;
}
