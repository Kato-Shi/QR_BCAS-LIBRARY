import { createClient } from "@/utils/client";
import { logActivity, getCurrentActor } from "@/lib/supabase/activity-logs";
import { ensureServerNow, getServerNow } from "@/lib/server-clock";
import type {
  ActorInfo,
  BorrowingTransactionWithDetails,
  StudentViolationIncident,
  StudentViolationStatus,
  TopBorrowerStudentRow,
  ViolationPolicy,
  ViolationRule,
} from "@/lib/types";

const supabase = createClient();

const POLICY_LOCAL_KEY = "bcas_violation_policy_v1";
const POLICY_LOG_ENTITY_ID = "violation_policy_config";

export const DEFAULT_VIOLATION_RULES: ViolationRule[] = [
  {
    level: 1,
    label: "Warning",
    action: "warning",
    banDays: 0,
    description: "Student receives an official warning; borrowing remains allowed.",
  },
  {
    level: 2,
    label: "Short Borrowing Ban",
    action: "ban",
    banDays: 3,
    description: "Student is forbidden from borrowing for 3 days.",
  },
  {
    level: 3,
    label: "1-Week Borrowing Ban",
    action: "ban",
    banDays: 7,
    description: "Student is forbidden from borrowing for 1 week (7 days).",
  },
  {
    level: 4,
    label: "1-Month Borrowing Ban",
    action: "ban",
    banDays: 30,
    description: "Student is forbidden from borrowing for 1 month (30 days).",
  },
];

export function getDefaultViolationPolicy(): ViolationPolicy {
  return {
    rules: DEFAULT_VIOLATION_RULES.map((r) => ({ ...r })),
  };
}

export function formatOrdinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

export function formatBanDuration(days: number): string {
  if (days <= 0) return "Warning only";
  if (days === 1) return "1 day";
  if (days === 7) return "1 week (7 days)";
  if (days === 14) return "2 weeks (14 days)";
  if (days === 30) return "1 month (30 days)";
  return `${days} days`;
}

export function formatViolationPolicySummary(policy: ViolationPolicy): string {
  const rules = normalizeRules(policy.rules);
  return rules
    .map((r, idx) => {
      const prefix =
        idx === rules.length - 1 && rules.length > 1
          ? `${formatOrdinal(r.level)}+`
          : formatOrdinal(r.level);
      const effect = r.action === "warning" || r.banDays <= 0 ? "Warning" : `${r.banDays}d ban`;
      return `${prefix}: ${effect}`;
    })
    .join(" • ");
}

export function normalizeRules(rawRules: unknown): ViolationRule[] {
  if (!Array.isArray(rawRules) || rawRules.length === 0) {
    return DEFAULT_VIOLATION_RULES.map((r) => ({ ...r }));
  }

  const cleaned: ViolationRule[] = [];
  for (let i = 0; i < rawRules.length; i++) {
    const item = rawRules[i] as Partial<ViolationRule> | null;
    if (!item || typeof item !== "object") continue;
    const action = item.action === "ban" ? "ban" : "warning";
    const parsedDays = Math.max(0, Math.round(Number(item.banDays ?? 0)));
    const banDays = action === "ban" ? Math.max(1, parsedDays || 3) : 0;
    const level = i + 1;
    const defaultLabel =
      action === "warning"
        ? "Warning"
        : `${formatBanDuration(banDays)} Ban`;
    const defaultDesc =
      action === "warning"
        ? "Student receives a warning; borrowing remains allowed."
        : `Student is forbidden from borrowing for ${formatBanDuration(banDays)}.`;

    cleaned.push({
      level,
      label: typeof item.label === "string" && item.label.trim() ? item.label.trim() : defaultLabel,
      action,
      banDays,
      description:
        typeof item.description === "string" && item.description.trim()
          ? item.description.trim()
          : defaultDesc,
    });
  }

  return cleaned.length > 0 ? cleaned : DEFAULT_VIOLATION_RULES.map((r) => ({ ...r }));
}

export function getRuleForOffense(
  offenseCount: number,
  policy: ViolationPolicy
): ViolationRule | null {
  if (offenseCount <= 0) return null;
  const rules = normalizeRules(policy.rules);
  const idx = Math.min(offenseCount - 1, rules.length - 1);
  return rules[idx] ?? null;
}

// ── Policy Persistence (Supabase + Fallback) ──────────────────

function readLocalPolicy(): ViolationPolicy | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(POLICY_LOCAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ViolationPolicy>;
    return {
      id: parsed.id,
      rules: normalizeRules(parsed.rules),
      updatedAt: parsed.updatedAt,
      updatedBy: parsed.updatedBy ?? null,
    };
  } catch {
    return null;
  }
}

