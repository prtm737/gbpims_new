// Client-side GST tax invoice for monthly rent, mirroring the park's printed format.
import { BRAND, getLogoDataUrl } from "./brand";
import { amountInWords, inr2 } from "./sheets-schema";

export type RentInvoicePdf = {
  invoiceNo: string;
  invoiceDate: string;
  /** Billing month, used for monthly archive-style file names. */
  month?: string;
  parkName: string;
  unitName: string;
  parkAddressLines: string[];
  parkGstin: string;
  stateName: string;
  stateCode: string;
  panNo: string;
  vatTin: string;
  party: string;
  partyAddressLines: string[];
  partyGstin: string;
  labId: string;
  dueDate: string;
  rentAmount: number;
  maintenanceAmount: number;
  hsnRent: string;
  hsnMaintenance: string;
  cgstPct: number;
  sgstPct: number;
  cgst: number;
  sgst: number;
  roundOff: number;
  total: number;
  paid: number;
  remarks: string;
  status: string;
};

const INK: [number, number, number] = [25, 30, 32];
const LINE: [number, number, number] = [110, 118, 120];

function d(date: string): string {
  const t = new Date(date);
  if (Number.isNaN(t.getTime())) return date || "—";
  return t
    .toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" })
    .replace(/ /g, "-");
}

export function rentInvoiceFileName(inv: RentInvoicePdf): string {
  const month = (inv.month || inv.invoiceDate.slice(0, 7) || "undated").replace("-", "");
  return `${BRAND.short}-rent-${month}-${inv.invoiceNo.replace(/[^a-zA-Z0-9]+/g, "-")}.pdf`;
}

