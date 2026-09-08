// Server-only daily backup of the whole workbook into Supabase Storage.
// Backups live in the same private bucket as the PDF archive, under
// backups/<YYYY-MM-DD>/workbook.json. The last 90 days are kept.
import { TABS, type Row, type Workbook } from "./sheets-schema";

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

/* ------------------------- backup recovery tool --------------------------- */

export type RecoveryRow = {
  tab: keyof typeof TABS;
  id: string;
  summary: string;
  backupDay: string;
};

export type RecoveryReport = {
  backupDays: string[];
  scannedBackups: number;
  missing: RecoveryRow[];
  error?: string | undefined;
};

type BackupEntry = { at?: string; workbook?: Partial<Record<keyof typeof TABS, Record<string, string>[]>> };

/** Natural id column per tab; tabs without one are not scanned. */
const ROW_ID_FIELD: Record<keyof typeof TABS, string | undefined> = {
  ledger: "bill_id",
  rent: "invoice_id",
  labs: "lab_id",
  incubatees: "incubatee_id",
  clients: "client_id",
  payments: "payment_id",
  settings: undefined,
  audit: undefined,
};

function rowId(tab: keyof typeof TABS, row: Record<string, string>): string {
  const field = ROW_ID_FIELD[tab];
  return field ? String(row[field] ?? "").trim() : "";
}

async function fetchBackupJson(path: string): Promise<BackupEntry | null> {
  try {
    const db = await admin();
    const { data } = await db.storage
      .from("gbpims-pdfs")
      .createSignedUrl(path, 60);
    if (!data?.signedUrl) return null;
    const res = await fetch(data.signedUrl);
    if (!res.ok) return null;
    return (await res.json()) as BackupEntry;
  } catch {
    return null;
  }
}

function summarizeRow(tab: keyof typeof TABS, row: Record<string, string>): string {
  const pick = (field: string) => (row[field] ?? "").trim();
  switch (tab) {
    case "ledger":
      return `${pick("client_name") || "—"} · ${pick("bill_date") || "undated"} · ₹${pick("total_amount") || "0"}`;
    case "rent":
      return `${pick("company_name") || "—"} · ${pick("month") || pick("invoice_date") || "—"} · ₹${pick("amount") || "0"}`;
    case "incubatees":
      return `${pick("company_name") || "—"} · ${pick("lab_id") || "no lab"}`;
    case "clients":
      return `${pick("client_name") || "—"} · ${pick("address") || ""}`;
    case "payments":
      return `${pick("client_name") || pick("incubatee_id") || "—"} · ${pick("date") || "—"} · ₹${pick("amount") || "0"}`;
    case "labs":
      return `${pick("name") || pick("lab_id")} · ${pick("status") || ""}`;
    default:
      return "";
  }
}

/**
 * Compare the live sheet against every daily backup: a row that exists in a
 * backup but not in the live sheet was lost somewhere along the way — list it
 * so one tap can restore it. Read-only; never writes to the sheet.
 */
export async function scanMissingRows(): Promise<RecoveryReport> {
  try {
    const { requireSpreadsheetId } = await import("./gbp.server");
    const { readWorkbook } = await import("./sheets.server");
    const spreadsheetId = await requireSpreadsheetId();
    const live = await readWorkbook(spreadsheetId, { fresh: true });

    const backups = await listBackups();
    const days = [...new Set(backups.map((b) => b.day))].sort().reverse();
    const tabKeys = Object.keys(TABS) as (keyof typeof TABS)[];

    const liveIds = new Map<keyof typeof TABS, Set<string>>();
    for (const tab of tabKeys) {
      const idField = ROW_ID_FIELD[tab];
      const rows = live[tab] as Row[] | undefined;
      // `settings` is a key/value object, not a row list — skip it (and any
      // other tab without a natural id) or .map blows up.
      if (!idField || !Array.isArray(rows)) {
        liveIds.set(tab, new Set());
        continue;
      }
      liveIds.set(
        tab,
        new Set(rows.map((r) => rowId(tab, r)).filter((v) => v !== "")),
      );
    }

    // Newest copy wins when the same id is missing across several backups.
    const missingIds = new Map<
      keyof typeof TABS,
      Map<string, { day: string; row: Record<string, string> }>
    >();
    for (const tab of tabKeys) missingIds.set(tab, new Map());

    let scannedBackups = 0;
    for (const day of days.slice(0, 14)) {
      const files = backups.filter((b) => b.day === day);
      for (const file of files) {
        const parsed = await fetchBackupJson(file.path);
        const wb = parsed?.workbook;
        if (!wb) continue;
        for (const tab of tabKeys) {
          const idField = ROW_ID_FIELD[tab];
          if (!idField) continue; // settings/audit have no natural key
          const target = missingIds.get(tab)!;
          for (const row of wb[tab] ?? []) {
            if (!row || typeof row !== "object") continue;
            const id = String(row[idField] ?? "").trim();
            if (id === "") continue;
            if (liveIds.get(tab)!.has(id)) continue;
            if (!target.has(id)) target.set(id, { day, row });
          }
        }
        scannedBackups += 1;
      }
    }

    const missing: RecoveryRow[] = [];
    for (const tab of tabKeys) {
      const idField = ROW_ID_FIELD[tab];
      if (!idField) continue;
      for (const [id, { day, row }] of missingIds.get(tab)!) {
        missing.push({
          tab,
          id,
          summary: summarizeRow(tab, row),
          backupDay: day,
        });
      }
    }

    // Same-day WAL fallback: backups are once/day — rows written and then
    // vanished the same day only exist in the wal/<date>/… files.
    try {
      const { listWal } = await import("./wal.server");
      const walEntries = await listWal(3);
      for (const entry of walEntries) {
        if (entry.op !== "write" || !entry.after) continue;
        const tab = entry.tab as keyof typeof TABS;
        const idField = ROW_ID_FIELD[tab];
        if (!idField) continue;
        const id = String((entry.after as Record<string, string>)[idField] ?? "").trim();
        if (id === "") continue;
        const target = missingIds.get(tab);
        if (!target || target.has(id) || liveIds.get(tab)!.has(id)) continue;
        // Only add if not already covered by a backup copy.
        missingIds.get(tab)!.set(id, { day: `wal ${entry.at.slice(0, 10)}`, row: entry.after as Record<string, string> });
        missing.push({
          tab,
          id,
          summary: summarizeRow(tab, entry.after as Record<string, string>),
          backupDay: `wal ${entry.at.slice(0, 10)}`,
        });
      }
    } catch {
      /* wal scan is best effort */
    }

    return { backupDays: days, scannedBackups, missing };
  } catch (err) {
    return {
      backupDays: [],
      scannedBackups: 0,
      missing: [],
      error: (err as Error).message,
    };
  }
}

