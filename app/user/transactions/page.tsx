"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Download,
  User,
  Hash,
  BookOpen,
  GraduationCap,
  Layers,
  Printer,
  Pencil,
  Trash2,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Ban,
} from "lucide-react";
import PageHeader from "@/components/ui/page-header";
import TransactionSubnav from "@/components/transactions/transaction-subnav";
import Modal, { ConfirmModal } from "@/components/ui/modal";
import SearchInput from "@/components/ui/search-input";
import Select from "@/components/ui/select";
import Badge from "@/components/ui/badge";
import DataTable from "@/components/ui/data-table";
import {
  getMaterialMeta,
  LIBRARY_MATERIAL_TYPES,
  normalizeMaterialType,
} from "@/lib/materials";
import { getEffectiveSession } from "@/lib/client-session";
import { canEdit, canDelete } from "@/lib/permissions";
import {
  getTransactions,
  updateTransactionDetails,
  deleteTransaction,
} from "@/lib/supabase/transactions";
import {
  evaluateAllStudentViolations,
  formatBanDuration,
  formatOrdinal,
  getDefaultViolationPolicy,
  getViolationPolicy,
  setTransactionViolationCleared,
} from "@/lib/supabase/violations";
import {
  getSchoolYears,
  resolveTransactionSchoolYearId,
} from "@/lib/supabase/school-years";
import { formatDateTime } from "@/lib/reports-excel";
import { ensureServerNow, getServerDateString, getServerNow } from "@/lib/server-clock";
import { requestPrint } from "@/lib/print";
import type {
  BorrowingTransactionWithDetails,
  SchoolYear,
  StaffRole,
  StudentViolationIncident,
  ViolationPolicy,
} from "@/lib/types";

