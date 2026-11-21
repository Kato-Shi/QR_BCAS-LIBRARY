-- ============================================================
-- BCAS Library Management System - Student Violations Policy
-- 006_student_violations.sql
--
-- Replaces monetary fine enforcement with configurable student
-- violation escalation tiers (Warning -> Borrowing Bans).
-- ============================================================

CREATE TABLE IF NOT EXISTS violation_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rules JSONB NOT NULL,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed default 4-tier escalation policy if empty
INSERT INTO violation_settings (rules, updated_by)
SELECT
  '[
    {
      "level": 1,
      "label": "1st Violation — Warning",
      "action": "warning",
      "banDays": 0,
      "description": "Issue an official warning. Student may still borrow books."
    },
    {
      "level": 2,
      "label": "2nd Violation — Short Ban",
      "action": "ban",
      "banDays": 3,
      "description": "Student is forbidden from borrowing for 3 days."
    },
    {
      "level": 3,
      "label": "3rd Violation — 1-Week Ban",
      "action": "ban",
      "banDays": 7,
      "description": "Student is forbidden from borrowing for 1 week (7 days)."
    },
    {
      "level": 4,
      "label": "4th+ Violation — 1-Month Ban",
      "action": "ban",
      "banDays": 30,
      "description": "Student is forbidden from borrowing for 1 month (30 days)."
    }
  ]'::jsonb,
  'System Default'
WHERE NOT EXISTS (SELECT 1 FROM violation_settings);

-- Row Level Security (mirrors existing staff policies)
ALTER TABLE violation_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'violation_settings'
      AND policyname = 'Staff can read violation_settings'
  ) THEN
    CREATE POLICY "Staff can read violation_settings"
      ON violation_settings FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'violation_settings'
      AND policyname = 'Staff can insert violation_settings'
  ) THEN
    CREATE POLICY "Staff can insert violation_settings"
      ON violation_settings FOR INSERT WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'violation_settings'
      AND policyname = 'Staff can update violation_settings'
  ) THEN
    CREATE POLICY "Staff can update violation_settings"
      ON violation_settings FOR UPDATE USING (true);
  END IF;
END
$$;
