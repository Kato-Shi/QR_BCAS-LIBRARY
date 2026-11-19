import { createClient } from "@/utils/client";
import { ensureServerNow } from "@/lib/server-clock";
import type {
  DashboardStats,
  OverdueBookRow,
  CirculationByClassification,
  MostBorrowedBookRow,
  ActiveUserRow,
} from "@/lib/types";

const supabase = createClient();

// ── Dashboard Stats ───────────────────────────────────────────

export async function getDashboardStats(): Promise<DashboardStats> {
  const serverNow = await ensureServerNow();
  const [borrowed, returned, overdue] = await Promise.all([
    supabase
      .from("borrowing_transactions")
      .select("*", { count: "exact", head: true })
      .eq("status", "Active"),
    supabase
      .from("borrowing_transactions")
      .select("*", { count: "exact", head: true })
      .eq("status", "Returned"),
    supabase
      .from("borrowing_transactions")
      .select("*", { count: "exact", head: true })
      .in("status", ["Active", "Overdue"])
      .lt("due_date", serverNow.toISOString()),
  ]);

  if (borrowed.error) throw borrowed.error;
  if (returned.error) throw returned.error;
  if (overdue.error) throw overdue.error;

  return {
    total_borrowed: borrowed.count ?? 0,
    total_returned: returned.count ?? 0,
    total_overdue: overdue.count ?? 0,
  };
}

// ── Overdue Books ─────────────────────────────────────────────

