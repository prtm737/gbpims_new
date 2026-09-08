// Server-only business logic for the incubatee management system.
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  DEFAULT_SETTINGS,
  discountValue,
  dueStatus,
  electricityDutyPct,
  electricityFixedChargeRate,
  electricityTariffRate,
  grossRent,
  num,
  computeBill,
  computeRentBill,
  gstEnabled,
  nextBillNumber,
  nextInvoiceNo,
  parseMeters,
  settingNum,
  spaceIds,
  totalArea,
  type Row,
  type Workbook,
} from "./sheets-schema";
import {
  appendRows,
  deleteRowById,
  ensureWorkbook,
  readWorkbook,
  replaceSettings,
  spreadsheetTitle,
  syncLabRoster,
  updateRowById,
  writeTabHeaders,
} from "./sheets.server";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Client = SupabaseClient<any, any, any>;

export type AppRole = "admin" | "staff" | "viewer";

const WRITE_ROLES: AppRole[] = ["admin", "staff"];

/** Staff may add new records (data entry) but only admins may edit or delete. */
export async function requireEdit(supabase: Client, userId: string): Promise<AppRole> {
  return requireRole(supabase, userId, ["admin"]);
}

export async function getMyRole(supabase: Client, userId: string): Promise<AppRole> {
  const cached = roleCache.get(userId);
  if (cached && Date.now() - cached.at < ROLE_TTL_MS) return cached.role;
  const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  if (error) throw new Error(error.message);
  const roles = (data ?? []).map((r: { role: string }) => r.role as AppRole);
  const role: AppRole = roles.includes("admin")
    ? "admin"
    : roles.includes("staff")
      ? "staff"
      : "viewer";
  roleCache.set(userId, { at: Date.now(), role });
  return role;
}

// Short-lived in-memory caches: roles and config change rarely, but every page
// load used to pay two extra database round trips before touching the sheet.
const ROLE_TTL_MS = 60_000;
const roleCache = new Map<string, { at: number; role: AppRole }>();
const CONFIG_TTL_MS = 120_000;
const configCache = new Map<string, { at: number; value: string | null }>();

/** Forget the cached role for a user (call after granting/revoking rights). */
export function invalidateRoleCache(userId?: string): void {
  if (userId) roleCache.delete(userId);
  else roleCache.clear();
}

export async function requireRole(
  supabase: Client,
  userId: string,
  allowed: AppRole[],
): Promise<AppRole> {
  const role = await getMyRole(supabase, userId);
  if (!allowed.includes(role)) {
    throw new Error("You do not have permission to perform this action.");
  }
  return role;
}

export async function requireWrite(supabase: Client, userId: string): Promise<AppRole> {
  return requireRole(supabase, userId, WRITE_ROLES);
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export async function getConfig(key: string): Promise<string | null> {
  const cached = configCache.get(key);
  if (cached && Date.now() - cached.at < CONFIG_TTL_MS) return cached.value;
  const db = await admin();
  const { data, error } = await db.from("app_config").select("value").eq("key", key).maybeSingle();
  if (error) throw new Error(error.message);
  const value = (data?.value as string | undefined) ?? null;
  configCache.set(key, { at: Date.now(), value });
  return value;
}

export async function setConfig(key: string, value: string, userId: string): Promise<void> {
  const db = await admin();
  const { error } = await db
    .from("app_config")
    .upsert(
      { key, value, updated_at: new Date().toISOString(), updated_by: userId },
      { onConflict: "key" },
    );
  if (error) throw new Error(error.message);
  configCache.set(key, { at: Date.now(), value });
}

export async function requireSpreadsheetId(): Promise<string> {
  const id = await getConfig("spreadsheet_id");
  if (!id) {
    throw new Error(
      "No Google Sheet is connected yet. An admin must add the spreadsheet link in Settings.",
    );
  }
  return id;
}

export function parseSpreadsheetId(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match?.[1]) return match[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) return trimmed;
  throw new Error("That doesn't look like a Google Sheets link or ID.");
}

export async function connectSpreadsheet(rawInput: string, userId: string) {
  const spreadsheetId = parseSpreadsheetId(rawInput);
  const title = await spreadsheetTitle(spreadsheetId);
  const { created } = await ensureWorkbook(spreadsheetId);
  await setConfig("spreadsheet_id", spreadsheetId, userId);
  return { spreadsheetId, title, created };
}

export async function loadWorkbook(
  options: { fresh?: boolean } = {},
): Promise<Workbook> {
  const id = await requireSpreadsheetId();
  const wb = await readWorkbook(id, { fresh: options.fresh === true });
  const { LAB_IDS } = await import("./sheets-schema");
  const have = new Set(wb.labs.map((l) => l["lab_id"]));
  if (LAB_IDS.some((labId) => !have.has(labId))) {
    await syncLabRoster(id);
    return readWorkbook(id, { fresh: true });
  }
  return wb;
}

// The workbook upgrade (formatting + Dashboard tab + legacy-tab cleanup) runs
// at most once per server process per day, and only once per spreadsheet.
const UPGRADE_TTL_MS = 24 * 60 * 60_000;
const lastUpgrade = new Map<string, number>();

/**
 * One-time-per-day self-heal: applies the new look (Dashboard tab, currency
 * and date formats, deletes the empty legacy ElectricityBills tab) without
 * anyone having to press a button. Failures are silent — formatting must
 * never block loading data.
 */
export function upgradeWorkbookOnce(): Promise<void> {
  return upgradeWorkbookInBoot();
}

// Daily workbook backup: fires with the first workbook load of the day.
const lastBackup = new Map<string, number>();

/** Fire-and-forget daily backup; failures are silent by design. */
export function backupWorkbookOnce(): Promise<void> {
  return (async () => {
    try {
      const key = "daily";
      const at = lastBackup.get(key) ?? 0;
      if (Date.now() - at < 20 * 60 * 60_000) return;
      lastBackup.set(key, Date.now());
      const { runDailyBackup } = await import("./backup.server");
      await runDailyBackup(() => loadWorkbook({ fresh: true }));
    } catch {
      /* backups must never break a page load */
    }
  })();
}

async function upgradeWorkbookInBoot(): Promise<void> {
  try {
    const id = await requireSpreadsheetId();
    const at = lastUpgrade.get(id) ?? 0;
    if (Date.now() - at < UPGRADE_TTL_MS) return;
    lastUpgrade.set(id, Date.now());
    const { ensureWorkbook } = await import("./sheets.server");
    await ensureWorkbook(id);
  } catch {
    /* cosmetic only — data access must never fail because of formatting */
  }
}

