import { createClient } from "@/utils/client";
import { logActivity, getCurrentActor } from "@/lib/supabase/activity-logs";
import { archiveRecord } from "@/lib/supabase/archive";
import { ensureServerNow, getServerNow } from "@/lib/server-clock";
import type {
  ActorInfo,
  BorrowingTransaction,
  SchoolYear,
  SchoolYearSummary,
} from "@/lib/types";

const supabase = createClient();

export const SCHOOL_YEAR_CHANGED_EVENT = "bcas:school-year-changed";

function notifySchoolYearChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SCHOOL_YEAR_CHANGED_EVENT));
  }
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const msg = String((error as { message?: unknown }).message ?? "");
    if (msg) return msg;
  }
  return fallback;
}

// ── Date & Classification Helpers (timezone-safe) ─────────────

/** Parse YYYY-MM-DD as local noon so formatting never shifts back by 1 day. */
export function parseSchoolYearDate(dateStr: string): Date {
  const parts = String(dateStr ?? "").slice(0, 10).split("-").map(Number);
  if (parts.length === 3 && !parts.some((n) => Number.isNaN(n))) {
    return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0);
  }
  return new Date(dateStr);
}

/** Local start-of-day timestamp (00:00:00.000) for YYYY-MM-DD. */
function parseSchoolYearStart(dateStr: string): Date {
  const parts = String(dateStr ?? "").slice(0, 10).split("-").map(Number);
  if (parts.length === 3 && !parts.some((n) => Number.isNaN(n))) {
    return new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0);
  }
  return new Date(dateStr);
}

/** Local end-of-day timestamp (23:59:59.999) for YYYY-MM-DD. */
function parseSchoolYearEnd(dateStr: string): Date {
  const parts = String(dateStr ?? "").slice(0, 10).split("-").map(Number);
  if (parts.length === 3 && !parts.some((n) => Number.isNaN(n))) {
    return new Date(parts[0], parts[1] - 1, parts[2], 23, 59, 59, 999);
  }
  return new Date(dateStr);
}

