// Client-side PDF generation for rent/electricity bills and payment receipts.
import { BRAND, getLogoDataUrl, getUpiQrDataUrl } from "./brand";
import { archiveMonth, archivePdfQuiet } from "./pdf-archive-client";
import type { PowerBill } from "./power";
import { inr, monthLabel } from "./sheets-schema";

export type PdfDoc = {
  kind: "invoice" | "receipt";
  docId: string;
  date: string;
  parkName: string;
  company: string;
  contact?: string;
  labId: string;
  month: string;
  title: string;
  lines: { label: string; value: string }[];
  amount: number;
  paid: number;
  balance: number;
  note?: string;
};

const GREEN: [number, number, number] = [99, 185, 0];
const TEAL: [number, number, number] = [0, 150, 165];
const INK: [number, number, number] = [32, 45, 50];
const MUTED: [number, number, number] = [110, 125, 130];
const OFFICIAL_UPI_ID = "paytm.s10f91q@pta";
const DEFAULT_TARIFF_RATE = 9.14;

export function pdfFileName(doc: PdfDoc): string {
  return `${BRAND.short}-${doc.kind === "receipt" ? "receipt" : "bill"}-${doc.docId || doc.labId}.pdf`;
}

async function build(doc: PdfDoc) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const W = pdf.internal.pageSize.getWidth();
  const M = 44;

  // Header band
  pdf.setFillColor(...INK);
  pdf.rect(0, 0, W, 92, "F");
  pdf.setFillColor(...GREEN);
  pdf.rect(0, 92, W, 4, "F");

  const logo = await getLogoDataUrl();
  if (logo) {
    try {
      pdf.addImage(logo, "PNG", M, 26, 150, 48);
    } catch {
      /* logo optional */
    }
  }

  pdf.setTextColor(255, 255, 255);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(15);
  pdf.text(doc.kind === "receipt" ? "PAYMENT RECEIPT" : "BILL / INVOICE", W - M, 44, {
    align: "right",
  });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.text(`${BRAND.short} · ${doc.docId}`, W - M, 60, { align: "right" });
  pdf.text(`Date: ${doc.date}`, W - M, 74, { align: "right" });

  // Parties
  let y = 130;
  pdf.setTextColor(...MUTED);
  pdf.setFontSize(8.5);
  pdf.text("FROM", M, y);
  pdf.text("BILLED TO", W / 2, y);
  y += 15;
  pdf.setTextColor(...INK);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.text(doc.parkName, M, y);
  pdf.text(doc.company, W / 2, y);
  y += 14;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9.5);
  pdf.setTextColor(...MUTED);
  pdf.text("Technology Park, Guwahati, Assam", M, y);
  pdf.text(`Lab ${doc.labId || "—"}${doc.contact ? ` · ${doc.contact}` : ""}`, W / 2, y);

  // Title strip
  y += 34;
  pdf.setFillColor(244, 248, 245);
  pdf.rect(M, y, W - M * 2, 30, "F");
  pdf.setTextColor(...INK);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10.5);
  pdf.text(`${doc.title} · ${monthLabel(doc.month)}`, M + 12, y + 19);

  // Lines
  y += 52;
  pdf.setFontSize(9.5);
  doc.lines.forEach((line) => {
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(...MUTED);
    pdf.text(line.label, M + 2, y);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(...INK);
    pdf.text(line.value, W - M - 2, y, { align: "right" });
    pdf.setDrawColor(232, 238, 234);
    pdf.line(M, y + 8, W - M, y + 8);
    y += 24;
  });

  // Totals
  y += 10;
  const boxH = 84;
  pdf.setFillColor(250, 252, 250);
  pdf.setDrawColor(224, 232, 226);
  pdf.rect(M, y, W - M * 2, boxH, "FD");
  const rows: [string, string, [number, number, number]][] = [
    ["Amount", inr(doc.amount), INK],
    ["Paid", inr(doc.paid), TEAL],
    ["Balance due", inr(doc.balance), doc.balance > 0 ? [190, 60, 40] : GREEN],
  ];
  let ry = y + 24;
  rows.forEach(([label, value, color]) => {
    pdf.setFont("helvetica", label === "Balance due" ? "bold" : "normal");
    pdf.setFontSize(label === "Balance due" ? 11.5 : 10);
    pdf.setTextColor(...MUTED);
    pdf.text(label, M + 14, ry);
    pdf.setTextColor(...color);
    pdf.text(value, W - M - 14, ry, { align: "right" });
    ry += 24;
  });

  y += boxH + 30;
  if (doc.note) {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(...MUTED);
    pdf.text(pdf.splitTextToSize(doc.note, W - M * 2), M, y);
    y += 30;
  }

  pdf.setFontSize(8.5);
  pdf.setTextColor(...MUTED);
  pdf.text(
    doc.kind === "receipt"
      ? "This is a system generated acknowledgement of payment received."
      : "Please pay on or before the due date to avoid follow-up reminders.",
    M,
    pdf.internal.pageSize.getHeight() - 54,
  );
  pdf.text(BRAND.name, M, pdf.internal.pageSize.getHeight() - 40);
  return pdf;
}

