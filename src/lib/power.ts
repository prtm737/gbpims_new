// Client-safe helpers for the electricity billing module (clients, ledger, messages).
import {
  computeBill,
  inr2,
  num,
  parseMeters,
  parseReadings,
  periodLabel,
  type Meter,
  type MeterReading,
  type Row,
  type Workbook,
} from "./sheets-schema";

export type PowerClient = {
  clientId: string;
  name: string;
  address: string;
  loadKw: number;
  whatsapp: string;
  fixedAcUnits: number;
  acFixedCharge: number;
  incubateeId: string;
  meters: Meter[];
  notes: string;
};

export type PowerBill = {
  billId: string;
  clientId: string;
  clientName: string;
  billDate: string;
  dueDate: string;
  periodFrom: string;
  periodTo: string;
  days: number;
  meterUnits: number;
  acUnits: number;
  totalUnits: number;
  tariffRate: number;
  energyCharge: number;
  loadKw: number;
  fixedChargeRate: number;
  fixedCharge: number;
  acCharge: number;
  dutyPct: number;
  duty: number;
  arrears: number;
  surcharge: number;
  surchargeMonths: number;
  total: number;
  /** Amount received so far — supports part payments. */
  amountPaid: number;
  /** Outstanding amount on this bill. */
  balance: number;
  /** Something received, but not the full bill. */
  partial: boolean;
  paid: boolean;
  paymentDate: string;
  paymentMode: string;
  txnRef: string;
  readings: MeterReading[];
  generatedBy: string;
  monthKey: string;
  remarks: string;
  manual: boolean;
};

export function powerClients(wb: Workbook): PowerClient[] {
  return wb.clients
    .filter((c) => (c["client_id"] ?? "").trim() !== "")
    .map((c) => ({
      clientId: c["client_id"] ?? "",
      name: c["client_name"] ?? "",
      address: c["address"] ?? "",
      loadKw: num(c["connected_load_kw"]),
      whatsapp: c["whatsapp"] ?? "",
      fixedAcUnits: num(c["fixed_ac_units"]),
      acFixedCharge: num(c["ac_fixed_charge"]),
      incubateeId: c["incubatee_id"] ?? "",
      meters: parseMeters(c["meters"]),
      notes: c["notes"] ?? "",
    }));
}

export function powerBills(wb: Workbook): PowerBill[] {
  return wb.ledger
    .filter((b) => (b["bill_id"] ?? "").trim() !== "")
    .map(toBill)
    .sort((a, b) => (b.billDate + b.billId).localeCompare(a.billDate + a.billId));
}

/** True when the bill points at a billing client that no longer exists. */
export function isOrphanBill(bill: PowerBill, clients: PowerClient[]): boolean {
  return !clients.some((c) => c.clientId === bill.clientId);
}

function toBill(b: Row): PowerBill {
  const billDate = b["bill_date"] ?? "";
  const total = num(b["total_amount"]);
  const statusPaid = (b["status"] ?? "").toLowerCase() === "paid";
  // Legacy rows have no amount_paid column: a "paid" status means fully settled.
  const amountPaid = b["amount_paid"] !== undefined && String(b["amount_paid"]).trim() !== ""
    ? num(b["amount_paid"])
    : statusPaid
      ? total
      : 0;
  const balance = Math.max(0, total - amountPaid);
  return {
    billId: b["bill_id"] ?? "",
    clientId: b["client_id"] ?? "",
    clientName: b["client_name"] ?? "",
    billDate,
    dueDate: b["due_date"] ?? "",
    periodFrom: b["period_from"] ?? "",
    periodTo: b["period_to"] ?? "",
    days: num(b["days"]),
    meterUnits: num(b["meter_units"]),
    acUnits: num(b["ac_units"]),
    totalUnits: num(b["total_units"]),
    tariffRate: num(b["tariff_rate"]),
    energyCharge: num(b["energy_charge"]),
    loadKw: num(b["connected_load_kw"]),
    fixedChargeRate: num(b["fixed_charge_rate"]),
    fixedCharge: num(b["fixed_charge"]),
    acCharge: num(b["ac_charge"]),
    dutyPct: num(b["duty_pct"]),
    duty: num(b["electricity_duty"]),
    arrears: num(b["arrears"]),
    surcharge: num(b["surcharge"]),
    surchargeMonths: num(b["surcharge_months"]),
    total,
    amountPaid,
    balance,
    partial: amountPaid > 0 && balance > 0,
    paid: total > 0 ? balance <= 0 : statusPaid,
    paymentDate: b["payment_date"] ?? "",
    paymentMode: b["payment_mode"] ?? "",
    txnRef: b["txn_ref"] ?? "",
    readings: parseReadings(b["readings"]),
    generatedBy: b["generated_by"] ?? "",
    monthKey: billDate.slice(0, 7),
    remarks: b["remarks"] ?? "",
    manual: (b["bill_id"] ?? "").startsWith("EM-"),
  };
}

/** Latest present readings per meter for a client, used to prefill "previous". */
export function lastReadings(wb: Workbook, clientId: string): Record<string, number> {
  const out: Record<string, number> = {};
  powerBills(wb)
    .filter((b) => b.clientId === clientId)
    .slice()
    .reverse()
    .forEach((b) => {
      b.readings.forEach((r) => {
        out[r.meterNo || r.labName] = r.presReading;
      });
    });
  return out;
}

