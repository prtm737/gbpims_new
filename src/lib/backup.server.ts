// Server-only daily backup of the whole workbook into Supabase Storage.
// Backups live in the same private bucket as the PDF archive, under
// backups/<YYYY-MM-DD>/workbook.json. The last 90 days are kept.
import { TABS, type Workbook } from "./sheets-schema";

const BACKUP_PREFIX = "backups";
const KEEP_DAYS = 90;

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Runs at most once per day: snapshots the whole workbook as JSON. */
export async function runDailyBackup(
  load: () => Promise<Workbook>,
): Promise<{ backed: boolean }> {
  try {
    const db = await admin();
    const store = db.storage.from("gbpims-pdfs");
    const day = today();
    const existing = await store.list(`${BACKUP_PREFIX}/${day}`, {
      limit: 10,
    });
    if (!existing.error && (existing.data ?? []).some((f) => f.id)) {
      return { backed: false };
    }
    const workbook = await load();
    const json = JSON.stringify({ at: new Date().toISOString(), workbook });
    await store.upload(
      `${BACKUP_PREFIX}/${day}/workbook.json`,
      json,
      { contentType: "application/json", upsert: true },
    );
    void pruneOldBackups();
    return { backed: true };
  } catch {
    // Backups are best-effort: never break a page load over them.
    return { backed: false };
  }
}

/** Keeps only the newest KEEP_DAYS day-folders. */
async function pruneOldBackups(): Promise<void> {
  try {
    const db = await admin();
    const store = db.storage.from("gbpims-pdfs");
    const days = await store.list(BACKUP_PREFIX, {
      limit: 400,
      sortBy: { column: "name", order: "desc" },
    });
    const stale = (days.data ?? [])
      .filter((d) => d.id === null && /^\d{4}-\d{2}-\d{2}$/.test(d.name))
      .slice(KEEP_DAYS);
    for (const folder of stale) {
      const files = await store.list(`${BACKUP_PREFIX}/${folder.name}`, { limit: 50 });
      for (const file of files.data ?? []) {
        if (file.id) {
          await store.remove([`${BACKUP_PREFIX}/${folder.name}/${file.name}`]);
        }
      }
    }
  } catch {
    /* best effort */
  }
}

export type WorkbookBackup = {
  path: string;
  day: string;
  size: number;
  updatedAt: string;
};

export async function listBackups(): Promise<WorkbookBackup[]> {
  try {
    const db = await admin();
    const store = db.storage.from("gbpims-pdfs");
    const days = await store.list(BACKUP_PREFIX, {
      limit: 400,
      sortBy: { column: "name", order: "desc" },
    });
    const out: WorkbookBackup[] = [];
    for (const folder of (days.data ?? []).slice(0, 60)) {
      if (folder.id) continue;
      const files = await store.list(`${BACKUP_PREFIX}/${folder.name}`, { limit: 10 });
      for (const file of files.data ?? []) {
        if (!file.id) continue;
        out.push({
          path: `${BACKUP_PREFIX}/${folder.name}/${file.name}`,
          day: folder.name,
          size: file.metadata?.size ?? 0,
          updatedAt: file.updated_at ?? file.created_at ?? "",
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** A 1-hour signed download link for one backup file. */
export async function getBackupDownloadUrl(
  rawPath: string,
): Promise<{ url: string }> {
  const path = rawPath.replace(/\\/g, "/").replace(/\.\.+/g, "").replace(/^\/+/, "");
  if (!new RegExp(`^${BACKUP_PREFIX}/\\d{4}-\\d{2}-\\d{2}/[\\w.-]+\\.json$`).test(path)) {
    throw new Error("Invalid backup path.");
  }
  const db = await admin();
  const { data, error } = await db.storage.from("gbpims-pdfs").createSignedUrl(path, 60 * 60);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? "Could not create the download link.");
  }
  const url = data.signedUrl.startsWith("http")
    ? data.signedUrl
    : `${new URL(data.signedUrl, process.env["SUPABASE_URL"] ?? "").toString()}`;
  return { url };
}

/** Tabs the backup covers — shown in the UI so staff know what is inside. */
export const BACKUP_TABS = Object.values(TABS);
