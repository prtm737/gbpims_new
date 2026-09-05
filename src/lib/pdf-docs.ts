// Maps app rows onto the PDF document shape.
import type { DueRow } from "./derive";
import type { PdfDoc } from "./pdf";
import { inr } from "./sheets-schema";

export function billPdfDoc(due: DueRow, parkName: string): PdfDoc {
  return {
    kind: "invoice",
    docId: due.id,
    date: new Date().toLocaleDateString("en-IN"),
    parkName,
    company: due.company,
    contact: due.phone,
    labId: due.labId,
    month: due.month,
    title: due.kind === "rent" ? "Monthly lab rent" : "Electricity charges",
    lines: [
      {
        label: due.kind === "rent" ? "Rent for the month" : "Electricity for the month",
        value: inr(due.amount),
      },
      { label: "Due date", value: due.dueDate || "—" },
      { label: "Status", value: due.status.toUpperCase() },
    ],
    amount: due.amount,
    paid: due.paid,
    balance: due.balance,
    note: `Bill reference ${due.id}. Kindly quote this reference while making the payment.`,
  };
}

export function receiptPdfDoc(input: {
  receiptId: string;
  parkName: string;
  company: string;
  phone?: string;
  labId: string;
  month: string;
  kind: "rent" | "electricity" | "deposit" | "other";
  amount: number;
  balance: number;
  date: string;
  mode: string;
  reference?: string;
}): PdfDoc {
  return {
    kind: "receipt",
    docId: input.receiptId,
    date: input.date,
    parkName: input.parkName,
    company: input.company,
    ...(input.phone ? { contact: input.phone } : {}),
    labId: input.labId,
    month: input.month,
    title:
      input.kind === "rent"
        ? "Rent payment received"
        : input.kind === "electricity"
          ? "Electricity payment received"
          : "Payment received",
    lines: [
      { label: "Amount received", value: inr(input.amount) },
      { label: "Payment date", value: input.date },
      { label: "Mode", value: input.mode.toUpperCase() },
      { label: "Reference", value: input.reference || "—" },
    ],
    amount: input.amount,
    paid: input.amount,
    balance: input.balance,
    note: `Thank you. Receipt ${input.receiptId} confirms the payment recorded against ${input.company}.`,
  };
}
