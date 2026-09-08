// Server-only month-wise PDF archive in Supabase Storage. Files are stored in
// a private bucket (<kind>/<YYYY-MM>/<refId>_<label>.pdf) and served through
// short-lived signed URLs, so access always goes through the app's auth.
import type { ArchivedPdfLike } from "./pdf-archive-shared";

const BUCKET = "gbpims-pdfs";
const MAX_BYTES = 4 * 1024 * 1024;
const PATH_RE = /^(electricity|rent|receipt)\/\d{4}-\d{2}\/[A-Za-z0-9._-]+\.pdf$/;

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function slug(value: string): string {
  return value
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
  const binary = atob(clean);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export type ArchivePdfInput = {
  kind: "electricity" | "rent" | "receipt";
  month: string;
  ref_id: string;
  label?: string | undefined;
  pdf_base64: string;
};

/** Store (or replace) one PDF in the month-wise archive. */
export async function archivePdf(input: ArchivePdfInput): Promise<{ path: string }> {
  const bytes = base64ToBytes(input.pdf_base64);
  if (bytes.byteLength === 0) throw new Error("The generated PDF was empty.");
  if (bytes.byteLength > MAX_BYTES) {
    throw new Error("The generated PDF is too large to archive (over 4 MB).");
  }
  const refId = input.ref_id.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 80);
  if (!refId) throw new Error("Missing document number for the archive.");
  const label = input.label ? `_${slug(input.label)}` : "";
  const path = `${input.kind}/${input.month}/${refId}${label}.pdf`;
  const db = await admin();
  const store = db.storage.from(BUCKET);
  const options = { contentType: "application/pdf", upsert: true } as const;
  const first = await store.upload(path, bytes, options);
  if (first.error && /not found|does not exist/i.test(first.error.message)) {
    // Bootstrap the bucket on first use so no manual Supabase setup is needed.
    const created = await db.storage.createBucket(BUCKET, { public: false });
    if (created.error && !/exists|duplicate/i.test(created.error.message)) {
      throw new Error(created.error.message);
    }
    const retry = await store.upload(path, bytes, options);
    if (retry.error) throw new Error(retry.error.message);
  } else if (first.error) {
    throw new Error(first.error.message);
  }
  return { path };
}

export type ArchivedPdf = ArchivedPdfLike;

/**
 * Every archived PDF, oldest month first. Empty until the bucket exists.
 * Supabase Storage list returns folder levels as pseudo-entries whose `id` is
 * null, while real files carry an id — walking kind/<month>/<file> must only
 * recurse into the id-less month folders (the old code did the exact opposite,
 * which is why the archive looked empty even though files were stored).
 */
export async function listPdfArchive(): Promise<ArchivedPdfLike[]> {
  const db = await admin();
  const store = db.storage.from(BUCKET);
  const out: ArchivedPdfLike[] = [];
  for (const kind of ["electricity", "rent", "receipt"]) {
    const months = await store.list(kind, {
      limit: 100,
      sortBy: { column: "name", order: "asc" },
    });
    if (months.error || !months.data) continue;
    for (const monthFolder of months.data) {
      if (monthFolder.id) continue; // a stray file directly under kind/
      if (!/^\d{4}-\d{2}$/.test(monthFolder.name)) continue;
      const prefix = `${kind}/${monthFolder.name}`;
      const files = await store.list(prefix, {
        limit: 1000,
        sortBy: { column: "name", order: "asc" },
      });
      if (files.error || !files.data) continue;
      for (const file of files.data) {
        if (!file.id) continue; // nested folder — ignore
        out.push({
          path: `${prefix}/${file.name}`,
          name: file.name,
          kind,
          month: monthFolder.name,
          size: file.metadata?.size ?? 0,
          updatedAt: file.updated_at ?? file.created_at ?? "",
        });
      }
    }
  }
  return out;
}

/** A 1-hour signed download link for one archived PDF. */
export async function getPdfDownloadUrl(
  rawPath: string,
): Promise<{ url: string; expiresAt: string }> {
  const path = rawPath.replace(/\\/g, "/").replace(/\.\.+/g, "").replace(/^\/+/, "");
  if (!PATH_RE.test(path)) throw new Error("Invalid archive path.");
  const db = await admin();
  const { data, error } = await db.storage
    .from(BUCKET)
    .createSignedUrl(path, 60 * 60);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? "Could not create the download link.");
  }
  const url = data.signedUrl.startsWith("http")
    ? data.signedUrl
    : `${new URL(data.signedUrl, process.env["SUPABASE_URL"] ?? "").toString()}`;
  return {
    url,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };
}
