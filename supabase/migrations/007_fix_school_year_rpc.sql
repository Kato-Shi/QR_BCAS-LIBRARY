-- ============================================================
-- BCAS Library Management System - School Year Function & FK Fix
-- 007_fix_school_year_rpc.sql (Optional — client already handles safely)
-- ============================================================

-- 1. Fix set_active_school_year() so UPDATE includes a WHERE clause
--    (prevents Supabase safe-update errors)
CREATE OR REPLACE FUNCTION set_active_school_year(p_school_year_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE school_years
  SET is_active = false
  WHERE is_active = true AND id <> p_school_year_id;

  UPDATE school_years
  SET is_active = true
  WHERE id = p_school_year_id;
END;
$$ LANGUAGE plpgsql;

-- 2. Update assign_school_year() trigger so an explicit school_year_id
--    from the app is respected and falls back to the active school year
CREATE OR REPLACE FUNCTION assign_school_year()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.school_year_id IS NULL THEN
    NEW.school_year_id := (
      SELECT id FROM school_years
      WHERE is_active = true
      ORDER BY start_date DESC
      LIMIT 1
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Ensure deleting an inactive school year safely preserves transactions
DO $$
DECLARE
  fk_name TEXT;
BEGIN
  SELECT tc.constraint_name INTO fk_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema = kcu.table_schema
  WHERE tc.table_name = 'borrowing_transactions'
    AND kcu.column_name = 'school_year_id'
    AND tc.constraint_type = 'FOREIGN KEY'
  LIMIT 1;

  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE borrowing_transactions DROP CONSTRAINT %I', fk_name);
    ALTER TABLE borrowing_transactions
      ADD CONSTRAINT borrowing_transactions_school_year_id_fkey
      FOREIGN KEY (school_year_id) REFERENCES school_years(id) ON DELETE SET NULL;
  END IF;
END
$$;