async function build(inv: RentInvoicePdf) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const W = pdf.internal.pageSize.getWidth();
  const M = 36;
  const R = W - M;
  pdf.setTextColor(...INK);
  pdf.setDrawColor(...LINE);

  const logo = await getLogoDataUrl();
  if (logo) {
    try {
      pdf.addImage(logo, "PNG", M, 26, 108, 34);
    } catch {
      /* logo optional */
    }
  }

  // Invoice meta
  let y = 40;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.text(`Invoice No.  ${inv.invoiceNo}`, M, y + 26);
  pdf.text(`Dated  ${d(inv.invoiceDate)}`, R, y + 26, { align: "right" });
  pdf.text(`Due date  ${d(inv.dueDate)}`, R, y + 40, { align: "right" });
  pdf.setFont("helvetica", "italic");
  pdf.setFontSize(9.5);
  pdf.text("(DUPLICATE FOR SUPPLIER)", W / 2, y + 26, { align: "center" });

  // Supplier block
  y += 60;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.text(inv.parkName, W / 2, y, { align: "center" });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  [inv.unitName, ...inv.parkAddressLines, `GSTIN/UIN: ${inv.parkGstin}`,
    `State Name : ${inv.stateName}, Code : ${inv.stateCode}`]
    .filter(Boolean)
    .forEach((line) => {
      y += 13;
      pdf.text(line, W / 2, y, { align: "center" });
    });

  y += 26;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(12);
  pdf.text("Tax Invoice", W / 2, y, { align: "center" });

  // Party block
  y += 26;
  pdf.setFontSize(9.5);
  pdf.text("Party :", M, y);
  pdf.text(inv.party, M + 52, y);
  pdf.setFont("helvetica", "normal");
  [...inv.partyAddressLines, inv.labId ? `Space: ${inv.labId}` : ""]
    .filter(Boolean)
    .forEach((line) => {
      y += 13;
      pdf.text(line, M + 52, y);
    });
  if (inv.partyGstin) {
    y += 13;
    pdf.text(`GSTIN/UIN   : ${inv.partyGstin}`, M, y);
  }
  y += 13;
  pdf.text(`State Name  : ${inv.stateName}, Code : ${inv.stateCode}`, M, y);

  // Particulars table
  y += 18;
  const tableTop = y;
  const cAmt = R;
  const cHsn = R - 150;
  const rowH = 16;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.text("Sl", M + 4, y + 12);
  pdf.text("No.", M + 4, y + 22);
  pdf.text("Particulars", M + 150, y + 14);
  pdf.text("HSN/SAC", cHsn + 4, y + 14);
  pdf.text("Amount", cAmt - 4, y + 14, { align: "right" });
  const headerH = 28;
  y += headerH;
  pdf.line(M, tableTop + headerH, R, tableTop + headerH);

  const items: [string, string, number][] = [
    [`Rent From Space ( ${inv.party} )`, inv.hsnRent, inv.rentAmount],
  ];
  if (inv.maintenanceAmount > 0) {
    items.push([`Maintenance Charges - ${inv.party}`, inv.hsnMaintenance, inv.maintenanceAmount]);
  }
  pdf.setFont("helvetica", "bold");
  items.forEach(([label, hsn, amount], i) => {
    y += rowH;
    pdf.text(String(i + 1), M + 6, y);
    pdf.text(label, M + 40, y);
    pdf.setFont("helvetica", "normal");
    pdf.text(hsn, cHsn + 4, y);
    pdf.text(inr2(amount, ""), cAmt - 4, y, { align: "right" });
    pdf.setFont("helvetica", "bold");
  });

  if (inv.cgst > 0 || inv.sgst > 0) {
    y += rowH + 4;
    pdf.text("CGST", cHsn - 10, y, { align: "right" });
    pdf.setFont("helvetica", "normal");
    pdf.text(inr2(inv.cgst, ""), cAmt - 4, y, { align: "right" });
    y += rowH;
    pdf.setFont("helvetica", "bold");
    pdf.text("SGST", cHsn - 10, y, { align: "right" });
    pdf.setFont("helvetica", "normal");
    pdf.text(inr2(inv.sgst, ""), cAmt - 4, y, { align: "right" });
  }
  if (inv.roundOff !== 0) {
    y += rowH + 4;
    pdf.setFont("helvetica", "bold");
    pdf.text("Rounded Off", M + 40, y);
    pdf.setFont("helvetica", "normal");
    pdf.text(inr2(inv.roundOff, ""), cAmt - 4, y, { align: "right" });
  }

  const tableBottom = Math.max(y + 30, tableTop + 190);
  pdf.rect(M, tableTop, R - M, tableBottom - tableTop);
  pdf.line(cHsn, tableTop, cHsn, tableBottom);
  pdf.line(cHsn - 90, tableTop, cHsn - 90, tableTop + headerH);
  pdf.line(M + 30, tableTop, M + 30, tableBottom);

  // Total row
  const totalTop = tableBottom;
  pdf.rect(M, totalTop, R - M, 22);
  pdf.line(cHsn, totalTop, cHsn, totalTop + 22);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  pdf.text("Total", cHsn - 8, totalTop + 15, { align: "right" });
  pdf.text(`Rs. ${inr2(inv.total, "")}`, cAmt - 4, totalTop + 15, { align: "right" });

  y = totalTop + 40;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8.5);
  pdf.text("Amount Chargeable (in words)", M, y - 4);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  pdf.text(amountInWords(inv.total), M, y + 12);
  pdf.setFont("helvetica", "italic");
  pdf.setFontSize(8);
  pdf.text("E. & O.E", R, y - 4, { align: "right" });

  // Tax summary
  y += 28;
  const taxable = inv.rentAmount + inv.maintenanceAmount;
  if (inv.cgst > 0 || inv.sgst > 0) {
    const cols = [M, M + 130, M + 210, M + 270, M + 350, M + 410, M + 480, R];
    const head = ["HSN/SAC", "Taxable Value", "CGST %", "Amount", "SGST %", "Amount", "Total Tax"];
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    const hTop = y;
    head.forEach((h, i) => pdf.text(h, (cols[i] ?? M) + 3, y + 11));
    y += 16;
    const lines: [string, number, number, number][] = [
      [inv.hsnRent, inv.rentAmount, (inv.rentAmount / taxable) * inv.cgst, (inv.rentAmount / taxable) * inv.sgst],
    ];
    if (inv.maintenanceAmount > 0) {
      lines.push([
        inv.hsnMaintenance,
        inv.maintenanceAmount,
        (inv.maintenanceAmount / taxable) * inv.cgst,
        (inv.maintenanceAmount / taxable) * inv.sgst,
      ]);
    }
    lines.forEach(([hsn, value, c, s]) => {
      y += 13;
      pdf.text(hsn, M + 3, y);
      pdf.text(inr2(value, ""), (cols[2] ?? M) - 6, y, { align: "right" });
      pdf.text(`${inv.cgstPct}%`, (cols[2] ?? M) + 3, y);
      pdf.text(inr2(c, ""), (cols[4] ?? M) - 6, y, { align: "right" });
      pdf.text(`${inv.sgstPct}%`, (cols[4] ?? M) + 3, y);
      pdf.text(inr2(s, ""), (cols[6] ?? M) - 6, y, { align: "right" });
      pdf.text(inr2(c + s, ""), R - 4, y, { align: "right" });
    });
    y += 16;
    pdf.setFont("helvetica", "bold");
    pdf.text("Total", (cols[1] ?? M) - 6, y, { align: "right" });
    pdf.text(inr2(taxable, ""), (cols[2] ?? M) - 6, y, { align: "right" });
    pdf.text(inr2(inv.cgst, ""), (cols[4] ?? M) - 6, y, { align: "right" });
    pdf.text(inr2(inv.sgst, ""), (cols[6] ?? M) - 6, y, { align: "right" });
    pdf.text(inr2(inv.cgst + inv.sgst, ""), R - 4, y, { align: "right" });
    pdf.rect(M, hTop, R - M, y + 6 - hTop);
    pdf.line(M, hTop + 16, R, hTop + 16);
    [1, 2, 3, 4, 5, 6].forEach((i) => pdf.line(cols[i] ?? M, hTop, cols[i] ?? M, y + 6));

    y += 24;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8.5);
    pdf.text("Tax Amount (in words) :", M, y);
    pdf.setFont("helvetica", "bold");
    pdf.text(pdf.splitTextToSize(amountInWords(inv.cgst + inv.sgst), 330), M + 120, y);
    y += 20;
  }

  // Remarks + statutory info
  pdf.setFont("helvetica", "italic");
  pdf.setFontSize(8.5);
  pdf.text("Remarks:", M, y);
  pdf.setFont("helvetica", "normal");
  y += 13;
  pdf.text(inv.remarks || "—", M, y);
  y += 15;
  if (inv.vatTin) {
    pdf.text(`Company's VAT TIN    :  ${inv.vatTin}`, M, y);
    y += 13;
  }
  if (inv.panNo) {
    pdf.text(`Company's PAN        :  ${inv.panNo}`, M, y);
    y += 13;
  }
  y += 6;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.text(
    inv.paid >= inv.total ? "PAID" : `Balance due: Rs. ${inr2(Math.max(0, inv.total - inv.paid), "")}`,
    M,
    y,
  );

  // Signature
  const bottom = pdf.internal.pageSize.getHeight() - 90;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9.5);
  pdf.text(`for ${inv.parkName}`, R, bottom, { align: "right" });
  pdf.line(R - 150, bottom + 46, R, bottom + 46);
  pdf.text("Authorised Signatory", R, bottom + 58, { align: "right" });
  pdf.setFontSize(8.5);
  pdf.text("This is a Computer Generated Invoice", W / 2, bottom + 58, { align: "center" });
  return pdf;
}

