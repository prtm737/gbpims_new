// Client-safe schema description of the Google Sheets workbook that backs the app.

export const TABS = {
  labs: "Labs",
  incubatees: "Incubatees",
  rent: "RentInvoices",
  payments: "Payments",
  clients: "PowerClients",
  ledger: "PowerLedger",
  audit: "AuditLog",
  settings: "Settings",
} as const;

export type TabKey = keyof typeof TABS;

export const HEADERS: Record<TabKey, string[]> = {
  labs: [
    "lab_id",
    "block",
    "floor",
    "area_sqft",
    "monthly_rent",
    "status",
    "notes",
    "space_type",
    "name",
  ],
  incubatees: [
    "incubatee_id",
    "company_name",
    "founder_name",
    "phone",
    "email",
    "lab_id",
    "allotment_date",
    "agreement_end",
    "security_deposit",
    "monthly_rent",
    "discount_pct",
    "discount_amount",
    "status",
    "notes",
    "agreement_start",
    "agreement_no",
    "lease_term_months",
    "gstin",
    "address",
  ],
  rent: [
    "invoice_id",
    "invoice_no",
    "incubatee_id",
    "company_name",
    "lab_id",
    "month",
    "invoice_date",
    "due_date",
    "gross_amount",
    "discount",
    "rent_amount",
    "maintenance_amount",
    "taxable_value",
    "gst_applicable",
    "cgst_pct",
    "cgst",
    "sgst_pct",
    "sgst",
    "round_off",
    "amount",
    "amount_paid",
    "status",
    "party_gstin",
    "hsn_rent",
    "hsn_maintenance",
    "remarks",
    "generated_by",
    "timestamp",
    "payment_date",
    "payment_mode",
    "txn_ref",
    "notes",
    "balance",
  ],
  payments: [
    "payment_id",
    "date",
    "incubatee_id",
    "ref_id",
    "type",
    "amount",
    "mode",
    "reference",
    "recorded_by",
    "notes",
  ],
  clients: [
    "client_id",
    "client_name",
    "address",
    "connected_load_kw",
    "whatsapp",
    "fixed_ac_units",
    "incubatee_id",
    "meters",
    "notes",
    "ac_fixed_charge",
  ],
  ledger: [
    "bill_id",
    "client_id",
    "client_name",
    "bill_date",
    "due_date",
    "period_from",
    "period_to",
    "days",
    "meter_units",
    "ac_units",
    "total_units",
    "tariff_rate",
    "energy_charge",
    "connected_load_kw",
    "fixed_charge_rate",
    "fixed_charge",
    "arrears",
    "surcharge",
    "total_amount",
    "status",
    "payment_date",
    "payment_mode",
    "txn_ref",
    "readings",
    "generated_by",
    "timestamp",
    "ac_charge",
    "duty_pct",
    "electricity_duty",
    "surcharge_months",
    "remarks",
    "amount_paid",
    "balance",
  ],
  settings: ["key", "value"],
  audit: [
    "audit_id",
    "timestamp",
    "actor",
    "action",
    "entity",
    "entity_id",
    "entity_name",
    "month",
    "amount",
    "details",
  ],
};

export const TOTAL_LABS = 26;

export const LAB_IDS = Array.from(
  { length: TOTAL_LABS },
  (_, i) => `L${String(i + 1).padStart(2, "0")}`,
);

