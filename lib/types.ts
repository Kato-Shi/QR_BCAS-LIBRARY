// ============================================================
// Database Row Types (mirrors Supabase table schemas)
// ============================================================

export type BookStatus = "Available" | "Borrowed" | "Lost" | "Damaged";
export type MaterialType = "Book" | "Non-Book";
export type BorrowStatus = "Active" | "Returned" | "Overdue";
export type StaffRole = "Admin" | "Librarian" | "Staff";

export interface Classification {
  id: string;
  name: string;
  created_at: string;
}

export interface Student {
  id: string;
  student_number: string | null;
  name: string;
  first_name: string | null;
  last_name: string | null;
  middle_name: string | null;
  grade_level: string | null;
  program: string | null;
  section: string;
  created_at: string;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  accession_number: string;
  classification_id: string;
  shelf_location: string | null;
  material_type: MaterialType;
  status: BookStatus;
  is_library_use_only: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface BorrowingTransaction {
  id: string;
  student_id: string;
  book_id: string;
  date_borrowed: string;
  date_returned: string | null;
  due_date: string;
  status: BorrowStatus;
  fine_amount: number;
  fine_paid: boolean;
  school_year_id: string | null;
  handled_by_staff_id: string | null;
  handled_by_name: string | null;
  handled_by_role: StaffRole | null;
  created_at: string;
}

export interface FineSetting {
  id: string;
  fine_rate_per_day: number;
  max_fine: number;
  created_at: string;
}

export type ViolationActionType = "warning" | "ban";

export interface ViolationRule {
  /** 1-based offense number (1 = 1st violation, 2 = 2nd, etc. Last rule applies to Nth and above). */
  level: number;
  label: string;
  action: ViolationActionType;
  /** Number of days the student is forbidden from borrowing (0 when action === "warning"). */
  banDays: number;
  description: string;
}

export interface ViolationPolicy {
  id?: string;
  rules: ViolationRule[];
  updatedAt?: string;
  updatedBy?: string | null;
}

export interface StudentViolationIncident {
  transactionId: string;
  studentId: string;
  studentName: string;
  studentNumber: string;
  studentSection: string;
  bookTitle: string;
  bookAuthor: string;
  accessionNumber: string;
  category: string;
  dateBorrowed: string;
  dueDate: string;
  dateReturned: string | null;
  status: BorrowStatus;
  daysOverdue: number;
  overdueLabel: string;
  /** Offense number for this student (1, 2, 3, ...), or 0 if forgiven/cleared. */
  offenseNumber: number;
  ruleApplied: ViolationRule | null;
  cleared: boolean;
}

export interface StudentViolationStatus {
  studentId: string;
  studentName: string;
  studentNumber: string;
  studentSection: string;
  gradeLevel: string;
  program: string;
  activeViolationCount: number;
  clearedViolationCount: number;
  currentRule: ViolationRule | null;
  isBanned: boolean;
  /** True when the student has an active unreturned overdue item triggering a ban. */
  blockedByUnreturnedOverdue: boolean;
  banStartsAt: string | null;
  banEndsAt: string | null;
  banRemainingLabel: string | null;
  standingLabel: string;
  standingTone: "emerald" | "amber" | "red";
  incidents: StudentViolationIncident[];
  latestViolationAt: string | null;
}

export interface TopBorrowerStudentRow {
  rank: number;
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
  activeViolations: number;
  standingLabel: string;
  standingTone: "emerald" | "amber" | "red";
  lastBorrowedAt: string;
}

export interface SchoolYear {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
  created_at: string;
}

export interface Staff {
  id: string;
  staff_id: string;
  name: string;
  role: StaffRole;
  is_active: boolean;
  password_hash: string | null;
  created_at: string;
}

export interface StudentFine {
  student_id: string;
  student_name: string;
  student_number: string | null;
  total_transactions: number;
  transactions_with_fines: number;
  total_fines: number;
  fines_paid: number;
  fines_pending: number;
}

export interface SchoolYearSummary {
  school_year_id: string;
  school_year_name: string;
  start_date?: string;
  end_date?: string;
  is_active?: boolean;
  total_transactions: number;
  currently_borrowed: number;
  returned: number;
  overdue: number;
  violations_count?: number;
  unique_students?: number;
  total_fines: number;
  fines_collected: number;
}

export interface LibraryVisit {
  id: string;
  student_id: string;
  visited_at: string;
}

export interface Notification {
  id: string;
  student_id: string;
  book_id: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

export interface NotificationWithDetails extends Notification {
  students: Pick<Student, "id" | "name" | "student_number" | "section">;
  books: Pick<Book, "id" | "title" | "author">;
}

// ============================================================
// Extended / Joined Types (for views & queries)
// ============================================================

export interface BookWithClassification extends Book {
  classifications: Pick<Classification, "id" | "name">;
}

export interface BorrowingTransactionWithDetails extends BorrowingTransaction {
  students: Pick<Student, "id" | "name" | "section" | "student_number" | "first_name" | "last_name" | "middle_name" | "grade_level" | "program">;
  books: BookWithClassification;
}

export interface OverdueBookRow {
  transaction_id: string;
  student_id: string;
  student_name: string;
  student_section: string;
  book_id: string;
  book_title: string;
  book_author: string;
  accession_number: string;
  classification_id: string;
  classification_name: string;
  date_borrowed: string;
  due_date: string;
  days_overdue: number;
}

export interface DashboardStats {
  total_borrowed: number;
  total_returned: number;
  total_overdue: number;
}

export interface CirculationByClassification {
  classification_name: string;
  total_transactions: number;
  currently_borrowed: number;
  returned: number;
}

export interface MostBorrowedBookRow {
  id: string;
  title: string;
  author: string;
  classification_name: string;
  borrow_count: number;
  current_status: BookStatus;
}

export interface ActiveUserRow {
  id: string;
  name: string;
  section: string;
  total_visits: number;
  total_borrowed: number;
}

// ============================================================
// Activity Log + Delete Archive (audit trail)
// ============================================================

export type ActivityAction =
  | "ADD"
  | "EDIT"
  | "DELETE"
  | "BORROW"
  | "RETURN"
  | "RESTORE"
  | "PERMANENT_DELETE";

export type ActivityEntity =
  | "book"
  | "transaction"
  | "student"
  | "staff"
  | "school_year"
  | "fine"
  | "archive";

export interface ActorInfo {
  staffId: string;
  name: string;
  role: StaffRole;
}

export interface ActivityLog {
  id: string;
  staff_id: string | null;
  staff_name: string | null;
  staff_role: StaffRole | null;
  action: ActivityAction;
  entity_type: ActivityEntity;
  entity_id: string | null;
  description: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface ArchivedRecord {
  id: string;
  entity_type: string;
  entity_id: string | null;
  data: Record<string, unknown> | null;
  deleted_by_staff_id: string | null;
  deleted_by_name: string | null;
  deleted_by_role: StaffRole | string | null;
  deleted_at: string;
  restored: boolean;
}