export async function downloadRentInvoicePdf(inv: RentInvoicePdf): Promise<void> {
  const pdf = await build(inv);
  pdf.save(rentInvoiceFileName(inv));
  // Every downloaded invoice is also stored in the month-wise archive.
  void (async () => {
    try {
      const { archiveMonth, archivePdfQuiet } = await import("./pdf-archive-client");
      const month = archiveMonth(inv.month, inv.invoiceDate.slice(0, 7));
      if (!month) return;
      const pdf_base64 = await rentInvoicePdfBase64(inv);
      await archivePdfQuiet({
        kind: "rent",
        month,
        ref_id: inv.invoiceNo,
        label: inv.party,
        pdf_base64,
      });
    } catch {
      /* the download itself already succeeded */
    }
  })();
}

export async function openRentInvoicePdf(inv: RentInvoicePdf): Promise<void> {
  const pdf = await build(inv);
  const url = URL.createObjectURL(pdf.output("blob"));
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Blob URL for in-app preview (caller revokes it). */
export async function rentInvoicePdfUrl(inv: RentInvoicePdf): Promise<string> {
  const pdf = await build(inv);
  return URL.createObjectURL(pdf.output("blob"));
}

/** Base64 payload for the server-side month-wise archive. */
export async function rentInvoicePdfBase64(inv: RentInvoicePdf): Promise<string> {
  const pdf = await build(inv);
  const dataUri = pdf.output("datauristring");
  return dataUri.slice(dataUri.indexOf(",") + 1);
}