export function formatSchoolYearDate(dateStr: string): string {
  const d = parseSchoolYearDate(dateStr);
  if (Number.isNaN(+d)) return dateStr;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatSchoolYearDateRange(startDate: string, endDate: string): string {
  return `${formatSchoolYearDate(startDate)} – ${formatSchoolYearDate(endDate)}`;
}

export type SchoolYearPhase = "In Progress" | "Upcoming" | "Ended";

export function getSchoolYearPhase(
  year: Pick<SchoolYear, "start_date" | "end_date">,
  referenceNow: Date = getServerNow()
): SchoolYearPhase {
  const start = parseSchoolYearStart(year.start_date);
  const end = parseSchoolYearEnd(year.end_date);
  if (Number.isNaN(+start) || Number.isNaN(+end)) return "In Progress";
  const nowMs = referenceNow.getTime();
  if (nowMs < start.getTime()) return "Upcoming";
  if (nowMs > end.getTime()) return "Ended";
  return "In Progress";
}

export function suggestNextSchoolYear(
  existingYears: SchoolYear[],
  referenceNow: Date = getServerNow()
): { name: string; start_date: string; end_date: string } {
  const existingNames = new Set(existingYears.map((y) => y.name.trim().toLowerCase()));

  let startYear =
    referenceNow.getMonth() >= 5
      ? referenceNow.getFullYear()
      : referenceNow.getFullYear() - 1;

  if (existingYears.length > 0) {
    // Find highest ending year among existing school years
    let maxStartYear = startYear - 1;
    for (const y of existingYears) {
      const startParsed = parseSchoolYearDate(y.start_date);
      if (!Number.isNaN(+startParsed)) {
        maxStartYear = Math.max(maxStartYear, startParsed.getFullYear());
      }
      const match = y.name.match(/(\d{4})\s*[-–/]\s*(\d{4})/);
      if (match) {
        maxStartYear = Math.max(maxStartYear, Number(match[1]));
      }
    }
    startYear = maxStartYear + 1;
  }

  // Ensure suggested name doesn't collide
  while (existingNames.has(`${startYear}-${startYear + 1}`)) {
    startYear += 1;
  }

  return {
    name: `${startYear}-${startYear + 1}`,
    start_date: `${startYear}-06-01`,
    end_date: `${startYear + 1}-05-31`,
  };
}

/**
 * Determine which School Year a transaction belongs to.
 * Uses explicit `school_year_id` when present and valid; otherwise falls back
 * to matching `date_borrowed` within a school year's [start_date, end_date].
 */
export function resolveTransactionSchoolYearId(
  tx: Pick<BorrowingTransaction, "school_year_id" | "date_borrowed">,
  schoolYears: SchoolYear[]
): string | null {
  if (schoolYears.length === 0) return tx.school_year_id ?? null;

  if (tx.school_year_id && schoolYears.some((y) => y.id === tx.school_year_id)) {
    return tx.school_year_id;
  }

  const borrowedMs = new Date(tx.date_borrowed).getTime();
  if (!Number.isNaN(borrowedMs)) {
    for (const y of schoolYears) {
      const s = parseSchoolYearStart(y.start_date).getTime();
      const e = parseSchoolYearEnd(y.end_date).getTime();
      if (borrowedMs >= s && borrowedMs <= e) {
        return y.id;
      }
    }
  }

  return null;
}

/**
 * Compute accurate real-time School Year summaries from transactions + school years
 * using the authoritative server clock (works even when DB views are outdated or
 * legacy records have school_year_id = NULL).
 */
export function buildSchoolYearSummaries(
  transactions: Pick<
    BorrowingTransaction,
    "id" | "student_id" | "school_year_id" | "date_borrowed" | "due_date" | "date_returned" | "status" | "fine_paid" | "fine_amount"
  >[],
  schoolYears: SchoolYear[],
  referenceNow: Date = getServerNow()
): SchoolYearSummary[] {
  const nowMs = referenceNow.getTime();
  const buckets = new Map<
    string,
    {
      total: number;
      borrowedOnTime: number;
      returned: number;
      overdue: number;
      violations: number;
      students: Set<string>;
      totalFines: number;
      finesCollected: number;
    }
  >();

  for (const sy of schoolYears) {
    buckets.set(sy.id, {
      total: 0,
      borrowedOnTime: 0,
      returned: 0,
      overdue: 0,
      violations: 0,
      students: new Set<string>(),
      totalFines: 0,
      finesCollected: 0,
    });
  }

  for (const tx of transactions) {
    const syId = resolveTransactionSchoolYearId(tx, schoolYears);
    if (!syId) continue;
    const bucket = buckets.get(syId);
    if (!bucket) continue;

    bucket.total += 1;
    if (tx.student_id) bucket.students.add(tx.student_id);

    const dueMs = new Date(tx.due_date).getTime();
    const isReturned = tx.status === "Returned" || Boolean(tx.date_returned);

    if (isReturned) {
      bucket.returned += 1;
      const retMs = tx.date_returned ? new Date(tx.date_returned).getTime() : NaN;
      if (!Number.isNaN(retMs) && !Number.isNaN(dueMs) && retMs > dueMs && !tx.fine_paid) {
        bucket.violations += 1;
      }
    } else {
      const isOverdue = tx.status === "Overdue" || (!Number.isNaN(dueMs) && dueMs < nowMs);
      if (isOverdue) {
        bucket.overdue += 1;
        if (!tx.fine_paid) bucket.violations += 1;
      } else {
        bucket.borrowedOnTime += 1;
      }
    }

    const fineAmt = Number(tx.fine_amount ?? 0);
    bucket.totalFines += fineAmt;
    if (tx.fine_paid) bucket.finesCollected += fineAmt;
  }

  return schoolYears.map((sy) => {
    const b = buckets.get(sy.id)!;
    return {
      school_year_id: sy.id,
      school_year_name: sy.name,
      start_date: sy.start_date,
      end_date: sy.end_date,
      is_active: sy.is_active,
      total_transactions: b.total,
      currently_borrowed: b.borrowedOnTime,
      returned: b.returned,
      overdue: b.overdue,
      violations_count: b.violations,
      unique_students: b.students.size,
      total_fines: b.totalFines,
      fines_collected: b.finesCollected,
    };
  });
}

// ── CRUD Operations ───────────────────────────────────────────

function validateSchoolYearInput(input: {
  name?: string;
  start_date?: string;
  end_date?: string;
}) {
  const name = input.name?.trim();
  if (input.name !== undefined && !name) {
    throw new Error("School year name is required (e.g., 2026-2027).");
  }
  if (input.start_date && input.end_date) {
    const start = parseSchoolYearStart(input.start_date);
    const end = parseSchoolYearEnd(input.end_date);
    if (Number.isNaN(+start) || Number.isNaN(+end)) {
      throw new Error("Please select valid start and end dates.");
    }
    if (end.getTime() <= start.getTime()) {
      throw new Error("End date must be after the start date.");
    }
  }
}

export async function getSchoolYears(): Promise<SchoolYear[]> {
  const { data, error } = await supabase
    .from("school_years")
    .select("*")
    .order("start_date", { ascending: false });

  if (error) throw error;
  return (data ?? []) as SchoolYear[];
}

export async function getActiveSchoolYear(): Promise<SchoolYear | null> {
  const { data, error } = await supabase
    .from("school_years")
    .select("*")
    .eq("is_active", true)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as SchoolYear | null) ?? null;
}

