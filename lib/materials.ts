import type { Book, BookWithClassification, MaterialType } from "@/lib/types";

export const LIBRARY_MATERIAL_TYPES = [
  "Book",
  "Magazine",
  "Journal",
  "Newspaper",
  "Thesis",
  "Other Material",
] as const;

export type LibraryMaterialType = (typeof LIBRARY_MATERIAL_TYPES)[number];

export interface MaterialTypeMeta {
  value: LibraryMaterialType;
  label: string;
  plural: string;
  creatorLabel: string;
  creatorPlaceholder: string;
  notesPlaceholder: string;
  badgeClass: string;
}

export const MATERIAL_TYPE_META: Record<LibraryMaterialType, MaterialTypeMeta> = {
  Book: {
    value: "Book",
    label: "Book",
    plural: "Books",
    creatorLabel: "Author",
    creatorPlaceholder: "e.g. Jose Rizal",
    notesPlaceholder: "Edition, ISBN, or condition notes...",
    badgeClass: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  },
  Magazine: {
    value: "Magazine",
    label: "Magazine",
    plural: "Magazines",
    creatorLabel: "Publisher / Editor",
    creatorPlaceholder: "e.g. National Geographic Society",
    notesPlaceholder: "Volume, Issue #, Publication Month/Year...",
    badgeClass: "bg-purple-50 text-purple-700 border border-purple-200",
  },
  Journal: {
    value: "Journal",
    label: "Journal",
    plural: "Journals",
    creatorLabel: "Publisher / Organization",
    creatorPlaceholder: "e.g. IEEE / Philippine Journal of Science",
    notesPlaceholder: "Volume, Issue, ISSN, Publication Year...",
    badgeClass: "bg-blue-50 text-blue-700 border border-blue-200",
  },
  Newspaper: {
    value: "Newspaper",
    label: "Newspaper",
    plural: "Newspapers",
    creatorLabel: "Publication / Publisher",
    creatorPlaceholder: "e.g. Philippine Daily Inquirer",
    notesPlaceholder: "Issue Date, Edition, Section...",
    badgeClass: "bg-slate-100 text-slate-700 border border-slate-300",
  },
  Thesis: {
    value: "Thesis",
    label: "Thesis",
    plural: "Theses",
    creatorLabel: "Researcher(s) / Author",
    creatorPlaceholder: "e.g. Dela Cruz, Juan M. et al.",
    notesPlaceholder: "Degree / Program, Academic Year, Adviser...",
    badgeClass: "bg-amber-50 text-amber-800 border border-amber-200",
  },
  "Other Material": {
    value: "Other Material",
    label: "Other Material",
    plural: "Other Materials",
    creatorLabel: "Creator / Source",
    creatorPlaceholder: "e.g. Department of Education",
    notesPlaceholder: "Format (DVD, Map, Pamphlet, Kit, Audio) & details...",
    badgeClass: "bg-teal-50 text-teal-700 border border-teal-200",
  },
};

const MATERIAL_TAG_REGEX = /^\[Material:\s*([^\]]+)\]\s*/i;

export function normalizeMaterialType(
  raw: string | null | undefined
): LibraryMaterialType {
  const cleaned = (raw ?? "").trim().toLowerCase();
  switch (cleaned) {
    case "book":
    case "books":
      return "Book";
    case "magazine":
    case "magazines":
      return "Magazine";
    case "journal":
    case "journals":
      return "Journal";
    case "newspaper":
    case "newspapers":
      return "Newspaper";
    case "thesis":
    case "theses":
    case "dissertation":
      return "Thesis";
    case "other material":
    case "other materials":
    case "other":
    case "non-book":
    case "non book":
      return "Other Material";
    default:
      return "Book";
  }
}

export function getMaterialMeta(type: MaterialType | string | null | undefined): MaterialTypeMeta {
  return MATERIAL_TYPE_META[normalizeMaterialType(type)];
}

export function stripMaterialTag(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const cleaned = notes.replace(MATERIAL_TAG_REGEX, "").trim();
  return cleaned.length > 0 ? cleaned : null;
}

export function encodeMaterialInNotes(
  materialType: LibraryMaterialType,
  notes: string | null | undefined
): string | null {
  const cleanNotes = stripMaterialTag(notes);
  if (materialType === "Book") return cleanNotes;
  return cleanNotes
    ? `[Material: ${materialType}] ${cleanNotes}`
    : `[Material: ${materialType}]`;
}

/**
 * Hydrates a raw book row from Supabase so both native enum values (post-migration 008)
 * and fallback-tagged `Non-Book` rows (pre-migration 008) present the exact material type
 * and clean user-facing notes everywhere in the app.
 */
export function normalizeBookMaterial<
  T extends Pick<Book, "material_type" | "notes">
>(row: T): T {
  if (!row) return row;

  const rawType = String(row.material_type ?? "Book");
  const rawNotes = typeof row.notes === "string" ? row.notes : null;
  const tagMatch = rawNotes ? rawNotes.match(MATERIAL_TAG_REGEX) : null;

  let resolvedType: LibraryMaterialType;
  if (rawType === "Non-Book" && tagMatch?.[1]) {
    resolvedType = normalizeMaterialType(tagMatch[1]);
  } else if (rawType === "Non-Book") {
    resolvedType = "Other Material";
  } else {
    resolvedType = normalizeMaterialType(rawType);
  }

  return {
    ...row,
    material_type: resolvedType,
    notes: stripMaterialTag(rawNotes),
  };
}

export function normalizeBookWithClassification(
  row: BookWithClassification
): BookWithClassification {
  return normalizeBookMaterial(row);
}

export function isMaterialEnumError(error: unknown): boolean {
  const code = String((error as { code?: unknown })?.code ?? "");
  const msg = String(
    (error as { message?: unknown })?.message ??
      (error instanceof Error ? error.message : error ?? "")
  );
  return (
    code === "22P02" ||
    /invalid input value for enum\s+material_type/i.test(msg)
  );
}