function writeLocalPolicy(policy: ViolationPolicy): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(POLICY_LOCAL_KEY, JSON.stringify(policy));
  } catch {
    // ignore storage errors
  }
}

export async function getViolationPolicy(): Promise<ViolationPolicy> {
  // 1. Primary: dedicated violation_settings table (migration 006)
  try {
    const { data, error } = await supabase
      .from("violation_settings")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && data && Array.isArray(data.rules)) {
      const policy: ViolationPolicy = {
        id: data.id,
        rules: normalizeRules(data.rules),
        updatedAt: data.updated_at ?? data.created_at,
        updatedBy: data.updated_by ?? null,
      };
      writeLocalPolicy(policy);
      return policy;
    }
  } catch {
    // Table may not be migrated yet — try activity_logs fallback below
  }

  // 2. Fallback: shared policy snapshot persisted in activity_logs metadata
  try {
    const { data, error } = await supabase
      .from("activity_logs")
      .select("id, metadata, staff_name, created_at")
      .eq("entity_id", POLICY_LOG_ENTITY_ID)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && data?.metadata && typeof data.metadata === "object") {
      const meta = data.metadata as { rules?: unknown };
      if (Array.isArray(meta.rules) && meta.rules.length > 0) {
        const policy: ViolationPolicy = {
          id: data.id,
          rules: normalizeRules(meta.rules),
          updatedAt: data.created_at,
          updatedBy: data.staff_name ?? null,
        };
        writeLocalPolicy(policy);
        return policy;
      }
    }
  } catch {
    // Fall through to local cache / default
  }

  // 3. Local cache or defaults
  return readLocalPolicy() ?? getDefaultViolationPolicy();
}

export async function saveViolationPolicy(
  rulesInput: ViolationRule[],
  actor?: ActorInfo | null
): Promise<ViolationPolicy> {
  const [resolved, serverNow] = await Promise.all([
    actor ? Promise.resolve(actor) : getCurrentActor().catch(() => null),
    ensureServerNow(true),
  ]);

  const rules = normalizeRules(rulesInput);
  const updatedBy = resolved ? `${resolved.name} (${resolved.role})` : "Library Staff";
  let savedId: string | undefined;

  // 1. Try dedicated violation_settings table first
  try {
    const { data: existing } = await supabase
      .from("violation_settings")
      .select("id")
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      const { data, error } = await supabase
        .from("violation_settings")
        .update({
          rules,
          updated_by: updatedBy,
          updated_at: serverNow.toISOString(),
        })
        .eq("id", existing.id)
        .select("id")
        .single();
      if (!error && data) savedId = data.id;
    } else {
      const { data, error } = await supabase
        .from("violation_settings")
        .insert({
          rules,
          updated_by: updatedBy,
          updated_at: serverNow.toISOString(),
        })
        .select("id")
        .single();
      if (!error && data) savedId = data.id;
    }
  } catch {
    // Migration 006 not applied yet — persisted via activity_logs below
  }

  // 2. Always write an audit log entry (which also serves as cross-device Supabase storage before migration 006)
  const summary = formatViolationPolicySummary({ rules });
  await logActivity({
    action: "EDIT",
    entity_type: "fine",
    entity_id: POLICY_LOG_ENTITY_ID,
    description: `Updated student violation policy (${summary}).`,
    metadata: { rules },
    actor: resolved,
  });

  const saved: ViolationPolicy = {
    id: savedId,
    rules,
    updatedAt: serverNow.toISOString(),
    updatedBy,
  };
  writeLocalPolicy(saved);
  return saved;
}

// ── Violation Evaluation Engine ───────────────────────────────

function formatOverdueSpan(dueDate: Date, endDate: Date): { days: number; label: string } {
  const diffMs = Math.max(0, endDate.getTime() - dueDate.getTime());
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days >= 1) {
    return { days, label: `${days} day${days === 1 ? "" : "s"}` };
  }
  const hours = Math.max(1, Math.floor(diffMs / (1000 * 60 * 60)));
  return { days: 0, label: `${hours} hr${hours === 1 ? "" : "s"}` };
}

function formatBanRemaining(banEndsAt: Date, now: Date): string {
  const diffMs = banEndsAt.getTime() - now.getTime();
  if (diffMs <= 0) return "Ended";
  const totalHours = Math.ceil(diffMs / (1000 * 60 * 60));
  if (totalHours < 24) {
    return `${totalHours} hr${totalHours === 1 ? "" : "s"} remaining`;
  }
  const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  return `${days} day${days === 1 ? "" : "s"} remaining`;
}

