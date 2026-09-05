import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireAuth as requireSupabaseAuth } from "./auth.functions-middleware";

export const getMe = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getMyRole, workbookStatus } = await import("./gbp.server");
    const [role, workbook] = await Promise.all([
      getMyRole(context.supabase, context.userId),
      workbookStatus(),
    ]);
    return {
      userId: context.userId,
      email: (context.claims["email"] as string | undefined) ?? "",
      role,
      workbook,
    };
  });

export const getWorkbook = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getMyRole, loadWorkbook, workbookStatus } = await import("./gbp.server");
    const [role, status] = await Promise.all([
      getMyRole(context.supabase, context.userId),
      workbookStatus(),
    ]);
    if (!status.connected) return { connected: false as const, role, data: null };
    const data = await loadWorkbook();
    return { connected: true as const, role, url: status.url, data };
  });

export const connectSheet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { link: string }) =>
    z.object({ link: z.string().trim().min(10).max(500) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { connectSpreadsheet, requireRole } = await import("./gbp.server");
    await requireRole(context.supabase, context.userId, ["admin"]);
    return connectSpreadsheet(data.link, context.userId);
  });

export const formatWorkbookFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireRole, requireSpreadsheetId } = await import("./gbp.server");
    const { formatWorkbook } = await import("./sheets.server");
    await requireRole(context.supabase, context.userId, ["admin"]);
    const spreadsheetId = await requireSpreadsheetId();
    await formatWorkbook(spreadsheetId);
    return { formatted: true };
  });

const labSchema = z.object({
  lab_id: z.string().trim().min(1).max(20),
  block: z.string().trim().max(30).optional().default(""),
  floor: z.string().trim().max(10).optional().default(""),
  area_sqft: z.string().trim().max(20).optional().default(""),
  monthly_rent: z.string().trim().max(20).optional().default(""),
  status: z.enum(["vacant", "occupied", "notice"]),
  notes: z.string().trim().max(500).optional().default(""),
  space_type: z
    .enum(["lab", "canteen", "utility", "office", "facility", "storage", "other"])
    .optional()
    .default("lab"),
  name: z.string().trim().max(120).optional().default(""),
});

export const saveLabFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => labSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { requireWrite, saveLab } = await import("./gbp.server");
    const role = await requireWrite(context.supabase, context.userId);
    return saveLab(data, role === "admin");
  });

export const deleteLabFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ lab_id: z.string().trim().min(1).max(20) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { deleteLab, requireEdit } = await import("./gbp.server");
    await requireEdit(context.supabase, context.userId);
    return deleteLab(data.lab_id);
  });

const incubateeSchema = z.object({
  incubatee_id: z.string().trim().max(40).optional().default(""),
  company_name: z.string().trim().min(1).max(120),
  founder_name: z.string().trim().max(120).optional().default(""),
  phone: z.string().trim().max(20).optional().default(""),
  email: z.string().trim().max(160).optional().default(""),
  lab_id: z.string().trim().max(20).optional().default(""),
  allotment_date: z.string().trim().max(20).optional().default(""),
  agreement_end: z.string().trim().max(20).optional().default(""),
  security_deposit: z.string().trim().max(20).optional().default(""),
  monthly_rent: z.string().trim().max(20).optional().default(""),
  discount_pct: z.string().trim().max(10).optional().default(""),
  discount_amount: z.string().trim().max(20).optional().default(""),
  status: z.enum(["active", "notice", "exited"]).default("active"),
  notes: z.string().trim().max(500).optional().default(""),
  agreement_start: z.string().trim().max(20).optional().default(""),
  agreement_no: z.string().trim().max(60).optional().default(""),
  lease_term_months: z.string().trim().max(6).optional().default(""),
  gstin: z.string().trim().max(30).optional().default(""),
  address: z.string().trim().max(300).optional().default(""),
});

export const saveIncubateeFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => incubateeSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { requireWrite, saveIncubatee } = await import("./gbp.server");
    const role = await requireWrite(context.supabase, context.userId);
    return saveIncubatee(data, role === "admin");
  });

export const vacateIncubateeFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { incubatee_id: string }) =>
    z.object({ incubatee_id: z.string().trim().min(1).max(40) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { requireEdit, vacateIncubatee } = await import("./gbp.server");
    await requireEdit(context.supabase, context.userId);
    return vacateIncubatee(data.incubatee_id);
  });

