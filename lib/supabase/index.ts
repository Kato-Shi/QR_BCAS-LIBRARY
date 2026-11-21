export {
  getClassifications,
  getClassificationById,
  createClassification,
  deleteClassification,
} from "./classifications";

export {
  getBooks,
  getBookById,
  getBookByAccessionNumber,
  searchBooks,
  getBooksByClassification,
  getAvailableBooks,
  getBorrowableBooks,
  getLibraryUseOnlyBooks,
  createBook,
  updateBook,
  updateBookStatus,
  updateBookNotes,
  deleteBook,
  createBooks,
} from "./books";

export {
  getStudents,
  getStudentById,
  getStudentByNumber,
  searchStudents,
  createStudent,
  updateStudent,
  upsertStudent,
  upsertStudents,
  deleteStudent,
  getStudentCount,
} from "./students";

export {
  getTransactions,
  getActiveTransactions,
  getStudentTransactions,
  getTransactionById,
  getStudentBorrowCount,
  canStudentBorrow,
  borrowBook,
  returnBook,
  updateTransactionDetails,
  deleteTransaction,
  updateOverdueStatus,
  getOverdueTransactions,
  getDaysOverdue,
  computeEffectiveFine,
  calculateFineAmount,
} from "./transactions";

export {
  recordVisit,
  getStudentVisits,
  getStudentVisitCount,
  getStudentVisitCountInRange,
  getTodayVisitCount,
} from "./visits";

export {
  getNotifications,
  getUnreadNotifications,
  getUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
  getStudentNotifications,
  getNotificationsWithDetails,
} from "./notifications";

export {
  getDashboardStats,
  getOverdueBooks,
  getCirculationByClassification,
  getMostBorrowedBooks,
  getActiveUsers,
  getCirculationActivity,
  getWeekBounds,
  buildWeeklyCirculationFromTransactions,
  toLocalDateKey,
  getTopVisitors,
  getTopBorrowers,
} from "./dashboard";
export type {
  DailyCirculation,
  WeeklyCirculationDay,
  WeekBounds,
} from "./dashboard";

export {
  getFineSettings,
  updateFineSettings,
  calculateFine,
  payFine,
  updateTransactionFine,
  getStudentFines,
  getPendingFinesTotal,
  getPaidFinesTotal,
  getFinesLedger,
} from "./fines";
export type { FineLedgerItem } from "./fines";

export {
  DEFAULT_VIOLATION_RULES,
  getDefaultViolationPolicy,
  getViolationPolicy,
  saveViolationPolicy,
  getRuleForOffense,
  isTransactionViolation,
  evaluateAllStudentViolations,
  getStudentViolationStatus,
  setTransactionViolationCleared,
  buildTopBorrowingStudents,
  formatOrdinal,
  formatBanDuration,
  formatViolationPolicySummary,
} from "./violations";
export type { ViolationEvaluationBundle } from "./violations";

export {
  SCHOOL_YEAR_CHANGED_EVENT,
  parseSchoolYearDate,
  formatSchoolYearDate,
  formatSchoolYearDateRange,
  getSchoolYearPhase,
  suggestNextSchoolYear,
  resolveTransactionSchoolYearId,
  buildSchoolYearSummaries,
  getSchoolYears,
  getActiveSchoolYear,
  createSchoolYear,
  updateSchoolYear,
  setActiveSchoolYear,
  deleteSchoolYear,
  countUnassignedTransactions,
  assignUnassignedTransactionsToSchoolYears,
  getSchoolYearSummaries,
} from "./school-years";

export {
  getStaff,
  getActiveStaff,
  getStaffByUserId,
  createStaff,
  updateStaff,
  deleteStaff,
  isStaffActive,
  getStaffRole,
  setStaffPassword,
  setStaffPasswordByUserId,
} from "./staff";

export {
  logActivity,
  getActivityLogs,
  deleteActivityLog,
  getCurrentActor,
} from "./activity-logs";

export {
  archiveRecord,
  getArchivedRecords,
  restoreArchivedBook,
  permanentlyDeleteArchived,
} from "./archive";
