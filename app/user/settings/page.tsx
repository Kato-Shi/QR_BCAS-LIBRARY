"use client";

import { useState, useEffect, useMemo } from "react";
import {
  ShieldAlert,
  Calendar,
  Users,
  Plus,
  Trash2,
  KeyRound,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Ban,
  Pencil,
  RefreshCw,
  Check,
  Sparkles,
} from "lucide-react";
import PageHeader from "@/components/ui/page-header";
import Modal, { ConfirmModal } from "@/components/ui/modal";
import {
  DEFAULT_VIOLATION_RULES,
  getViolationPolicy,
  saveViolationPolicy,
  formatOrdinal,
  formatBanDuration,
  formatViolationPolicySummary,
} from "@/lib/supabase/violations";
import {
  getSchoolYears,
  getSchoolYearSummaries,
  createSchoolYear,
  updateSchoolYear,
  setActiveSchoolYear,
  deleteSchoolYear,
  countUnassignedTransactions,
  assignUnassignedTransactionsToSchoolYears,
  formatSchoolYearDateRange,
  getSchoolYearPhase,
  suggestNextSchoolYear,
} from "@/lib/supabase/school-years";
import { getStaff, createStaff, deleteStaff, setStaffPassword } from "@/lib/supabase/staff";
import { getEffectiveSession } from "@/lib/client-session";
import { ensureServerNow, getServerNow } from "@/lib/server-clock";
import { canManageSettings, STAFF_RESTRICTED_MESSAGE } from "@/lib/permissions";
import type {
  SchoolYear,
  SchoolYearSummary,
  Staff,
  StaffRole,
  ViolationRule,
  ViolationActionType,
} from "@/lib/types";

const BAN_DAY_PRESETS = [
  { label: "3 days", days: 3 },
  { label: "5 days", days: 5 },
  { label: "1 week (7d)", days: 7 },
  { label: "2 weeks (14d)", days: 14 },
  { label: "1 month (30d)", days: 30 },
];

