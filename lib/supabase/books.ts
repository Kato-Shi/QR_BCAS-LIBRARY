import { createClient } from "@/utils/client";
import { logActivity, getCurrentActor } from "@/lib/supabase/activity-logs";
import { archiveRecord } from "@/lib/supabase/archive";
import { ensureServerNow } from "@/lib/server-clock";
import {
  encodeMaterialInNotes,
  isMaterialEnumError,
  normalizeBookMaterial,
  normalizeMaterialType,
  stripMaterialTag,
} from "@/lib/materials";
import type { ActorInfo, Book, BookWithClassification, BookStatus } from "@/lib/types";

const supabase = createClient();

type BookInsert = Omit<Book, "id" | "created_at" | "updated_at">;
type BookUpdate = Partial<Omit<Book, "id" | "created_at" | "updated_at">>;

// ── Read ──────────────────────────────────────────────────────

export async function getBooks(): Promise<BookWithClassification[]> {
  const { data, error } = await supabase
    .from("books")
    .select("*, classifications(id, name)")
    .order("title");

  if (error) throw error;
  return (data ?? []).map((b: BookWithClassification) => normalizeBookMaterial(b));
}

export async function getBookById(id: string): Promise<BookWithClassification | null> {
  const { data, error } = await supabase
    .from("books")
    .select("*, classifications(id, name)")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data ? normalizeBookMaterial(data as BookWithClassification) : null;
}

export async function getBookByAccessionNumber(accessionNumber: string): Promise<BookWithClassification | null> {
  const { data, error } = await supabase
    .from("books")
    .select("*, classifications(id, name)")
    .eq("accession_number", accessionNumber)
    .single();

  if (error) throw error;
  return data ? normalizeBookMaterial(data as BookWithClassification) : null;
}

export async function searchBooks(query: string): Promise<BookWithClassification[]> {
  const { data, error } = await supabase
    .from("books")
    .select("*, classifications(id, name)")
    .or(`title.ilike.%${query}%,author.ilike.%${query}%,accession_number.ilike.%${query}%`)
    .order("title");

  if (error) throw error;
  return (data ?? []).map((b: BookWithClassification) => normalizeBookMaterial(b));
}

export async function getBooksByClassification(classificationId: string): Promise<BookWithClassification[]> {
  const { data, error } = await supabase
    .from("books")
    .select("*, classifications(id, name)")
    .eq("classification_id", classificationId)
    .order("title");

  if (error) throw error;
  return (data ?? []).map((b: BookWithClassification) => normalizeBookMaterial(b));
}

export async function getAvailableBooks(): Promise<BookWithClassification[]> {
  const { data, error } = await supabase
    .from("books")
    .select("*, classifications(id, name)")
    .eq("status", "Available")
    .eq("is_library_use_only", false)
    .order("title");

  if (error) throw error;
  return (data ?? []).map((b: BookWithClassification) => normalizeBookMaterial(b));
}

export async function getBorrowableBooks(): Promise<BookWithClassification[]> {
  const { data, error } = await supabase
    .from("books")
    .select("*, classifications(id, name)")
    .eq("status", "Available")
    .eq("is_library_use_only", false)
    .order("title");

  if (error) throw error;
  return (data ?? []).map((b: BookWithClassification) => normalizeBookMaterial(b));
}

export async function getLibraryUseOnlyBooks(): Promise<BookWithClassification[]> {
  const { data, error } = await supabase
    .from("books")
    .select("*, classifications(id, name)")
    .eq("is_library_use_only", true)
    .order("title");

  if (error) throw error;
  return (data ?? []).map((b: BookWithClassification) => normalizeBookMaterial(b));
}

// ── Write ──────────────────────────────────────────────────────

export async function createBook(book: BookInsert, actor?: ActorInfo | null): Promise<Book> {
  const resolvedType = normalizeMaterialType(book.material_type);
  const cleanNotes = stripMaterialTag(book.notes);

  let { data, error } = await supabase
    .from("books")
    .insert({
      ...book,
      material_type: resolvedType,
      notes: cleanNotes,
    })
    .select()
    .single();

  // Pre-008-migration DBs only accept 'Book' | 'Non-Book' on the enum:
  // fall back cleanly to 'Non-Book' with an encoded [Material: ...] tag in notes.
  if (error && isMaterialEnumError(error) && resolvedType !== "Book") {
    const retry = await supabase
      .from("books")
      .insert({
        ...book,
        material_type: "Non-Book",
        notes: encodeMaterialInNotes(resolvedType, cleanNotes),
      })
      .select()
      .single();
    data = retry.data;
    error = retry.error;
  }

  if (error) throw error;

  const normalized = normalizeBookMaterial(data as Book);

  const resolved = actor ?? (await getCurrentActor().catch(() => null));
  await logActivity({
    action: "ADD",
    entity_type: "book",
    entity_id: normalized?.id ?? null,
    description: `Added ${resolvedType.toLowerCase()} "${book.title}" by ${book.author} (Accession #: ${book.accession_number}).`,
    metadata: {
      title: book.title,
      author: book.author,
      accession_number: book.accession_number,
      material_type: resolvedType,
    },
    actor: resolved,
  });

  return normalized;
}