export const DEFAULT_SETTINGS: Record<string, string> = {
  park_name: "Guwahati Biotech Park",
  rent_rate_per_sqft: "40",
  electricity_rate: "9.14",
  electricity_fixed_charge: "0",
  default_monthly_rent: "15000",
  rent_due_day: "10",
  lease_reminder_days: "60",
  currency_symbol: "₹",
  tariff_rate: "9.14",
  fixed_charge_rate: "210",
  late_surcharge_pct: "1.5",
  electricity_duty_pct: "5",
  ac_fixed_charge: "0",
  gst_enabled: "true",
  cgst_pct: "9",
  sgst_pct: "9",
  maintenance_pct: "0",
  maintenance_rate_per_sqft: "2.5",
  invoice_series: "GBP/IN",
  park_gstin: "18AAAAG7658P1ZY",
  park_pan: "AAAAG7658P",
  park_vat_tin: "GWB/TAN9118",
  park_state: "Assam",
  park_state_code: "18",
  park_unit_name: "Technology Incubation Centre",
  hsn_rent: "997211",
  hsn_maintenance: "995419",
  park_address: "Amingaon, Kamrup, Guwahati - 781031, Assam",
  park_phone: "+919864228941",
  park_email: "gbpincubateebills@gmail.com",
  bank_name: "Axis Bank",
  bank_account_name: "Technology Incubation Centre GBP",
  bank_account_no: "918010089862862",
  bank_ifsc: "UTIB0003343",
  upi_id: "paytm.s10f91q@pta",
  prepared_by: "Junior Engineer, GBP",
  prepared_by_designation: "Junior Engineer",
  verified_by: "Manager (Estate & Billing)",
  bill_terms: [
    "Payment made via UPI, Bank Transfer only.",
    "Late payment surcharge @ 1.5% per month will be applicable after due date.",
    "In case of discrepancy, contact concerned officer, GBP.",
    "Payment should be done and share receipt to account division GBP.",
  ].join(" | "),
};

/** Park + bank profile used on printed bills, falling back to the shipped defaults. */
export function parkProfile(settings: Record<string, string>) {
  return parkProfileInner(settings);
}

/** Blank-safe setting read: an empty cell in the sheet falls back to the default. */
export function settingText(
  settings: Record<string, string> | undefined,
  key: string,
): string {
  const raw = String(settings?.[key] ?? "").trim();
  return raw !== "" ? raw : (DEFAULT_SETTINGS[key] ?? "");
}

/** Blank-safe numeric setting read. */
export function settingNum(
  settings: Record<string, string> | undefined,
  key: string,
): number {
  return num(settingText(settings, key));
}

/** Electricity tariff must fall back even when an old sheet row contains 0. */
export function electricityTariffRate(settings: Record<string, string> | undefined): number {
  return settingNum(settings, "tariff_rate") || settingNum(settings, "electricity_rate") || 9.14;
}

/** Fixed charge is a flat monthly rate per connected kW. */
export function electricityFixedChargeRate(settings: Record<string, string> | undefined): number {
  return settingNum(settings, "fixed_charge_rate") || 210;
}

/** Default duty is 5%; per-bill disable is handled separately with applyDuty. */
export function electricityDutyPct(settings: Record<string, string> | undefined): number {
  return settingNum(settings, "electricity_duty_pct") || 5;
}

function parkProfileInner(settings: Record<string, string>) {
  const get = (key: string) =>
    (settings[key] ?? "").trim() || (DEFAULT_SETTINGS[key] ?? "");
  return {
    parkName: get("park_name"),
    address: get("park_address"),
    phone: get("park_phone"),
    email: get("park_email"),
    bankName: get("bank_name"),
    accountName: get("bank_account_name"),
    accountNo: get("bank_account_no"),
    ifsc: get("bank_ifsc"),
    upiId: get("upi_id"),
    gstin: get("park_gstin"),

    preparedBy: get("prepared_by"),
    preparedByRole: get("prepared_by_designation"),
    approvedByRole: get("verified_by"),
  };
}

/** Terms & conditions lines printed on the electricity bill. */
export function billTerms(settings: Record<string, string>): string[] {
  const raw = settings["bill_terms"] || DEFAULT_SETTINGS["bill_terms"] || "";
  return raw
    .split("|")
    .map((t) => t.trim())
    .filter((t) => t !== "");
}

export type Row = Record<string, string>;

export type Workbook = {
  labs: Row[];
  incubatees: Row[];
  rent: Row[];
  payments: Row[];
  clients: Row[];
  ledger: Row[];
  audit: Row[];
  settings: Record<string, string>;
};

export const LAB_STATUS = ["vacant", "occupied", "notice"] as const;
export const PAY_STATUS = ["pending", "partial", "paid"] as const;

/** Rentable space categories. Labs are the default; the park also rents other spaces. */
export const SPACE_TYPES = [
  { value: "lab", label: "Modular lab" },
  { value: "canteen", label: "Canteen" },
  { value: "utility", label: "Utility area" },
  { value: "office", label: "Office / admin space" },
  { value: "facility", label: "Shared facility" },
  { value: "storage", label: "Storage" },
  { value: "other", label: "Other space" },
] as const;