export default function SettingsPage() {
  const [session, setSession] = useState<{ role: StaffRole } | null>(null);
  const [activeTab, setActiveTab] = useState<"violations" | "school-years" | "staff">("violations");

  // Violation policy settings
  const [violationRules, setViolationRules] = useState<ViolationRule[]>(
    DEFAULT_VIOLATION_RULES.map((r) => ({ ...r }))
  );
  const [policyUpdatedBy, setPolicyUpdatedBy] = useState<string | null>(null);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [policyFeedback, setPolicyFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // School years
  const [schoolYears, setSchoolYears] = useState<SchoolYear[]>([]);
  const [schoolYearSummaries, setSchoolYearSummaries] = useState<SchoolYearSummary[]>([]);
  const [unassignedTxCount, setUnassignedTxCount] = useState(0);
  const [serverNow, setServerNow] = useState<Date>(() => getServerNow());
  const [newYearName, setNewYearName] = useState("");
  const [newYearStart, setNewYearStart] = useState("");
  const [newYearEnd, setNewYearEnd] = useState("");
  const [newYearSetActive, setNewYearSetActive] = useState(false);
  const [showAddYear, setShowAddYear] = useState(false);
  const [editingYear, setEditingYear] = useState<SchoolYear | null>(null);
  const [editYearName, setEditYearName] = useState("");
  const [editYearStart, setEditYearStart] = useState("");
  const [editYearEnd, setEditYearEnd] = useState("");
  const [activatingYearId, setActivatingYearId] = useState<string | null>(null);
  const [syncingUnassigned, setSyncingUnassigned] = useState(false);
  const [yearFeedback, setYearFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Staff
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [showAddStaff, setShowAddStaff] = useState(false);
  const [newStaff, setNewStaff] = useState({ staff_id: "", name: "", role: "Staff" as StaffRole, password: "" });
  const [passwordStaff, setPasswordStaff] = useState<Staff | null>(null);
  const [newPassword, setNewPassword] = useState("");

  const [yearToDelete, setYearToDelete] = useState<SchoolYear | null>(null);
  const [staffToDelete, setStaffToDelete] = useState<Staff | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalBusy, setModalBusy] = useState(false);

  async function fetchSettingsBundle() {
    const [policy, years, summaries, unassigned, staff, now] = await Promise.all([
      getViolationPolicy(),
      getSchoolYears(),
      getSchoolYearSummaries().catch(() => [] as SchoolYearSummary[]),
      countUnassignedTransactions().catch(() => 0),
      getStaff(),
      ensureServerNow(),
    ]);
    return { policy, years, summaries, unassigned, staff, now };
  }

  async function loadData() {
    try {
      const data = await fetchSettingsBundle();
      setViolationRules(data.policy.rules.map((r) => ({ ...r })));
      setPolicyUpdatedBy(data.policy.updatedBy ?? null);
      setSchoolYears(data.years);
      setSchoolYearSummaries(data.summaries);
      setUnassignedTxCount(data.unassigned);
      setStaffList(data.staff);
      setServerNow(data.now);
    } catch (e) {
      console.error("Failed to load settings:", e);
    }
  }

  useEffect(() => {
    let active = true;
    const params =
      typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    const initialTab = params?.get("tab");

    Promise.all([getEffectiveSession(), fetchSettingsBundle()])
      .then(([sess, data]) => {
        if (!active) return;
        setSession(sess);
        if (initialTab === "school-years" || initialTab === "violations") {
          setActiveTab(initialTab);
        } else if (initialTab === "staff" && sess?.role === "Admin") {
          setActiveTab("staff");
        }
        setViolationRules(data.policy.rules.map((r) => ({ ...r })));
        setPolicyUpdatedBy(data.policy.updatedBy ?? null);
        setSchoolYears(data.years);
        setSchoolYearSummaries(data.summaries);
        setUnassignedTxCount(data.unassigned);
        setStaffList(data.staff);
        setServerNow(data.now);
      })
      .catch((e) => {
        console.error("Failed to load settings:", e);
      });

    return () => {
      active = false;
    };
  }, []);

  const summaryByYearId = useMemo(() => {
    const map = new Map<string, SchoolYearSummary>();
    for (const s of schoolYearSummaries) {
      map.set(s.school_year_id, s);
    }
    return map;
  }, [schoolYearSummaries]);

  const activeSchoolYear = useMemo(
    () => schoolYears.find((y) => y.is_active) ?? null,
    [schoolYears]
  );

  function updateRule(index: number, patch: Partial<ViolationRule>) {
    setPolicyFeedback(null);
    setViolationRules((prev) =>
      prev.map((rule, idx) => {
        if (idx !== index) return rule;
        const next: ViolationRule = { ...rule, ...patch };
        if (patch.action === "warning") {
          next.banDays = 0;
        } else if (patch.action === "ban" && (!next.banDays || next.banDays <= 0)) {
          next.banDays = 3;
        }
        return next;
      })
    );
  }

  function handleAddViolationLevel() {
    setPolicyFeedback(null);
    setViolationRules((prev) => {
      const nextLevel = prev.length + 1;
      const lastDays = prev[prev.length - 1]?.banDays ?? 30;
      const suggestedDays = Math.max(30, lastDays + 30);
      return [
        ...prev,
        {
          level: nextLevel,
          label: `${formatOrdinal(nextLevel)} Violation Ban`,
          action: "ban",
          banDays: suggestedDays,
          description: `Student is forbidden from borrowing for ${suggestedDays} days.`,
        },
      ];
    });
  }

  function handleRemoveViolationLevel(index: number) {
    if (violationRules.length <= 1) return;
    setPolicyFeedback(null);
    setViolationRules((prev) =>
      prev
        .filter((_, idx) => idx !== index)
        .map((rule, i) => ({ ...rule, level: i + 1 }))
    );
  }

  function handleResetDefaults() {
    setPolicyFeedback(null);
    setViolationRules(DEFAULT_VIOLATION_RULES.map((r) => ({ ...r })));
  }

  async function handleSaveViolationPolicy() {
    if (!canManage) return;
    setSavingPolicy(true);
    setPolicyFeedback(null);
    try {
      const saved = await saveViolationPolicy(violationRules);
      setViolationRules(saved.rules);
      setPolicyUpdatedBy(saved.updatedBy ?? null);
      setPolicyFeedback({
        type: "success",
        message: "Violation policy saved. All borrow checks, returns, and reports now use these rules.",
      });
    } catch (e) {
      setPolicyFeedback({
        type: "error",
        message: e instanceof Error ? e.message : "Failed to save violation policy.",
      });
    } finally {
      setSavingPolicy(false);
    }
  }

  function openAddYearModal() {
    const suggestion = suggestNextSchoolYear(schoolYears, serverNow);
    setNewYearName(suggestion.name);
    setNewYearStart(suggestion.start_date);
    setNewYearEnd(suggestion.end_date);
    setNewYearSetActive(!activeSchoolYear);
    setModalError(null);
    setYearFeedback(null);
    setShowAddYear(true);
  }

  function applyCalendarPreset(
    mode: "jun-may" | "aug-may",
    target: "add" | "edit"
  ) {
    const rawName = target === "add" ? newYearName : editYearName;
    const rawStart = target === "add" ? newYearStart : editYearStart;
    const nameMatch = rawName.match(/(\d{4})/);
    const startYear = nameMatch
      ? Number(nameMatch[1])
      : rawStart
      ? Number(rawStart.slice(0, 4))
      : serverNow.getFullYear();
    const startDate = mode === "jun-may" ? `${startYear}-06-01` : `${startYear}-08-01`;
    const endDate = `${startYear + 1}-05-31`;
    if (target === "add") {
      if (!newYearName.trim()) setNewYearName(`${startYear}-${startYear + 1}`);
      setNewYearStart(startDate);
      setNewYearEnd(endDate);
    } else {
      setEditYearStart(startDate);
      setEditYearEnd(endDate);
    }
  }

  async function handleAddYear() {
    if (!canManage) {
      setModalError(STAFF_RESTRICTED_MESSAGE);
      return;
    }
    if (!newYearName.trim() || !newYearStart || !newYearEnd) {
      setModalError("Year name, start date, and end date are required.");
      return;
    }
    if (newYearEnd <= newYearStart) {
      setModalError("End date must be later than the start date.");
      return;
    }
    setModalBusy(true);
    setModalError(null);
    setYearFeedback(null);
    try {
      const created = await createSchoolYear({
        name: newYearName.trim(),
        start_date: newYearStart,
        end_date: newYearEnd,
        is_active: newYearSetActive,
      });
      setShowAddYear(false);
      await loadData();
      setYearFeedback({
        type: "success",
        message: `School year "${created.name}" added${created.is_active ? " and set as the active school year" : ""}.`,
      });
    } catch (e) {
      setModalError(e instanceof Error ? e.message : "Failed to add school year.");
    } finally {
      setModalBusy(false);
    }
  }

  function openEditYearModal(year: SchoolYear) {
    setEditingYear(year);
    setEditYearName(year.name);
    setEditYearStart(year.start_date.slice(0, 10));
    setEditYearEnd(year.end_date.slice(0, 10));
    setModalError(null);
    setYearFeedback(null);
  }

  async function handleUpdateYear() {
    if (!editingYear || !canManage) return;
    if (!editYearName.trim() || !editYearStart || !editYearEnd) {
      setModalError("Year name, start date, and end date are required.");
      return;
    }
    if (editYearEnd <= editYearStart) {
      setModalError("End date must be later than the start date.");
      return;
    }
    setModalBusy(true);
    setModalError(null);
    setYearFeedback(null);
    try {
      const updated = await updateSchoolYear(editingYear.id, {
        name: editYearName.trim(),
        start_date: editYearStart,
        end_date: editYearEnd,
      });
      setEditingYear(null);
      await loadData();
      setYearFeedback({
        type: "success",
        message: `School year "${updated.name}" updated.`,
      });
    } catch (e) {
      setModalError(e instanceof Error ? e.message : "Failed to update school year.");
    } finally {
      setModalBusy(false);
    }
  }

  async function handleSetActiveYear(year: SchoolYear) {
    if (!canManage || activatingYearId) return;
    setActivatingYearId(year.id);
    setYearFeedback(null);
    try {
      await setActiveSchoolYear(year.id);
      await loadData();
      setYearFeedback({
        type: "success",
        message: `Active school year switched to "${year.name}". All new checkouts will be recorded under this school year.`,
      });
    } catch (e) {
      setYearFeedback({
        type: "error",
        message: e instanceof Error ? e.message : "Failed to set active school year.",
      });
    } finally {
      setActivatingYearId(null);
    }
  }

  async function handleDeleteYear() {
    if (!yearToDelete || !canManage) return;
    setModalBusy(true);
    setYearFeedback(null);
    try {
      const targetName = yearToDelete.name;
      const { unlinkedTransactions } = await deleteSchoolYear(yearToDelete.id);
      setYearToDelete(null);
      await loadData();
      setYearFeedback({
        type: "success",
        message:
          unlinkedTransactions > 0
            ? `School year "${targetName}" deleted. ${unlinkedTransactions} linked transaction record(s) were preserved and unlinked.`
            : `School year "${targetName}" deleted.`,
      });
    } catch (e) {
      setYearToDelete(null);
      setYearFeedback({
        type: "error",
        message: e instanceof Error ? e.message : "Failed to delete school year.",
      });
    } finally {
      setModalBusy(false);
    }
  }

  async function handleSyncUnassigned() {
    if (!canManage || syncingUnassigned) return;
    setSyncingUnassigned(true);
    setYearFeedback(null);
    try {
      const { assignedCount } = await assignUnassignedTransactionsToSchoolYears();
      await loadData();
      setYearFeedback({
        type: "success",
        message:
          assignedCount > 0
            ? `Synced ${assignedCount} legacy transaction${assignedCount === 1 ? "" : "s"} into their matching school year.`
            : "All transactions are already linked to a school year.",
      });
    } catch (e) {
      setYearFeedback({
        type: "error",
        message: e instanceof Error ? e.message : "Failed to sync unassigned transactions.",
      });
    } finally {
      setSyncingUnassigned(false);
    }
  }

  async function handleAddStaff() {
    if (!newStaff.staff_id || !newStaff.name || !newStaff.password) {
      setModalError("Staff ID, name, and password are required.");
      return;
    }
    setModalBusy(true);
    setModalError(null);
    try {
      const { password, ...staffData } = newStaff;
      const passwordHash = btoa(password);
      await createStaff({ ...staffData, is_active: true, password_hash: passwordHash });
      setNewStaff({ staff_id: "", name: "", role: "Staff", password: "" });
      setShowAddStaff(false);
      await loadData();
    } catch (e: unknown) {
      console.error("Staff creation error:", e);
      setModalError(e instanceof Error ? `Failed to add staff: ${e.message}` : "Failed to add staff.");
    } finally {
      setModalBusy(false);
    }
  }

  async function handleSetPassword() {
    if (!passwordStaff || !newPassword) {
      setModalError("Please enter a new password.");
      return;
    }
    setModalBusy(true);
    setModalError(null);
    try {
      await setStaffPassword(passwordStaff.id, newPassword);
      setPasswordStaff(null);
      setNewPassword("");
    } catch {
      setModalError("Failed to update password.");
    } finally {
      setModalBusy(false);
    }
  }

  async function handleDeleteStaff() {
    if (!staffToDelete) return;
    setModalBusy(true);
    try {
      await deleteStaff(staffToDelete.id);
      setStaffToDelete(null);
      await loadData();
    } catch {
      setModalError("Failed to delete staff member.");
    } finally {
      setModalBusy(false);
    }
  }

  const tabs = [
    { id: "violations" as const, label: "Violation Policy", icon: ShieldAlert },
    { id: "school-years" as const, label: "School Years", icon: Calendar },
    { id: "staff" as const, label: "Staff Management", icon: Users, adminOnly: true },
  ];

  const filteredTabs = tabs.filter((t) => !t.adminOnly || session?.role === "Admin");
  const canManage = session ? canManageSettings(session.role) : true;

  return (
    <>
      <PageHeader title="Settings" />

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 mb-6 bg-slate-100 p-1 rounded-lg w-fit">
        {filteredTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? "bg-white text-slate-800 shadow-sm"
                : "text-slate-600 hover:text-slate-800"
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Student Violation Policy Tab */}
      {activeTab === "violations" && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-4">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">
                Student Violation Escalation Policy
              </h3>
              <p className="text-sm text-slate-600 mt-1">
                Configure what happens each time a student returns a book late or has an overdue item. Monetary fines are disabled — borrowing restrictions are enforced automatically using the server clock.
              </p>
            </div>
            {canManage && (
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleResetDefaults}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset Defaults
                </button>
                <button
                  type="button"
                  onClick={handleAddViolationLevel}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Level
                </button>
              </div>
            )}
          </div>

          {!canManage && (
            <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
              {STAFF_RESTRICTED_MESSAGE} Violation rules are read-only for your account.
            </div>
          )}

          {policyFeedback && (
            <div
              className={`mb-4 p-3 rounded-lg border text-sm flex items-center gap-2 ${
                policyFeedback.type === "success"
                  ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                  : "bg-red-50 border-red-200 text-red-700"
              }`}
            >
              {policyFeedback.type === "success" ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 shrink-0" />
              )}
              <span>{policyFeedback.message}</span>
            </div>
          )}

          {/* Escalation Tiers */}
          <div className="space-y-4">
            {violationRules.map((rule, idx) => {
              const isLast = idx === violationRules.length - 1 && violationRules.length > 1;
              const tierHeading = isLast
                ? `${formatOrdinal(rule.level)}+ Violation`
                : `${formatOrdinal(rule.level)} Violation`;
              const isBan = rule.action === "ban";

              return (
                <div
                  key={idx}
                  className={`rounded-xl border p-4 transition-colors ${
                    isBan
                      ? "border-red-200/80 bg-red-50/20"
                      : "border-amber-200/80 bg-amber-50/25"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold ${
                          isBan
                            ? "bg-red-100 text-red-800"
                            : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {isBan ? <Ban className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                        {tierHeading}
                      </span>
                      <span className="text-xs text-slate-500">
                        {isBan
                          ? `Forbidden from borrowing for ${formatBanDuration(rule.banDays)}`
                          : "Warning only — borrowing stays allowed"}
                      </span>
                    </div>
                    {canManage && violationRules.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveViolationLevel(idx)}
                        title="Remove violation tier"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                    <div className="md:col-span-4">
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Penalty Action
                      </label>
                      <select
                        value={rule.action}
                        onChange={(e) =>
                          updateRule(idx, { action: e.target.value as ViolationActionType })
                        }
                        disabled={!canManage}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white text-slate-800 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:bg-slate-100 disabled:text-slate-400"
                      >
                        <option value="warning">Warning Only (Allow Borrowing)</option>
                        <option value="ban">Forbid Borrowing (Temporary Ban)</option>
                      </select>
                    </div>

                    <div className="md:col-span-4">
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        {isBan ? "Ban Duration (Days)" : "Ban Duration"}
                      </label>
                      {isBan ? (
                        <div>
                          <input
                            type="number"
                            min="1"
                            max="365"
                            value={rule.banDays}
                            onChange={(e) => {
                              const parsed = parseInt(e.target.value, 10);
                              updateRule(idx, {
                                banDays: Number.isNaN(parsed) ? 1 : Math.max(1, parsed),
                              });
                            }}
                            disabled={!canManage}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white text-slate-800 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:bg-slate-100 disabled:text-slate-400"
                          />
                          {canManage && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {BAN_DAY_PRESETS.map((p) => (
                                <button
                                  key={p.days}
                                  type="button"
                                  onClick={() =>
                                    updateRule(idx, {
                                      banDays: p.days,
                                      description: `Student is forbidden from borrowing for ${formatBanDuration(p.days)}.`,
                                    })
                                  }
                                  className={`px-2 py-0.5 rounded text-[11px] font-medium border transition-colors ${
                                    rule.banDays === p.days
                                      ? "bg-emerald-700 text-white border-emerald-700"
                                      : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
                                  }`}
                                >
                                  {p.label}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <input
                          type="text"
                          value="0 days (Warning only)"
                          readOnly
                          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 text-slate-500"
                        />
                      )}
                    </div>

                    <div className="md:col-span-4">
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Tier Name / Label
                      </label>
                      <input
                        type="text"
                        value={rule.label}
                        onChange={(e) => updateRule(idx, { label: e.target.value })}
                        disabled={!canManage}
                        placeholder="e.g., 1-Week Borrowing Ban"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white text-slate-800 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:bg-slate-100 disabled:text-slate-400"
                      />
                    </div>

                    <div className="md:col-span-12">
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Policy Note / Message Shown to Staff &amp; Student
                      </label>
                      <input
                        type="text"
                        value={rule.description}
                        onChange={(e) => updateRule(idx, { description: e.target.value })}
                        disabled={!canManage}
                        placeholder="Describe what happens at this violation level..."
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white text-slate-800 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:bg-slate-100 disabled:text-slate-400"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Summary & Save */}
          <div className="mt-6 pt-5 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="text-xs text-slate-500 space-y-0.5">
              <p className="font-semibold text-slate-700">
                Active Ladder: {formatViolationPolicySummary({ rules: violationRules })}
              </p>
              {policyUpdatedBy && <p>Last updated by: {policyUpdatedBy}</p>}
            </div>

            {canManage && (
              <button
                onClick={handleSaveViolationPolicy}
                disabled={savingPolicy}
                className="px-5 py-2.5 rounded-lg bg-emerald-700 text-white text-sm font-semibold hover:bg-emerald-800 transition-colors disabled:opacity-50 shrink-0"
              >
                {savingPolicy ? "Saving Policy..." : "Save Violation Policy"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* School Years Tab */}
      {activeTab === "school-years" && (
        <div className="space-y-5">
          {/* Active School Year Banner */}
          {activeSchoolYear ? (
            (() => {
              const activeStats = summaryByYearId.get(activeSchoolYear.id);
              const phase = getSchoolYearPhase(activeSchoolYear, serverNow);
              return (
                <div className="bg-emerald-900 text-white rounded-xl p-5 sm:p-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-700/80 text-emerald-100 text-[11px] font-semibold uppercase tracking-wide">
                          <Check className="w-3 h-3" />
                          Active School Year
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                            phase === "In Progress"
                              ? "bg-emerald-500/25 text-emerald-100"
                              : phase === "Upcoming"
                              ? "bg-blue-500/25 text-blue-100"
                              : "bg-amber-500/25 text-amber-100"
                          }`}
                        >
                          {phase}
                        </span>
                      </div>
                      <h3 className="text-xl sm:text-2xl font-bold mt-2">
                        SY {activeSchoolYear.name}
                      </h3>
                      <p className="text-sm text-emerald-200 mt-0.5">
                        {formatSchoolYearDateRange(activeSchoolYear.start_date, activeSchoolYear.end_date)}
                      </p>
                    </div>
                    {canManage && (
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => openEditYearModal(activeSchoolYear)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-medium transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          Edit Dates
                        </button>
                        <button
                          type="button"
                          onClick={openAddYearModal}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white text-emerald-900 hover:bg-emerald-50 text-xs font-semibold transition-colors"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          New School Year
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-4 border-t border-emerald-800">
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-emerald-300">Total Loans</div>
                      <div className="text-lg font-bold mt-0.5">{activeStats?.total_transactions ?? 0}</div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-emerald-300">Borrowed</div>
                      <div className="text-lg font-bold mt-0.5">{activeStats?.currently_borrowed ?? 0}</div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-emerald-300">Returned</div>
                      <div className="text-lg font-bold mt-0.5">{activeStats?.returned ?? 0}</div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-emerald-300">Overdue</div>
                      <div className="text-lg font-bold mt-0.5">{activeStats?.overdue ?? 0}</div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-emerald-300">Violations</div>
                      <div className="text-lg font-bold mt-0.5">{activeStats?.violations_count ?? 0}</div>
                    </div>
                  </div>
                </div>
              );
            })()
          ) : (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm font-bold text-amber-900">No Active School Year Selected</h3>
                  <p className="text-xs text-amber-800 mt-0.5">
                    Set an active school year below (or add a new one) so all new book loans are automatically grouped by academic year.
                  </p>
                </div>
              </div>
              {canManage && (
                <button
                  type="button"
                  onClick={openAddYearModal}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800 transition-colors shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add School Year
                </button>
              )}
            </div>
          )}

          {/* Unassigned legacy transactions sync banner */}
          {unassignedTxCount > 0 && schoolYears.length > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-2.5 text-sm text-blue-900">
                <Sparkles className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold">
                    {unassignedTxCount} older transaction{unassignedTxCount === 1 ? "" : "s"}
                  </span>{" "}
                  not yet tagged with a school year ID. Sync them automatically based on each loan&apos;s borrow date.
                </div>
              </div>
              {canManage && (
                <button
                  type="button"
                  onClick={handleSyncUnassigned}
                  disabled={syncingUnassigned}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-700 text-white text-xs font-semibold hover:bg-blue-800 transition-colors disabled:opacity-50 shrink-0"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${syncingUnassigned ? "animate-spin" : ""}`} />
                  {syncingUnassigned ? "Syncing..." : "Sync to School Years"}
                </button>
              )}
            </div>
          )}

          <div className="bg-white rounded-xl border border-slate-200 p-5 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-800">All School Years</h3>
                <p className="text-sm text-slate-600 mt-0.5">
                  New checkouts are automatically tagged with the active school year. You can also filter Transactions and Reports by any school year.
                </p>
              </div>
              {canManage && (
                <button
                  type="button"
                  onClick={openAddYearModal}
                  className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-emerald-700 text-white text-sm font-medium hover:bg-emerald-800 transition-colors shrink-0 self-start sm:self-auto"
                >
                  <Plus className="w-4 h-4" />
                  Add School Year
                </button>
              )}
            </div>

            {!canManage && (
              <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
                {STAFF_RESTRICTED_MESSAGE} School years are read-only for your account.
              </div>
            )}

            {yearFeedback && (
              <div
                className={`mb-4 p-3 rounded-lg border text-sm flex items-center gap-2 ${
                  yearFeedback.type === "success"
                    ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                    : "bg-red-50 border-red-200 text-red-700"
                }`}
              >
                {yearFeedback.type === "success" ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                )}
                <span>{yearFeedback.message}</span>
              </div>
            )}

            {/* Years List */}
            <div className="space-y-3">
              {schoolYears.map((year) => {
                const stats = summaryByYearId.get(year.id);
                const phase = getSchoolYearPhase(year, serverNow);
                const isActivating = activatingYearId === year.id;

                return (
                  <div
                    key={year.id}
                    className={`flex flex-col md:flex-row md:items-center justify-between gap-3 p-4 rounded-xl border transition-colors ${
                      year.is_active
                        ? "border-emerald-300 bg-emerald-50/60"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-slate-900">SY {year.name}</span>
                        {year.is_active && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-700 text-white text-[11px] font-semibold">
                            <Check className="w-3 h-3" />
                            Active
                          </span>
                        )}
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                            phase === "In Progress"
                              ? "bg-emerald-100 text-emerald-700"
                              : phase === "Upcoming"
                              ? "bg-blue-100 text-blue-700"
                              : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {phase}
                        </span>
                      </div>

                      <div className="text-xs text-slate-500 mt-1">
                        {formatSchoolYearDateRange(year.start_date, year.end_date)}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 mt-2">
                        <span>
                          <strong className="text-slate-800">{stats?.total_transactions ?? 0}</strong> loans
                        </span>
                        <span className="text-slate-300">•</span>
                        <span>
                          <strong className="text-slate-800">{stats?.unique_students ?? 0}</strong> students
                        </span>
                        <span className="text-slate-300">•</span>
                        <span>
                          <strong className="text-emerald-700">{stats?.currently_borrowed ?? 0}</strong> borrowed
                        </span>
                        <span className="text-slate-300">•</span>
                        <span>
                          <strong className={(stats?.overdue ?? 0) > 0 ? "text-red-600" : "text-slate-700"}>
                            {stats?.overdue ?? 0}
                          </strong>{" "}
                          overdue
                        </span>
                        <span className="text-slate-300">•</span>
                        <span>
                          <strong className={(stats?.violations_count ?? 0) > 0 ? "text-amber-700" : "text-slate-700"}>
                            {stats?.violations_count ?? 0}
                          </strong>{" "}
                          violations
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {!year.is_active && canManage && (
                        <button
                          type="button"
                          onClick={() => handleSetActiveYear(year)}
                          disabled={!!activatingYearId}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 transition-colors disabled:opacity-50"
                        >
                          <Check className="w-3.5 h-3.5" />
                          {isActivating ? "Activating..." : "Set Active"}
                        </button>
                      )}
                      {canManage && (
                        <button
                          type="button"
                          onClick={() => openEditYearModal(year)}
                          title="Edit school year"
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          Edit
                        </button>
                      )}
                      {!year.is_active && canManage && (
                        <button
                          type="button"
                          onClick={() => {
                            setModalError(null);
                            setYearToDelete(year);
                          }}
                          title="Delete school year"
                          className="p-1.5 rounded-lg border border-red-200/80 text-red-500 hover:text-red-700 hover:bg-red-50 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {schoolYears.length === 0 && (
                <p className="text-center text-slate-400 py-8">No school years configured yet.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Staff Management Tab */}
      {activeTab === "staff" && session?.role === "Admin" && (
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-slate-800">Staff Management</h3>
            <button
              onClick={() => { setModalError(null); setShowAddStaff(true); }}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-700 text-white text-sm font-medium hover:bg-emerald-800 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Staff
            </button>
          </div>
          <p className="text-sm text-slate-600 mb-4">
            Manage staff accounts and their access levels.
          </p>

          {/* Staff List */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">Staff ID</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">Name</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">Role</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">Status</th>
                  <th className="text-right px-4 py-3 font-semibold text-slate-600">Actions</th>
                </tr>
              </thead>
              <tbody>
                {staffList.map((staff) => (
                  <tr key={staff.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-slate-800">{staff.staff_id}</td>
                    <td className="px-4 py-3 text-slate-800">{staff.name}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        staff.role === "Admin" ? "bg-purple-100 text-purple-700" :
                        staff.role === "Librarian" ? "bg-blue-100 text-blue-700" :
                        "bg-slate-100 text-slate-700"
                      }`}>
                        {staff.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`flex items-center gap-1 text-xs font-medium ${
                        staff.is_active ? "text-emerald-600" : "text-slate-400"
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${staff.is_active ? "bg-emerald-500" : "bg-slate-300"}`} />
                        {staff.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                        <div className="flex items-center gap-2 justify-end">
                          <button
                            onClick={() => { setModalError(null); setNewPassword(""); setPasswordStaff(staff); }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors"
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                            Set Password
                          </button>
                          <button
                            onClick={() => { setModalError(null); setStaffToDelete(staff); }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 bg-white text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Delete
                          </button>
                        </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {staffList.length === 0 && (
              <p className="text-center text-slate-400 py-8">No staff members configured.</p>
            )}
          </div>
        </div>
      )}

      {/* Add School Year Modal */}
      <Modal
        open={showAddYear}
        onClose={() => !modalBusy && setShowAddYear(false)}
        title="Add School Year"
        subtitle="Create a new academic year for library circulation and reports."
        footer={
          <>
            <button
              type="button"
              onClick={() => setShowAddYear(false)}
              disabled={modalBusy}
              className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAddYear}
              disabled={modalBusy}
              className="px-4 py-2 rounded-lg bg-emerald-700 text-white text-sm font-medium hover:bg-emerald-800 transition-colors disabled:opacity-50"
            >
              {modalBusy ? "Saving..." : "Save School Year"}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {modalError && showAddYear && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              {modalError}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Year Name</label>
            <input
              type="text"
              placeholder="e.g., 2026-2027"
              value={newYearName}
              onChange={(e) => setNewYearName(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-slate-500">Quick Calendar Presets</span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => applyCalendarPreset("jun-may", "add")}
                  className="px-2 py-0.5 rounded border border-slate-200 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                >
                  Jun 1 – May 31
                </button>
                <button
                  type="button"
                  onClick={() => applyCalendarPreset("aug-may", "add")}
                  className="px-2 py-0.5 rounded border border-slate-200 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                >
                  Aug 1 – May 31
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Start Date</label>
                <input
                  type="date"
                  value={newYearStart}
                  onChange={(e) => setNewYearStart(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">End Date</label>
                <input
                  type="date"
                  value={newYearEnd}
                  onChange={(e) => setNewYearEnd(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>
            </div>
          </div>
          <label className="flex items-center gap-2.5 pt-1 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={newYearSetActive}
              onChange={(e) => setNewYearSetActive(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
            />
            <span className="text-sm text-slate-700">Set as active school year immediately</span>
          </label>
        </div>
      </Modal>

      {/* Edit School Year Modal */}
      <Modal
        open={!!editingYear}
        onClose={() => !modalBusy && setEditingYear(null)}
        title="Edit School Year"
        subtitle={editingYear ? `Update name or date range for SY ${editingYear.name}.` : undefined}
        footer={
          <>
            <button
              type="button"
              onClick={() => setEditingYear(null)}
              disabled={modalBusy}
              className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleUpdateYear}
              disabled={modalBusy}
              className="px-4 py-2 rounded-lg bg-emerald-700 text-white text-sm font-medium hover:bg-emerald-800 transition-colors disabled:opacity-50"
            >
              {modalBusy ? "Saving..." : "Save Changes"}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {modalError && editingYear && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              {modalError}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Year Name</label>
            <input
              type="text"
              value={editYearName}
              onChange={(e) => setEditYearName(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-slate-500">Quick Calendar Presets</span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => applyCalendarPreset("jun-may", "edit")}
                  className="px-2 py-0.5 rounded border border-slate-200 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                >
                  Jun 1 – May 31
                </button>
                <button
                  type="button"
                  onClick={() => applyCalendarPreset("aug-may", "edit")}
                  className="px-2 py-0.5 rounded border border-slate-200 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                >
                  Aug 1 – May 31
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Start Date</label>
                <input
                  type="date"
                  value={editYearStart}
                  onChange={(e) => setEditYearStart(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">End Date</label>
                <input
                  type="date"
                  value={editYearEnd}
                  onChange={(e) => setEditYearEnd(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>
            </div>
          </div>
        </div>
      </Modal>

      {/* Add Staff Modal */}
      <Modal
        open={showAddStaff}
        onClose={() => setShowAddStaff(false)}
        title="Add Staff"
        subtitle="Create a new staff account."
        footer={
          <>
            <button onClick={() => setShowAddStaff(false)} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">Cancel</button>
            <button onClick={handleAddStaff} disabled={modalBusy} className="px-4 py-2 rounded-lg bg-emerald-700 text-white text-sm font-medium hover:bg-emerald-800 transition-colors disabled:opacity-50">{modalBusy ? "Saving..." : "Save"}</button>
          </>
        }
      >
        <div className="space-y-4">
          {modalError && showAddStaff && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{modalError}</div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Staff ID</label>
              <input type="text" placeholder="e.g., STAFF001" value={newStaff.staff_id} onChange={(e) => setNewStaff({ ...newStaff, staff_id: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
              <input type="text" placeholder="Full name" value={newStaff.name} onChange={(e) => setNewStaff({ ...newStaff, name: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
              <input type="password" placeholder="Enter password" value={newStaff.password} onChange={(e) => setNewStaff({ ...newStaff, password: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
              <select value={newStaff.role} onChange={(e) => setNewStaff({ ...newStaff, role: e.target.value as StaffRole })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm">
                <option value="Staff">Staff</option>
                <option value="Librarian">Librarian</option>
                <option value="Admin">Admin</option>
              </select>
            </div>
          </div>
        </div>
      </Modal>

      {/* Set Password Modal */}
      <Modal
        open={!!passwordStaff}
        onClose={() => { setPasswordStaff(null); setNewPassword(""); setModalError(null); }}
        title="Set Password"
        subtitle={passwordStaff ? `Update password for ${passwordStaff.name} (${passwordStaff.staff_id})` : undefined}
        size="sm"
        footer={
          <>
            <button onClick={() => { setPasswordStaff(null); setNewPassword(""); }} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">Cancel</button>
            <button onClick={handleSetPassword} disabled={modalBusy} className="px-4 py-2 rounded-lg bg-emerald-700 text-white text-sm font-medium hover:bg-emerald-800 transition-colors disabled:opacity-50">{modalBusy ? "Saving..." : "Update"}</button>
          </>
        }
      >
        {modalError && passwordStaff && <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{modalError}</div>}
        <label className="block text-sm font-medium text-slate-700 mb-1">New Password</label>
        <input type="password" placeholder="Enter new password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500" />
      </Modal>

      <ConfirmModal
        open={!!yearToDelete}
        onClose={() => !modalBusy && setYearToDelete(null)}
        onConfirm={handleDeleteYear}
        title="Delete School Year"
        message={
          yearToDelete
            ? (() => {
                const count = summaryByYearId.get(yearToDelete.id)?.total_transactions ?? 0;
                return count > 0
                  ? `Delete school year "${yearToDelete.name}"? Its ${count} circulation transaction record${count === 1 ? "" : "s"} will be kept safely in the system (unlinked from this school year).`
                  : `Delete school year "${yearToDelete.name}"? This school year has no linked transactions and will be archived.`;
              })()
            : ""
        }
        confirming={modalBusy}
      />
      <ConfirmModal
        open={!!staffToDelete}
        onClose={() => setStaffToDelete(null)}
        onConfirm={handleDeleteStaff}
        title="Delete Staff"
        message={staffToDelete ? `Delete staff "${staffToDelete.name}" (${staffToDelete.staff_id})? This cannot be undone.` : ""}
        confirming={modalBusy}
      />
    </>
  );
}
