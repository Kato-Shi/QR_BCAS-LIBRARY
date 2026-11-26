-- ============================================================
-- 008: Expand material_type enum to support additional library
-- materials (Magazines, Journals, Newspapers, Theses, Other).
-- Safe to run multiple times (IF NOT EXISTS).
-- ============================================================

ALTER TYPE material_type ADD VALUE IF NOT EXISTS 'Magazine';
ALTER TYPE material_type ADD VALUE IF NOT EXISTS 'Journal';
ALTER TYPE material_type ADD VALUE IF NOT EXISTS 'Newspaper';
ALTER TYPE material_type ADD VALUE IF NOT EXISTS 'Thesis';
ALTER TYPE material_type ADD VALUE IF NOT EXISTS 'Other Material';