const monthSchema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) });

export const deleteIncubateeFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { incubatee_id: string }) =>
    z.object({ incubatee_id: z.string().trim().min(1).max(40) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { requireRole, deleteIncubatee } = await import("./gbp.server");
    await requireRole(context.supabase, context.userId, ["admin"]);
    return deleteIncubatee(data.incubatee_id);
  });

const rentInvoiceSchema = z.object({
  invoice_id: z.string().trim().max(80).optional(),
  incubatee_id: z.string().trim().min(1).max(40),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  invoice_date: z.string().trim().max(20).optional(),
  due_date: z.string().trim().max(20).optional(),
  gross_amount: z.number().min(0).max(100000000).optional(),
  discount_pct: z.string().trim().max(10).optional(),
  discount_amount: z.string().trim().max(20).optional(),
  maintenance_pct: z.string().trim().max(10).optional(),
  maintenance_amount: z.string().trim().max(20).optional(),
  gst_applicable: z.boolean().default(true),
  cgst_pct: z.number().min(0).max(50).optional(),
  sgst_pct: z.number().min(0).max(50).optional(),
  party_gstin: z.string().trim().max(30).optional(),
  remarks: z.string().trim().max(300).optional(),
});

export const saveRentInvoiceFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => rentInvoiceSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { requireWrite, saveRentInvoice } = await import("./gbp.server");
    const role = await requireWrite(context.supabase, context.userId);
    return saveRentInvoice(
      {
        ...data,
        generated_by: (context.claims["email"] as string | undefined) ?? context.userId,
      },
      role === "admin",
    );
  });

export const markRentPaidFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        invoice_id: z.string().trim().min(1).max(80),
        payment_date: z.string().trim().min(4).max(20),
        payment_mode: z.string().trim().max(40).default("upi"),
        txn_ref: z.string().trim().max(80).optional(),
        remarks: z.string().trim().max(300).optional(),
        amount: z.number().min(0).max(100000000).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { markRentInvoicePaid, requireWrite } = await import("./gbp.server");
    await requireWrite(context.supabase, context.userId);
    const actor = (context.claims["email"] as string | undefined) ?? context.userId;
    const out = await markRentInvoicePaid({ ...data, recorded_by: actor });
    const { logAudit } = await import("./gbp.server");
    await logAudit({
      actor,
      action: out.balance > 0 ? "rent part payment recorded" : "rent marked paid",
      entity: "rent",
      entity_id: data.invoice_id,
      amount: out.amount,
      details: `${data.payment_mode}${data.txn_ref ? ` · ${data.txn_ref}` : ""}${out.balance > 0 ? ` · balance ${out.balance}` : ""}${data.remarks ? ` · ${data.remarks}` : ""}`,
    });
    return out;
  });

export const saveManualRentEntryFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        invoice_id: z.string().trim().max(80).optional(),
        invoice_no: z.string().trim().max(60).optional(),
        incubatee_id: z.string().trim().min(1).max(40),
        month: z.string().regex(/^\d{4}-\d{2}$/),
        invoice_date: z.string().trim().max(20).optional(),
        due_date: z.string().trim().max(20).optional(),
        rent_amount: z.number().min(0).max(100000000),
        maintenance_amount: z.number().min(0).max(100000000).default(0),
        gst_applicable: z.boolean().default(false),
        cgst_pct: z.number().min(0).max(50).optional(),
        sgst_pct: z.number().min(0).max(50).optional(),
        remarks: z.string().trim().max(300).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { requireWrite, saveManualRentEntry } = await import("./gbp.server");
    await requireWrite(context.supabase, context.userId);
    const actor = (context.claims["email"] as string | undefined) ?? context.userId;
    const out = await saveManualRentEntry({ ...data, generated_by: actor });
    const { logAudit } = await import("./gbp.server");
    await logAudit({
      actor,
      action: data.invoice_id ? "manual rent entry edited" : "manual rent entry created",
      entity: "rent",
      entity_id: out.invoiceId,
      month: data.month,
      amount: out.total,
      details: data.remarks ?? "",
    });
    return out;
  });

export const updateLedgerRemarksFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        kind: z.enum(["rent", "electricity"]),
        id: z.string().trim().min(1).max(80),
        remarks: z.string().trim().max(300),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { requireWrite, updateLedgerRemarks } = await import("./gbp.server");
    await requireWrite(context.supabase, context.userId);
    return updateLedgerRemarks({
      ...data,
      actor: (context.claims["email"] as string | undefined) ?? context.userId,
    });
  });