export async function downloadPdf(doc: PdfDoc): Promise<void> {
  const pdf = await build(doc);
  pdf.save(pdfFileName(doc));
  // Every downloaded receipt/bill is also stored in the month-wise archive.
  void (async () => {
    try {
      const month = archiveMonth(doc.month, new Date().toISOString().slice(0, 7));
      if (!month || !doc.docId) return;
      const pdf_base64 = await pdfBase64(doc);
      await archivePdfQuiet({
        kind: "receipt",
        month,
        ref_id: doc.docId,
        label: doc.company,
        pdf_base64,
      });
    } catch {
      /* the download itself already succeeded */
    }
  })();
}

/** Base64 payload for the server-side month-wise archive. */
export async function pdfBase64(doc: PdfDoc): Promise<string> {
  const pdf = await build(doc);
  const dataUri = pdf.output("datauristring");
  return dataUri.slice(dataUri.indexOf(",") + 1);
}

/** Opens the PDF in a new tab (print/share friendly) and returns the object URL. */
export async function openPdf(doc: PdfDoc): Promise<void> {
  const pdf = await build(doc);
  const url = URL.createObjectURL(pdf.output("blob"));
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Downloads the PDF and opens a pre-filled email draft to attach it to. */
export async function emailPdf(doc: PdfDoc, to: string, body: string): Promise<void> {
  await downloadPdf(doc);
  const subject = `${doc.kind === "receipt" ? "Payment receipt" : "Bill"} ${doc.docId} · ${doc.company}`;
  window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(
    subject,
  )}&body=${encodeURIComponent(`${body}\n\nThe PDF (${pdfFileName(doc)}) has been downloaded — please attach it before sending.`)}`;
}

/* --------------------- electricity invoice (billing app) ------------------ */

export type PowerBillPdfOptions = {
  parkName: string;
  address: string;
  phone: string;
  email: string;
  clientAddress: string;
  /** Client phone printed under "BILLED TO". */
  clientPhone?: string;
  bankName: string;
  accountName: string;
  accountNo: string;
  ifsc: string;
  upiId: string;
  /** Park GST identification number printed in the header. */
  gstin?: string;

  preparedBy: string;
  /** Designation printed under the left signature box. */
  preparedByRole?: string;
  /** Designation printed under the right (approver) signature box. */
  approvedByRole?: string;
  /** Terms & conditions lines printed at the foot of the bill. */
  terms?: string[];
};

/** UPI deep link used for the payment QR code. */
function upiUri(o: PowerBillPdfOptions, bill: PowerBill): string {
  const params = new URLSearchParams({
    pa: OFFICIAL_UPI_ID,
    pn: o.accountName || o.parkName,
    am: String(bill.total),
    cu: "INR",
    tn: `Electricity ${bill.billId}`,
  });
  return `upi://pay?${params.toString()}`;
}