export async function updateBook(id: string, updates: BookUpdate, actor?: ActorInfo | null): Promise<Book> {
  const serverNow = await ensureServerNow();

  // Preserve existing material tag if caller only updated unrelated fields (e.g. status/notes)
  let nextMaterialType = updates.material_type
    ? normalizeMaterialType(updates.material_type)
    : undefined;
  let existingRow: Book | null = null;

  if (!nextMaterialType || updates.notes === undefined) {
    try {
      const { data: current } = await supabase
        .from("books")
        .select("*")
        .eq("id", id)
        .single();
      if (current) {
        existingRow = normalizeBookMaterial(current as Book);
        if (!nextMaterialType) {
          nextMaterialType = normalizeMaterialType(existingRow.material_type);
        }
      }
    } catch {
      // proceed with provided updates
    }
  }

  const nextNotes =
    updates.notes !== undefined
      ? stripMaterialTag(updates.notes)
      : existingRow
      ? existingRow.notes
      : undefined;

  const payload: Record<string, unknown> = {
    ...updates,
    updated_at: serverNow.toISOString(),
  };
  if (updates.material_type !== undefined && nextMaterialType) {
    payload.material_type = nextMaterialType;
  }
  if (nextNotes !== undefined) {
    payload.notes = nextNotes;
  }

  let { data, error } = await supabase
    .from("books")
    .update(payload)
    .eq("id", id)
    .select()
    .single();

  // Pre-008-migration enum fallback: store as Non-Book + [Material: ...] tag in notes.
  if (error && isMaterialEnumError(error) && nextMaterialType && nextMaterialType !== "Book") {
    const fallbackPayload: Record<string, unknown> = {
      ...payload,
      material_type: "Non-Book",
      notes: encodeMaterialInNotes(nextMaterialType, nextNotes ?? existingRow?.notes ?? null),
    };
    const retry = await supabase
      .from("books")
      .update(fallbackPayload)
      .eq("id", id)
      .select()
      .single();
    data = retry.data;
    error = retry.error;
  } else if (
    !error &&
    existingRow &&
    updates.material_type === undefined &&
    updates.notes !== undefined &&
    data &&
    (data as Book).material_type === "Non-Book" &&
    existingRow.material_type !== "Book" &&
    existingRow.material_type !== "Other Material"
  ) {
    // Keep the fallback material tag intact if only notes were edited on a pre-008 row.
    const taggedNotes = encodeMaterialInNotes(
      normalizeMaterialType(existingRow.material_type),
      nextNotes
    );
    const preserve = await supabase
      .from("books")
      .update({ notes: taggedNotes, updated_at: serverNow.toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (!preserve.error && preserve.data) {
      data = preserve.data;
    }
  }

  if (error) throw error;

  const normalized = normalizeBookMaterial(data as Book);

  const resolved = actor ?? (await getCurrentActor().catch(() => null));
  const changedKeys = Object.keys(updates).filter((k) => k !== "updated_at");
  await logActivity({
    action: "EDIT",
    entity_type: "book",
    entity_id: id,
    description: `Edited ${normalized.material_type.toLowerCase()} "${normalized?.title ?? id}" (changed: ${changedKeys.join(", ") || "—"}).`,
    metadata: { changed_fields: changedKeys, updates, material_type: normalized.material_type },
    actor: resolved,
  });

  return normalized;
}

export async function updateBookStatus(id: string, status: BookStatus): Promise<Book> {
  return updateBook(id, { status });
}

export async function updateBookNotes(id: string, notes: string): Promise<Book> {
  return updateBook(id, { notes });
}

export async function deleteBook(id: string, actor?: ActorInfo | null): Promise<void> {
  const resolved = actor ?? (await getCurrentActor().catch(() => null));

  // Snapshot the record first so it can be archived + restored later.
  let snapshot: Record<string, unknown> | null = null;
  try {
    const { data } = await supabase.from("books").select("*").eq("id", id).single();
    snapshot = data
      ? (normalizeBookMaterial(data as Book) as unknown as Record<string, unknown>)
      : null;
  } catch {
    snapshot = null;
  }

  const { error } = await supabase
    .from("books")
    .delete()
    .eq("id", id);

  if (error) throw error;

  await archiveRecord({
    entity_type: "book",
    entity_id: id,
    data: snapshot,
    actor: resolved,
  });

  await logActivity({
    action: "DELETE",
    entity_type: "book",
    entity_id: id,
    description: snapshot
      ? `Deleted ${String(snapshot.material_type ?? "book").toLowerCase()} "${String(snapshot.title ?? id)}" by ${String(snapshot.author ?? "unknown")} (moved to archive).`
      : `Deleted material ${id} (moved to archive).`,
    metadata: snapshot
      ? {
          title: snapshot.title,
          author: snapshot.author,
          accession_number: snapshot.accession_number,
          material_type: snapshot.material_type,
        }
      : null,
    actor: resolved,
  });
}

// ── Bulk ──────────────────────────────────────────────────────

export async function createBooks(books: BookInsert[]): Promise<Book[]> {
  const prepared = books.map((b) => ({
    ...b,
    material_type: normalizeMaterialType(b.material_type),
    notes: stripMaterialTag(b.notes),
  }));

  let { data, error } = await supabase
    .from("books")
    .insert(prepared)
    .select();

  if (error && isMaterialEnumError(error)) {
    const fallbackPrepared = prepared.map((b) =>
      b.material_type === "Book"
        ? b
        : {
            ...b,
            material_type: "Non-Book" as const,
            notes: encodeMaterialInNotes(b.material_type, b.notes),
          }
    );
    const retry = await supabase
      .from("books")
      .insert(fallbackPrepared)
      .select();
    data = retry.data;
    error = retry.error;
  }

  if (error) throw error;
  return (data ?? []).map((b: Book) => normalizeBookMaterial(b));
}