export const deleteRentInvoiceFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ invoice_id: z.string().trim().min(1).max(80) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { deleteRentInvoice, requireRole } = await import("./gbp.server");
    await requireRole(context.supabase, context.userId, ["admin"]);
    const out = await deleteRentInvoice(data.invoice_id);
    const { logAudit } = await import("./gbp.server");
    await logAudit({
      actor: (context.claims["email"] as string | undefined) ?? context.userId,
      action: "rent entry deleted",
      entity: "rent",
      entity_id: data.invoice_id,
    });
    return out;
  });

export const generateRentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { month: string }) => monthSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { generateRentInvoices, requireWrite } = await import("./gbp.server");
    await requireWrite(context.supabase, context.userId);
    return generateRentInvoices(data.month);
  });

/** Admin-only scan for ledger rows whose tenant/billing client was deleted. */
export const scanOrphansFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { findOrphans, requireRole } = await import("./gbp.server");
    await requireRole(context.supabase, context.userId, ["admin"]);
    return { records: await findOrphans() };
  });

/** Admin-only sweep that removes every orphaned record found by the scan. */
export const cleanupOrphansFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { cleanupOrphans, requireRole } = await import("./gbp.server");
    await requireRole(context.supabase, context.userId, ["admin"]);
    const actor = (context.claims["email"] as string | undefined) ?? context.userId;
    return cleanupOrphans(actor);
  });

export const recordPaymentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        type: z.enum(["rent", "electricity", "deposit", "other"]),
        ref_id: z.string().trim().max(60).optional(),
        incubatee_id: z.string().trim().max(40).default(""),
        amount: z.number().positive().max(100000000),
        date: z.string().trim().min(4).max(20),
        mode: z.string().trim().max(40).default("upi"),
        reference: z.string().trim().max(80).optional(),
        notes: z.string().trim().max(300).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { recordPayment, requireWrite } = await import("./gbp.server");
    await requireWrite(context.supabase, context.userId);
    return recordPayment({
      ...data,
      recorded_by: (context.claims["email"] as string | undefined) ?? context.userId,
    });
  });

export const saveSettingsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ values: z.record(z.string(), z.string().max(200)) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { requireRole, saveSettings } = await import("./gbp.server");
    await requireRole(context.supabase, context.userId, ["admin"]);
    return saveSettings(data.values);
  });

/* -------------------------- power billing ------------------------------- */

const powerClientSchema = z.object({
  client_id: z.string().trim().max(40).optional(),
  client_name: z.string().trim().min(1).max(160),
  address: z.string().trim().max(300).optional(),
  connected_load_kw: z.string().trim().max(20).optional(),
  whatsapp: z.string().trim().max(20).optional(),
  fixed_ac_units: z.string().trim().max(20).optional(),
  ac_fixed_charge: z.string().trim().max(20).optional(),
  incubatee_id: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(300).optional(),
  meters: z
    .array(
      z.object({
        id: z.string().trim().max(40),
        labName: z.string().trim().max(120),
        meterNo: z.string().trim().max(60),
      }),
    )
    .max(20),
});

export const savePowerClientFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => powerClientSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { requireWrite, savePowerClient } = await import("./gbp.server");
    await requireWrite(context.supabase, context.userId);
    return savePowerClient(data);
  });

export const deletePowerClientFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ client_id: z.string().trim().min(1).max(40) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { deletePowerClient, requireRole } = await import("./gbp.server");
    await requireRole(context.supabase, context.userId, ["admin"]);
    return deletePowerClient(data.client_id);
  });

export const savePowerBillFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        bill_id: z.string().trim().max(40).optional(),
        client_id: z.string().trim().min(1).max(40),
        bill_date: z.string().trim().min(4).max(20),
        due_date: z.string().trim().min(4).max(20),
        period_from: z.string().trim().min(4).max(20),
        period_to: z.string().trim().min(4).max(20),
        readings: z
          .array(
            z.object({
              labName: z.string().trim().max(120),
              meterNo: z.string().trim().max(60),
              prevReading: z.number().min(0).max(100000000),
              presReading: z.number().min(0).max(100000000),
            }),
          )
          .max(20),
        include_ac_units: z.boolean().default(false),
        ac_units: z.number().min(0).max(1000000).optional(),

        apply_fixed_charge: z.boolean().default(true),
        connected_load_kw: z.number().min(0).max(100000).optional(),
        include_ac_charge: z.boolean().default(false),
        ac_charge: z.number().min(0).max(10000000).optional(),
        arrears: z.number().min(0).max(100000000).default(0),
        surcharge_months: z.number().min(0).max(60).default(1),
        duty_pct: z.number().min(0).max(100).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { requireWrite, savePowerBill } = await import("./gbp.server");
    await requireWrite(context.supabase, context.userId);
    return savePowerBill({
      ...data,
      generated_by: (context.claims["email"] as string | undefined) ?? context.userId,
    });
  });