export type SpaceType = (typeof SPACE_TYPES)[number]["value"];

export function spaceTypeLabel(value: string | undefined): string {
  return SPACE_TYPES.find((t) => t.value === (value || "lab"))?.label ?? "Other space";
}

export function num(value: string | undefined | null): number {
  if (!value) return 0;
  const n = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** paid | partial | overdue | pending, derived from amounts and the due date. */
export function dueStatus(amount: number, paid: number, dueDate?: string): string {
  if (paid >= amount && amount > 0) return "paid";
  const overdue = dueDate ? new Date(dueDate).getTime() < Date.now() : false;
  if (paid > 0) return overdue ? "overdue" : "partial";
  return overdue ? "overdue" : "pending";
}

export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-");
  if (!y || !m) return month;
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleString("en-IN", { month: "short", year: "numeric" });
}

export function inr(value: number, symbol = "₹"): string {
  return `${symbol}${Math.round(value).toLocaleString("en-IN")}`;
}

/** Rent rate per square foot from settings, defaulting to ₹40. */
export function rentRate(settings: Record<string, string>): number {
  return num(settings["rent_rate_per_sqft"]) || num(DEFAULT_SETTINGS["rent_rate_per_sqft"]) || 40;
}

/**
 * A tenant may hold several spaces. `lab_id` therefore stores one or more ids
 * separated by commas, plus signs or semicolons (e.g. "LAB-01, LAB-02").
 */
export function spaceIds(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[,;+/]/)
    .map((s) => s.trim())
    .filter((s) => s !== "" && s.toLowerCase() !== "none");
}

/** Total area of every space held by a tenant. */
export function totalArea(labs: Row[], labIdField: string | undefined): number {
  return spaceIds(labIdField).reduce((sum, id) => {
    const lab = labs.find((l) => l["lab_id"] === id);
    return sum + num(lab?.["area_sqft"]);
  }, 0);
}

/** Gross rent for a lab: area x rate per sqft, falling back to stored/default rent. */
export function grossRent(
  areaSqft: string | number | undefined,
  settings: Record<string, string>,
  fallbackRent = 0,
): number {
  const area = typeof areaSqft === "number" ? areaSqft : num(areaSqft);
  if (area > 0) return Math.round(area * rentRate(settings));
  return fallbackRent || num(settings["default_monthly_rent"]);
}

/** Discount value from a percentage and/or a flat amount, capped at the gross. */
export function discountValue(
  gross: number,
  discountPct: string | number | undefined,
  discountAmount: string | number | undefined,
): number {
  const pct = typeof discountPct === "number" ? discountPct : num(discountPct);
  const flat = typeof discountAmount === "number" ? discountAmount : num(discountAmount);
  const fromPct = pct > 0 ? (gross * Math.min(pct, 100)) / 100 : 0;
  return Math.min(gross, Math.round(fromPct + Math.max(0, flat)));
}

/* ------------------ electricity billing engine (PRD 4.3) ------------------ */

/* --------------------- rent billing engine (GST invoice) ------------------ */

export type RentBillInput = {
  /** Gross monthly rent before discount. */
  gross: number;
  discountPct?: number | string | undefined;
  discountAmount?: number | string | undefined;
  /** Maintenance charge as a percentage of net rent (ignored when an amount is given). */
  maintenancePct?: number | string | undefined;
  maintenanceAmount?: number | string | undefined;
  /** Maintenance rate in ₹ per sqft per month (preferred over the percentage). */
  maintenanceRatePerSqft?: number | string | undefined;
  areaSqft?: number | string | undefined;
  gstApplicable: boolean;
  cgstPct: number;
  sgstPct: number;
};

export type RentBillComputation = {
  gross: number;
  discount: number;
  rent: number;
  maintenance: number;
  taxable: number;
  cgst: number;
  sgst: number;
  roundOff: number;
  total: number;
};

