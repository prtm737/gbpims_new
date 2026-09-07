import {
  dateLabel,
  discountValue,
  dueStatus,
  grossRent,
  inr,
  daysUntil,
  leaseReminderDays,
  leaseState,
  type LeaseState,
  monthLabel,
  num,
  spaceIds,
  totalArea,
  rentRate,
  type Row,
  type Workbook,
} from "./sheets-schema";

export type LabView = {
  labId: string;
  name: string;
  spaceType: string;
  block: string;
  floor: string;
  areaSqft: string;
  rent: number;
  grossRent: number;
  discount: number;
  status: string;
  notes: string;
  occupant: Row | undefined;
};

export function labViews(wb: Workbook): LabView[] {
  return wb.labs.map((lab) => {
    const occupant = wb.incubatees.find(
      (i) => spaceIds(i["lab_id"]).includes(lab["lab_id"] ?? "") && i["status"] !== "exited",
    );
    const gross = grossRent(lab["area_sqft"], wb.settings, num(lab["monthly_rent"]));
    const discount = occupant
      ? discountValue(gross, occupant["discount_pct"], occupant["discount_amount"])
      : 0;
    return {
      labId: lab["lab_id"] ?? "",
      name: lab["name"] ?? "",
      spaceType: lab["space_type"] || "lab",
      block: lab["block"] ?? "",
      floor: lab["floor"] ?? "",
      areaSqft: lab["area_sqft"] ?? "",
      rent: Math.max(0, gross - discount),
      grossRent: gross,
      discount,
      status: occupant ? (occupant["status"] === "notice" ? "notice" : "occupied") : "vacant",
      notes: lab["notes"] ?? "",
      occupant,
    };
  });
}

/** Billable monthly rent for one incubatee: area x rate, less any agreed discount. */
export function incubateeRent(wb: Workbook, inc: Row) {
  const ids = spaceIds(inc["lab_id"]);
  const area = totalArea(wb.labs, inc["lab_id"]);
  const fallbackRent =
    num(inc["monthly_rent"]) ||
    ids.reduce((sum, id) => sum + num(wb.labs.find((l) => l["lab_id"] === id)?.["monthly_rent"]), 0);
  const gross = grossRent(
    area,
    wb.settings,
    fallbackRent,
  );
  const discount = discountValue(gross, inc["discount_pct"], inc["discount_amount"]);
  return { gross, discount, net: Math.max(0, gross - discount), rate: rentRate(wb.settings) };
}

export function companyName(wb: Workbook, incubateeId: string): string {
  return (
    wb.incubatees.find((i) => i["incubatee_id"] === incubateeId)?.["company_name"] ?? incubateeId
  );
}

export type DueRow = {
  id: string;
  kind: "rent" | "electricity";
  incubateeId: string;
  company: string;
  labId: string;
  month: string;
  amount: number;
  paid: number;
  balance: number;
  status: string;
  dueDate: string;
  phone: string;
};

export function dueRows(wb: Workbook): DueRow[] {
  const phoneOf = (id: string) =>
    wb.incubatees.find((i) => i["incubatee_id"] === id)?.["phone"] ?? "";

  const rent: DueRow[] = wb.rent.map((r) => {
    const amount = num(r["amount"]);
    const paid = num(r["amount_paid"]);
    return {
      id: r["invoice_id"] ?? "",
      kind: "rent" as const,
      incubateeId: r["incubatee_id"] ?? "",
      company: companyName(wb, r["incubatee_id"] ?? ""),
      labId: r["lab_id"] ?? "",
      month: r["month"] ?? "",
      amount,
      paid,
      balance: Math.max(0, amount - paid),
      status: dueStatus(amount, paid, r["due_date"]),
      dueDate: r["due_date"] ?? "",
      phone: phoneOf(r["incubatee_id"] ?? ""),
    };
  });

  // Electricity dues come from the billing-engine ledger (ElectricityBills).
  const power: DueRow[] = wb.ledger
    .filter((r) => (r["bill_id"] ?? "").trim() !== "")
    .map((r) => {
      const amount = num(r["total_amount"]);
      const isPaid = (r["status"] ?? "").toLowerCase() === "paid";
      // Trust the recorded part-payments; fall back to the status only for
      // older rows that never had amount_paid filled in.
      const storedPaid = num(r["amount_paid"]);
      const paid = storedPaid > 0 ? Math.min(storedPaid, amount) : isPaid ? amount : 0;
      const client = wb.clients.find((c) => c["client_id"] === r["client_id"]);
      const incubateeId = client?.["incubatee_id"] ?? "";
      return {
        id: r["bill_id"] ?? "",
        kind: "electricity" as const,
        incubateeId,
        company: r["client_name"] || companyName(wb, incubateeId),
        labId: incubateeId
          ? (wb.incubatees.find((i) => i["incubatee_id"] === incubateeId)?.["lab_id"] ?? "")
          : "",
        month: (r["bill_date"] ?? "").slice(0, 7),
        amount,
        paid,
        balance: Math.max(0, amount - paid),
        status: paid >= amount && amount > 0 ? "paid" : dueStatus(amount, paid, r["due_date"]),
        dueDate: r["due_date"] ?? "",
        phone: client?.["whatsapp"] || phoneOf(incubateeId),
      };
    });

  return [...rent, ...power].sort((a, b) => b.month.localeCompare(a.month));
}