/**
 * Restore missing rows from the newest backup that holds them. Only rows that
 * are still absent from the live sheet are appended, so restoring is safe to
 * re-run and can never duplicate data.
 */
export async function restoreMissingRows(
  ids: { tab: keyof typeof TABS; id: string }[],
): Promise<{ restored: number; stillMissing: string[] }> {
  const { requireSpreadsheetId } = await import("./gbp.server");
  const { readWorkbook, appendRows } = await import("./sheets.server");
  const spreadsheetId = await requireSpreadsheetId();

  const backups = await listBackups();
  const days = [...new Set(backups.map((b) => b.day))].sort().reverse();
  const tabKeys = Object.keys(TABS) as (keyof typeof TABS)[];

  const pending = new Set(ids.map((x) => `${String(x.tab)}:${x.id}`));
  let restored = 0;

  for (const day of days.slice(0, 14)) {
    if (pending.size === 0) break;
    const files = backups.filter((b) => b.day === day);
    for (const file of files) {
      if (pending.size === 0) break;
      const parsed = await fetchBackupJson(file.path);
      const wb = parsed?.workbook;
      if (!wb) continue;
      for (const tab of tabKeys) {
        const idField = ROW_ID_FIELD[tab];
        if (!idField) continue;
        const rows = (wb[tab] ?? []).filter((r) => {
          const id = String(r[idField] ?? "").trim();
          return id !== "" && pending.has(`${String(tab)}:${id}`);
        });
        if (rows.length === 0) continue;
        // Append only rows still absent from the sheet (someone may have
        // restored them between the scan and this call).
        const liveNow = await readWorkbook(spreadsheetId, { fresh: true });
        const existing = new Set(
          ((liveNow[tab] as Row[] | undefined) ?? [])
            .map((r) => rowId(tab, r))
            .filter((v) => v !== ""),
        );
        const toAdd = rows.filter((r) => {
          const id = String(r[idField] ?? "").trim();
          if (existing.has(id)) {
            pending.delete(`${String(tab)}:${id}`);
            return false;
          }
          return true;
        });
        if (toAdd.length === 0) continue;
        await appendRows(spreadsheetId, tab, toAdd);
        for (const r of toAdd) {
          pending.delete(`${String(tab)}:${String(r[idField] ?? "").trim()}`);
        }
        restored += toAdd.length;
      }
    }
  }

  // WAL fallback for any id still pending: the after-image is the row's last
  // known good copy even if it vanished before tonight's backup.
  if (pending.size > 0) {
    try {
      const { listWal } = await import("./wal.server");
      const { readWorkbook: freshRead, appendRows: walAppend } = await import("./sheets.server");
      const walEntries = await listWal(3);
      const byKey = new Map<string, Record<string, string>>();
      for (const e of walEntries) {
        if (e.op !== "write" || !e.after) continue;
        const tab = e.tab as keyof typeof TABS;
        const idField = ROW_ID_FIELD[tab];
        if (!idField) continue;
        const id = String((e.after as Record<string, string>)[idField] ?? "").trim();
        const key = `${String(tab)}:${id}`;
        if (!pending.has(key)) continue;
        if (!byKey.has(key)) byKey.set(key, e.after as Record<string, string>);
      }
      for (const [key, row] of byKey) {
        const [tabStr] = key.split(":");
        const tab = tabStr as keyof typeof TABS;
        const liveNow = await freshRead(spreadsheetId, { fresh: true });
        const existing2 = new Set(
          ((liveNow[tab] as Row[] | undefined) ?? [])
            .map((r) => rowId(tab, r))
            .filter((v) => v !== ""),
        );
        const id = String(row[ROW_ID_FIELD[tab]! ?? ""] ?? "").trim();
        if (existing2.has(id)) {
          pending.delete(key);
          continue;
        }
        await walAppend(spreadsheetId, tab, [row]);
        pending.delete(key);
        restored += 1;
      }
    } catch {
      /* wal restore is best effort */
    }
  }

  // Fresh verification read: anything still absent is reported back exactly,
  // never silently dropped.
  const after = await readWorkbook(spreadsheetId, { fresh: true });
  const stillMissing: string[] = [];
  for (const item of ids) {
    const idField = ROW_ID_FIELD[item.tab];
    if (!idField) continue;
    const rows = (after[item.tab] as Row[] | undefined) ?? [];
    const found = rows.some((r) => String(r[idField] ?? "").trim() === item.id);
    if (!found) stillMissing.push(`${String(item.tab)}:${item.id}`);
  }
  return { restored, stillMissing };
}