/** Single source of truth for rent invoice maths — used by the UI and server. */
export function computeRentBill(input: RentBillInput): RentBillComputation {
  const gross = Math.max(0, round2(input.gross));
  const discount = discountValue(gross, input.discountPct, input.discountAmount);
  const rent = round2(Math.max(0, gross - discount));
  const manual = num(String(input.maintenanceAmount ?? ""));
  const area = Math.max(0, num(String(input.areaSqft ?? "")));
  const rateSqft = Math.max(0, num(String(input.maintenanceRatePerSqft ?? "")));
  const maintenance =
    String(input.maintenanceAmount ?? "").trim() !== ""
      ? round2(Math.max(0, manual))
      : area > 0 && rateSqft > 0
        ? round2(area * rateSqft)
        : round2((rent * Math.max(0, num(String(input.maintenancePct ?? "")))) / 100);
  const taxable = round2(rent + maintenance);
  const cgst = input.gstApplicable ? round2((taxable * Math.max(0, input.cgstPct)) / 100) : 0;
  const sgst = input.gstApplicable ? round2((taxable * Math.max(0, input.sgstPct)) / 100) : 0;
  const raw = round2(taxable + cgst + sgst);
  const total = Math.round(raw);
  return {
    gross,
    discount,
    rent,
    maintenance,
    taxable,
    cgst,
    sgst,
    roundOff: round2(total - raw),
    total,
  };
}

export function gstEnabled(settings: Record<string, string>): boolean {
  const raw = (settings["gst_enabled"] ?? DEFAULT_SETTINGS["gst_enabled"] ?? "true").toLowerCase();
  return raw !== "false" && raw !== "0" && raw !== "no";
}