export default function TransactionsPage() {
  const [search, setSearch] = useState("");
  const [schoolYearFilter, setSchoolYearFilter] = useState("all");
  const [dateRange, setDateRange] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [materialFilter, setMaterialFilter] = useState("all");
  const [allTransactions, setAllTransactions] = useState<BorrowingTransactionWithDetails[]>([]);
  const [schoolYears, setSchoolYears] = useState<SchoolYear[]>([]);
  const [policy, setPolicy] = useState<ViolationPolicy>(() => getDefaultViolationPolicy());
  const [serverNow, setServerNow] = useState<Date>(() => getServerNow());
  const [loading, setLoading] = useState(true);
  const [selectedStudent, setSelectedStudent] = useState<BorrowingTransactionWithDetails["students"] | null>(null);
  const [role, setRole] = useState<StaffRole | null>(null);

  const allowEdit = role ? canEdit(role) : true;
  const allowDelete = role ? canDelete(role) : true;
  const staffRestricted = role === "Staff";

  // Edit / delete / clear violation state
  const [editingTx, setEditingTx] = useState<BorrowingTransactionWithDetails | null>(null);
  const [editDueDate, setEditDueDate] = useState("");
  const [editViolationCleared, setEditViolationCleared] = useState(false);
  const [deletingTx, setDeletingTx] = useState<BorrowingTransactionWithDetails | null>(null);
  const [clearingIncident, setClearingIncident] = useState<{
    tx: BorrowingTransactionWithDetails;
    incident: StudentViolationIncident;
  } | null>(null);

  const [busy, setBusy] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  useEffect(() => {
    async function fetch() {
      try {
        const [data, session, violationPolicy, years, now] = await Promise.all([
          getTransactions(),
          getEffectiveSession(),
          getViolationPolicy(),
          getSchoolYears().catch(() => [] as SchoolYear[]),
          ensureServerNow(),
        ]);
        setAllTransactions(data);
        setPolicy(violationPolicy);
        setSchoolYears(years);
        setServerNow(now);
        if (session) setRole(session.role);
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    }
    fetch();
  }, []);

  const reload = async () => {
    const [data, violationPolicy, years, now] = await Promise.all([
      getTransactions(),
      getViolationPolicy(),
      getSchoolYears().catch(() => [] as SchoolYear[]),
      ensureServerNow(),
    ]);
    setAllTransactions(data);
    setPolicy(violationPolicy);
    setSchoolYears(years);
    setServerNow(now);
  };

  const violationBundle = useMemo(
    () => evaluateAllStudentViolations(allTransactions, policy, serverNow),
    [allTransactions, policy, serverNow]
  );

  const selectedSchoolYear = useMemo(
    () => schoolYears.find((y) => y.id === schoolYearFilter) ?? null,
    [schoolYears, schoolYearFilter]
  );

  const filtered = useMemo(() => {
    return allTransactions.filter((tx) => {
      if (schoolYearFilter !== "all") {
        const txSyId = resolveTransactionSchoolYearId(tx, schoolYears);
        if (txSyId !== schoolYearFilter) return false;
      }

      const txDate = new Date(tx.date_borrowed);
      const diffDays = (serverNow.getTime() - txDate.getTime()) / (1000 * 60 * 60 * 24);
      const matchesDateRange =
        dateRange === "all" ||
        (dateRange === "7d" && diffDays <= 7) ||
        (dateRange === "30d" && diffDays <= 30) ||
        (dateRange === "90d" && diffDays <= 90);

      const studentName = tx.students?.name ?? "";
      const bookTitle = tx.books?.title ?? "";
      const matchesSearch =
        search === "" ||
        studentName.toLowerCase().includes(search.toLowerCase()) ||
        bookTitle.toLowerCase().includes(search.toLowerCase());

      const isOverdue =
        tx.status === "Overdue" ||
        (tx.status === "Active" && new Date(tx.due_date) < serverNow);
      const incident = violationBundle.byTransactionId.get(tx.id);

      const matchesType =
        typeFilter === "all" ||
        (typeFilter === "Borrow" && tx.status === "Active" && !isOverdue) ||
        (typeFilter === "Return" && tx.status === "Returned") ||
        (typeFilter === "Overdue" && isOverdue) ||
        (typeFilter === "Violation" && Boolean(incident));

      const matchesMaterial =
        materialFilter === "all" ||
        normalizeMaterialType(tx.books?.material_type) === materialFilter;

      return matchesDateRange && matchesSearch && matchesType && matchesMaterial;
    });
  }, [allTransactions, schoolYearFilter, schoolYears, search, dateRange, typeFilter, materialFilter, serverNow, violationBundle]);

  const filteredViolationCounts = useMemo(() => {
    let active = 0;
    let cleared = 0;
    const bannedIds = new Set<string>();
    for (const tx of filtered) {
      const inc = violationBundle.byTransactionId.get(tx.id);
      if (!inc) continue;
      if (inc.cleared) {
        cleared += 1;
      } else {
        active += 1;
        const st = violationBundle.byStudentId.get(tx.student_id);
        if (st?.isBanned) bannedIds.add(tx.student_id);
      }
    }
    return { active, cleared, restrictedStudents: bannedIds.size };
  }, [filtered, violationBundle]);

  const describeIncidentText = (inc: StudentViolationIncident | undefined): string => {
    if (!inc) return "None";
    if (inc.cleared) return "Cleared / Excused";
    const rule = inc.ruleApplied;
    const effect =
      rule?.action === "ban" && rule.banDays > 0
        ? formatBanDuration(rule.banDays) + " ban"
        : rule?.label ?? "Warning";
    return `${formatOrdinal(inc.offenseNumber)} Violation (${effect})`;
  };

  const handleExportCSV = () => {
    const header =
      "Borrowed Date & Time,Returned Date & Time,Due Date & Time,Student,Student Number,Material Type,Title,Author/Creator,Status,Violation Status,Handled By,Handler Role\n";
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const body = filtered
      .map((tx) => {
        const inc = violationBundle.byTransactionId.get(tx.id);
        return [
          esc(formatDateTime(tx.date_borrowed)),
          esc(tx.date_returned ? formatDateTime(tx.date_returned) : ""),
          esc(formatDateTime(tx.due_date)),
          esc(tx.students?.name ?? ""),
          esc(tx.students?.student_number ?? ""),
          esc(normalizeMaterialType(tx.books?.material_type)),
          esc(tx.books?.title ?? ""),
          esc(tx.books?.author ?? ""),
          esc(tx.status),
          esc(describeIncidentText(inc)),
          esc(tx.handled_by_name ?? ""),
          esc(tx.handled_by_role ?? ""),
        ].join(",");
      })
      .join("\n");
    const blob = new Blob(["\uFEFF" + header + body], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `transactions_violations_${getServerDateString()}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const handlePrint = () => {
    requestPrint({
      title: "Transactions & Student Violations Log",
      filename: `bcas_transactions_print_${getServerDateString()}.html`,
    });
  };

  const openEditModal = (tx: BorrowingTransactionWithDetails) => {
    if (!allowEdit) return;
    setEditingTx(tx);
    setEditDueDate(tx.due_date ? new Date(tx.due_date).toISOString().split("T")[0] : "");
    setEditViolationCleared(Boolean(tx.fine_paid));
    setModalError(null);
  };

  const handleEditSubmit = async () => {
    if (!editingTx || !allowEdit) return;
    setBusy(true);
    setModalError(null);
    try {
      await updateTransactionDetails(editingTx.id, {
        due_date: editDueDate || undefined,
        fine_amount: 0,
        fine_paid: editViolationCleared,
      });
      setEditingTx(null);
      await reload();
    } catch (e) {
      setModalError(e instanceof Error ? e.message : "Failed to update transaction.");
    } finally {
      setBusy(false);
    }
  };

  const handleClearViolation = async () => {
    if (!clearingIncident || !allowEdit) return;
    setBusy(true);
    setModalError(null);
    try {
      await setTransactionViolationCleared(clearingIncident.tx.id, true);
      setClearingIncident(null);
      await reload();
    } catch (e) {
      setModalError(e instanceof Error ? e.message : "Failed to clear violation.");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingTx || !allowDelete) return;
    setBusy(true);
    try {
      await deleteTransaction(deletingTx.id);
      setDeletingTx(null);
      await reload();
    } catch (e) {
      setModalError(e instanceof Error ? e.message : "Failed to delete transaction.");
    } finally {
      setBusy(false);
    }
  };

  const columns = [
    {
      key: "date",
      header: "Date & Time",
      render: (row: BorrowingTransactionWithDetails) => (
        <div>
          <div className="text-slate-800">{formatDateTime(row.date_borrowed)}</div>
          <div className="text-xs text-slate-500">
            {row.date_returned
              ? `Returned ${formatDateTime(row.date_returned)}`
              : `Due ${formatDateTime(row.due_date)}`}
          </div>
        </div>
      ),
    },
    {
      key: "student",
      header: "Student",
      render: (row: BorrowingTransactionWithDetails) => (
        <div>
          <div className="font-medium text-slate-800">{row.students?.name ?? "—"}</div>
          <div className="text-xs text-slate-500">{row.students?.student_number || row.students?.section || ""}</div>
        </div>
      ),
    },
    {
      key: "book",
      header: "Material Details",
      render: (row: BorrowingTransactionWithDetails) => {
        const meta = getMaterialMeta(row.books?.material_type);
        return (
          <div>
            <div className="flex items-center gap-1.5 mb-0.5">
              <span
                className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold ${meta.badgeClass}`}
              >
                {meta.label}
              </span>
            </div>
            <div className="font-medium text-slate-800">{row.books?.title ?? "—"}</div>
            <div className="text-xs text-slate-500">{row.books?.author ?? ""}</div>
          </div>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      render: (row: BorrowingTransactionWithDetails) => <Badge label={row.status} />,
    },
    {
      key: "violation",
      header: "Violation",
      render: (row: BorrowingTransactionWithDetails) => {
        const inc = violationBundle.byTransactionId.get(row.id);
        if (!inc) return <span className="text-slate-400">—</span>;
        if (inc.cleared) {
          return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
              <ShieldCheck className="w-3.5 h-3.5" />
              Cleared
            </span>
          );
        }
        const isBan = inc.ruleApplied?.action === "ban" && (inc.ruleApplied.banDays ?? 0) > 0;
        return (
          <div>
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold ${
                isBan
                  ? "bg-red-100 text-red-700"
                  : "bg-amber-100 text-amber-800"
              }`}
            >
              {isBan ? <Ban className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
              {formatOrdinal(inc.offenseNumber)} —{" "}
              {isBan
                ? `${inc.ruleApplied!.banDays}d Ban`
                : inc.ruleApplied?.label ?? "Warning"}
            </span>
            <div className="text-[11px] text-slate-500 mt-0.5">{inc.overdueLabel} late</div>
          </div>
        );
      },
    },
    {
      key: "handledBy",
      header: "Handled By",
      render: (row: BorrowingTransactionWithDetails) => {
        if (!row.handled_by_name) return <span className="text-slate-400">—</span>;
        return (
          <div>
            <div className="font-medium text-slate-800">{row.handled_by_name}</div>
            {row.handled_by_role && (
              <div className="text-xs text-slate-500">{row.handled_by_role}</div>
            )}
          </div>
        );
      },
    },
    {
      key: "actions",
      header: "Actions",
      render: (row: BorrowingTransactionWithDetails) => {
        const inc = violationBundle.byTransactionId.get(row.id);
        return (
          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            {allowEdit && inc && !inc.cleared && (
              <button
                onClick={() => {
                  setModalError(null);
                  setClearingIncident({ tx: row, incident: inc });
                }}
                className="text-emerald-600 hover:text-emerald-800 transition-colors"
                title="Clear / excuse violation"
              >
                <ShieldCheck className="w-4 h-4" />
              </button>
            )}
            {allowEdit && (
              <button
                onClick={() => openEditModal(row)}
                className="text-slate-400 hover:text-slate-600 transition-colors"
                title="Edit transaction"
              >
                <Pencil className="w-4 h-4" />
              </button>
            )}
            {allowDelete && (
              <button
                onClick={() => {
                  setModalError(null);
                  setDeletingTx(row);
                }}
                className="text-slate-400 hover:text-red-600 transition-colors"
                title="Delete transaction"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        );
      },
    },
  ].filter((col) => col.key !== "actions" || allowEdit || allowDelete);

  const selectedStudentViolation = selectedStudent
    ? violationBundle.byStudentId.get(selectedStudent.id)
    : undefined;

  return (
    <>
      <div className="animate-fade-in-up stagger-1 no-print">
        <PageHeader
          title="Transactions"
          actions={
            <>
              <Select
                value={dateRange}
                onChange={setDateRange}
                options={[
                  { label: "Last 7 Days", value: "7d" },
                  { label: "Last 30 Days", value: "30d" },
                  { label: "Last 90 Days", value: "90d" },
                  { label: "All Time", value: "all" },
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
              <Select
                value={materialFilter}
                onChange={setMaterialFilter}
                options={[
                  { label: "All Materials", value: "all" },
                  ...LIBRARY_MATERIAL_TYPES.map((t) => ({ label: t, value: t })),
                ]}
              />
              <Select
                value={typeFilter}
                onChange={setTypeFilter}
                options={[
                  { label: "All Statuses", value: "all" },
                  { label: "Borrow (On Time)", value: "Borrow" },
                  { label: "Return", value: "Return" },
                  { label: "Overdue", value: "Overdue" },
                  { label: "With Violation", value: "Violation" },
                ]}
              />
              <button
                onClick={handleExportCSV}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 transition-colors no-print"
              >
                <Download className="w-4 h-4" />
                Export
              </button>
              <button
                onClick={handlePrint}
                className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 transition-colors no-print"
              >
                <Printer className="w-4 h-4" />
                Print
              </button>
            </>
          }
        />
      </div>

      <TransactionSubnav />

      {staffRestricted && (
        <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 flex items-start gap-2 text-sm text-amber-800 animate-fade-in-up stagger-2 no-print">
          <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
          <span>Borrows are recorded automatically via Borrow/Return scanning. Editing, clearing violations, or deleting a transaction requires a Librarian or Admin.</span>
        </div>
      )}

      <div data-print-area className="space-y-4">
        {/* Print-only formal header */}
        <div className="hidden print:block pb-3 border-b border-slate-300">
          <h2 className="text-xl font-bold text-slate-900">BCAS Library — Transactions &amp; Student Violations Log</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Generated {formatDateTime(serverNow.toISOString())} • School Year: {selectedSchoolYear ? `SY ${selectedSchoolYear.name}` : "All School Years"} • {filtered.length} record(s) • Active Violations: {filteredViolationCounts.active} • Restricted Students: {filteredViolationCounts.restrictedStudents} • Cleared: {filteredViolationCounts.cleared}
          </p>
        </div>

        {/* Violation Summary (visible on screen and print) */}
        {(filteredViolationCounts.active > 0 || filteredViolationCounts.cleared > 0) && (
          <div className="p-4 bg-amber-50 rounded-xl border border-amber-200 animate-fade-in-up stagger-2 print-avoid-break">
            <div className="flex items-center gap-2 mb-2">
              <ShieldAlert className="w-5 h-5 text-amber-600" />
              <span className="font-semibold text-amber-900">Student Violation Summary</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <div>
                <span className="text-amber-700">Active Violations:</span>
                <span className="ml-2 font-semibold text-amber-900">{filteredViolationCounts.active}</span>
              </div>
              <div>
                <span className="text-amber-700">Borrowing Restricted:</span>
                <span className="ml-2 font-semibold text-red-700">
                  {filteredViolationCounts.restrictedStudents} student{filteredViolationCounts.restrictedStudents === 1 ? "" : "s"}
                </span>
              </div>
              <div>
                <span className="text-amber-700">Cleared / Excused:</span>
                <span className="ml-2 font-semibold text-emerald-700">{filteredViolationCounts.cleared}</span>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 animate-fade-in-up stagger-3">
          <div className="mb-5 no-print">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search by student or book title..."
            />
          </div>
          {loading ? (
            <div className="py-12 text-center text-slate-400 text-sm">Loading transactions...</div>
          ) : (
            <>
              <div className="print:hidden">
                <DataTable
                  columns={columns}
                  data={filtered}
                  pageSize={5}
                  keyExtractor={(row) => row.id}
                  onRowClick={(row) => setSelectedStudent(row.students)}
                  emptyMessage="No transactions found."
                />
              </div>
              {/* Print-only full list */}
              <div className="hidden print:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="text-left px-2 py-2 font-semibold text-slate-500">Date &amp; Time</th>
                      <th className="text-left px-2 py-2 font-semibold text-slate-500">Student</th>
                      <th className="text-left px-2 py-2 font-semibold text-slate-500">Book</th>
                      <th className="text-left px-2 py-2 font-semibold text-slate-500">Status</th>
                      <th className="text-left px-2 py-2 font-semibold text-slate-500">Violation</th>
                      <th className="text-left px-2 py-2 font-semibold text-slate-500">Handled By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((tx) => (
                      <tr key={tx.id} className="border-b border-slate-100">
                        <td className="px-2 py-2 text-slate-600">
                          {formatDateTime(tx.date_borrowed)}
                          <div className="text-xs text-slate-400">
                            {tx.date_returned
                              ? `Returned ${formatDateTime(tx.date_returned)}`
                              : `Due ${formatDateTime(tx.due_date)}`}
                          </div>
                        </td>
                        <td className="px-2 py-2">
                          <div className="font-medium text-slate-800">{tx.students?.name ?? "—"}</div>
                          <div className="text-xs text-slate-500">{tx.students?.student_number || tx.students?.section || ""}</div>
                        </td>
                        <td className="px-2 py-2">
                          <div className="font-medium text-slate-800">{tx.books?.title ?? "—"}</div>
                          <div className="text-xs text-slate-500">{tx.books?.author ?? ""}</div>
                        </td>
                        <td className="px-2 py-2 text-slate-600">{tx.status}</td>
                        <td className="px-2 py-2 text-slate-600">
                          {describeIncidentText(violationBundle.byTransactionId.get(tx.id))}
                        </td>
                        <td className="px-2 py-2 text-slate-600">
                          {tx.handled_by_name ? `${tx.handled_by_name}${tx.handled_by_role ? ` (${tx.handled_by_role})` : ""}` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filtered.length === 0 && (
                  <p className="py-8 text-center text-slate-400 text-sm">No transactions found.</p>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Edit Transaction Modal */}
      <Modal
        open={!!editingTx}
        onClose={() => setEditingTx(null)}
        title="Edit Transaction"
        subtitle={editingTx ? `${editingTx.books?.title ?? ""} / ${editingTx.students?.name ?? ""}` : undefined}
        size="sm"
        footer={
          <>
            <button
              onClick={() => setEditingTx(null)}
              className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleEditSubmit}
              disabled={busy}
              className="px-4 py-2 rounded-lg bg-emerald-700 text-white text-sm font-medium hover:bg-emerald-800 transition-colors disabled:opacity-50"
            >
              {busy ? "Saving..." : "Save Changes"}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {modalError && editingTx && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{modalError}</div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Due Date</label>
            <input
              type="date"
              value={editDueDate}
              onChange={(e) => setEditDueDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
            />
          </div>
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={editViolationCleared}
                onChange={(e) => setEditViolationCleared(e.target.checked)}
                className="w-4 h-4 mt-0.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <div>
                <span className="text-sm font-medium text-slate-700 block">
                  Clear / Excuse Violation
                </span>
                <span className="text-xs text-slate-500">
                  Removes this transaction from the student&apos;s violation count and lifts any ban it caused.
                </span>
              </div>
            </label>
          </div>
        </div>
      </Modal>

      {/* Clear Violation Confirm Modal */}
      <ConfirmModal
        open={!!clearingIncident}
        onClose={() => { setClearingIncident(null); setModalError(null); }}
        onConfirm={handleClearViolation}
        title="Clear / Excuse Violation"
        message={
          modalError ??
          (clearingIncident
            ? `Clear the ${formatOrdinal(clearingIncident.incident.offenseNumber)} violation for "${clearingIncident.tx.books?.title ?? ""}" (${clearingIncident.tx.students?.name ?? ""})? This removes it from the student's violation count and lifts any active ban triggered by it.`
            : "")
        }
        confirmLabel="Clear Violation"
        confirming={busy}
        variant="primary"
      />

      {/* Delete Confirm Modal */}
      <ConfirmModal
        open={!!deletingTx}
        onClose={() => { setDeletingTx(null); setModalError(null); }}
        onConfirm={handleDelete}
        title="Delete Transaction"
        message={
          modalError ??
          (deletingTx
            ? `Delete the ${deletingTx.status.toLowerCase()} transaction for "${deletingTx.books?.title ?? ""}" / ${deletingTx.students?.name ?? ""}? It will be moved to the Archive${deletingTx.status === "Active" || deletingTx.status === "Overdue" ? " and the book marked Available" : ""}. This will be recorded in the Activity Logs.`
            : "")
        }
        confirmLabel="Delete"
        confirming={busy}
      />

      {/* Student Info Modal */}
      <Modal
        open={!!selectedStudent}
        onClose={() => setSelectedStudent(null)}
        title="Student Information"
        subtitle={selectedStudent?.name}
        size="sm"
        footer={
          <button
            onClick={() => setSelectedStudent(null)}
            className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Close
          </button>
        }
      >
        {selectedStudent && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-slate-50 border border-slate-200">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
                  <User className="w-5 h-5 text-emerald-700" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">{selectedStudent.name}</p>
                  <p className="text-xs text-slate-500">Student</p>
                </div>
              </div>
              <span
                className={`px-2 py-0.5 rounded text-xs font-semibold ${
                  selectedStudentViolation?.standingTone === "red"
                    ? "bg-red-100 text-red-700"
                    : selectedStudentViolation?.standingTone === "amber"
                    ? "bg-amber-100 text-amber-800"
                    : "bg-emerald-100 text-emerald-700"
                }`}
              >
                {selectedStudentViolation?.standingLabel ?? "Good Standing"}
              </span>
            </div>

            {selectedStudentViolation && selectedStudentViolation.activeViolationCount > 0 && (
              <div
                className={`p-3 rounded-lg border text-xs ${
                  selectedStudentViolation.isBanned
                    ? "bg-red-50 border-red-200 text-red-800"
                    : "bg-amber-50 border-amber-200 text-amber-800"
                }`}
              >
                <p className="font-semibold">
                  Active Violations: {selectedStudentViolation.activeViolationCount}
                </p>
                {selectedStudentViolation.isBanned && (
                  <p className="mt-0.5">
                    {selectedStudentViolation.blockedByUnreturnedOverdue
                      ? "Borrowing restricted until overdue book is returned."
                      : selectedStudentViolation.banEndsAt
                      ? `Forbidden from borrowing until ${formatDateTime(selectedStudentViolation.banEndsAt)}.`
                      : "Borrowing currently suspended."}
                  </p>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                <div className="flex items-center gap-1.5 mb-1">
                  <Hash className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-xs font-medium text-slate-500">Student ID</span>
                </div>
                <p className="text-sm font-medium text-slate-800">{selectedStudent.student_number || "—"}</p>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                <div className="flex items-center gap-1.5 mb-1">
                  <Layers className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-xs font-medium text-slate-500">Section</span>
                </div>
                <p className="text-sm font-medium text-slate-800">{selectedStudent.section || "—"}</p>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                <div className="flex items-center gap-1.5 mb-1">
                  <GraduationCap className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-xs font-medium text-slate-500">Grade Level</span>
                </div>
                <p className="text-sm font-medium text-slate-800">{selectedStudent.grade_level || "—"}</p>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                <div className="flex items-center gap-1.5 mb-1">
                  <BookOpen className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-xs font-medium text-slate-500">Program</span>
                </div>
                <p className="text-sm font-medium text-slate-800">{selectedStudent.program || "—"}</p>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