export async function createSchoolYear(
  year: Omit<SchoolYear, "id" | "created_at">,
  actor?: ActorInfo | null
): Promise<SchoolYear> {
  const name = year.name.trim();
  validateSchoolYearInput({
    name,
    start_date: year.start_date,
    end_date: year.end_date,
  });

  // Friendly duplicate check before insert
  const { data: dup } = await supabase
    .from("school_years")
    .select("id")
    .ilike("name", name)
    .limit(1)
    .maybeSingle();

  if (dup) {
    throw new Error(`School year "${name}" already exists.`);
  }

  // If creating as active, deactivate any currently active rows first (with WHERE clause)
  if (year.is_active) {
    const { error: clearErr } = await supabase
      .from("school_years")
      .update({ is_active: false })
      .eq("is_active", true);
    if (clearErr) throw new Error(getErrorMessage(clearErr, "Failed to switch active school year."));
  }

  const { data, error } = await supabase
    .from("school_years")
    .insert({
      name,
      start_date: year.start_date,
      end_date: year.end_date,
      is_active: Boolean(year.is_active),
    })
    .select()
    .single();

  if (error) {
    if (String((error as { code?: string }).code) === "23505") {
      throw new Error(`School year "${name}" already exists.`);
    }
    throw new Error(getErrorMessage(error, "Failed to create school year."));
  }

  const created = data as SchoolYear;
  const resolved = actor ?? (await getCurrentActor().catch(() => null));
  await logActivity({
    action: "ADD",
    entity_type: "school_year",
    entity_id: created.id,
    description: `Added school year "${created.name}" (${formatSchoolYearDateRange(created.start_date, created.end_date)})${created.is_active ? " and set as active" : ""}.`,
    metadata: {
      name: created.name,
      start_date: created.start_date,
      end_date: created.end_date,
      is_active: created.is_active,
    },
    actor: resolved,
  });

  notifySchoolYearChanged();
  return created;
}

export async function updateSchoolYear(
  id: string,
  updates: Partial<Omit<SchoolYear, "id" | "created_at">>,
  actor?: ActorInfo | null
): Promise<SchoolYear> {
  const { data: existing, error: existingErr } = await supabase
    .from("school_years")
    .select("*")
    .eq("id", id)
    .single();

  if (existingErr || !existing) {
    throw new Error("School year not found.");
  }

  const current = existing as SchoolYear;
  const nextName = updates.name !== undefined ? updates.name.trim() : current.name;
  const nextStart = updates.start_date ?? current.start_date;
  const nextEnd = updates.end_date ?? current.end_date;

  validateSchoolYearInput({
    name: nextName,
    start_date: nextStart,
    end_date: nextEnd,
  });

  if (nextName.toLowerCase() !== current.name.toLowerCase()) {
    const { data: dup } = await supabase
      .from("school_years")
      .select("id")
      .ilike("name", nextName)
      .neq("id", id)
      .limit(1)
      .maybeSingle();
    if (dup) {
      throw new Error(`School year "${nextName}" already exists.`);
    }
  }

  const payload: Record<string, unknown> = {
    name: nextName,
    start_date: nextStart,
    end_date: nextEnd,
  };
  if (updates.is_active !== undefined) {
    payload.is_active = updates.is_active;
  }

  const { data, error } = await supabase
    .from("school_years")
    .update(payload)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw new Error(getErrorMessage(error, "Failed to update school year."));
  }

  const updated = data as SchoolYear;
  const resolved = actor ?? (await getCurrentActor().catch(() => null));
  await logActivity({
    action: "EDIT",
    entity_type: "school_year",
    entity_id: id,
    description: `Updated school year "${updated.name}" (${formatSchoolYearDateRange(updated.start_date, updated.end_date)}).`,
    metadata: {
      previous_name: current.name,
      name: updated.name,
      start_date: updated.start_date,
      end_date: updated.end_date,
    },
    actor: resolved,
  });

  notifySchoolYearChanged();
  return updated;
}

