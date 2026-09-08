import { CalendarDays, Download, Eye, FileText, Receipt, Zap } from "lucide-react";
import { useState } from "react";

import { PdfPreviewDialog } from "@/components/pdf-preview-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { incubateeRent } from "@/lib/derive";
import { downloadPowerBillPdf, powerBillPdfUrl } from "@/lib/pdf";
import { downloadRentInvoicePdf, rentInvoicePdfUrl } from "@/lib/pdf-rent";
import { powerBills, powerClients } from "@/lib/power";
import { rentInvoicePdfData, rentInvoiceViews } from "@/lib/rent-invoices";
import { billTerms, dateLabel, inr, monthLabel, num, parkProfile, periodLabel, type Row, type Workbook } from "@/lib/sheets-schema";

/** Everything the park holds on one tenant: lease, invoices, bills and receipts. */
export function TenantDetailDialog({
  tenant,
  wb,
  onClose,
}: {
  tenant: Row | null;
  wb: Workbook | null;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<{ title: string; subtitle?: string } | null>(null);
  const [builder, setBuilder] = useState<(() => Promise<string>) | null>(null);
  const [downloader, setDownloader] = useState<(() => void) | null>(null);
  if (!tenant || !wb) return null;
  const workbook = wb;
  const tenantRow = tenant;
  const incubateeId = (tenant["incubatee_id"] ?? "").trim();
  const rent = incubateeRent(wb, tenant);
  const invoices = rentInvoiceViews(wb).filter((r) => r.incubateeId === incubateeId);
  const clients = powerClients(wb).filter(
    (c) => c.incubateeId === incubateeId || c.incubateeIds.includes(incubateeId),
  );
  const clientIds = clients.flatMap((c) => c.clientIds);
  const bills = powerBills(wb).filter((b) => clientIds.includes(b.clientId));
  const receipts = wb.payments.filter((p) => (p["incubatee_id"] ?? "") === incubateeId);
  const profile = parkProfile(wb.settings);

  const rentBilled = invoices.reduce((s, r) => s + r.amount, 0);
  const rentPaid = invoices.reduce((s, r) => s + r.paid, 0);
  const powerBilled = bills.reduce((s, b) => s + b.total, 0);
  const powerPaid = bills.reduce((s, b) => s + b.amountPaid, 0);
  const rentDue = Math.max(0, rentBilled - rentPaid);
  const powerDue = Math.max(0, powerBilled - powerPaid);
  const totalPending = rentDue + powerDue;

  // Month-wise ledger: every rent invoice, electricity bill and receipt grouped by month.
  type Entry = { date: string; kind: string; ref: string; detail: string; amount: number; status: string };
  const monthOf = (d: string) => (d || "").slice(0, 7) || "unknown";
  const entries: { month: string; rows: Entry[] }[] = [];
  const bucket = new Map<string, Entry[]>();
  const push = (month: string, row: Entry) => {
    const list = bucket.get(month) ?? [];
    list.push(row);
    bucket.set(month, list);
  };
  invoices.forEach((r) =>
    push(r.month || monthOf(r.invoiceDate), {
      date: r.invoiceDate,
      kind: "Rent",
      ref: r.invoiceNo || r.invoiceId,
      detail: `Billed ${inr(r.amount)} · paid ${inr(r.paid)}`,
      amount: r.balance,
      status: r.status,
    }),
  );
  bills.forEach((b) =>
    push(monthOf(b.billDate), {
      date: b.billDate,
      kind: "Electricity",
      ref: b.billId,
      detail: `${b.totalUnits} units · billed ${inr(b.total)} · paid ${inr(b.amountPaid)}`,
      amount: b.balance,
      status: b.paid ? "paid" : b.amountPaid > 0 ? "partial" : "unpaid",
    }),
  );
  receipts.forEach((p) =>
    push(monthOf(p["date"] ?? ""), {
      date: p["date"] ?? "",
      kind: "Receipt",
      ref: p["payment_id"] ?? "",
      detail: `${p["type"] ?? ""} ${p["ref_id"] ?? ""} · ${p["mode"] ?? ""}`.trim(),
      amount: -num(p["amount"]),
      status: "received",
    }),
  );
  [...bucket.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .forEach(([month, rows]) =>
      entries.push({ month, rows: rows.sort((a, b) => (a.date || "").localeCompare(b.date || "")) }),
    );

  function previewRentBill(inv: (typeof invoices)[number]) {
    const data = rentInvoicePdfData(workbook, inv);
    setPreview({
      title: `Rent invoice ${inv.invoiceNo || inv.invoiceId}`,
      subtitle: `${inv.company} · ${inr(inv.amount)}`,
    });
    setBuilder(() => () => rentInvoicePdfUrl(data));
    setDownloader(() => () => void downloadRentInvoicePdf(data));
  }

  function powerOptions(bill: (typeof bills)[number]) {
    const client = clients.find((c) => c.clientId === bill.clientId);
    return {
      ...profile,
      clientAddress: client?.address ?? tenantRow["address"] ?? "",
      clientPhone: client?.whatsapp ?? tenantRow["phone"] ?? "",
      terms: billTerms(workbook.settings),
    };
  }

  function previewElectricityBill(bill: (typeof bills)[number]) {
    const options = powerOptions(bill);
    setPreview({ title: `Electricity bill ${bill.billId}`, subtitle: `${bill.clientName} · ${inr(bill.total)}` });
    setBuilder(() => () => powerBillPdfUrl(bill, options));
    setDownloader(() => () => void downloadPowerBillPdf(bill, options));
  }

  return (
    <>
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92dvh] max-w-5xl overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-4 py-3 sm:px-5 sm:py-4">
          <DialogTitle className="text-sm sm:text-lg">Tenant account statement · {tenant["company_name"]}</DialogTitle>
          <DialogDescription>
            {incubateeId} · {tenant["lab_id"] || "No space"} ·{" "}
            {tenant["founder_name"] || "Founder not recorded"}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[calc(92dvh-6.5rem)]">
          <div className="min-w-0 space-y-5 px-4 py-4 sm:px-5">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Total pending" value={inr(totalPending)} tone={totalPending > 0} />
              <Stat label="Rent billed" value={inr(rentBilled)} />
              <Stat label="Rent due" value={inr(rentDue)} tone={rentDue > 0} />
              <Stat label="Electricity due" value={inr(powerDue)} tone={powerDue > 0} />
            </div>

            <Section title="Month-wise account statement" icon={<CalendarDays className="size-4" />}>
              {entries.length === 0 ? (
                <Empty>No transactions recorded yet.</Empty>
              ) : (
                <div className="space-y-3">
                  {entries.map((m) => (
                    <div key={m.month} className="space-y-1.5">
                      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                        {m.month === "unknown" ? "Undated" : monthLabel(m.month)}
                      </p>
                      <div className="grid min-w-0 gap-2 lg:grid-cols-2">
                        {m.rows.map((r) => (
                          <div key={`${r.kind}-${r.ref}-${r.date}`} className="min-w-0 rounded-xl border border-border bg-card/70 p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-foreground">{r.kind}</p>
                                <p className="truncate text-[11px] text-muted-foreground">{r.ref} · {dateLabel(r.date)}</p>
                              </div>
                              <div className="shrink-0 text-right">
                                <p className={r.amount > 0 ? "text-sm font-bold text-destructive" : "text-sm font-bold text-primary"}>
                                  {r.amount < 0 ? `- ${inr(Math.abs(r.amount))}` : inr(r.amount)}
                                </p>
                                <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">{r.status}</p>
                              </div>
                            </div>
                            <p className="mt-2 text-xs text-muted-foreground">{r.detail}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Section title="Lease & profile" icon={<FileText className="size-4" />}>
              <div className="grid min-w-0 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
                <Field label="Monthly rent" value={inr(rent.net)} />
                <Field label="Phone" value={tenant["phone"]} />
                <Field label="Email" value={tenant["email"]} />
                <Field label="Agreement no" value={tenant["agreement_no"]} />
                <Field label="GSTIN" value={tenant["gstin"]} />
                <Field label="Allotment" value={tenant["allotment_date"]} />
                <Field label="Agreement end" value={tenant["agreement_end"]} />
                <Field label="Security deposit" value={inr(num(tenant["security_deposit"]))} />
                <Field label="Status" value={tenant["status"] || "active"} />
              </div>
            </Section>

            <Section title={`Rent invoices (${invoices.length})`} icon={<Receipt className="size-4" />}>
              {invoices.length === 0 ? (
                <Empty>No rent invoices raised yet.</Empty>
              ) : (
                <div className="grid min-w-0 gap-2 lg:grid-cols-2">
                  {invoices.map((r) => {
                    const data = rentInvoicePdfData(wb, r);
                    return (
                      <BillCard
                        key={r.invoiceId}
                        title={r.invoiceNo || r.invoiceId}
                        meta={`${monthLabel(r.month)} · due ${dateLabel(r.dueDate)}`}
                        amount={r.amount}
                        paid={r.paid}
                        balance={r.balance}
                        status={r.status}
                        onPreview={() => previewRentBill(r)}
                        onDownload={() => void downloadRentInvoicePdf(data)}
                      />
                    );
                  })}
                </div>
              )}
            </Section>

            <Section title={`Electricity bills (${bills.length})`} icon={<Zap className="size-4" />}>
              {bills.length === 0 ? (
                <Empty>No electricity bills raised yet.</Empty>
              ) : (
                <div className="grid min-w-0 gap-2 lg:grid-cols-2">
                  {bills.map((b) => (
                    <BillCard
                      key={b.billId}
                      title={b.billId}
                      meta={`${periodLabel(b.periodFrom, b.periodTo)} · ${b.totalUnits} units${b.manual ? " · manual" : ""}`}
                      amount={b.total}
                      paid={b.amountPaid}
                      balance={b.balance}
                      status={b.paid ? "paid" : b.partial ? "partial" : "unpaid"}
                      onPreview={() => previewElectricityBill(b)}
                      onDownload={() => void downloadPowerBillPdf(b, powerOptions(b))}
                    />
                  ))}
                </div>
              )}
            </Section>

            <Section title={`Receipts (${receipts.length})`} icon={<Receipt className="size-4" />}>
              {receipts.length === 0 ? (
                <Empty>No payments recorded yet.</Empty>
              ) : (
                <Table
                  head={["Receipt", "Date", "Against", "Type", "Amount", "Mode"]}
                  rows={receipts.map((p) => [
                    p["payment_id"] ?? "",
                    p["date"] ?? "",
                    p["ref_id"] ?? "",
                    p["type"] ?? "",
                    inr(num(p["amount"])),
                    p["mode"] ?? "",
                  ])}
                />
              )}
            </Section>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
    <PdfPreviewDialog
      open={preview !== null}
      title={preview?.title ?? ""}
      subtitle={preview?.subtitle}
      build={builder}
      onDownload={downloader ?? undefined}
      onClose={() => {
        setPreview(null);
        setBuilder(null);
        setDownloader(null);
      }}
    />
    </>
  );
}

function BillCard({
  title,
  meta,
  amount,
  paid,
  balance,
  status,
  onPreview,
  onDownload,
}: {
  title: string;
  meta: string;
  amount: number;
  paid: number;
  balance: number;
  status: string;
  onPreview: () => void;
  onDownload: () => void;
}) {
  return (
    <article className="min-w-0 rounded-xl border border-border bg-card/70 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{meta}</p>
        </div>
        <p className="shrink-0 text-right font-display text-base font-bold">{inr(amount)}</p>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <Mini label="Paid" value={inr(paid)} />
        <Mini label="Balance" value={inr(balance)} tone={balance > 0} />
        <Mini label="Status" value={status} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={onPreview}>
          <Eye className="size-3.5" /> Preview
        </Button>
        <Button size="sm" variant="outline" onClick={onDownload}>
          <Download className="size-3.5" /> PDF
        </Button>
      </div>
    </article>
  );
}

function Mini({ label, value, tone }: { label: string; value: string; tone?: boolean }) {
  return (
    <div className="rounded-lg bg-muted/60 px-2 py-1.5">
      <p className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className={`truncate font-semibold ${tone ? "text-destructive" : "text-foreground"}`}>{value}</p>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card/70 px-3 py-2">
      <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <p
        className={`mt-0.5 truncate font-display text-sm font-bold tabular-nums ${tone ? "text-destructive" : "text-foreground"}`}
      >
        {value}
      </p>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <span className="text-primary">{icon}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function Field({ label, value }: { label: string; value: string | undefined }) {
  return (
    <p className="flex min-w-0 items-baseline justify-between gap-3 border-b border-dashed border-border/60 py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right font-medium break-words text-foreground">{value?.trim() || "—"}</span>
    </p>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
      {children}
    </p>
  );
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-xs">
        <thead className="bg-muted/60">
          <tr>
            {head.map((h) => (
              <th
                key={h}
                className="px-3 py-2 text-left font-semibold tracking-wide text-muted-foreground uppercase whitespace-nowrap"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border/70">
              {r.map((cell, j) => (
                <td key={j} className="px-3 py-2 whitespace-nowrap text-foreground">
                  {cell || "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}