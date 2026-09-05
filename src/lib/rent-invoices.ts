// Client-safe views over the RentInvoices tab.
import type { RentInvoicePdf } from "./pdf-rent";
import { DEFAULT_SETTINGS, dueStatus, num, type Row, type Workbook } from "./sheets-schema";

export type RentDraftFields = {
  invoice_id?: string;
  incubatee_id: string;
  month: string;
  invoice_date?: string;
  due_date?: string;
  gross_amount?: string;
  discount_pct?: string;
  discount_amount?: string;
  maintenance_pct?: string;
  maintenance_amount?: string;
  gst_applicable?: boolean;
  party_gstin?: string;
  remarks?: string;
};

export type RentInvoiceView = {
  invoiceId: string;
  invoiceNo: string;
  incubateeId: string;
  company: string;
  labId: string;
  month: string;
  invoiceDate: string;
  dueDate: string;
  gross: number;
  discount: number;
  rent: number;
  maintenance: number;
  taxable: number;
  gstApplicable: boolean;
  cgstPct: number;
  sgstPct: number;
  cgst: number;
  sgst: number;
  roundOff: number;
  amount: number;
  paid: number;
  balance: number;
  status: string;
  partyGstin: string;
  remarks: string;
  generatedBy: string;
  phone: string;
  /** True when the invoice points at a tenant that no longer exists. */
  orphan: boolean;
  draft: RentDraftFields;
};

function companyOf(
  wb: Workbook,
  row: Row,
): { name: string; phone: string; lab: string; orphan: boolean } {
  const inc = wb.incubatees.find((i) => i["incubatee_id"] === row["incubatee_id"]);
  const stored = (row["company_name"] ?? "").trim();
  return {
    // Never invent a tenant: if neither the row nor the tenant list has a name,
    // the record is flagged as orphaned instead of shown as "Unknown tenant".
    name: stored || inc?.["company_name"] || "Orphaned record — tenant deleted",
    phone: inc?.["phone"] ?? "",
    lab: row["lab_id"] || inc?.["lab_id"] || "",
    orphan: !inc,
  };
}

export function rentInvoiceViews(wb: Workbook): RentInvoiceView[] {
  return wb.rent
    .filter((r) => (r["invoice_id"] ?? "").trim() !== "")
    .map((r) => {
      const amount = num(r["amount"]);
      const paid = num(r["amount_paid"]);
      const meta = companyOf(wb, r);
      const rent = num(r["rent_amount"]) || Math.max(0, num(r["gross_amount"]) - num(r["discount"]));
      const gstApplicable = (r["gst_applicable"] ?? "").toLowerCase() !== "no";
      return {
        invoiceId: r["invoice_id"] ?? "",
        invoiceNo: r["invoice_no"] ?? "",
        incubateeId: r["incubatee_id"] ?? "",
        company: meta.name,
        labId: meta.lab,
        month: r["month"] ?? "",
        invoiceDate: r["invoice_date"] ?? "",
        dueDate: r["due_date"] ?? "",
        gross: num(r["gross_amount"]),
        discount: num(r["discount"]),
        rent,
        maintenance: num(r["maintenance_amount"]),
        taxable: num(r["taxable_value"]) || rent + num(r["maintenance_amount"]),
        gstApplicable,
        cgstPct: num(r["cgst_pct"]),
        sgstPct: num(r["sgst_pct"]),
        cgst: num(r["cgst"]),
        sgst: num(r["sgst"]),
        roundOff: num(r["round_off"]),
        amount,
        paid,
        balance: Math.max(0, amount - paid),
        status: dueStatus(amount, paid, r["due_date"]),
        partyGstin: r["party_gstin"] ?? "",
        remarks: r["remarks"] ?? "",
        generatedBy: r["generated_by"] ?? "",
        phone: meta.phone,
        orphan: meta.orphan,
        draft: {
          invoice_id: r["invoice_id"] ?? "",
          incubatee_id: r["incubatee_id"] ?? "",
          month: r["month"] ?? "",
          invoice_date: r["invoice_date"] ?? "",
          due_date: r["due_date"] ?? "",
          gross_amount: r["gross_amount"] ?? "",
          maintenance_amount: r["maintenance_amount"] ?? "",
          gst_applicable: gstApplicable,
          party_gstin: r["party_gstin"] ?? "",
          remarks: r["remarks"] ?? "",
        },
      };
    })
    .sort((a, b) => b.month.localeCompare(a.month) || a.company.localeCompare(b.company));
}

function setting(wb: Workbook, key: string): string {
  return wb.settings[key] || DEFAULT_SETTINGS[key] || "";
}

export function rentInvoicePdfData(wb: Workbook, inv: RentInvoiceView): RentInvoicePdf {
  const inc = wb.incubatees.find((i) => i["incubatee_id"] === inv.incubateeId);
  return {
    invoiceNo: inv.invoiceNo || inv.invoiceId,
    invoiceDate: inv.invoiceDate,
    month: inv.month,
    parkName: setting(wb, "park_name"),
    unitName: setting(wb, "park_unit_name"),
    parkAddressLines: setting(wb, "park_address")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    parkGstin: setting(wb, "park_gstin"),
    stateName: setting(wb, "park_state"),
    stateCode: setting(wb, "park_state_code"),
    panNo: setting(wb, "park_pan"),
    vatTin: setting(wb, "park_vat_tin"),
    party: inv.company,
    partyAddressLines: (inc?.["address"] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    partyGstin: inv.partyGstin,
    labId: inv.labId,
    dueDate: inv.dueDate,
    rentAmount: inv.rent,
    maintenanceAmount: inv.maintenance,
    hsnRent: setting(wb, "hsn_rent"),
    hsnMaintenance: setting(wb, "hsn_maintenance"),
    cgstPct: inv.cgstPct,
    sgstPct: inv.sgstPct,
    cgst: inv.cgst,
    sgst: inv.sgst,
    roundOff: inv.roundOff,
    total: inv.amount,
    paid: inv.paid,
    remarks: inv.remarks,
    status: inv.status,
  };
}