export const markPowerBillPaidFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        bill_id: z.string().trim().min(1).max(40),
        payment_date: z.string().trim().min(4).max(20),
        payment_mode: z.string().trim().max(40).default("upi"),
        txn_ref: z.string().trim().max(80).optional(),
        remarks: z.string().trim().max(300).optional(),
        amount: z.number().min(0).max(100000000).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { markPowerBillPaid, requireWrite } = await import("./gbp.server");
    await requireWrite(context.supabase, context.userId);
    const actor = (context.claims["email"] as string | undefined) ?? context.userId;
    const out = await markPowerBillPaid({ ...data, recorded_by: actor });
    const { logAudit } = await import("./gbp.server");
    await logAudit({
      actor,
      action: out.balance > 0 ? "electricity part payment recorded" : "electricity marked paid",
      entity: "electricity",
      entity_id: data.bill_id,
      amount: out.received,
      details: `${data.payment_mode}${data.txn_ref ? ` · ${data.txn_ref}` : ""}${out.balance > 0 ? ` · balance ${out.balance}` : ""}${data.remarks ? ` · ${data.remarks}` : ""}`,
    });
    return out;
  });

export const saveManualPowerEntryFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        bill_id: z.string().trim().max(60).optional(),
        client_id: z.string().trim().max(40).optional(),
        incubatee_id: z.string().trim().max(40).optional(),
        bill_date: z.string().trim().min(4).max(20),
        due_date: z.string().trim().min(4).max(20),
        period_from: z.string().trim().max(20).optional(),
        period_to: z.string().trim().max(20).optional(),
        total_units: z.number().min(0).max(100000000).optional(),
        energy_charge: z.number().min(0).max(100000000).optional(),
        fixed_charge: z.number().min(0).max(100000000).optional(),
        arrears: z.number().min(0).max(100000000).optional(),
        total_amount: z.number().min(0).max(100000000),
        remarks: z.string().trim().max(300).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { requireWrite, saveManualPowerEntry } = await import("./gbp.server");
    await requireWrite(context.supabase, context.userId);
    const actor = (context.claims["email"] as string | undefined) ?? context.userId;
    const out = await saveManualPowerEntry({ ...data, generated_by: actor });
    const { logAudit } = await import("./gbp.server");
    await logAudit({
      actor,
      action: data.bill_id ? "manual electricity entry edited" : "manual electricity entry created",
      entity: "electricity",
      entity_id: out.billId,
      month: data.bill_date.slice(0, 7),
      amount: out.total,
      details: data.remarks ?? "",
    });
    return out;
  });

export const deletePowerBillFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ bill_id: z.string().trim().min(1).max(40) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { deletePowerBill, requireRole } = await import("./gbp.server");
    await requireRole(context.supabase, context.userId, ["admin"]);
    const out = await deletePowerBill(data.bill_id);
    const { logAudit } = await import("./gbp.server");
    await logAudit({
      actor: (context.claims["email"] as string | undefined) ?? context.userId,
      action: "electricity entry deleted",
      entity: "electricity",
      entity_id: data.bill_id,
    });
    return out;
  });

export const importTenantClientsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { importTenantClients, requireWrite } = await import("./gbp.server");
    await requireWrite(context.supabase, context.userId);
    return importTenantClients();
  });

export const listStaffFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { listStaff, requireRole } = await import("./gbp.server");
    await requireRole(context.supabase, context.userId, ["admin"]);
    return listStaff();
  });

export const setUserRoleFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        role: z.enum(["admin", "staff", "viewer"]),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { requireRole, setUserRole } = await import("./gbp.server");
    await requireRole(context.supabase, context.userId, ["admin"]);
    return setUserRole(data.userId, data.role, context.userId);
  });