/** Sum of all unpaid bills for a client — the auto arrears figure. */
export function outstandingArrears(wb: Workbook, clientId: string, excludeBillId?: string): number {
  return powerBills(wb)
    .filter((b) => b.clientId === clientId && !b.paid && b.billId !== excludeBillId)
    .reduce((s, b) => s + b.balance, 0);
}

export function powerSummary(wb: Workbook) {
  const bills = powerBills(wb);
  const unpaid = bills.filter((b) => !b.paid);
  return {
    clients: powerClients(wb).length,
    bills: bills.length,
    outstanding: bills.reduce((s, b) => s + b.balance, 0),
    collected: bills.reduce((s, b) => s + b.amountPaid, 0),
    unpaidCount: unpaid.length,
    units: bills.reduce((s, b) => s + b.totalUnits, 0),
  };
}

export function billPreview(input: {
  client: PowerClient;
  readings: { labName: string; meterNo: string; prevReading: number; presReading: number }[];
  periodFrom: string;
  periodTo: string;
  includeAc: boolean;
  /** Override for the fixed AC units billed (defaults to the client profile value). */
  acUnits?: number;
  applyFixed: boolean;
  /** Per-bill override for connected load (kW); defaults to the client profile. */
  connectedLoadKw?: number;
  includeAcCharge: boolean;
  acCharge: number;
  dutyPct: number;
  arrears: number;
  surchargeMonths: number;
  tariffRate: number;
  fixedChargeRate: number;
  surchargePct: number;
}) {
  return computeBill({
    readings: input.readings,
    periodFrom: input.periodFrom,
    periodTo: input.periodTo,
    connectedLoadKw:
      input.connectedLoadKw !== undefined && input.connectedLoadKw > 0
        ? input.connectedLoadKw
        : input.client.loadKw,
    tariffRate: input.tariffRate,
    fixedChargeRate: input.fixedChargeRate,
    applyFixedCharge: input.applyFixed,
    acUnits: input.acUnits ?? input.client.fixedAcUnits,
    includeAcUnits: input.includeAc,
    acCharge: input.acCharge,
    includeAcCharge: input.includeAcCharge,
    dutyPct: input.dutyPct,
    arrears: input.arrears,
    surchargePct: input.surchargePct,
    surchargeMonths: input.surchargeMonths,
  });
}


/** WhatsApp bill notification (PRD 4.5). */
export function powerBillMessage(bill: PowerBill, parkName: string): string {
  return [
    `*${parkName}* — Electricity bill`,
    "",
    `Bill no: ${bill.billId}`,
    `Client: ${bill.clientName}`,
    `Period: ${periodLabel(bill.periodFrom, bill.periodTo)} (${bill.days} days)`,
    `Units consumed: ${bill.totalUnits}`,
    `Energy charge: ${inr2(bill.energyCharge)}`,
    bill.fixedCharge > 0 ? `Fixed charge: ${inr2(bill.fixedCharge)}` : "",
    bill.acCharge > 0 ? `AC fixed charge: ${inr2(bill.acCharge)}` : "",
    bill.duty > 0 ? `Electricity duty (${bill.dutyPct}%): ${inr2(bill.duty)}` : "",
    bill.arrears > 0 ? `Pending arrears: ${inr2(bill.arrears)}` : "",
    bill.surcharge > 0
      ? `Late surcharge (${bill.surchargeMonths || 1} month): ${inr2(bill.surcharge)}`
      : "",
    "",
    `*Total payable: ${inr2(bill.total)}*`,
    bill.amountPaid > 0 ? `Received so far: ${inr2(bill.amountPaid)}` : "",
    bill.amountPaid > 0 && bill.balance > 0 ? `*Balance due: ${inr2(bill.balance)}*` : "",
    `Due date: ${bill.dueDate || "—"}`,
    `Status: ${bill.paid ? "PAID — thank you" : bill.partial ? "PARTIALLY PAID" : "UNPAID"}`,
    "",
    "Kindly pay on time and share the payment receipt with the park office.",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

/** Acknowledgement sent once a bill is marked paid. */
export function powerPaidMessage(bill: PowerBill, parkName: string): string {
  return [
    `Dear ${bill.clientName},`,
    "",
    `${parkName} acknowledges your electricity payment with thanks.`,
    "",
    `Bill no: ${bill.billId}`,
    `Amount received: ${inr2(bill.total)}`,
    `Payment date: ${bill.paymentDate || "—"}`,
    `Mode: ${(bill.paymentMode || "—").toUpperCase()}${bill.txnRef ? ` · Ref ${bill.txnRef}` : ""}`,
    "",
    "Status: Fully settled. This is a system generated acknowledgement.",
  ].join("\n");
}

export function powerLedgerCsv(bills: PowerBill[]): Record<string, string | number>[] {
  return bills.map((b) => ({
    bill_id: b.billId,
    client: b.clientName,
    bill_date: b.billDate,
    due_date: b.dueDate,
    period_from: b.periodFrom,
    period_to: b.periodTo,
    days: b.days,
    units: b.totalUnits,
    energy_charge: b.energyCharge,
    fixed_charge: b.fixedCharge,
    ac_charge: b.acCharge,
    electricity_duty: b.duty,
    arrears: b.arrears,
    surcharge: b.surcharge,
    total: b.total,
    amount_paid: b.amountPaid,
    balance: b.balance,
    status: b.paid ? "Paid" : b.partial ? "Partial" : "Unpaid",
    payment_date: b.paymentDate,
    payment_mode: b.paymentMode,
    txn_ref: b.txnRef,
  }));
}
