// Server-only write-ahead log (WAL): every write to the ledger/rent tabs is
// recorded in the gbpims-pdfs bucket BEFORE/AFTER the Google Sheet is touched,
// keeping the previous (before) and new (after) row images. If the sheet ever
// loses rows again — races, migrations, accidental clears — the exact data is
// here and can be re-applied row by row. Storage never blocks a real write.
const BUCKET = "gbpims-pdfs";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export type WalOperation = "write" | "delete";

export type WalEntry = {
  at: string;
  tab: string;
  op: WalOperation;
  row_id: string;
  before: Record<string, string> | null;
  after: Record<string, string> | null;
};

/**
 * Record one operation. Best-effort by design: a WAL failure must never break
 * the actual write, so all errors are swallowed (a console trace remains).
 * `before` = the row image prior to the operation (null for appends),
 * `after` = the row image written (null for deletes).
 */
export async function walWrite(
  tab: string,
  op: WalOperation,
  rowId: string,
  before: Record<string, string> | null,
  after: Record<string, string> | null,
): Promise<void> {
  try {
    const db = await admin();
    const store = db.storage.from(BUCKET);
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const name = `${now.toISOString().replace(/[:.]/g, "-")}-${Math.random()
      .toString(36)
      .slice(2, 7)}-${op}.json`;
    const path = `wal/${day}/${tab}/${name}`;
    const body: WalEntry = {
      at: now.toISOString(),
      tab,
      op,
      row_id: rowId,
      before,
      after,
    };
    await store.upload(path, JSON.stringify(body), {
      contentType: "application/json",
      upsert: false,
    });
  } catch (err) {
    console.warn(
      `[wal] could not record ${op} on ${tab}/${rowId}: ${(err as Error).message.slice(0, 120)}`,
    );
  }
}

/** WAL entries from the last `days` days, newest first. Best effort. */
export async function listWal(days = 3): Promise<WalEntry[]> {
  try {
    const db = await admin();
    const store = db.storage.from(BUCKET);
    const out: WalEntry[] = [];
    for (let i = 0; i < days; i += 1) {
      const day = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
      const tabs = await store.list(`wal/${day}`, { limit: 50 });
      for (const tabFolder of tabs.data ?? []) {
        if (tabFolder.id) continue;
        const files = await store.list(`wal/${day}/${tabFolder.name}`, { limit: 1000 });
        for (const file of files.data ?? []) {
          if (!file.id) continue;
          const { data } = await store.download(`wal/${day}/${tabFolder.name}/${file.name}`);
          if (!data) continue;
          try {
            const text = await (data as Blob).text();
            const parsed = JSON.parse(text) as WalEntry;
            if (parsed && typeof parsed.row_id === "string") out.push(parsed);
          } catch {
            /* skip unreadable entries */
          }
        }
      }
    }
    return out.sort((a, b) => b.at.localeCompare(a.at));
  } catch {
    return [];
  }
}