/**
 * Set a school year as active reliably without depending on the unsafe
 * `UPDATE school_years SET is_active = false;` RPC (which can fail under
 * Supabase safe-update policies or unmigrated databases).
 */
export async function setActiveSchoolYear(
  id: string,
  actor?: ActorInfo | null
): Promise<SchoolYear> {
  // Verify target exists first
  const { data: target, error: fetchErr } = await supabase
    .from("school_years")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchErr || !target) {
    throw new Error("Selected school year was not found.");
  }

  // 1. Deactivate any other currently active school year(s) using an explicit WHERE clause
  const { error: deactivateErr } = await supabase
    .from("school_years")
    .update({ is_active: false })
    .eq("is_active", true)
    .neq("id", id);

  if (deactivateErr) {
    throw new Error(getErrorMessage(deactivateErr, "Failed to deactivate previous school year."));
  }

  // 2. Activate the target school year
  const { data: activated, error: activateErr } = await supabase
    .from("school_years")
    .update({ is_active: true })
    .eq("id", id)
    .select()
    .single();

  if (activateErr || !activated) {
    throw new Error(getErrorMessage(activateErr, "Failed to activate school year."));
  }

  const sy = activated as SchoolYear;
  const resolved = actor ?? (await getCurrentActor().catch(() => null));
  await logActivity({
    action: "EDIT",
    entity_type: "school_year",
    entity_id: sy.id,
    description: `Set active school year to "${sy.name}" (${formatSchoolYearDateRange(sy.start_date, sy.end_date)}).`,
    metadata: {
      school_year_name: sy.name,
      start_date: sy.start_date,
      end_date: sy.end_date,
    },
    actor: resolved,
  });

  notifySchoolYearChanged();
  return sy;
}

/**
 * Safely delete an inactive school year.
 * Unlinks any referencing borrowing_transactions (setting school_year_id = null)
 * so transaction history is preserved and PostgreSQL FK constraints never block deletion.
 */
export async function deleteSchoolYear(
  id: string,
  actor?: ActorInfo | null
): Promise<{ unlinkedTransactions: number }> {
  const { data: existing, error: fetchErr } = await supabase
    .from("school_years")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchErr || !existing) {
    throw new Error("School year not found.");
  }

  const sy = existing as SchoolYear;
  if (sy.is_active) {
    throw new Error(
      "Cannot delete the active school year. Set another school year as active first."
    );
  }

  // Count and unlink any linked transactions so history is preserved and FK never fails
  const { count: linkedCount } = await supabase
    .from("borrowing_transactions")
    .select("id", { count: "exact", head: true })
    .eq("school_year_id", id);

  const unlinkedTransactions = linkedCount ?? 0;

  if (unlinkedTransactions > 0) {
    const { error: unlinkErr } = await supabase
      .from("borrowing_transactions")
      .update({ school_year_id: null })
      .eq("school_year_id", id);

    if (unlinkErr) {
      throw new Error(
        getErrorMessage(unlinkErr, "Failed to unlink existing transactions from this school year.")
      );
    }
  }

  const resolved = actor ?? (await getCurrentActor().catch(() => null));
  await archiveRecord({
    entity_type: "school_year",
    entity_id: id,
    data: {
      ...sy,
      unlinked_transactions: unlinkedTransactions,
    },
    actor: resolved,
  });

  const { error: deleteErr } = await supabase
    .from("school_years")
    .delete()
    .eq("id", id);

  if (deleteErr) {
    throw new Error(getErrorMessage(deleteErr, "Failed to delete school year."));
  }

  await logActivity({
    action: "DELETE",
    entity_type: "school_year",
    entity_id: id,
    description: `Deleted school year "${sy.name}"${unlinkedTransactions > 0 ? ` (${unlinkedTransactions} transaction record(s) preserved and unlinked)` : ""}.`,
    metadata: {
      name: sy.name,
      start_date: sy.start_date,
      end_date: sy.end_date,
      unlinked_transactions: unlinkedTransactions,
    },
    actor: resolved,
  });

  notifySchoolYearChanged();
  return { unlinkedTransactions };
}

