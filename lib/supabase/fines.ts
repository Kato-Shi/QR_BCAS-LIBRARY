import { createClient } from "@/utils/client";
import { logActivity, getCurrentActor } from "@/lib/supabase/activity-logs";
import { computeEffectiveFine } from "@/lib/supabase/transactions";
import { ensureServerNow, getServerNowIso } from "@/lib/server-clock";
import type { ActorInfo, BorrowingTransactionWithDetails, FineSetting, StudentFine } from "@/lib/types";

const supabase = createClient();

export async function getFineSettings(): Promise<FineSetting> {
  const { data, error } = await supabase
    .from("fine_settings")
    .select("*")
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    return {
      id: "",
      fine_rate_per_day: 5,
      max_fine: 500,
      created_at: getServerNowIso(),
    };
  }

  return {
    ...data,
    fine_rate_per_day: Number(data.fine_rate_per_day ?? 5),
    max_fine: Number(data.max_fine ?? 500),
  };
}

export async function updateFineSettings(
  id: string,
  updates: Partial<Omit<FineSetting, "id" | "created_at">>
): Promise<FineSetting> {
  if (!id) {
    const { data, error } = await supabase
      .from("fine_settings")
      .insert({
        fine_rate_per_day: updates.fine_rate_per_day ?? 5,
        max_fine: updates.max_fine ?? 500,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from("fine_settings")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function calculateFine(transactionId: string): Promise<number> {
  const [{ data: tx, error }, settings, serverNow] = await Promise.all([
    supabase
      .from("borrowing_transactions")
      .select("due_date, date_returned, status, fine_amount")
      .eq("id", transactionId)
      .single(),
    getFineSettings(),
    ensureServerNow(true),
  ]);

  if (error || !tx) throw error ?? new Error("Transaction not found.");
  return computeEffectiveFine(tx, settings.fine_rate_per_day, settings.max_fine, serverNow).amount;
}

export async function payFine(transactionId: string, actor?: ActorInfo | null): Promise<void> {
  const resolved = actor ?? (await getCurrentActor().catch(() => null));

  const [{ data: tx, error: fetchError }, settings, serverNow] = await Promise.all([
    supabase
      .from("borrowing_transactions")
      .select("id, due_date, date_returned, status, fine_amount, students(name), books(title)")
      .eq("id", transactionId)
      .single(),
    getFineSettings(),
    ensureServerNow(true),
  ]);

  if (fetchError || !tx) throw fetchError ?? new Error("Transaction not found.");

  const effective = computeEffectiveFine(
    tx,
    settings.fine_rate_per_day,
    settings.max_fine,
    serverNow
  ).amount;

  const { error } = await supabase
    .from("borrowing_transactions")
    .update({
      fine_amount: effective,
      fine_paid: true,
    })
    .eq("id", transactionId);

  if (error) throw error;

  const txDetails = tx as unknown as {
    students?: { name?: string } | null;
    books?: { title?: string } | null;
  };

  await logActivity({
    action: "EDIT",
    entity_type: "fine",
    entity_id: transactionId,
    description: `Marked fine ₱${effective.toFixed(2)} as paid for "${txDetails.books?.title ?? transactionId}" (${txDetails.students?.name ?? "student"}).`,
    metadata: { fine_amount: effective, fine_paid: true },
    actor: resolved,
  });
}

export async function updateTransactionFine(transactionId: string, fineAmount: number): Promise<void> {
  const { error } = await supabase
    .from("borrowing_transactions")
    .update({ fine_amount: fineAmount })
    .eq("id", transactionId);

  if (error) throw error;
}

export async function getStudentFines(): Promise<StudentFine[]> {
  const { data, error } = await supabase
    .from("student_fines")
    .select("*")
    .order("total_fines", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function getPendingFinesTotal(): Promise<number> {
  const [{ data, error }, settings, serverNow] = await Promise.all([
    supabase
      .from("borrowing_transactions")
      .select("due_date, date_returned, status, fine_amount, fine_paid")
      .eq("fine_paid", false),
    getFineSettings(),
    ensureServerNow(),
  ]);

  if (error) throw error;

  return (data ?? []).reduce((sum, tx) => {
    const { amount } = computeEffectiveFine(
      tx,
      settings.fine_rate_per_day,
      settings.max_fine,
      serverNow
    );
    return sum + amount;
  }, 0);
}

export async function getPaidFinesTotal(): Promise<number> {
  const { data, error } = await supabase
    .from("borrowing_transactions")
    .select("fine_amount")
    .gt("fine_amount", 0)
    .eq("fine_paid", true);

  if (error) throw error;
  return (data ?? []).reduce((sum, tx) => sum + Number(tx.fine_amount || 0), 0);
}

export interface FineLedgerItem {
  transaction_id: string;
  student_name: string;
  student_number: string;
  student_section: string;
  book_title: string;
  book_author: string;
  accession_number: string;
  status: string;
  date_borrowed: string;
  due_date: string;
  date_returned: string | null;
  days_overdue: number;
  fine_amount: number;
  is_accruing: boolean;
  fine_paid: boolean;
}

export async function getFinesLedger(): Promise<{
  items: FineLedgerItem[];
  pendingTotal: number;
  paidTotal: number;
  totalAssessed: number;
}> {
  const [{ data, error }, settings, serverNow] = await Promise.all([
    supabase
      .from("borrowing_transactions")
      .select(`
        *,
        students(id, name, section, student_number),
        books(id, title, author, accession_number)
      `)
      .order("due_date", { ascending: true }),
    getFineSettings(),
    ensureServerNow(),
  ]);

  if (error) throw error;

  const items: FineLedgerItem[] = [];
  let pendingTotal = 0;
  let paidTotal = 0;

  for (const raw of (data ?? []) as BorrowingTransactionWithDetails[]) {
    const { amount, isAccruing, daysOverdue } = computeEffectiveFine(
      raw,
      settings.fine_rate_per_day,
      settings.max_fine,
      serverNow
    );
    if (amount <= 0) continue;

    if (raw.fine_paid) {
      paidTotal += amount;
    } else {
      pendingTotal += amount;
    }

    items.push({
      transaction_id: raw.id,
      student_name: raw.students?.name ?? "Unknown",
      student_number: raw.students?.student_number ?? "",
      student_section: raw.students?.section ?? "",
      book_title: raw.books?.title ?? "Unknown",
      book_author: raw.books?.author ?? "",
      accession_number: raw.books?.accession_number ?? "",
      status: raw.status,
      date_borrowed: raw.date_borrowed,
      due_date: raw.due_date,
      date_returned: raw.date_returned,
      days_overdue: daysOverdue,
      fine_amount: amount,
      is_accruing: isAccruing,
      fine_paid: !!raw.fine_paid,
    });
  }

  return {
    items,
    pendingTotal,
    paidTotal,
    totalAssessed: pendingTotal + paidTotal,
  };
}