export async function workbookStatus() {
  const spreadsheetId = await getConfig("spreadsheet_id");
  if (!spreadsheetId) return { connected: false as const };
  return {
    connected: true as const,
    spreadsheetId,
    url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
  };
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 900 + 100)}`;
}

/* ------------------------------ audit log -------------------------------- */

export type AuditEntry = {
  actor: string;
  action: string;
  entity: "rent" | "electricity";
  entity_id: string;
  entity_name?: string | undefined;
  month?: string | undefined;
  amount?: number | string | undefined;
  details?: string | undefined;
};

/** Append an immutable trail row for every ledger change. Never blocks the action. */
export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    const id = await requireSpreadsheetId();
    await appendRows(id, "audit", [
      {
        audit_id: newId("AUD"),
        timestamp: new Date().toISOString(),
        actor: entry.actor,
        action: entry.action,
        entity: entry.entity,
        entity_id: entry.entity_id,
        entity_name: entry.entity_name ?? "",
        month: entry.month ?? "",
        amount: entry.amount === undefined ? "" : String(entry.amount),
        details: entry.details ?? "",
      },
    ]);
  } catch (err) {
    // The AuditLog tab may not exist yet on older workbooks — create it once and retry.
    try {
      const id = await requireSpreadsheetId();
      const { ensureWorkbook: ensure } = await import("./sheets.server");
      await ensure(id);
      await appendRows(id, "audit", [
        {
          audit_id: newId("AUD"),
          timestamp: new Date().toISOString(),
          actor: entry.actor,
          action: entry.action,
          entity: entry.entity,
          entity_id: entry.entity_id,
          entity_name: entry.entity_name ?? "",
          month: entry.month ?? "",
          amount: entry.amount === undefined ? "" : String(entry.amount),
          details: entry.details ?? "",
        },
      ]);
    } catch {
      console.warn(`[audit] skipped: ${(err as Error).message.slice(0, 160)}`);
    }
  }
}

/**
 * Backfill the AuditLog from the sheet itself: every existing ledger/rent/
 * payment row that has no audit entry gets one ("history import"), so the
 * entry history is complete and missing-row checks have a timeline of when
 * data was first written. Caps per run to keep writes bounded.
 */
export async function backfillAudit(): Promise<{ added: number; skipped: number }> {
  const id = await requireSpreadsheetId();
  const wb = await readWorkbook(id, { fresh: true });
  const existing = new Set(
    (wb.audit ?? []).map((r) => `${String(r["entity"] ?? "").trim()}:${String(r["entity_id"] ?? "").trim()}`),
  );
  const rows: Row[] = [];
  const add = (entity: AuditEntry["entity"], entityId: string, entry: Omit<AuditEntry, "entity" | "entity_id">) => {
    const key = `${entity}:${String(entityId).trim()}`;
    if (key.endsWith(":") || existing.has(key)) return;
    existing.add(key);
    rows.push({
      audit_id: newId("AUD"),
      timestamp: new Date().toISOString(),
      actor: entry.actor,
      action: entry.action,
      entity,
      entity_id: entityId,
      entity_name: entry.entity_name ?? "",
      month: entry.month ?? "",
      amount: entry.amount === undefined ? "" : String(entry.amount),
      details: entry.details ?? "",
    });
  };
  for (const b of wb.ledger ?? []) {
    const billId = String(b["bill_id"] ?? "").trim();
    if (billId === "") continue;
    add("electricity", billId, {
      actor: String(b["generated_by"] ?? "").trim() || "history import",
      action: "electricity bill created",
      entity_name: String(b["client_name"] ?? "").trim(),
      month: String(b["bill_date"] ?? "").trim().slice(0, 7),
      amount: String(b["total_amount"] ?? "").trim(),
      details: `${String(b["total_units"] ?? "").trim()} units · ${String(b["period_from"] ?? "").trim()} → ${String(b["period_to"] ?? "").trim()}`,
    });
  }
  for (const r of wb.rent ?? []) {
    const invoiceId = String(r["invoice_id"] ?? "").trim();
    if (invoiceId === "") continue;
    add("rent", invoiceId, {
      actor: String(r["generated_by"] ?? "").trim() || "history import",
      action: "rent invoice created",
      entity_name: String(r["company_name"] ?? "").trim(),
      month: String(r["month"] ?? "").trim(),
      amount: String(r["amount"] ?? "").trim(),
      details: String(r["invoice_no"] ?? "").trim(),
    });
  }
  for (const p of wb.payments ?? []) {
    const pid = String(p["payment_id"] ?? "").trim();
    if (pid === "") continue;
    add("rent", pid, {
      actor: String(p["recorded_by"] ?? "").trim() || "history import",
      action: "payment recorded",
      entity_name: String(p["incubatee_id"] ?? p["ref_id"] ?? "").trim(),
      month: String(p["date"] ?? "").trim().slice(0, 7),
      amount: String(p["amount"] ?? "").trim(),
      details: `${String(p["type"] ?? "").trim()} · ${String(p["mode"] ?? "").trim()} ${String(p["reference"] ?? "").trim()}`.trim(),
    });
  }
  if (rows.length === 0) return { added: 0, skipped: 0 };
  const capped = rows.slice(0, 800);
  await appendRows(id, "audit", capped);
  return { added: capped.length, skipped: rows.length - capped.length };
}

/** Update only the remark of a ledger entry (rent invoice or electricity bill). */
export async function updateLedgerRemarks(input: {
  kind: "rent" | "electricity";
  id: string;
  remarks: string;
  actor: string;
}) {
  const spreadsheetId = await requireSpreadsheetId();
  const tab = input.kind === "rent" ? "rent" : "ledger";
  const ok = await updateRowById(spreadsheetId, tab, input.id, { remarks: input.remarks });
  if (!ok) throw new Error("Entry not found.");
  await logAudit({
    actor: input.actor,
    action: "remark updated",
    entity: input.kind,
    entity_id: input.id,
    details: input.remarks,
  });
  return { ok: true };
}

/* ------------------------------- labs ---------------------------------- */

export async function saveLab(lab: Row, canEdit = true) {
  const id = await requireSpreadsheetId();
  const labId = String(lab["lab_id"] ?? "").trim();
  if (!labId) throw new Error("lab_id is required");
  const wb = await readWorkbook(id);
  const exists = wb.labs.some((l) => l["lab_id"] === labId);
  if (exists && !canEdit) {
    throw new Error("Only a super admin can edit an existing space. You can add new spaces.");
  }
  if (!exists && !String(lab["space_type"] ?? "").trim()) lab = { ...lab, space_type: "lab" };
  const record: Row = { ...lab };
  // Rent is derived from area x rate per sqft unless a rent is entered manually.
  if (!String(record["monthly_rent"] ?? "").trim()) {
    record["monthly_rent"] = String(grossRent(record["area_sqft"], wb.settings));
  }
  const updated = await updateRowById(id, "labs", labId, record);
  if (!updated) await appendRows(id, "labs", [record]);
  return { ok: true };
}

/** Remove a rentable space. Blocked while an active incubatee occupies it. */
export async function deleteLab(labId: string) {
  const id = await requireSpreadsheetId();
  const wb = await readWorkbook(id);
  const occupant = wb.incubatees.find(
    (i) => i["lab_id"] === labId && i["status"] !== "exited",
  );
  if (occupant) {
    throw new Error(
      `${labId} is allotted to ${occupant["company_name"]}. Vacate the tenant before deleting.`,
    );
  }
  const ok = await deleteRowById(id, "labs", labId);
  if (!ok) throw new Error("Space not found.");
  return { ok: true };
}

/* ---------------------------- incubatees -------------------------------- */

export async function saveIncubatee(input: Row, canEdit = true) {
  const id = await requireSpreadsheetId();
  const incubateeId = String(input["incubatee_id"] ?? "").trim() || newId("INC");
  if (String(input["incubatee_id"] ?? "").trim() && !canEdit) {
    throw new Error("Only a super admin can edit an existing tenant. You can add new tenants.");
  }
  const record: Row = { ...input, incubatee_id: incubateeId };

  const updated = await updateRowById(id, "incubatees", incubateeId, record);
  if (!updated) await appendRows(id, "incubatees", [record]);

  const labId = String(record["lab_id"] ?? "").trim();
  if (labId) {
    const status =
      record["status"] === "exited"
        ? "vacant"
        : record["status"] === "notice"
          ? "notice"
          : "occupied";
    await updateRowById(id, "labs", labId, {
      status,
      ...(record["monthly_rent"] ? { monthly_rent: record["monthly_rent"] } : {}),
    });
  }

  // Every tenant is billable everywhere the moment they are saved: make sure an
  // electricity billing client exists for them too.
  try {
    const wb = await readWorkbook(id, { fresh: true });
    const existing = wb.clients.find((c) => (c["incubatee_id"] ?? "").trim() === incubateeId);
    if (existing) {
      await updateRowById(id, "clients", existing["client_id"] ?? "", {
        client_name: String(record["company_name"] ?? existing["client_name"] ?? ""),
        whatsapp: String(record["phone"] ?? existing["whatsapp"] ?? ""),
        address: existing["address"] || (labId ? `${labId}, Guwahati Biotech Park` : ""),
      });
    } else if (String(record["status"] ?? "active") !== "exited") {
      await ensureClientForTenant(wb, incubateeId);
    }
  } catch {
    /* billing-client sync is best effort — the tenant record is already saved */
  }
  return { incubateeId };
}

export async function vacateIncubatee(incubateeId: string) {
  const id = await requireSpreadsheetId();
  const wb = await readWorkbook(id);
  const inc = wb.incubatees.find((r) => r["incubatee_id"] === incubateeId);
  if (!inc) throw new Error("Incubatee not found");
  await updateRowById(id, "incubatees", incubateeId, { status: "exited" });
  if (inc["lab_id"]) {
    await updateRowById(id, "labs", inc["lab_id"], { status: "vacant" });
  }
  return { ok: true };
}

/** Permanently remove a tenant plus its rent invoices and power-billing client. */
export async function deleteIncubatee(incubateeId: string) {
  const id = await requireSpreadsheetId();
  const wb = await readWorkbook(id);
  const inc = wb.incubatees.find((r) => r["incubatee_id"] === incubateeId);
  if (!inc) throw new Error("Incubatee not found");

  for (const invoice of wb.rent.filter((r) => r["incubatee_id"] === incubateeId)) {
    if (invoice["invoice_id"]) await deleteRowById(id, "rent", invoice["invoice_id"]);
  }
  for (const client of wb.clients.filter((c) => c["incubatee_id"] === incubateeId)) {
    if (client["client_id"]) await deleteRowById(id, "clients", client["client_id"]);
  }
  if (inc["lab_id"]) {
    await updateRowById(id, "labs", inc["lab_id"], { status: "vacant" });
  }
  await deleteRowById(id, "incubatees", incubateeId);
  return { ok: true };
}

/* ------------------------------- rent ----------------------------------- */

function rentDueDate(month: string, settings: Record<string, string>): string {
  const dueDay = num(settings["rent_due_day"] ?? DEFAULT_SETTINGS["rent_due_day"]) || 10;
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) throw new Error("Invalid month");
  return `${y}-${String(m).padStart(2, "0")}-${String(dueDay).padStart(2, "0")}`;
}

/** Last day of the billing month — used as the default invoice date. */
function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) throw new Error("Invalid month");
  return new Date(y, m, 0).toISOString().slice(0, 10);
}

export type RentInvoiceInput = {
  invoice_id?: string | undefined;
  incubatee_id: string;
  month: string;
  invoice_date?: string | undefined;
  due_date?: string | undefined;
  gross_amount?: number | undefined;
  discount_pct?: string | undefined;
  discount_amount?: string | undefined;
  maintenance_pct?: string | undefined;
  maintenance_amount?: string | undefined;
  gst_applicable: boolean;
  cgst_pct?: number | undefined;
  sgst_pct?: number | undefined;
  party_gstin?: string | undefined;
  remarks?: string | undefined;
  generated_by: string;
};

/**
 * Creates or updates a single incubatee's rent tax invoice for a month.
 * This is the staff-facing rent billing engine.
 */
export async function saveRentInvoice(input: RentInvoiceInput, canEdit: boolean) {
  const id = await requireSpreadsheetId();
  await writeTabHeaders(id, "rent");
  const wb = await readWorkbook(id, { fresh: true });
  const inc = wb.incubatees.find((r) => r["incubatee_id"] === input.incubatee_id);
  if (!inc) throw new Error("Incubatee not found. Add the tenant first.");

  const ids = spaceIds(inc["lab_id"]);
  const billedArea = totalArea(wb.labs, inc["lab_id"]);
  const fallbackGross = grossRent(
    billedArea,
    wb.settings,
    num(inc["monthly_rent"]) ||
      ids.reduce(
        (sum, sid) => sum + num(wb.labs.find((l) => l["lab_id"] === sid)?.["monthly_rent"]),
        0,
      ),
  );
  const settings = wb.settings;
  const cgstPct = input.cgst_pct ?? settingNum(settings, "cgst_pct");
  const sgstPct = input.sgst_pct ?? settingNum(settings, "sgst_pct");

  const bill = computeRentBill({
    gross: input.gross_amount && input.gross_amount > 0 ? input.gross_amount : fallbackGross,
    // Empty strings mean "use what's on record" — the form preview falls back
    // to the tenant's stored discount, so the saved invoice must do the same
    // or staff would see a different total on the PDF than on the preview.
    discountPct: input.discount_pct || inc["discount_pct"],
    discountAmount: input.discount_amount || inc["discount_amount"],
    maintenancePct: input.maintenance_pct || settingNum(settings, "maintenance_pct"),
    maintenanceAmount: input.maintenance_amount,
    maintenanceRatePerSqft: settingNum(settings, "maintenance_rate_per_sqft"),
    areaSqft: billedArea,
    gstApplicable: input.gst_applicable,
    cgstPct,
    sgstPct,
  });

  const invoiceId = (input.invoice_id ?? "").trim() || `RI-${input.month}-${input.incubatee_id}`;
  const existing = wb.rent.find((r) => r["invoice_id"] === invoiceId);
  if (existing && !canEdit) {
    throw new Error(
      "This invoice already exists. Only a super admin can revise a generated invoice.",
    );
  }
  const invoiceDate = (input.invoice_date ?? "").trim() || monthEnd(input.month);
  const invoiceNo =
    existing?.["invoice_no"] ||
    nextInvoiceNo(
      wb.rent.map((r) => r["invoice_no"] ?? ""),
      settings["invoice_series"] || DEFAULT_SETTINGS["invoice_series"] || "GBP/IN",
      invoiceDate,
    );
  const paid = num(existing?.["amount_paid"]);
  const dueDate = (input.due_date ?? "").trim() || rentDueDate(input.month, settings);

  const row: Row = {
    invoice_id: invoiceId,
    invoice_no: invoiceNo,
    incubatee_id: input.incubatee_id,
    company_name: inc["company_name"] ?? "",
    lab_id: inc["lab_id"] ?? "",
    month: input.month,
    invoice_date: invoiceDate,
    due_date: dueDate,
    gross_amount: String(bill.gross),
    discount: String(bill.discount),
    rent_amount: String(bill.rent),
    maintenance_amount: String(bill.maintenance),
    taxable_value: String(bill.taxable),
    gst_applicable: input.gst_applicable ? "yes" : "no",
    cgst_pct: input.gst_applicable ? String(cgstPct) : "0",
    cgst: String(bill.cgst),
    sgst_pct: input.gst_applicable ? String(sgstPct) : "0",
    sgst: String(bill.sgst),
    round_off: String(bill.roundOff),
    amount: String(bill.total),
    amount_paid: String(paid),
    balance: String(Math.max(0, bill.total - paid)),
    status: dueStatus(bill.total, paid, dueDate),
    party_gstin: (input.party_gstin ?? inc["gstin"] ?? "").trim(),
    hsn_rent: settings["hsn_rent"] || DEFAULT_SETTINGS["hsn_rent"] || "",
    hsn_maintenance: settings["hsn_maintenance"] || DEFAULT_SETTINGS["hsn_maintenance"] || "",
    remarks: input.remarks ?? `Bill for the month of ${input.month}`,
    generated_by: input.generated_by,
    timestamp: new Date().toISOString(),
    payment_date: existing?.["payment_date"] ?? "",
    payment_mode: existing?.["payment_mode"] ?? "",
    txn_ref: existing?.["txn_ref"] ?? "",
    notes: bill.discount > 0 ? `Discount applied: ${bill.discount}` : "",
  };

  const updated = await updateRowById(id, "rent", invoiceId, row);
  if (!updated) await appendRows(id, "rent", [row]);
  await logAudit({
    actor: input.generated_by,
    action: existing ? "rent invoice updated" : "rent invoice created",
    entity: "rent",
    entity_id: invoiceId,
    entity_name: inc["company_name"] ?? "",
    month: input.month,
    amount: bill.total,
    details: `${invoiceNo} · gross ${bill.gross} · discount ${bill.discount} · total ${bill.total}`,
  });
  return { invoiceId, invoiceNo, total: bill.total };
}

export async function deleteRentInvoice(invoiceId: string) {
  const id = await requireSpreadsheetId();
  const wb = await readWorkbook(id, { fresh: true });
  const invoice = wb.rent.find((r) => (r["invoice_id"] ?? "") === invoiceId);
  const ok = await deleteRowById(id, "rent", invoiceId);
  if (!ok) throw new Error("Invoice not found.");
  if (invoice) {
    await logAudit({
      actor: "system",
      action: "rent invoice deleted",
      entity: "rent",
      entity_id: invoiceId,
      entity_name: invoice["company_name"] ?? "",
      month: invoice["month"] ?? "",
      amount: num(invoice["amount"]),
      details: `Deleted from the rent ledger (was ${invoice["invoice_no"] || "unnumbered"} · ₹${invoice["amount"] || "?"} for ${invoice["month"] || "?"})`,
    });
  }
  return { ok: true };
}

/**
 * Manual rent ledger entry: the finance officer already raised the bill outside
 * the app and only feeds the figures in. Amounts are stored exactly as typed.
 */
export async function saveManualRentEntry(input: {
  invoice_id?: string | undefined;
  invoice_no?: string | undefined;
  incubatee_id: string;
  month: string;
  invoice_date?: string | undefined;
  due_date?: string | undefined;
  rent_amount: number;
  maintenance_amount: number;
  gst_applicable: boolean;
  cgst_pct?: number | undefined;
  sgst_pct?: number | undefined;
  remarks?: string | undefined;
  generated_by: string;
}) {
  const id = await requireSpreadsheetId();
  await writeTabHeaders(id, "rent");
  const wb = await readWorkbook(id, { fresh: true });
  const inc = wb.incubatees.find((r) => r["incubatee_id"] === input.incubatee_id);
  if (!inc) throw new Error("Tenant not found. Add the tenant first.");

  const settings = wb.settings;
  const cgstPct = input.gst_applicable
    ? (input.cgst_pct ?? settingNum(settings, "cgst_pct"))
    : 0;
  const sgstPct = input.gst_applicable
    ? (input.sgst_pct ?? settingNum(settings, "sgst_pct"))
    : 0;
  const rent = Math.max(0, input.rent_amount);
  const maintenance = Math.max(0, input.maintenance_amount);
  const taxable = rent + maintenance;
  const cgst = round2((taxable * cgstPct) / 100);
  const sgst = round2((taxable * sgstPct) / 100);
  const raw = taxable + cgst + sgst;
  const total = Math.round(raw);
  const roundOff = round2(total - raw);

  const invoiceId = (input.invoice_id ?? "").trim() || `EM-RENT-${input.month}-${input.incubatee_id}`;
  const existing = wb.rent.find((r) => r["invoice_id"] === invoiceId);
  const invoiceDate = (input.invoice_date ?? "").trim() || monthEnd(input.month);
  const paid = num(existing?.["amount_paid"]);
  const dueDate = (input.due_date ?? "").trim() || rentDueDate(input.month, settings);

  const row: Row = {
    invoice_id: invoiceId,
    invoice_no: (input.invoice_no ?? "").trim() || existing?.["invoice_no"] || invoiceId,
    incubatee_id: input.incubatee_id,
    company_name: inc["company_name"] ?? "",
    lab_id: inc["lab_id"] ?? "",
    month: input.month,
    invoice_date: invoiceDate,
    due_date: dueDate,
    gross_amount: String(rent),
    discount: "0",
    rent_amount: String(rent),
    maintenance_amount: String(maintenance),
    taxable_value: String(taxable),
    gst_applicable: input.gst_applicable ? "yes" : "no",
    cgst_pct: String(cgstPct),
    cgst: String(cgst),
    sgst_pct: String(sgstPct),
    sgst: String(sgst),
    round_off: String(roundOff),
    amount: String(total),
    amount_paid: String(paid),
    balance: String(Math.max(0, total - paid)),
    status: existing?.["status"] === "paid" && paid >= total ? "paid" : dueStatus(total, paid, dueDate),
    party_gstin: inc["gstin"] ?? "",
    hsn_rent: settings["hsn_rent"] || DEFAULT_SETTINGS["hsn_rent"] || "",
    hsn_maintenance: settings["hsn_maintenance"] || DEFAULT_SETTINGS["hsn_maintenance"] || "",
    remarks: (input.remarks ?? "").trim() || `Manual entry for ${input.month}`,
    generated_by: input.generated_by,
    timestamp: new Date().toISOString(),
    payment_date: existing?.["payment_date"] ?? "",
    payment_mode: existing?.["payment_mode"] ?? "",
    txn_ref: existing?.["txn_ref"] ?? "",
    notes: existing?.["notes"] ?? "Entered manually",
  };

  const updated = await updateRowById(id, "rent", invoiceId, row);
  if (!updated) await appendRows(id, "rent", [row]);
  return { invoiceId, total };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Finance-manager action: record a rent receipt. Without `amount` the whole
 * outstanding balance is settled; with `amount` a part payment is recorded and
 * the remaining balance stays visible in the sheet and the app.
 */
export async function markRentInvoicePaid(input: {
  invoice_id: string;
  payment_date: string;
  payment_mode: string;
  txn_ref?: string | undefined;
  remarks?: string | undefined;
  amount?: number | undefined;
  recorded_by: string;
}) {
  const id = await requireSpreadsheetId();
  await writeTabHeaders(id, "rent");
  const wb = await readWorkbook(id, { fresh: true });
  const invoice = wb.rent.find((r) => r["invoice_id"] === input.invoice_id);
  if (!invoice) throw new Error("Invoice not found.");
  const amount = num(invoice["amount"]);
  const alreadyPaid = num(invoice["amount_paid"]);
  const balance = Math.max(0, amount - alreadyPaid);
  if (balance <= 0) return { ok: true, balance: 0, amount: 0, paymentId: "" };
  const received =
    input.amount !== undefined && input.amount > 0 ? Math.min(input.amount, balance) : balance;
  const paidTotal = round2(alreadyPaid + received);
  const remaining = round2(Math.max(0, amount - paidTotal));

  const paymentId = newId("PAY");

  await appendRows(id, "payments", [
    {
      payment_id: paymentId,
      date: input.payment_date,
      incubatee_id: invoice["incubatee_id"] ?? "",
      ref_id: input.invoice_id,
      type: "rent",
      amount: String(received),
      mode: input.payment_mode,
      reference: input.txn_ref ?? "",
      recorded_by: input.recorded_by,
      notes:
        (input.remarks ?? "").trim() ||
        `Rent invoice ${invoice["invoice_no"] ?? input.invoice_id} ${remaining > 0 ? "part payment" : "marked paid"}`,
    },
  ]);

  await updateRowById(id, "rent", input.invoice_id, {
    amount_paid: String(paidTotal),
    balance: String(remaining),
    status: remaining > 0 ? dueStatus(amount, paidTotal, invoice["due_date"]) : "paid",
    payment_date: input.payment_date,
    payment_mode: input.payment_mode,
    txn_ref: input.txn_ref ?? "",
    notes: (input.remarks ?? "").trim() || invoice["notes"] || "",
  });
  return { ok: true, balance: remaining, amount: received, paymentId };
}

export async function generateRentInvoices(month: string) {
  const id = await requireSpreadsheetId();
  // Always work from a fresh read: a stale cache made this look like a no-op.
  await writeTabHeaders(id, "rent");
  const wb = await readWorkbook(id, { fresh: true });
  const dueDate = rentDueDate(month, wb.settings);
  const invoiceDate = monthEnd(month);
  const gst = gstEnabled(wb.settings);
  const cgstPct = settingNum(wb.settings, "cgst_pct");
  const sgstPct = settingNum(wb.settings, "sgst_pct");
  const issued = wb.rent.map((r) => r["invoice_no"] ?? "");

  const active = wb.incubatees.filter(
    (r) => r["status"] !== "exited" && String(r["lab_id"] ?? "").trim() !== "",
  );
  const skippedNoLab = wb.incubatees.filter(
    (r) => r["status"] !== "exited" && String(r["lab_id"] ?? "").trim() === "",
  );
  if (active.length === 0) {
    throw new Error(
      "No active tenant is allotted to a space yet, so there is nothing to invoice. Add a tenant with a space on the Tenants page first.",
    );
  }

  const rows: Row[] = [];
  let updated = 0;
  for (const inc of active) {
    const lab = wb.labs.find((l) => l["lab_id"] === inc["lab_id"]);
    const gross = grossRent(
      lab?.["area_sqft"],
      wb.settings,
      num(inc["monthly_rent"]) || num(lab?.["monthly_rent"]),
    );
    const bill = computeRentBill({
      gross,
      discountPct: inc["discount_pct"],
      discountAmount: inc["discount_amount"],
      maintenancePct: settingNum(wb.settings, "maintenance_pct"),
      maintenanceRatePerSqft: settingNum(wb.settings, "maintenance_rate_per_sqft"),
      areaSqft: lab?.["area_sqft"],
      gstApplicable: gst,
      cgstPct,
      sgstPct,
    });
    const invoiceId = `RI-${month}-${inc["incubatee_id"]}`;
    const existing = wb.rent.find((r) => r["invoice_id"] === invoiceId);
    const paid = num(existing?.["amount_paid"]);
    const invoiceNo =
      existing?.["invoice_no"] ||
      nextInvoiceNo(
        issued,
        wb.settings["invoice_series"] || DEFAULT_SETTINGS["invoice_series"] || "GBP/IN",
        invoiceDate,
      );
    if (!existing?.["invoice_no"]) issued.push(invoiceNo);
    const row: Row = {
      invoice_id: invoiceId,
      invoice_no: invoiceNo,
      incubatee_id: String(inc["incubatee_id"]),
      company_name: String(inc["company_name"] ?? ""),
      lab_id: String(inc["lab_id"]),
      month,
      invoice_date: invoiceDate,
      due_date: dueDate,
      gross_amount: String(bill.gross),
      discount: String(bill.discount),
      rent_amount: String(bill.rent),
      maintenance_amount: String(bill.maintenance),
      taxable_value: String(bill.taxable),
      gst_applicable: gst ? "yes" : "no",
      cgst_pct: gst ? String(cgstPct) : "0",
      cgst: String(bill.cgst),
      sgst_pct: gst ? String(sgstPct) : "0",
      sgst: String(bill.sgst),
      round_off: String(bill.roundOff),
      amount: String(bill.total),
      amount_paid: String(paid),
      balance: String(Math.max(0, bill.total - paid)),
      status: dueStatus(bill.total, paid, dueDate),
      party_gstin: String(inc["gstin"] ?? ""),
      hsn_rent: wb.settings["hsn_rent"] || DEFAULT_SETTINGS["hsn_rent"] || "",
      hsn_maintenance:
        wb.settings["hsn_maintenance"] || DEFAULT_SETTINGS["hsn_maintenance"] || "",
      remarks: `Bill for the month of ${month}`,
      generated_by: "",
      timestamp: new Date().toISOString(),
      payment_date: existing?.["payment_date"] ?? "",
      payment_mode: existing?.["payment_mode"] ?? "",
      txn_ref: existing?.["txn_ref"] ?? "",
      notes: bill.discount > 0 ? `Discount applied: ${bill.discount}` : "",
    };
    if (existing) {
      // Refresh the amount if rent or discount changed, but never touch a paid bill.
      if (paid === 0) {
        await updateRowById(id, "rent", invoiceId, row);
        updated += 1;
      }
    } else {
      rows.push(row);
    }
  }

  await appendRows(id, "rent", rows);
  return {
    created: rows.length,
    updated,
    tenants: active.length,
    skipped: skippedNoLab.map((s) => String(s["company_name"] ?? s["incubatee_id"] ?? "Unnamed")),
  };
}

/* ----------------------------- payments --------------------------------- */

export async function recordPayment(input: {
  type: "rent" | "electricity" | "deposit" | "other";
  ref_id?: string | undefined;
  incubatee_id: string;
  amount: number;
  date: string;
  mode: string;
  reference?: string | undefined;
  notes?: string | undefined;
  recorded_by: string;
}) {
  const id = await requireSpreadsheetId();
  const payment: Row = {
    payment_id: newId("PAY"),
    date: input.date,
    incubatee_id: input.incubatee_id,
    ref_id: input.ref_id ?? "",
    type: input.type,
    amount: String(input.amount),
    mode: input.mode,
    reference: input.reference ?? "",
    recorded_by: input.recorded_by,
    notes: input.notes ?? "",
  };
  await appendRows(id, "payments", [payment]);

  let balance = 0;
  let month = "";
  let labId = "";
  if (input.ref_id && input.type === "electricity") {
    // Electricity bills live in the billing-engine ledger (paid / unpaid).
    const wb = await readWorkbook(id);
    const bill = wb.ledger.find((b) => b["bill_id"] === input.ref_id);
    if (bill) {
      month = (bill["bill_date"] ?? "").slice(0, 7);
      const total = num(bill["total_amount"]);
      const paid = num(bill["amount_paid"]) + input.amount;
      balance = Math.max(0, total - paid);
      await updateRowById(id, "ledger", input.ref_id, {
        amount_paid: String(paid),
        balance: String(balance),
        status: balance <= 0 ? "paid" : "partial",
        payment_date: input.date,
        payment_mode: input.mode,
        txn_ref: input.reference ?? "",
      });
    }
  } else if (input.ref_id && input.type === "rent") {
    const wb = await readWorkbook(id);
    const target = wb.rent.find((r) => r["invoice_id"] === input.ref_id);
    if (target) {
      const paid = num(target["amount_paid"]) + input.amount;
      balance = Math.max(0, num(target["amount"]) - paid);
      month = target["month"] ?? "";
      labId = target["lab_id"] ?? "";
      await updateRowById(id, "rent", input.ref_id, {
        amount_paid: String(paid),
        balance: String(balance),
        status: dueStatus(num(target["amount"]), paid, target["due_date"]),
      });
    }
  }
  return { paymentId: payment["payment_id"] ?? "", balance, month, labId };
}

/* ----------------------------- settings --------------------------------- */

/* -------------------------- power billing ------------------------------- */

export type PowerClientInput = {
  client_id?: string | undefined;
  client_name: string;
  address?: string | undefined;
  connected_load_kw?: string | undefined;
  whatsapp?: string | undefined;
  fixed_ac_units?: string | undefined;
  ac_fixed_charge?: string | undefined;
  incubatee_id?: string | undefined;
  notes?: string | undefined;
  meters: { id: string; labName: string; meterNo: string }[];
};

export async function savePowerClient(input: PowerClientInput) {
  const id = await requireSpreadsheetId();
  const clientId = (input.client_id ?? "").trim() || newId("GBP-CLI");
  const record: Row = {
    client_id: clientId,
    client_name: input.client_name,
    address: input.address ?? "",
    connected_load_kw: input.connected_load_kw ?? "",
    whatsapp: input.whatsapp ?? "",
    fixed_ac_units: input.fixed_ac_units ?? "",
    ac_fixed_charge: input.ac_fixed_charge ?? "",
    incubatee_id: input.incubatee_id ?? "",
    meters: JSON.stringify(input.meters),
    notes: input.notes ?? "",
  };
  const updated = await updateRowById(id, "clients", clientId, record);
  if (!updated) await appendRows(id, "clients", [record]);
  return { clientId };
}

export async function deletePowerClient(clientId: string) {
  const id = await requireSpreadsheetId();
  const wb = await readWorkbook(id, { fresh: true });
  const client = wb.clients.find((c) => c["client_id"] === clientId);
  const billCount = wb.ledger.filter((b) => (b["client_id"] ?? "") === clientId).length;
  if (billCount > 0) {
    // Bills are financial records: they are NEVER bulk-deleted with a client.
    // They stay in the ledger (shown as orphaned in the UI) until each bill is
    // deleted individually on purpose.
    throw new Error(
      `${client?.["client_name"] || clientId} still has ${billCount} electricity bill(s). Bills are financial records and are kept — delete the individual bills first if you really need to.`,
    );
  }
  await deleteRowById(id, "clients", clientId);
  if (client) {
    await logAudit({
      actor: "system",
      action: "billing client deleted",
      entity: "electricity",
      entity_id: clientId,
      entity_name: client["client_name"] ?? "",
      details: "Client removed from PowerClients (no bills existed)",
    });
  }
  return { ok: true };
}

/**
 * One billing client per company. Creates clients for active tenants without
 * one, tops up existing clients with any lab meters they are missing, and
 * MERGES legacy duplicate rows (a company that got one PowerClients row per
 * lab before the per-company fix): meters are combined into the first row,
 * its duplicate rows are deleted, and their bills are re-pointed so arrears,
 * readings and the ledger all resolve to a single company.
 */
export async function importTenantClients() {
  const id = await requireSpreadsheetId();
  const wb = await readWorkbook(id, { fresh: true });

  const tenants = wb.incubatees.filter(
    (t) =>
      (t["status"] ?? "active").toLowerCase() === "active" &&
      (t["company_name"] ?? "").trim() !== "",
  );

  // One billing client per company: a tenant occupying several labs (recorded
  // as multiple tenant rows) still gets a single client whose meters cover
  // every lab the company occupies.
  const groups = new Map<string, typeof tenants>();
  for (const t of tenants) {
    const key = (t["company_name"] ?? "").trim().toLowerCase();
    const group = groups.get(key) ?? [];
    group.push(t);
    groups.set(key, group);
  }

  // Existing client rows indexed by normalized name, keeping sheet order so
  // the first row is the merge target for any duplicates.
  const clientsByName = new Map<string, Row[]>();
  for (const c of wb.clients) {
    const key = (c["client_name"] ?? "").trim().toLowerCase();
    if (key === "") continue;
    const rows = clientsByName.get(key) ?? [];
    rows.push(c);
    clientsByName.set(key, rows);
  }

  const meterKey = (labName: string) => labName.trim().toLowerCase();
  let created = 0;
  let merged = 0;
  let updated = 0;

  for (const [key, group] of groups) {
    const incubateeIds = [
      ...new Set(
        group.map((t) => (t["incubatee_id"] ?? "").trim()).filter((v) => v !== ""),
      ),
    ];
    const labs = [
      ...new Set(group.flatMap((t) => spaceIds(t["lab_id"])).filter((v) => v !== "")),
    ];
    const existingRows = clientsByName.get(key) ?? [];

    if (existingRows.length > 1) {
      const primary = existingRows[0]!;
      const primaryId = (primary["client_id"] ?? "").trim();
      const primaryName = (primary["client_name"] ?? "").trim();
      const dupRows = existingRows.slice(1);
      if (primaryId === "") continue;

      const meters: { id: string; labName: string; meterNo: string }[] = [];
      for (const row of existingRows) {
        for (const m of parseMeters(row["meters"])) {
          if (m.labName.trim() === "" && m.meterNo.trim() === "") continue;
          const k = meterKey(m.labName || m.meterNo);
          if (meters.some((x) => meterKey(x.labName || x.meterNo) === k)) continue;
          meters.push(m);
        }
      }
      for (const lab of labs) {
        if (meters.some((m) => meterKey(m.labName) === meterKey(lab))) continue;
        meters.push({ id: `M-${meters.length + 1}`, labName: lab, meterNo: "" });
      }
      meters.forEach((m, i) => {
        m.id = `M-${i + 1}`;
      });
      const pick = (field: string) =>
        existingRows.map((r) => (r[field] ?? "").trim()).find((v) => v !== "") ?? "";

      await savePowerClient({
        client_id: primaryId,
        client_name: primaryName,
        address: pick("address"),
        connected_load_kw: pick("connected_load_kw"),
        whatsapp: pick("whatsapp"),
        fixed_ac_units: pick("fixed_ac_units"),
        ac_fixed_charge: pick("ac_fixed_charge"),
        incubatee_id: (primary["incubatee_id"] ?? "").trim() || incubateeIds[0] || "",
        notes: pick("notes"),
        meters,
      });
      // Bills recorded under a duplicate id move to the surviving client.
      const dupIds = [
        ...new Set(
          dupRows
            .map((d) => (d["client_id"] ?? "").trim())
            .filter((v) => v !== "" && v !== primaryId),
        ),
      ];
      for (const bill of wb.ledger) {
        const billId = (bill["bill_id"] ?? "").trim();
        if (billId === "" || !dupIds.includes((bill["client_id"] ?? "").trim())) continue;
        await updateRowById(id, "ledger", billId, {
          client_id: primaryId,
          client_name: primaryName,
        });
      }
      for (const dupId of dupIds) {
        await deleteRowById(id, "clients", dupId);
      }
      merged += dupRows.length;
      continue;
    }

    if (existingRows.length === 1) {
      // Single client row: add meters for labs it is missing and backfill the
      // tenant link — never touching values the user has already configured.
      const row = existingRows[0]!;
      const meters = parseMeters(row["meters"]);
      const missingLabs = labs.filter(
        (lab) => !meters.some((m) => meterKey(m.labName) === meterKey(lab)),
      );
      const incubateeId = (row["incubatee_id"] ?? "").trim();
      if (missingLabs.length === 0 && incubateeId !== "") continue;
      const nextMeters = [
        ...meters,
        ...missingLabs.map((lab, i) => ({
          id: `M-${meters.length + i + 1}`,
          labName: lab,
          meterNo: "",
        })),
      ];
      await savePowerClient({
        client_id: (row["client_id"] ?? "").trim(),
        client_name: (row["client_name"] ?? "").trim(),
        address: row["address"] ?? "",
        connected_load_kw: row["connected_load_kw"] ?? "",
        whatsapp: (row["whatsapp"] ?? "").trim() || (group[0]?.["phone"] ?? ""),
        fixed_ac_units: row["fixed_ac_units"] ?? "",
        ac_fixed_charge: row["ac_fixed_charge"] ?? "",
        incubatee_id: incubateeId || incubateeIds[0] || "",
        notes: row["notes"] ?? "",
        meters: nextMeters,
      });
      updated += 1;
      continue;
    }

    // No client row yet: create one covering every lab the company occupies.
    const primary = group[0]!;
    const firstLab = (primary["lab_id"] ?? "").trim();
    const meters = labs.length
      ? labs.map((labId, i) => ({ id: `M-${i + 1}`, labName: labId, meterNo: "" }))
      : [{ id: "M-1", labName: firstLab || (primary["company_name"] ?? ""), meterNo: "" }];
    await savePowerClient({
      client_name: (primary["company_name"] ?? "").trim(),
      address: labs.length
        ? `${labs.join(", ")}, Guwahati Biotech Park`
        : firstLab
          ? `${firstLab}, Guwahati Biotech Park`
          : "",
      whatsapp: primary["phone"] ?? "",
      incubatee_id: incubateeIds[0] ?? "",
      meters,
    });
    created += 1;
  }
  return {
    created,
    merged,
    updated,
    skipped: Math.max(0, tenants.length - created - merged - updated),
  };
}

export type PowerBillInput = {
  bill_id?: string | undefined;
  client_id: string;
  bill_date: string;
  due_date: string;
  period_from: string;
  period_to: string;
  readings: { labName: string; meterNo: string; prevReading: number; presReading: number }[];
  include_ac_units: boolean;
  /** Override for fixed AC units billed on this bill. */
  ac_units?: number | undefined;
  apply_fixed_charge: boolean;
  /** Per-bill override for the connected load (kW) used for fixed charges. */
  connected_load_kw?: number | undefined;
  include_ac_charge: boolean;
  ac_charge?: number | undefined;

  arrears: number;
  surcharge_months: number;
  duty_pct?: number | undefined;
  generated_by: string;
};

export async function savePowerBill(input: PowerBillInput) {
  const id = await requireSpreadsheetId();
  const wb = await readWorkbook(id);
  const client = wb.clients.find((c) => c["client_id"] === input.client_id);
  if (!client) throw new Error("Billing client not found.");
  // The engine may override the sanctioned load for this bill; fall back to the client profile.
  const connectedLoadKw =
    input.connected_load_kw !== undefined && input.connected_load_kw > 0
      ? input.connected_load_kw
      : num(client["connected_load_kw"]);

  const tariffRate = electricityTariffRate(wb.settings);
  const fixedChargeRate = electricityFixedChargeRate(wb.settings);
  const surchargePct =
    settingNum(wb.settings, "late_surcharge_pct") || 1.5;
  const dutyPct =
    input.duty_pct !== undefined ? input.duty_pct : electricityDutyPct(wb.settings);
  const acCharge =
    input.ac_charge !== undefined && input.ac_charge > 0
      ? input.ac_charge
      : num(client["ac_fixed_charge"]);

  const readings =
    input.readings.length > 0
      ? input.readings
      : parseMeters(client["meters"]).map((m) => ({
          labName: m.labName,
          meterNo: m.meterNo,
          prevReading: 0,
          presReading: 0,
        }));

  const computed = computeBill({
    readings,
    periodFrom: input.period_from,
    periodTo: input.period_to,
    connectedLoadKw,
    tariffRate,
    fixedChargeRate,
    applyFixedCharge: input.apply_fixed_charge,
    acUnits: input.ac_units !== undefined ? input.ac_units : num(client["fixed_ac_units"]),
    includeAcUnits: input.include_ac_units,

    acCharge,
    includeAcCharge: input.include_ac_charge,
    dutyPct,
    arrears: input.arrears,
    surchargePct,
    surchargeMonths: input.surcharge_months,
  });

  const requested = (input.bill_id ?? "").trim();
  let existing = requested ? wb.ledger.find((b) => (b["bill_id"] ?? "") === requested) : undefined;
  let billId =
    existing?.["bill_id"] ??
    (requested !== ""
      ? requested
      : nextBillNumber(
          wb.ledger.map((b) => b["bill_id"] ?? ""),
          new Date(input.bill_date || Date.now()).getFullYear(),
        ));

  if (!existing) {
    // Re-check against a fresh read before writing: a stale cache can allocate
    // a bill number that already exists, and writing it could clobber another
    // client's bill row (reports of "bills missing from the sheet" traced back
    // to exactly this). The fresh read must fail loudly on a Google error —
    // never silently fall back to stale data here.
    const freshWb = await readWorkbook(id, { fresh: true });
    const clash = freshWb.ledger.find((b) => (b["bill_id"] ?? "") === billId);
    if (clash) {
      if ((clash["client_id"] ?? "") !== input.client_id) {
        throw new Error(
          `Bill number ${billId} already belongs to ${clash["client_name"] || "another client"}. Nothing was saved — pick a different invoice number.`,
        );
      }
      if (requested !== "") {
        existing = clash;
        billId = clash["bill_id"] ?? billId;
      } else {
        billId = nextBillNumber(
          freshWb.ledger.map((b) => b["bill_id"] ?? ""),
          new Date(input.bill_date || Date.now()).getFullYear(),
        );
      }
    }
  }


  const row: Row = {
    bill_id: billId,
    client_id: input.client_id,
    client_name: client["client_name"] ?? "",
    bill_date: input.bill_date,
    due_date: input.due_date,
    period_from: input.period_from,
    period_to: input.period_to,
    days: String(computed.days),
    meter_units: String(computed.meterUnits),
    ac_units: String(computed.acUnits),
    total_units: String(computed.totalUnits),
    tariff_rate: String(tariffRate),
    energy_charge: String(computed.energyCharge),
    connected_load_kw: String(connectedLoadKw),
    fixed_charge_rate: String(input.apply_fixed_charge ? fixedChargeRate : 0),
    fixed_charge: String(computed.fixedCharge),
    ac_charge: String(computed.acCharge),
    duty_pct: String(dutyPct),
    electricity_duty: String(computed.duty),
    arrears: String(computed.arrears),
    surcharge: String(computed.surcharge),
    surcharge_months: String(input.surcharge_months),
    total_amount: String(computed.total),
    amount_paid: String(num(existing?.["amount_paid"])),
    balance: String(Math.max(0, computed.total - num(existing?.["amount_paid"]))),
    status:
      num(existing?.["amount_paid"]) >= computed.total && computed.total > 0
        ? "paid"
        : num(existing?.["amount_paid"]) > 0
          ? "partial"
          : "unpaid",
    payment_date: existing?.["payment_date"] ?? "",
    payment_mode: existing?.["payment_mode"] ?? "",
    txn_ref: existing?.["txn_ref"] ?? "",
    readings: JSON.stringify(computed.readings),
    generated_by: input.generated_by,
    timestamp: new Date().toISOString(),
  };

  if (existing) {
    const updated = await updateRowById(id, "ledger", billId, row);
    if (!updated) {
      // The cached read said the bill exists but the sheet disagrees. Appending
      // here would create a duplicate bill row — surface the conflict instead.
      throw new Error(
        `Bill ${billId} no longer exists in the sheet. Reload the billing page and try again — nothing was overwritten.`,
      );
    }
  } else {
    await appendRows(id, "ledger", [row]);
  }
  await logAudit({
    actor: input.generated_by,
    action: existing ? "electricity bill updated" : "electricity bill created",
    entity: "electricity",
    entity_id: billId,
    entity_name: client["client_name"] ?? "",
    month: (input.bill_date || "").slice(0, 7),
    amount: computed.total,
    details: `${computed.totalUnits} units · period ${input.period_from} → ${input.period_to} · arrears ${computed.arrears}`,
  });
  return { billId, total: computed.total };
}

/**
 * Record an electricity receipt. Without `amount` the whole outstanding balance
 * is settled; with `amount` a part payment is stored and the balance remains
 * visible in the sheet (amount_paid / balance columns) and in the app.
 */
export async function markPowerBillPaid(input: {
  bill_id: string;
  payment_date: string;
  payment_mode: string;
  txn_ref?: string | undefined;
  remarks?: string | undefined;
  amount?: number | undefined;
  recorded_by?: string | undefined;
}) {
  const id = await requireSpreadsheetId();
  await writeTabHeaders(id, "ledger");
  const wb = await readWorkbook(id, { fresh: true });
  const bill = wb.ledger.find((b) => b["bill_id"] === input.bill_id);
  if (!bill) throw new Error("Bill not found.");

  const total = num(bill["total_amount"]);
  const stored = String(bill["amount_paid"] ?? "").trim();
  const prior =
    stored !== "" ? num(stored) : (bill["status"] ?? "").toLowerCase() === "paid" ? total : 0;
  const outstanding = Math.max(0, total - prior);
  if (outstanding <= 0) return { ok: true, received: 0, balance: 0, paymentId: "" };

  const received =
    input.amount !== undefined && input.amount > 0
      ? Math.min(input.amount, outstanding)
      : outstanding;
  const paidTotal = round2(prior + received);
  const balance = round2(Math.max(0, total - paidTotal));

  const client = wb.clients.find((c) => c["client_id"] === bill["client_id"]);
  const paymentId = newId("PAY");
  await appendRows(id, "payments", [
    {
      payment_id: paymentId,
      date: input.payment_date,
      incubatee_id: client?.["incubatee_id"] ?? "",
      ref_id: input.bill_id,
      type: "electricity",
      amount: String(received),
      mode: input.payment_mode,
      reference: input.txn_ref ?? "",
      recorded_by: input.recorded_by ?? "",
      notes:
        (input.remarks ?? "").trim() ||
        `Electricity bill ${input.bill_id} ${balance > 0 ? "part payment" : "marked paid"}`,
    },
  ]);

  const patch: Row = {
    amount_paid: String(paidTotal),
    balance: String(balance),
    status: balance <= 0 ? "paid" : "partial",
    payment_date: input.payment_date,
    payment_mode: input.payment_mode,
    txn_ref: input.txn_ref ?? "",
  };
  if ((input.remarks ?? "").trim() !== "") patch["remarks"] = (input.remarks ?? "").trim();
  const ok = await updateRowById(id, "ledger", input.bill_id, patch);
  if (!ok) throw new Error("Bill not found.");
  await logAudit({
    actor: input.recorded_by ?? "system",
    action: balance <= 0 ? "electricity bill paid" : "electricity bill part-paid",
    entity: "electricity",
    entity_id: input.bill_id,
    entity_name: bill["client_name"] ?? "",
    month: (bill["bill_date"] ?? "").slice(0, 7),
    amount: received,
    details: `${input.payment_mode}${input.txn_ref ? ` · ${input.txn_ref}` : ""} · now ${paidTotal}/${total} · balance ${balance}`,
  });
  return { ok: true, received, balance, paymentId };
}

/**
 * Returns the billing client for a tenant, creating one on the fly so every
 * tenant can be billed for electricity the moment they are added.
 */
async function ensureClientForTenant(wb: Workbook, incubateeId: string): Promise<Row> {
  const existing = wb.clients.find((c) => (c["incubatee_id"] ?? "").trim() === incubateeId);
  if (existing) return existing;
  const tenant = wb.incubatees.find((t) => t["incubatee_id"] === incubateeId);
  if (!tenant) throw new Error("Tenant not found. Add the tenant first.");
  const labId = (tenant["lab_id"] ?? "").trim();
  const { clientId } = await savePowerClient({
    client_name: tenant["company_name"] ?? "",
    address: labId ? `${labId}, Guwahati Biotech Park` : "",
    whatsapp: tenant["phone"] ?? "",
    incubatee_id: incubateeId,
    meters: [{ id: "M-1", labName: labId || (tenant["company_name"] ?? ""), meterNo: "" }],
  });
  return {
    client_id: clientId,
    client_name: tenant["company_name"] ?? "",
    incubatee_id: incubateeId,
    connected_load_kw: "",
  };
}

/**
 * Manual electricity ledger entry: the bill was raised outside the app, so the
 * officer only records the client, period and amounts.
 */
export async function saveManualPowerEntry(input: {
  bill_id?: string | undefined;
  client_id?: string | undefined;
  incubatee_id?: string | undefined;
  bill_date: string;
  due_date: string;
  period_from?: string | undefined;
  period_to?: string | undefined;
  total_units?: number | undefined;
  energy_charge?: number | undefined;
  fixed_charge?: number | undefined;
  arrears?: number | undefined;
  total_amount: number;
  remarks?: string | undefined;
  generated_by: string;
}) {
  const id = await requireSpreadsheetId();
  await writeTabHeaders(id, "ledger");
  const wb = await readWorkbook(id, { fresh: true });
  // A tenant can be billed straight away: if they have no billing client row
  // yet, one is created from their tenant record.
  const client = input.client_id
    ? wb.clients.find((c) => c["client_id"] === input.client_id)
    : input.incubatee_id
      ? await ensureClientForTenant(wb, input.incubatee_id)
      : undefined;
  if (!client) throw new Error("Select a tenant to bill.");
  const clientId = client["client_id"] ?? "";

  const existing = input.bill_id
    ? wb.ledger.find((b) => b["bill_id"] === input.bill_id)
    : undefined;
  const billId = existing?.["bill_id"] ?? `EM-${input.bill_date.slice(0, 7)}-${clientId}`;
  const total = Math.max(0, input.total_amount);
  const priorPaid = num(existing?.["amount_paid"]);

  const row: Row = {
    bill_id: billId,
    client_id: clientId,
    client_name: client["client_name"] ?? "",
    bill_date: input.bill_date,
    due_date: input.due_date,
    period_from: input.period_from ?? "",
    period_to: input.period_to ?? "",
    days: "",
    meter_units: String(input.total_units ?? 0),
    ac_units: "0",
    total_units: String(input.total_units ?? 0),
    tariff_rate: "",
    energy_charge: String(input.energy_charge ?? 0),
    connected_load_kw: String(num(client["connected_load_kw"])),
    fixed_charge_rate: "",
    fixed_charge: String(input.fixed_charge ?? 0),
    ac_charge: "0",
    duty_pct: "",
    electricity_duty: "0",
    arrears: String(input.arrears ?? 0),
    surcharge: "0",
    surcharge_months: "0",
    total_amount: String(total),
    amount_paid: String(priorPaid),
    balance: String(Math.max(0, total - priorPaid)),
    status:
      priorPaid >= total && total > 0 ? "paid" : priorPaid > 0 ? "partial" : "unpaid",
    payment_date: existing?.["payment_date"] ?? "",
    payment_mode: existing?.["payment_mode"] ?? "",
    txn_ref: existing?.["txn_ref"] ?? "",
    readings: "[]",
    generated_by: input.generated_by,
    timestamp: new Date().toISOString(),
    remarks: (input.remarks ?? "").trim() || "Manually entered bill",
  };

  if (existing) await updateRowById(id, "ledger", billId, row);
  else await appendRows(id, "ledger", [row]);
  await logAudit({
    actor: input.generated_by,
    action: existing ? "manual electricity entry updated" : "manual electricity entry created",
    entity: "electricity",
    entity_id: billId,
    entity_name: client["client_name"] ?? "",
    month: (input.bill_date || "").slice(0, 7),
    amount: total,
    details: (input.remarks ?? "").trim() || "Manually entered bill",
  });
  return { billId, total };
}

export async function deletePowerBill(billId: string) {
  const id = await requireSpreadsheetId();
  const wb = await readWorkbook(id, { fresh: true });
  const bill = wb.ledger.find((b) => (b["bill_id"] ?? "") === billId);
  await deleteRowById(id, "ledger", billId);
  if (bill) {
    await logAudit({
      actor: "system",
      action: "electricity bill deleted",
      entity: "electricity",
      entity_id: billId,
      entity_name: bill["client_name"] ?? "",
      month: (bill["bill_date"] ?? "").slice(0, 7),
      amount: num(bill["total_amount"]),
      details: `Deleted from the electricity ledger (was ₹${bill["total_amount"] || "?"} dated ${bill["bill_date"] || "?"})`,
    });
  }
  return { ok: true };
}

export type OrphanRecord = {
  kind: "rent" | "electricity" | "client";
  id: string;
  label: string;
  reason: string;
  amount: number;
};

/** Ledger rows and billing clients whose tenant no longer exists in the sheet. */
export async function findOrphans(): Promise<OrphanRecord[]> {
  const id = await requireSpreadsheetId();
  const wb = await readWorkbook(id, { fresh: true });
  const tenants = new Set(
    wb.incubatees.map((i) => (i["incubatee_id"] ?? "").trim()).filter(Boolean),
  );
  const clientIds = new Set(wb.clients.map((c) => (c["client_id"] ?? "").trim()).filter(Boolean));
  const out: OrphanRecord[] = [];

  for (const r of wb.rent) {
    const invoiceId = (r["invoice_id"] ?? "").trim();
    if (!invoiceId) continue;
    const tenant = (r["incubatee_id"] ?? "").trim();
    if (!tenant || !tenants.has(tenant)) {
      out.push({
        kind: "rent",
        id: invoiceId,
        label: `${r["invoice_no"] || invoiceId} · ${r["company_name"] || "no tenant name"}`,
        reason: tenant ? `tenant ${tenant} was deleted` : "no tenant linked",
        amount: num(r["amount"]),
      });
    }
  }

  for (const b of wb.ledger) {
    const billId = (b["bill_id"] ?? "").trim();
    if (!billId) continue;
    const client = (b["client_id"] ?? "").trim();
    if (!client || !clientIds.has(client)) {
      out.push({
        kind: "electricity",
        id: billId,
        label: `${billId} · ${b["client_name"] || "no client name"}`,
        reason: client ? `billing client ${client} was deleted` : "no client linked",
        amount: num(b["total_amount"]),
      });
    }
  }

  for (const c of wb.clients) {
    const clientId = (c["client_id"] ?? "").trim();
    const tenant = (c["incubatee_id"] ?? "").trim();
    if (!clientId || !tenant) continue;
    if (!tenants.has(tenant)) {
      out.push({
        kind: "client",
        id: clientId,
        label: `${c["client_name"] || clientId}`,
        reason: `tenant ${tenant} was deleted`,
        amount: 0,
      });
    }
  }

  return out;
}

/** Delete every orphaned ledger row / billing client and log the sweep. */
export async function cleanupOrphans(actor: string) {
  const id = await requireSpreadsheetId();
  const orphans = await findOrphans();
  for (const o of orphans) {
    const tab = o.kind === "rent" ? "rent" : o.kind === "electricity" ? "ledger" : "clients";
    await deleteRowById(id, tab, o.id);
  }
  if (orphans.length) {
    await logAudit({
      actor,
      action: "orphan cleanup",
      entity: "rent",
      entity_id: `${orphans.length} records`,
      month: "",
      amount: orphans.reduce((s, o) => s + o.amount, 0),
      details: orphans.map((o) => `${o.kind}:${o.id}`).join(", ").slice(0, 400),
    });
  }
  return { removed: orphans.length, records: orphans };
}

export async function saveSettings(values: Record<string, string>) {
  const id = await requireSpreadsheetId();
  const wb = await readWorkbook(id);
  await replaceSettings(id, { ...DEFAULT_SETTINGS, ...wb.settings, ...values });
  return { ok: true };
}

/* ------------------------------- staff ---------------------------------- */

export async function listStaff() {
  const db = await admin();
  const [{ data: profiles, error: pErr }, { data: roles, error: rErr }] = await Promise.all([
    db.from("profiles").select("id, email, full_name, created_at"),
    db.from("user_roles").select("user_id, role"),
  ]);
  if (pErr) throw new Error(pErr.message);
  if (rErr) throw new Error(rErr.message);
  const roleMap = new Map<string, string>();
  (roles ?? []).forEach((r: { user_id: string; role: string }) => {
    const current = roleMap.get(r.user_id);
    const rank = { admin: 3, staff: 2, viewer: 1 } as Record<string, number>;
    if (!current || (rank[r.role] ?? 0) > (rank[current] ?? 0)) roleMap.set(r.user_id, r.role);
  });
  return (profiles ?? []).map(
    (p: { id: string; email: string | null; full_name: string | null; created_at: string }) => ({
      id: p.id,
      email: p.email ?? "",
      fullName: p.full_name ?? "",
      createdAt: p.created_at,
      role: roleMap.get(p.id) ?? "viewer",
    }),
  );
}

export async function setUserRole(targetUserId: string, role: AppRole, actingUserId: string) {
  if (targetUserId === actingUserId && role !== "admin") {
    throw new Error("You cannot remove your own admin access.");
  }
  const db = await admin();
  const { error: delErr } = await db.from("user_roles").delete().eq("user_id", targetUserId);
  if (delErr) throw new Error(delErr.message);
  const { error } = await db.from("user_roles").insert({ user_id: targetUserId, role });
  if (error) throw new Error(error.message);
  invalidateRoleCache(targetUserId);
  return { ok: true };
}