async function qrDataUrl(text: string): Promise<string | null> {
  try {
    const QR = await import("qrcode");
    return await QR.toDataURL(text, { margin: 0, width: 240 });
  } catch {
    return null;
  }
}

async function buildPowerBill(bill: PowerBill, o: PowerBillPdfOptions) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const M = 40;
  const RS = "Rs.";
  const money = (v: number) => `${RS}${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const n2 = (v: number) =>
    v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const units = (v: number) => n2(Math.max(0, Math.round(v * 100) / 100));
  const displayTariffRate = bill.tariffRate > 0 ? bill.tariffRate : DEFAULT_TARIFF_RATE;
  const displayFixedRate = bill.fixedChargeRate > 0 ? bill.fixedChargeRate : 0;
  const displayDutyPct = bill.dutyPct > 0 ? bill.dutyPct : 0;
  const displayEnergyCharge = bill.energyCharge > 0 ? bill.energyCharge : bill.totalUnits * displayTariffRate;
  const displayFixedCharge = bill.fixedCharge > 0 ? bill.fixedCharge : 0;
  const displayDuty =
    bill.duty > 0
      ? bill.duty
      : displayDutyPct > 0
        ? ((displayEnergyCharge + displayFixedCharge) * displayDutyPct) / 100
        : 0;
  const displayPresentTotal = displayEnergyCharge + displayFixedCharge + bill.acCharge + displayDuty;
  const displayTotal = Math.round(displayPresentTotal + bill.arrears + bill.surcharge);
  const label = (t: string, x: number, y: number, align: "left" | "right" = "left") =>
    pdf.text(t, x, y, { align });
  /** Draw text shrinking the font until it fits maxW (never wraps). */
  const fitText = (
    t: string,
    x: number,
    yy: number,
    maxW: number,
    size: number,
    align: "left" | "right" | "center" = "left",
  ) => {
    let s = size;
    pdf.setFontSize(s);
    while (s > 5 && pdf.getTextWidth(t) > maxW) {
      s -= 0.3;
      pdf.setFontSize(s);
    }
    pdf.text(t, x, yy, { align });
    return s;
  };

  /* ---------------- header ---------------- */
  const logo = await getLogoDataUrl();
  if (logo) {
    try {
      pdf.addImage(logo, "PNG", M, 28, 150, 46);
    } catch {
      /* logo optional */
    }
  }
  pdf.setTextColor(...INK);
  pdf.setFont("helvetica", "bold");
  fitText(o.parkName.toUpperCase(), M + 168, 44, W - M - 148 - (M + 168), 16);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8.5);
  pdf.setTextColor(...MUTED);
  pdf.text(o.address, M + 168, 58, { maxWidth: 250 });
  pdf.text(
    [o.phone ? `Tel: ${o.phone}` : "", o.email ? `Email: ${o.email}` : ""]
      .filter(Boolean)
      .join(" | "),
    M + 168,
    70,
    { maxWidth: 250 },
  );
  if (o.gstin) {
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(...INK);
    pdf.text(`GSTIN: ${o.gstin}`, M + 168, 82, { maxWidth: 250 });
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(...MUTED);
  }


  pdf.setDrawColor(...INK);
  pdf.setLineWidth(1);
  pdf.rect(W - M - 132, 34, 132, 26);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  pdf.setTextColor(...INK);
  pdf.text("ELECTRICITY BILL", W - M - 66, 51, { align: "center" });

  pdf.setLineWidth(1.2);
  pdf.line(M, 92, W - M, 92);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13.5);
  pdf.text(`INVOICE NO: ${bill.billId}`, W / 2, 118, { align: "center" });
  pdf.setLineWidth(0.8);
  pdf.line(M, 132, W - M, 132);

  /* ---------------- billed to / meta ---------------- */
  let y = 156;
  pdf.setFillColor(...INK);
  pdf.rect(M, y - 12, 3, 74, "F");
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8.5);
  pdf.setTextColor(...MUTED);
  pdf.text("BILLED TO:", M + 12, y);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(12.5);
  pdf.setTextColor(...INK);
  pdf.text(bill.clientName || "—", M + 12, y + 20, { maxWidth: 250 });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(...MUTED);
  pdf.text(o.clientAddress || o.address, M + 12, y + 36, { maxWidth: 250 });
  pdf.setFontSize(8.5);
  if (o.clientPhone) pdf.text(`Contact: ${o.clientPhone}`, M + 12, y + 52);


  const meta: [string, string][] = [
    ["Invoice Date:", bill.billDate || "—"],
    ["Payment Due Date:", bill.dueDate || "—"],
    ["Billing Cycle:", `${bill.periodFrom || "—"} to ${bill.periodTo || "—"}`],
    ["Cycle Duration:", `${bill.days} Days`],
    ["Connected Load:", `${bill.loadKw} kW`],
  ];
  let my = y;
  meta.forEach(([k, v]) => {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8.8);
    pdf.setTextColor(...INK);
    const vw = pdf.getTextWidth(v);
    label(k, W - M - vw - 5, my, "right");
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(...MUTED);
    label(v, W - M, my, "right");
    my += 14;
  });

  /* ---------------- readings table ---------------- */
  y = Math.max(my, y + 62) + 10;
  const tableW = W - M * 2;
  const widths = [0.34, 0.22, 0.22, 0.22];
  const heads = ["METER", "PREVIOUS READING", "PRESENT READING", "UNITS CONSUMED"];
  const xs: number[] = [M];
  widths.forEach((w) => {
    const last = xs.at(-1) ?? M;
    xs.push(last + w * tableW);
  });

  const headH = 26;
  pdf.setDrawColor(...INK);
  pdf.setLineWidth(0.8);
  pdf.rect(M, y, tableW, headH);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(7.6);
  pdf.setTextColor(...INK);
  heads.forEach((h, i) => {
    const x0 = xs[i] ?? M;
    const x1 = xs[i + 1] ?? W - M;
    const cx = (x0 + x1) / 2;
    if (i > 0) pdf.line(x0, y, x0, y + headH);
    const wrapped = pdf.splitTextToSize(h, x1 - x0 - 10);
    pdf.text(wrapped, cx, y + (headH - wrapped.length * 9) / 2 + 8, { align: "center" });
  });
  y += headH;

  const rowH = 20;
  const bodyRows: string[][] =
    bill.readings.length > 0
      ? bill.readings.map((r) => [
          String(r.labName || r.meterNo || "Meter").slice(0, 28),
          units(r.prevReading),
          units(r.presReading),
          `${units(r.unitsConsumed)} kWh`,
        ])
      : [["Meter", "0.00", "0.00", `${units(bill.meterUnits)} kWh`]];
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  bodyRows.forEach((cells) => {
    pdf.rect(M, y, tableW, rowH);
    cells.forEach((c, i) => {
      const x0 = xs[i] ?? M;
      const x1 = xs[i + 1] ?? W - M;
      if (i > 0) pdf.line(x0, y, x0, y + rowH);
      const diffCol = 3;
      pdf.setFont("helvetica", i === diffCol ? "bold" : "normal");
      pdf.text(c, (x0 + x1) / 2, y + 16, { align: "center" });
    });
    y += rowH;
  });
  if (bill.acUnits > 0) {
    const acRows: [string, string][] = [
      ["Units consumed (meter)", `${bill.meterUnits} kWh`],
      ["Fixed AC units", `${bill.acUnits} kWh`],
      ["Total units billed", `${bill.totalUnits} kWh`],
    ];
    pdf.setDrawColor(...INK);
    pdf.setLineWidth(0.6);
    acRows.forEach(([k, v], i) => {
      const rh = 15;
      pdf.rect(M, y, tableW, rh);
      pdf.setFont("helvetica", i === 2 ? "bold" : "normal");
      pdf.setFontSize(8.6);
      pdf.setTextColor(...(i === 2 ? INK : MUTED));
      pdf.text(k, M + 8, y + 10.5);
      pdf.text(v, M + tableW - 8, y + 10.5, { align: "right" });
      y += rh;
    });
  }


  /* ------------- particulars table (mirrors the park's printed bill) ------------- */
  y += 14;
  const pW = W - M * 2;
  const amtX = W - M;
  const tarX = M + pW * 0.62;
  const amtColX = M + pW * 0.82;
  const pRow = (
    particulars: string,
    tariff: string,
    amount: string,
    opts: { bold?: boolean; section?: boolean; total?: boolean } = {},
  ) => {
    const h = 17;
    pdf.setDrawColor(...INK);
    pdf.setLineWidth(opts.total ? 0.9 : 0.5);
    pdf.rect(M, y, pW, h);
    pdf.line(tarX, y, tarX, y + h);
    pdf.line(amtColX, y, amtColX, y + h);
    pdf.setTextColor(...INK);
    pdf.setFont("helvetica", opts.bold || opts.section || opts.total ? "bold" : "normal");
    fitText(particulars, M + 7, y + 12, tarX - M - 14, 8.6);
    if (tariff) {
      pdf.setFont("helvetica", "normal");
      fitText(tariff, tarX + 6, y + 12, amtColX - tarX - 12, 8.2);
    }
    if (amount) {
      pdf.setFont("helvetica", opts.bold || opts.total ? "bold" : "normal");
      pdf.setFontSize(opts.total ? 9.6 : 8.8);
      pdf.text(amount, amtX - 6, y + 12, { align: "right" });
    }
    y += h;
  };

  // header
  pdf.setDrawColor(...INK);
  pdf.setLineWidth(0.9);
  pdf.rect(M, y, pW, 17);
  pdf.line(tarX, y, tarX, y + 17);
  pdf.line(amtColX, y, amtColX, y + 17);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8.6);
  pdf.setTextColor(...INK);
  pdf.text("PARTICULARS", M + 7, y + 12);
  pdf.text("TARIFF RATE", tarX + 6, y + 12);
  pdf.text("AMOUNT (Rs.)", amtX - 6, y + 12, { align: "right" });
  y += 17;

  pRow("Present Bill", "", "", { section: true });
  pRow(
    `a) Energy charge (${bill.totalUnits} units)`,
    `Rs.${displayTariffRate} per unit`,
    n2(displayEnergyCharge),
  );
  pRow(
    `b) Fixed charge (${bill.loadKw} kW connected load)`,
    `Rs.${displayFixedRate} per KW`,
    n2(displayFixedCharge),
  );
  if (bill.acCharge > 0) pRow("c) AC fixed charge", "", n2(bill.acCharge));
  pRow(
    `${bill.acCharge > 0 ? "d" : "c"}) Electricity Duty (Energy Charge + Fixed Charge) x ${(
      displayDutyPct / 100
    ).toFixed(2)}`,
    "",
    n2(displayDuty),
  );
  pRow("I. Total of Present Bill", "", n2(displayPresentTotal), { bold: true });
  pRow("Arear Bill", "", "", { section: true });
  pRow("a) Arear amount of previous bill", "", n2(bill.arrears));
  pRow("b) Surcharge for delayed payment (@1.5% per month)", "", n2(bill.surcharge));
  pRow("II. Total of Arear Bill", "", n2(bill.arrears + bill.surcharge), { bold: true });
  pRow("Total (I + II)", "", `${RS}${n2(displayTotal)}`, { total: true });

  pdf.setDrawColor(...INK);
  pdf.setLineWidth(0.5);
  const words = `Amount in words: ${amountInWords(displayTotal)}`;
  const wrappedWords = pdf.splitTextToSize(words, pW - 14);
  const wordsH = Math.max(18, wrappedWords.length * 10 + 8);
  pdf.rect(M, y, pW, wordsH);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8.3);
  pdf.setTextColor(...INK);
  pdf.text(wrappedWords, M + 7, y + 12);
  y += wordsH;

  // The note only makes sense when the bill actually carries an arear figure.
  if (bill.arrears > 0 || bill.surcharge > 0) {
    pdf.setFont("helvetica", "italic");
    pdf.setFontSize(8.4);
    pdf.setTextColor(...MUTED);
    pdf.text("Please ignore the arear amount if paid and furnish the payment details.", M, y + 12);
    y += 18;
  }

  if (bill.paid) {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.setTextColor(...GREEN);
    pdf.text(
      `PAID on ${bill.paymentDate || "—"} · ${(bill.paymentMode || "").toUpperCase()}${bill.txnRef ? ` · Ref ${bill.txnRef}` : ""}`,
      M,
      y + 12,
    );
    y += 18;
  }

  /* ------------- payment block: bank details + UPI QR ------------- */
  const blockTop = y + 4;
  const bankH = 92;
  const bankW = pW - 140;
  pdf.setDrawColor(...INK);
  pdf.setLineWidth(0.6);
  pdf.rect(M, blockTop, bankW, bankH);
  pdf.rect(M + bankW, blockTop, 140, bankH);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8.4);
  pdf.setTextColor(...INK);
  pdf.text("PAYMENT DETAILS", M + 10, blockTop + 15);
  pdf.line(M, blockTop + 22, M + bankW, blockTop + 22);
  const bankLines: [string, string][] = [
    ["Bank:", o.bankName],
    ["Account:", o.accountName],
    ["A/C No:", o.accountNo],
    ["IFS Code:", o.ifsc],
    ["UPI ID:", OFFICIAL_UPI_ID],
  ].filter(([, v]) => (v ?? "") !== "") as [string, string][];
  let by = blockTop + 34;
  bankLines.forEach(([k, v]) => {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8.4);
    pdf.setTextColor(...INK);
    pdf.text(k, M + 10, by);
    const kw = pdf.getTextWidth(k) + 4;
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(...INK);
    const wrapped = pdf.splitTextToSize(v, bankW - kw - 18);
    pdf.text(wrapped, M + 10 + kw, by);
    by += wrapped.length * 10.5 + 3;
  });

  // QR: the park's official static UPI QR, with the dynamic amount QR as fallback.
  const qrX = M + bankW;
  const qr = (await getUpiQrDataUrl()) ?? (await qrDataUrl(upiUri(o, bill)));
  if (qr) {
    try {
      pdf.addImage(qr, qr.startsWith("data:image/png") ? "PNG" : "JPEG", qrX + 40, blockTop + 6, 60, 60);
    } catch {
      /* QR optional */
    }
  }
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(7.4);
  pdf.setTextColor(...INK);
  pdf.text("Scan to Pay via UPI", qrX + 70, blockTop + 74, { align: "center" });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7.6);
  pdf.text(OFFICIAL_UPI_ID, qrX + 70, blockTop + 85, { align: "center" });

  /* ---------------- terms & signatures ---------------- */
  const terms = o.terms && o.terms.length > 0 ? o.terms : [];
  let cursor = blockTop + bankH + 18;
  // Keep terms and signatures whole: break to a fresh page when the foot won't fit.
  if (cursor + terms.length * 12 + 64 > H - 16) {
    pdf.addPage();
    cursor = 70;
  }
  const termsTop = cursor;
  const signTop = Math.max(termsTop + terms.length * 12 + 22, H - 100);

  pdf.setDrawColor(...INK);
  pdf.setLineWidth(0.6);
  pdf.line(M, termsTop - 18, W - M, termsTop - 18);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8.8);
  pdf.setTextColor(...INK);
  pdf.text("Terms & Conditions:", M, termsTop);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8.2);
  pdf.setTextColor(...MUTED);
  let ty = termsTop + 15;
  terms.forEach((t, i) => {
    pdf.text(`${i + 1}.`, M + 8, ty);
    const wrapped = pdf.splitTextToSize(t, W - M * 2 - 34);
    pdf.text(wrapped, M + 24, ty);
    ty += wrapped.length * 11 + 2;
  });

  const sy = signTop + 30;
  pdf.setDrawColor(...MUTED);
  pdf.setLineWidth(0.6);
  const leftX = M;
  const rightX = W - M;
  pdf.line(leftX, sy, leftX + 170, sy);
  pdf.line(rightX - 170, sy, rightX, sy);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8.6);
  pdf.setTextColor(...INK);
  pdf.text("Prepared by", leftX, sy + 14);
  pdf.text("Client / Recipient", rightX, sy + 14, { align: "right" });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8.2);
  pdf.setTextColor(...MUTED);
  pdf.text(o.preparedBy || "Junior Engineer", leftX, sy + 27, { maxWidth: 170 });
  pdf.text(bill.clientName || "", rightX, sy + 27, { align: "right", maxWidth: 170 });
  return pdf;
}

function amountInWords(amount: number): string {
  const rupees = Math.max(0, Math.round(amount));
  return `Rupees ${indianNumberWords(rupees)} only`;
}

function indianNumberWords(value: number): string {
  const ones = [
    "Zero",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
  ];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const belowHundred = (n: number) =>
    n < 20 ? ones[n] ?? "" : [tens[Math.floor(n / 10)], ones[n % 10] !== "Zero" ? ones[n % 10] : ""].filter(Boolean).join(" ");
  const belowThousand = (n: number) => {
    const hundred = Math.floor(n / 100);
    const rest = n % 100;
    return [hundred ? `${ones[hundred]} Hundred` : "", rest ? belowHundred(rest) : ""].filter(Boolean).join(" ");
  };
  if (value === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(value / 10_000_000);
  value %= 10_000_000;
  const lakh = Math.floor(value / 100_000);
  value %= 100_000;
  const thousand = Math.floor(value / 1_000);
  value %= 1_000;
  if (crore) parts.push(`${belowThousand(crore)} Crore`);
  if (lakh) parts.push(`${belowThousand(lakh)} Lakh`);
  if (thousand) parts.push(`${belowThousand(thousand)} Thousand`);
  if (value) parts.push(belowThousand(value));
  return parts.join(" ");
}


/** Month-foldered file name so downloads sort and archive per billing month. */
export function powerBillFileName(bill: PowerBill): string {
  const month = (bill.monthKey || bill.billDate.slice(0, 7) || "undated").replace("-", "");
  return `${BRAND.short}-electricity-${month}-${bill.billId}.pdf`;
}


export async function downloadPowerBillPdf(bill: PowerBill, o: PowerBillPdfOptions) {
  const pdf = await buildPowerBill(bill, o);
  pdf.save(powerBillFileName(bill));
  // Every downloaded bill is also stored in the month-wise archive.
  void (async () => {
    try {
      const month = archiveMonth(bill.monthKey, bill.billDate.slice(0, 7));
      if (!month) return;
      const pdf_base64 = await powerBillPdfBase64(bill, o);
      await archivePdfQuiet({
        kind: "electricity",
        month,
        ref_id: bill.billId,
        label: bill.clientName,
        pdf_base64,
      });
    } catch {
      /* the download itself already succeeded */
    }
  })();
}

export async function openPowerBillPdf(bill: PowerBill, o: PowerBillPdfOptions) {
  const pdf = await buildPowerBill(bill, o);
  const url = URL.createObjectURL(pdf.output("blob"));
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Blob URL for in-app preview (caller revokes it). */
export async function powerBillPdfUrl(bill: PowerBill, o: PowerBillPdfOptions): Promise<string> {
  const pdf = await buildPowerBill(bill, o);
  return URL.createObjectURL(pdf.output("blob"));
}

/** Base64 payload for the server-side month-wise archive. */
export async function powerBillPdfBase64(
  bill: PowerBill,
  o: PowerBillPdfOptions,
): Promise<string> {
  const pdf = await buildPowerBill(bill, o);
  const dataUri = pdf.output("datauristring");
  return dataUri.slice(dataUri.indexOf(",") + 1);
}