/** Dues split by kind — used by the reports page. */
export function duesByKind(wb: Workbook) {
  const all = dueRows(wb);
  const totals = (rows: DueRow[]) => ({
    rows,
    billed: rows.reduce((s, d) => s + d.amount, 0),
    collected: rows.reduce((s, d) => s + d.paid, 0),
    outstanding: rows.reduce((s, d) => s + d.balance, 0),
  });
  return {
    rent: totals(all.filter((d) => d.kind === "rent")),
    electricity: totals(all.filter((d) => d.kind === "electricity")),
  };
}

/** Billed vs collected per month, split into rent and electricity. */
export function monthlySplitSeries(wb: Workbook, months = 6) {
  const dues = dueRows(wb);
  const now = new Date();
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return keys.map((month) => {
    const rows = dues.filter((d) => d.month === month);
    const rent = rows.filter((d) => d.kind === "rent");
    const power = rows.filter((d) => d.kind === "electricity");
    return {
      month: `${month.slice(5)}/${month.slice(2, 4)}`,
      rent: rent.reduce((s, d) => s + d.amount, 0),
      electricity: power.reduce((s, d) => s + d.amount, 0),
      collected: rows.reduce((s, d) => s + d.paid, 0),
    };
  });
}

export function summary(wb: Workbook) {
  const labs = labViews(wb);
  const dues = dueRows(wb);
  const occupied = labs.filter((l) => l.status !== "vacant").length;
  const billed = dues.reduce((s, d) => s + d.amount, 0);
  const collected = dues.reduce((s, d) => s + d.paid, 0);
  const outstanding = dues.reduce((s, d) => s + d.balance, 0);
  const overdue = dues.filter((d) => d.status === "overdue");
  const monthlyRentRoll = labs
    .filter((l) => l.status !== "vacant")
    .reduce((s, l) => s + (num(l.occupant?.["monthly_rent"]) || l.rent), 0);

  return {
    labs,
    dues,
    totalLabs: labs.length,
    occupied,
    vacant: labs.length - occupied,
    occupancyPct: labs.length ? Math.round((occupied / labs.length) * 100) : 0,
    activeIncubatees: wb.incubatees.filter((i) => i["status"] !== "exited").length,
    billed,
    collected,
    outstanding,
    overdue,
    monthlyRentRoll,
  };
}

export function monthlySeries(wb: Workbook, months = 6) {
  const dues = dueRows(wb);
  const keys: string[] = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return keys.map((month) => {
    const rows = dues.filter((d) => d.month === month);
    return {
      month: `${month.slice(5)}/${month.slice(2, 4)}`,
      billed: rows.reduce((s, d) => s + d.amount, 0),
      collected: rows.reduce((s, d) => s + d.paid, 0),
    };
  });
}