/**
 * Count how many borrowing_transactions currently have school_year_id = NULL.
 */
export async function countUnassignedTransactions(): Promise<number> {
  const { count, error } = await supabase
    .from("borrowing_transactions")
    .select("id", { count: "exact", head: true })
    .is("school_year_id", null);

  if (error) return 0;
  return count ?? 0;
}

/**
 * Assign all legacy/unassigned transactions (`school_year_id IS NULL`) to the
 * school year matching their `date_borrowed` range (or active school year fallback).
 */
export async function assignUnassignedTransactionsToSchoolYears(
  actor?: ActorInfo | null
): Promise<{ assignedCount: number; skippedCount: number }> {
  const [years, txRes] = await Promise.all([
    getSchoolYears(),
    supabase
      .from("borrowing_transactions")
      .select("id, date_borrowed, school_year_id")
      .is("school_year_id", null),
  ]);

  if (txRes.error) {
    throw new Error(getErrorMessage(txRes.error, "Failed to load unassigned transactions."));
  }

  const unassigned = txRes.data ?? [];
  if (unassigned.length === 0 || years.length === 0) {
    return { assignedCount: 0, skippedCount: unassigned.length };
  }

  const activeYear = years.find((y) => y.is_active) ?? years[0] ?? null;
  const groups = new Map<string, string[]>();
  let skippedCount = 0;

  for (const tx of unassigned) {
    const matchedId =
      resolveTransactionSchoolYearId(
        { school_year_id: null, date_borrowed: tx.date_borrowed },
        years
      ) ?? activeYear?.id ?? null;

    if (!matchedId) {
      skippedCount += 1;
      continue;
    }

    const list = groups.get(matchedId) ?? [];
    list.push(tx.id);
    groups.set(matchedId, list);
  }

  let assignedCount = 0;
  for (const [syId, txIds] of groups.entries()) {
    // Update in chunks of 100 to avoid query string length limits
    for (let i = 0; i < txIds.length; i += 100) {
      const chunk = txIds.slice(i, i + 100);
      const { error } = await supabase
        .from("borrowing_transactions")
        .update({ school_year_id: syId })
        .in("id", chunk);
      if (error) {
        throw new Error(getErrorMessage(error, "Failed to sync unassigned transactions."));
      }
      assignedCount += chunk.length;
    }
  }

  if (assignedCount > 0) {
    const resolved = actor ?? (await getCurrentActor().catch(() => null));
    await logActivity({
      action: "EDIT",
      entity_type: "school_year",
      entity_id: activeYear?.id ?? null,
      description: `Synced ${assignedCount} unassigned transaction(s) to matching school years.`,
      metadata: {
        assigned_count: assignedCount,
        skipped_count: skippedCount,
      },
      actor: resolved,
    });
  }

  return { assignedCount, skippedCount };
}

/**
 * Fetch accurate School Year circulation summaries computed from live
 * school_years + borrowing_transactions data (anchored to server clock).
 */
export async function getSchoolYearSummaries(): Promise<SchoolYearSummary[]> {
  const [years, txRes, serverNow] = await Promise.all([
    getSchoolYears(),
    supabase
      .from("borrowing_transactions")
      .select("id, student_id, school_year_id, date_borrowed, due_date, date_returned, status, fine_paid, fine_amount"),
    ensureServerNow(),
  ]);

  if (txRes.error) {
    // Fallback to DB view if direct query fails for any reason
    const { data, error } = await supabase
      .from("school_year_summary")
      .select("*")
      .order("school_year_name", { ascending: false });
    if (error) throw error;
    return (data ?? []) as SchoolYearSummary[];
  }

  return buildSchoolYearSummaries(
    (txRes.data ?? []) as Pick<
      BorrowingTransaction,
      "id" | "student_id" | "school_year_id" | "date_borrowed" | "due_date" | "date_returned" | "status" | "fine_paid" | "fine_amount"
    >[],
    years,
    serverNow
  );
}