/** Indian financial year label for a date, e.g. 26-27 for 30-Jul-2026. */
export function financialYear(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const valid = Number.isFinite(d.getTime()) ? d : new Date();
  const y = valid.getFullYear();
  const start = valid.getMonth() + 1 >= 4 ? y : y - 1;
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`;
}

/** Next running tax-invoice number, e.g. GBP/IN/26-27/79. */
export function nextInvoiceNo(existing: string[], series: string, date: string | Date): string {
  const prefix = `${series}/${financialYear(date)}/`;
  const max = existing
    .filter((n) => n.startsWith(prefix))
    .reduce((m, n) => Math.max(m, Number(n.slice(prefix.length)) || 0), 0);
  return `${prefix}${max + 1}`;
}

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen",
  "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n] ?? "";
  const t = TENS[Math.floor(n / 10)] ?? "";
  const o = ONES[n % 10] ?? "";
  return o ? `${t} ${o}` : t;
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", twoDigits(rest)].filter(Boolean).join(" ");
}

/** Indian-system words for an amount, e.g. "Indian Rupees Thirty Seven Thousand ... Only". */
export function amountInWords(value: number): string {
  const total = Math.round(Math.abs(value) * 100);
  const rupees = Math.floor(total / 100);
  const paise = total % 100;
  if (rupees === 0 && paise === 0) return "Indian Rupees Zero Only";

  const parts: string[] = [];
  const units: [number, string][] = [
    [10_000_000, "Crore"],
    [100_000, "Lakh"],
    [1_000, "Thousand"],
  ];
  let rest = rupees;
  for (const [size, name] of units) {
    const count = Math.floor(rest / size);
    if (count > 0) parts.push(`${threeDigits(count)} ${name}`);
    rest %= size;
  }
  if (rest > 0) parts.push(threeDigits(rest));

  const rupeeWords = parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  const paiseWords = paise > 0 ? ` and ${twoDigits(paise)} paise` : "";
  return `Indian Rupees ${rupeeWords}${paiseWords} Only`;
}

export type Meter = { id: string; labName: string; meterNo: string };

export type MeterReading = {
  labName: string;
  meterNo: string;
  prevReading: number;
  presReading: number;
  unitsConsumed: number;
};

export function parseMeters(value: string | undefined): Meter[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as Meter[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function parseReadings(value: string | undefined): MeterReading[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as MeterReading[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function daysBetween(from: string, to: string): number {
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

export type BillInput = {
  readings: { labName: string; meterNo: string; prevReading: number; presReading: number }[];
  periodFrom: string;
  periodTo: string;
  connectedLoadKw: number;
  tariffRate: number;
  fixedChargeRate: number;
  applyFixedCharge: boolean;
  acUnits: number;
  includeAcUnits: boolean;
  /** Flat monthly AC fixed charge in rupees (separate from AC units). */
  acCharge: number;
  includeAcCharge: boolean;
  /** Electricity duty percentage on (energy + fixed) charges. */
  dutyPct: number;
  arrears: number;
  surchargePct: number;
  /** Number of months the arrears have been delayed (surcharge multiplier). */
  surchargeMonths: number;
};

export type BillComputation = {
  days: number;
  readings: MeterReading[];
  meterUnits: number;
  acUnits: number;
  totalUnits: number;
  energyCharge: number;
  fixedCharge: number;
  acCharge: number;
  duty: number;
  arrears: number;
  surcharge: number;
  total: number;
};

/** Single source of truth for electricity bill maths — used by UI preview and server. */
export function computeBill(input: BillInput): BillComputation {
  const readings: MeterReading[] = input.readings.map((r) => ({
    labName: r.labName,
    meterNo: r.meterNo,
    prevReading: round2(r.prevReading),
    presReading: round2(r.presReading),
    unitsConsumed: round2(Math.max(0, r.presReading - r.prevReading)),
  }));
  const days = daysBetween(input.periodFrom, input.periodTo);
  const meterUnits = round2(readings.reduce((s, r) => s + r.unitsConsumed, 0));
  const acUnits = input.includeAcUnits ? round2(Math.max(0, input.acUnits)) : 0;
  const totalUnits = round2(meterUnits + acUnits);

  const tariffRate = input.tariffRate > 0 ? input.tariffRate : 9.14;
  const fixedChargeRate = input.fixedChargeRate > 0 ? input.fixedChargeRate : 210;
  const energyCharge = round2(totalUnits * tariffRate);
  // Fixed charge = total connected load (kW) x flat rate per kW (default Rs.210).
  const fixedCharge = input.applyFixedCharge
    ? round2(input.connectedLoadKw * fixedChargeRate)
    : 0;
  const acCharge = input.includeAcCharge ? round2(Math.max(0, input.acCharge)) : 0;
  // Duty = 5% of (energy charge + fixed charge).
  const duty = round2(((energyCharge + fixedCharge) * Math.max(0, input.dutyPct)) / 100);
  const arrears = Math.max(0, round2(input.arrears));
  const months = Math.max(0, input.surchargeMonths);
  const surcharge = arrears > 0 ? round2((arrears * input.surchargePct * months) / 100) : 0;
  return {
    days,
    readings,
    meterUnits,
    acUnits,
    totalUnits,
    energyCharge,
    fixedCharge,
    acCharge,
    duty,
    arrears,
    surcharge,
    total: Math.round(energyCharge + fixedCharge + acCharge + duty + arrears + surcharge),
  };
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Next auto-incrementing bill number, e.g. GBP-2026-0004. */
export function nextBillNumber(existing: string[], year = new Date().getFullYear()): string {
  const prefix = `GBP-${year}-`;
  const max = existing
    .filter((id) => id.startsWith(prefix))
    .reduce((m, id) => Math.max(m, Number(id.slice(prefix.length)) || 0), 0);
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

export function inr2(value: number, symbol = "₹"): string {
  return `${symbol}${value.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function periodLabel(from: string, to: string): string {
  const fmt = (d: string) =>
    d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
  return `${fmt(from)} – ${fmt(to)}`;
}

/* ------------------------------ leases ---------------------------------- */

/** Whole days from today until `date` (negative when already past). */
export function daysUntil(date: string | undefined): number | null {
  if (!date) return null;
  const t = new Date(date).getTime();
  if (!Number.isFinite(t)) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((t - today.getTime()) / 86_400_000);
}

export type LeaseState = "unknown" | "active" | "expiring" | "expired";

export function leaseState(agreementEnd: string | undefined, reminderDays = 60): LeaseState {
  const days = daysUntil(agreementEnd);
  if (days === null) return "unknown";
  if (days < 0) return "expired";
  return days <= reminderDays ? "expiring" : "active";
}

export function leaseReminderDays(settings: Record<string, string>): number {
  return num(settings["lease_reminder_days"]) || 60;
}

export function dateLabel(date: string | undefined): string {
  if (!date) return "—";
  const t = new Date(date);
  if (Number.isNaN(t.getTime())) return date;
  return t.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