export function whatsappLink(phone: string, message: string): string {
  const digits = phone.replace(/\D/g, "");
  const withCode = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${withCode}?text=${encodeURIComponent(message)}`;
}

/** Polite payment reminder for a pending due. */
export function reminderMessage(row: {
  kind: "rent" | "electricity";
  company: string;
  month: string;
  amount: number;
  paid: number;
  balance: number;
  dueDate: string;
  labId?: string | undefined;
}, parkName: string): string {
  const kind = row.kind === "rent" ? "rent" : "electricity";
  return [
    `Dear ${row.company},`,
    "",
    `This is a gentle reminder from ${parkName}.`,
    `${kind === "rent" ? "Rent" : "Electricity"} for ${monthLabel(row.month)}${row.labId ? ` (Lab ${row.labId})` : ""}`,
    `Billed: ${inr(row.amount)}`,
    `Received: ${inr(row.paid)}`,
    `Balance due: ${inr(row.balance)}${row.dueDate ? ` (due ${row.dueDate})` : ""}`,
    "",
    "Kindly arrange the payment at your earliest convenience. Thank you.",
  ].join("\n");
}

/** Acknowledgement / receipt message sent after a payment is recorded. */
export function acknowledgementMessage(input: {
  company: string;
  kind: "rent" | "electricity" | "deposit" | "other";
  month: string;
  labId: string;
  amount: number;
  balance: number;
  date: string;
  mode: string;
  reference: string;
  receiptId: string;
  parkName: string;
}): string {
  const label =
    input.kind === "rent"
      ? `Rent ${monthLabel(input.month)}`
      : input.kind === "electricity"
        ? `Electricity ${monthLabel(input.month)}`
        : input.kind === "deposit"
          ? "Security deposit"
          : "Payment";
  return [
    `Dear ${input.company},`,
    "",
    `${input.parkName} acknowledges your payment with thanks.`,
    "",
    `Receipt no: ${input.receiptId}`,
    `Towards: ${label}${input.labId ? ` · Lab ${input.labId}` : ""}`,
    `Amount received: ${inr(input.amount)}`,
    `Mode: ${input.mode.toUpperCase()}${input.reference ? ` · Ref ${input.reference}` : ""}`,
    `Date: ${input.date}`,
    input.balance > 0
      ? `Remaining balance: ${inr(input.balance)}`
      : "Status: Fully settled. No dues pending.",
    "",
    "This is a system generated acknowledgement.",
  ].join("\n");
}

export function toCsv(rows: Record<string, string | number>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0] ?? {});
  const escape = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  return [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => escape(r[h] ?? "")).join(",")),
  ].join("\n");
}

/* ------------------------------- leases --------------------------------- */

export type LeaseView = {
  incubateeId: string;
  company: string;
  labId: string;
  phone: string;
  agreementNo: string;
  start: string;
  end: string;
  termMonths: string;
  deposit: number;
  rent: number;
  state: LeaseState;
  daysLeft: number | null;
};

export function leaseViews(wb: Workbook): LeaseView[] {
  const notice = leaseReminderDays(wb.settings);
  return wb.incubatees
    .filter((i) => i["status"] !== "exited")
    .map((i) => ({
      incubateeId: i["incubatee_id"] ?? "",
      company: i["company_name"] ?? "",
      labId: i["lab_id"] ?? "",
      phone: i["phone"] ?? "",
      agreementNo: i["agreement_no"] ?? "",
      start: i["agreement_start"] ?? i["allotment_date"] ?? "",
      end: i["agreement_end"] ?? "",
      termMonths: i["lease_term_months"] ?? "",
      deposit: num(i["security_deposit"]),
      rent: incubateeRent(wb, i).net,
      state: leaseState(i["agreement_end"], notice),
      daysLeft: daysUntil(i["agreement_end"]),
    }))
    .sort((a, b) => {
      const rank: Record<LeaseState, number> = { expired: 0, expiring: 1, active: 2, unknown: 3 };
      if (rank[a.state] !== rank[b.state]) return rank[a.state] - rank[b.state];
      return (a.daysLeft ?? 99999) - (b.daysLeft ?? 99999);
    });
}

/** Lease renewal / expiry reminder text for WhatsApp. */
export function leaseReminderMessage(lease: LeaseView, parkName: string): string {
  const expired = lease.state === "expired";
  return [
    `Dear ${lease.company},`,
    "",
    `This is a reminder from ${parkName} regarding your lab lease agreement.`,
    lease.agreementNo ? `Agreement no: ${lease.agreementNo}` : "",
    lease.labId ? `Lab: ${lease.labId}` : "",
    `Agreement period: ${dateLabel(lease.start)} to ${dateLabel(lease.end)}`,
    expired
      ? `The agreement expired ${Math.abs(lease.daysLeft ?? 0)} day(s) ago.`
      : `The agreement expires in ${lease.daysLeft ?? 0} day(s).`,
    `Current monthly rent: ${inr(lease.rent)}`,
    "",
    "Kindly contact the park office to complete the renewal formalities. Thank you.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export function downloadCsv(filename: string, rows: Record<string, string | number>[]) {
  const csv = toCsv(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