export async function getOverdueBooks(): Promise<OverdueBookRow[]> {
  const { data, error } = await supabase
    .from("overdue_books")
    .select("*")
    .order("days_overdue", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

// ── Circulation by Classification ─────────────────────────────

export async function getCirculationByClassification(): Promise<CirculationByClassification[]> {
  const { data, error } = await supabase
    .from("circulation_by_classification")
    .select("*")
    .order("total_transactions", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

// ── Most Borrowed Books ──────────────────────────────────────

export async function getMostBorrowedBooks(limit = 10): Promise<MostBorrowedBookRow[]> {
  const { data, error } = await supabase
    .from("most_borrowed_books")
    .select("*")
    .order("borrow_count", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

// ── Active Users ──────────────────────────────────────────────

export async function getActiveUsers(limit = 10): Promise<ActiveUserRow[]> {
  const { data, error } = await supabase
    .from("active_users")
    .select("*")
    .order("total_visits", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

// ── Circulation Activity (for chart) ──────────────────────────

export interface DailyCirculation {
  day: string;
  borrows: number;
  returns: number;
}

export interface WeeklyCirculationDay extends DailyCirculation {
  shortLabel: string;
  fullDate: string;
  dateKey: string;
  overdueDue: number;
}

export interface WeekBounds {
  start: Date;
  end: Date;
  isoStart: string;
  isoEnd: string;
  rangeLabel: string;
}

const WEEKDAYS_MON_FIRST = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const SHORT_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

export function toLocalDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Computes the Monday–Sunday calendar week containing `referenceDate`.
 */
export function getWeekBounds(referenceDate: Date): WeekBounds {
  const d = new Date(referenceDate);
  d.setHours(0, 0, 0, 0);
  // JS getDay(): Sun=0, Mon=1, ..., Sat=6 -> offset so Monday is 0
  const diffToMonday = (d.getDay() + 6) % 7;
  const start = new Date(d);
  start.setDate(d.getDate() - diffToMonday);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);

  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  const sameYear = start.getFullYear() === end.getFullYear();
  const rangeLabel = sameMonth
    ? `${SHORT_MONTHS[start.getMonth()]} ${start.getDate()} – ${end.getDate()}, ${end.getFullYear()}`
    : sameYear
    ? `${SHORT_MONTHS[start.getMonth()]} ${start.getDate()} – ${SHORT_MONTHS[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`
    : `${SHORT_MONTHS[start.getMonth()]} ${start.getDate()}, ${start.getFullYear()} – ${SHORT_MONTHS[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;

  return {
    start,
    end,
    isoStart: toLocalDateKey(start),
    isoEnd: toLocalDateKey(end),
    rangeLabel,
  };
}

/**
 * Buckets transactions into the exact 7 days (Mon–Sun) of the selected week.
 * Counts borrows by `date_borrowed`, returns by `date_returned` (even if
 * borrowed in an earlier week), and unreturned items whose `due_date` fell on
 * that day and is already overdue.
 */
export function buildWeeklyCirculationFromTransactions(
  transactions: Array<{
    date_borrowed: string;
    date_returned: string | null;
    due_date: string;
    status: string;
  }>,
  weekBounds: WeekBounds,
  referenceNow: Date
): WeeklyCirculationDay[] {
  const days: WeeklyCirculationDay[] = [];
  const byKey = new Map<string, WeeklyCirculationDay>();

  for (let i = 0; i < 7; i++) {
    const dt = new Date(weekBounds.start);
    dt.setDate(weekBounds.start.getDate() + i);
    const dateKey = toLocalDateKey(dt);
    const dayName = WEEKDAYS_MON_FIRST[i];
    const entry: WeeklyCirculationDay = {
      day: dayName,
      shortLabel: `${dayName} ${dt.getDate()}`,
      fullDate: `${dayName}, ${SHORT_MONTHS[dt.getMonth()]} ${dt.getDate()}, ${dt.getFullYear()}`,
      dateKey,
      borrows: 0,
      returns: 0,
      overdueDue: 0,
    };
    days.push(entry);
    byKey.set(dateKey, entry);
  }

  for (const tx of transactions) {
    if (tx.date_borrowed) {
      const bKey = toLocalDateKey(new Date(tx.date_borrowed));
      const slot = byKey.get(bKey);
      if (slot) slot.borrows++;
    }

    if (tx.date_returned) {
      const rKey = toLocalDateKey(new Date(tx.date_returned));
      const slot = byKey.get(rKey);
      if (slot) slot.returns++;
    } else if (tx.due_date) {
      const due = new Date(tx.due_date);
      if (tx.status === "Overdue" || due < referenceNow) {
        const dKey = toLocalDateKey(due);
        const slot = byKey.get(dKey);
        if (slot) slot.overdueDue++;
      }
    }
  }

  return days;
}

export async function getCirculationActivity(days = 7): Promise<DailyCirculation[]> {
  const serverNow = await ensureServerNow();
  const since = new Date(serverNow.getTime() - days * 24 * 60 * 60 * 1000);

  const { data, error } = await supabase
    .from("borrowing_transactions")
    .select("date_borrowed, date_returned, status")
    .or(`date_borrowed.gte.${since.toISOString()},date_returned.gte.${since.toISOString()}`);

  if (error) throw error;

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const grouped: Record<string, { borrows: number; returns: number }> = {};

  dayNames.forEach((d) => (grouped[d] = { borrows: 0, returns: 0 }));

  (data ?? []).forEach((tx) => {
    const borrowDate = new Date(tx.date_borrowed);
    if (borrowDate >= since) {
      const dayName = dayNames[borrowDate.getDay()];
      grouped[dayName].borrows++;
    }

    if (tx.date_returned) {
      const returnDate = new Date(tx.date_returned);
      if (returnDate >= since) {
        const returnDay = dayNames[returnDate.getDay()];
        grouped[returnDay].returns++;
      }
    }
  });

  return dayNames.map((day) => ({
    day,
    borrows: grouped[day].borrows,
    returns: grouped[day].returns,
  }));
}

// ── Award Eligibility ─────────────────────────────────────────

export interface AwardWinner {
  student_id: string;
  student_name: string;
  section: string;
  count: number;
}

export async function getTopVisitors(year?: number): Promise<AwardWinner[]> {
  const y = year ?? (await ensureServerNow()).getFullYear();
  const start = `${y}-01-01`;
  const end = `${y}-12-31`;

  const { data, error } = await supabase
    .from("library_visits")
    .select("student_id, students(name, section)")
    .gte("visited_at", start)
    .lte("visited_at", end);

  if (error) throw error;

  // Count visits per student
  const counts: Record<string, { name: string; section: string; count: number }> = {};
  (data ?? []).forEach((v: { student_id: string; students?: unknown }) => {
    const sid = v.student_id;
    const joined = Array.isArray(v.students) ? v.students[0] : v.students;
    const student = (joined ?? {}) as { name?: unknown; section?: unknown };
    if (!counts[sid]) {
      counts[sid] = {
        name: typeof student.name === "string" ? student.name : "Unknown",
        section: typeof student.section === "string" ? student.section : "",
        count: 0,
      };
    }
    counts[sid].count++;
  });

  return Object.entries(counts)
    .map(([student_id, { name, section, count }]) => ({
      student_id,
      student_name: name,
      section,
      count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

export async function getTopBorrowers(year?: number): Promise<AwardWinner[]> {
  const y = year ?? (await ensureServerNow()).getFullYear();
  const start = `${y}-01-01`;
  const end = `${y}-12-31`;

  const { data, error } = await supabase
    .from("borrowing_transactions")
    .select("student_id, students(name, section)")
    .gte("date_borrowed", start)
    .lte("date_borrowed", end);

  if (error) throw error;

  const counts: Record<string, { name: string; section: string; count: number }> = {};
  (data ?? []).forEach((tx: { student_id: string; students?: unknown }) => {
    const sid = tx.student_id;
    const joined = Array.isArray(tx.students) ? tx.students[0] : tx.students;
    const student = (joined ?? {}) as { name?: unknown; section?: unknown };
    if (!counts[sid]) {
      counts[sid] = {
        name: typeof student.name === "string" ? student.name : "Unknown",
        section: typeof student.section === "string" ? student.section : "",
        count: 0,
      };
    }
    counts[sid].count++;
  });

  return Object.entries(counts)
    .map(([student_id, { name, section, count }]) => ({
      student_id,
      student_name: name,
      section,
      count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}