/** True when a transaction represents a late return or currently overdue loan. */
export function isTransactionViolation(
  tx: Pick<BorrowingTransactionWithDetails, "due_date" | "date_returned" | "status">,
  referenceNow: Date = getServerNow()
): boolean {
  const due = new Date(tx.due_date);
  if (Number.isNaN(due.getTime())) return false;

  if (tx.date_returned) {
    const returned = new Date(tx.date_returned);
    return !Number.isNaN(returned.getTime()) && returned.getTime() > due.getTime();
  }

  return tx.status === "Overdue" || due.getTime() < referenceNow.getTime();
}

export interface ViolationEvaluationBundle {
  byStudentId: Map<string, StudentViolationStatus>;
  byTransactionId: Map<string, StudentViolationIncident>;
  studentsWithViolations: StudentViolationStatus[];
  allIncidents: StudentViolationIncident[];
  totalActiveViolations: number;
  bannedStudentCount: number;
  warnedStudentCount: number;
}

export function evaluateAllStudentViolations(
  transactions: BorrowingTransactionWithDetails[],
  policy: ViolationPolicy,
  referenceNow: Date = getServerNow()
): ViolationEvaluationBundle {
  // Group chronologically (oldest due_date first) so offense #1, #2, #3... are deterministic
  const sorted = [...transactions].sort(
    (a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime()
  );

  const byStudentId = new Map<string, StudentViolationStatus>();
  const byTransactionId = new Map<string, StudentViolationIncident>();
  const allIncidents: StudentViolationIncident[] = [];

  for (const tx of sorted) {
    if (!isTransactionViolation(tx, referenceNow)) continue;

    const student = tx.students;
    const book = tx.books;
    const due = new Date(tx.due_date);
    const end = tx.date_returned ? new Date(tx.date_returned) : referenceNow;
    const span = formatOverdueSpan(due, end);
    // `fine_paid === true` is repurposed cleanly as "Violation Cleared / Excused"
    const cleared = Boolean(tx.fine_paid);

    let studentStatus = byStudentId.get(tx.student_id);
    if (!studentStatus) {
      studentStatus = {
        studentId: tx.student_id,
        studentName: student?.name ?? "Unknown Student",
        studentNumber: student?.student_number ?? "—",
        studentSection: student?.section ?? "—",
        gradeLevel: student?.grade_level ?? "",
        program: student?.program ?? "",
        activeViolationCount: 0,
        clearedViolationCount: 0,
        currentRule: null,
        isBanned: false,
        blockedByUnreturnedOverdue: false,
        banStartsAt: null,
        banEndsAt: null,
        banRemainingLabel: null,
        standingLabel: "Good Standing",
        standingTone: "emerald",
        incidents: [],
        latestViolationAt: null,
      };
      byStudentId.set(tx.student_id, studentStatus);
    }

    let offenseNumber = 0;
    let ruleApplied: ViolationRule | null = null;
    if (cleared) {
      studentStatus.clearedViolationCount += 1;
    } else {
      studentStatus.activeViolationCount += 1;
      offenseNumber = studentStatus.activeViolationCount;
      ruleApplied = getRuleForOffense(offenseNumber, policy);
    }

    const incident: StudentViolationIncident = {
      transactionId: tx.id,
      studentId: tx.student_id,
      studentName: studentStatus.studentName,
      studentNumber: studentStatus.studentNumber,
      studentSection: studentStatus.studentSection,
      bookTitle: book?.title ?? "Unknown Book",
      bookAuthor: book?.author ?? "—",
      accessionNumber: book?.accession_number ?? "—",
      category: book?.classifications?.name ?? "Uncategorized",
      dateBorrowed: tx.date_borrowed,
      dueDate: tx.due_date,
      dateReturned: tx.date_returned,
      status: tx.status,
      daysOverdue: span.days,
      overdueLabel: span.label,
      offenseNumber,
      ruleApplied,
      cleared,
    };

    studentStatus.incidents.push(incident);
    byTransactionId.set(tx.id, incident);
    allIncidents.push(incident);
  }

  // Finalize current standing & active ban windows for each student
  let totalActiveViolations = 0;
  let bannedStudentCount = 0;
  let warnedStudentCount = 0;

  for (const st of byStudentId.values()) {
    const activeIncidents = st.incidents.filter((i) => !i.cleared);
    totalActiveViolations += activeIncidents.length;

    if (activeIncidents.length === 0) {
      st.standingLabel = "Cleared / Good Standing";
      st.standingTone = "emerald";
      continue;
    }

    const latestActive = activeIncidents[activeIncidents.length - 1];
    const currentRule = getRuleForOffense(activeIncidents.length, policy);
    st.currentRule = currentRule;
    st.latestViolationAt = latestActive.dateReturned ?? latestActive.dueDate;

    // Check every active incident to find the furthest active ban expiration
    let furthestBanEnd: Date | null = null;
    let furthestBanStart: Date | null = null;
    let unreturnedBanTrigger = false;

    for (const inc of activeIncidents) {
      const rule = inc.ruleApplied;
      if (!rule || rule.action !== "ban" || rule.banDays <= 0) continue;

      if (!inc.dateReturned) {
        // Still overdue & unreturned — borrowing is restricted until returned + ban served
        unreturnedBanTrigger = true;
      } else {
        const start = new Date(inc.dateReturned);
        const end = new Date(start.getTime() + rule.banDays * 24 * 60 * 60 * 1000);
        if (end.getTime() > referenceNow.getTime()) {
          if (!furthestBanEnd || end.getTime() > furthestBanEnd.getTime()) {
            furthestBanEnd = end;
            furthestBanStart = start;
          }
        }
      }
    }

    if (unreturnedBanTrigger || furthestBanEnd) {
      st.isBanned = true;
      st.blockedByUnreturnedOverdue = unreturnedBanTrigger;
      st.banStartsAt = furthestBanStart ? furthestBanStart.toISOString() : null;
      st.banEndsAt = furthestBanEnd ? furthestBanEnd.toISOString() : null;
      st.banRemainingLabel = unreturnedBanTrigger
        ? "Return overdue book first"
        : furthestBanEnd
        ? formatBanRemaining(furthestBanEnd, referenceNow)
        : null;
      st.standingLabel = `${formatOrdinal(activeIncidents.length)} Violation — ${currentRule?.label ?? "Borrowing Ban"}`;
      st.standingTone = "red";
      bannedStudentCount += 1;
    } else if (currentRule?.action === "warning") {
      st.standingLabel = `${formatOrdinal(activeIncidents.length)} Violation — ${currentRule.label}`;
      st.standingTone = "amber";
      warnedStudentCount += 1;
    } else {
      // Previous ban already expired, student can borrow again but record remains at N violations
      st.standingLabel = `${formatOrdinal(activeIncidents.length)} Violation (Ban Served)`;
      st.standingTone = "amber";
      warnedStudentCount += 1;
    }

    // Reverse incidents for display (newest first)
    st.incidents.reverse();
  }

  const studentsWithViolations = Array.from(byStudentId.values()).sort((a, b) => {
    if (a.isBanned !== b.isBanned) return a.isBanned ? -1 : 1;
    if (b.activeViolationCount !== a.activeViolationCount) {
      return b.activeViolationCount - a.activeViolationCount;
    }
    return b.clearedViolationCount - a.clearedViolationCount;
  });

  allIncidents.sort(
    (a, b) =>
      new Date(b.dateReturned ?? b.dueDate).getTime() -
      new Date(a.dateReturned ?? a.dueDate).getTime()
  );

  return {
    byStudentId,
    byTransactionId,
    studentsWithViolations,
    allIncidents,
    totalActiveViolations,
    bannedStudentCount,
    warnedStudentCount,
  };
}

/** Fetch a single student's authoritative violation standing (used during Borrow/Return). */
export async function getStudentViolationStatus(
  studentId: string,
  referenceNow?: Date
): Promise<StudentViolationStatus> {
  const [now, policy, txRes] = await Promise.all([
    referenceNow ? Promise.resolve(referenceNow) : ensureServerNow(),
    getViolationPolicy(),
    supabase
      .from("borrowing_transactions")
      .select(`
        *,
        students(id, name, section, student_number, first_name, last_name, middle_name, grade_level, program),
        books(*, classifications(id, name))
      `)
      .eq("student_id", studentId)
      .order("due_date", { ascending: true }),
  ]);

  if (txRes.error) throw txRes.error;
  const txs = (txRes.data ?? []) as BorrowingTransactionWithDetails[];
  const bundle = evaluateAllStudentViolations(txs, policy, now);
  const existing = bundle.byStudentId.get(studentId);
  if (existing) return existing;

  const firstStudent = txs[0]?.students;
  return {
    studentId,
    studentName: firstStudent?.name ?? "Student",
    studentNumber: firstStudent?.student_number ?? "—",
    studentSection: firstStudent?.section ?? "—",
    gradeLevel: firstStudent?.grade_level ?? "",
    program: firstStudent?.program ?? "",
    activeViolationCount: 0,
    clearedViolationCount: 0,
    currentRule: null,
    isBanned: false,
    blockedByUnreturnedOverdue: false,
    banStartsAt: null,
    banEndsAt: null,
    banRemainingLabel: null,
    standingLabel: "Good Standing",
    standingTone: "emerald",
    incidents: [],
    latestViolationAt: null,
  };
}

/** Clear/excuse a transaction's violation (or restore it). */
export async function setTransactionViolationCleared(
  transactionId: string,
  cleared: boolean,
  actor?: ActorInfo | null
): Promise<void> {
  const resolved = actor ?? (await getCurrentActor().catch(() => null));

  const { data: tx, error: fetchError } = await supabase
    .from("borrowing_transactions")
    .select("id, students(name), books(title)")
    .eq("id", transactionId)
    .single();

  if (fetchError || !tx) throw fetchError ?? new Error("Transaction not found.");

  const { error } = await supabase
    .from("borrowing_transactions")
    .update({ fine_paid: cleared, fine_amount: 0 })
    .eq("id", transactionId);

  if (error) throw error;

  const details = tx as unknown as {
    students?: { name?: string } | null;
    books?: { title?: string } | null;
  };

  await logActivity({
    action: "EDIT",
    entity_type: "transaction",
    entity_id: transactionId,
    description: cleared
      ? `Cleared/excused overdue violation for "${details.books?.title ?? transactionId}" (${details.students?.name ?? "student"}).`
      : `Restored overdue violation for "${details.books?.title ?? transactionId}" (${details.students?.name ?? "student"}).`,
    metadata: { violation_cleared: cleared },
    actor: resolved,
  });
}

// ── Top Borrowing Students Leaderboard ────────────────────────

export function buildTopBorrowingStudents(
  transactions: BorrowingTransactionWithDetails[],
  violationsByStudentId: Map<string, StudentViolationStatus>,
  referenceNow: Date = getServerNow()
): TopBorrowerStudentRow[] {
  const map = new Map<
    string,
    {
      studentId: string;
      studentName: string;
      studentNumber: string;
      studentSection: string;
      gradeLevel: string;
      program: string;
      totalBorrowed: number;
      currentlyBorrowed: number;
      returnedOnTime: number;
      lateReturns: number;
      lastBorrowedAt: string;
    }
  >();

  for (const tx of transactions) {
    const sid = tx.student_id;
    if (!sid) continue;

    const student = tx.students;
    let entry = map.get(sid);
    if (!entry) {
      entry = {
        studentId: sid,
        studentName: student?.name ?? "Unknown Student",
        studentNumber: student?.student_number ?? "—",
        studentSection: student?.section ?? "—",
        gradeLevel: student?.grade_level ?? "",
        program: student?.program ?? "",
        totalBorrowed: 0,
        currentlyBorrowed: 0,
        returnedOnTime: 0,
        lateReturns: 0,
        lastBorrowedAt: tx.date_borrowed,
      };
      map.set(sid, entry);
    }

    entry.totalBorrowed += 1;

    if (new Date(tx.date_borrowed).getTime() > new Date(entry.lastBorrowedAt).getTime()) {
      entry.lastBorrowedAt = tx.date_borrowed;
    }

    const due = new Date(tx.due_date);
    const isReturned = tx.status === "Returned" || Boolean(tx.date_returned);
    if (isReturned) {
      const ret = tx.date_returned ? new Date(tx.date_returned) : referenceNow;
      if (ret.getTime() > due.getTime()) {
        entry.lateReturns += 1;
      } else {
        entry.returnedOnTime += 1;
      }
    } else {
      entry.currentlyBorrowed += 1;
    }
  }

  const sorted = Array.from(map.values())
    .map((entry) => {
      const vStatus = violationsByStudentId.get(entry.studentId);
      return {
        ...entry,
        activeViolations: vStatus?.activeViolationCount ?? 0,
        standingLabel: vStatus?.standingLabel ?? "Good Standing",
        standingTone: vStatus?.standingTone ?? ("emerald" as const),
      };
    })
    .sort((a, b) => {
      if (b.totalBorrowed !== a.totalBorrowed) return b.totalBorrowed - a.totalBorrowed;
      if (b.returnedOnTime !== a.returnedOnTime) return b.returnedOnTime - a.returnedOnTime;
      if (a.activeViolations !== b.activeViolations) return a.activeViolations - b.activeViolations;
      return a.studentName.localeCompare(b.studentName);
    });

  return sorted.map((row, idx) => ({
    rank: idx + 1,
    ...row,
  }));
}
