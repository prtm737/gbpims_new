import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CheckCheck, Download, FilePlus2, ReceiptIndianRupee, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { RentBillDialog, type RentDraft } from "@/components/rent-bill-dialog";
import { MarkRentPaidDialog } from "@/components/mark-rent-paid-dialog";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { canCreate, canDelete, useWorkbookState } from "@/components/workbook-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteRentInvoiceFn, generateRentFn } from "@/lib/gbp.functions";
import { downloadRentInvoicePdf } from "@/lib/pdf-rent";
import { rentInvoicePdfData, rentInvoiceViews, type RentInvoiceView } from "@/lib/rent-invoices";
import { currentMonth, inr, monthLabel } from "@/lib/sheets-schema";
import { useSheetMutation } from "@/lib/use-app-data";

export const Route = createFileRoute("/_authenticated/rent")({
  head: () => ({
    meta: [
      { title: "Rent billing | GBPIMS" },
      {
        name: "description",
        content:
          "Month-wise rent tax invoices per incubatee with GST, PDF download and paid marking.",
      },
      { property: "og:title", content: "Rent billing | GBPIMS" },
      { property: "og:description", content: "Incubatee-wise monthly rent billing with GST." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RentPage,
});

function RentPage() {
  const { wb, role, fallback } = useWorkbookState();
  const [month, setMonth] = useState(currentMonth());
  const [draft, setDraft] = useState<RentDraft | null>(null);
  const [payFor, setPayFor] = useState<RentInvoiceView | null>(null);
  const generate = useSheetMutation(
    useServerFn(generateRentFn),
    (out) => {
      const parts = [`${out.created} created`];
      if (out.updated > 0) parts.push(`${out.updated} refreshed`);
      parts.push(`${out.tenants} tenants billed`);
      if (out.skipped?.length) {
        parts.push(`skipped (no space): ${out.skipped.join(", ")}`);
      }
      return parts.join(" · ");
    },
  );
  const remove = useSheetMutation(useServerFn(deleteRentInvoiceFn), "Invoice deleted");

  const creator = canCreate(role);
  const deleter = canDelete(role);

  const invoices = useMemo(
    () => (wb ? rentInvoiceViews(wb).filter((i) => i.month === month) : []),
    [wb, month],
  );

  const billed = invoices.reduce((s, i) => s + i.amount, 0);
  const collected = invoices.reduce((s, i) => s + i.paid, 0);

  return (
    <AppShell
      title="Rent billing"
      subtitle={`${monthLabel(month)} · ${invoices.length} invoice${invoices.length === 1 ? "" : "s"}`}
      actions={
        creator ? (
          <Button size="sm" onClick={() => setDraft({ month })}>
            <FilePlus2 className="size-4" /> New invoice
          </Button>
        ) : undefined
      }
    >
      {fallback ?? (
        <div className="space-y-4">
          <div className="surface-card flex flex-wrap items-end justify-between gap-3 p-3.5">
            <div className="min-w-0">
              <label
                className="text-[10.5px] font-semibold tracking-[0.09em] text-muted-foreground uppercase"
                htmlFor="month"
              >
                Billing month
              </label>
              <Input
                id="month"
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="mt-1.5 w-44"
              />
            </div>
            {creator && (
              <Button
                size="sm"
                variant="outline"
                disabled={generate.isPending}
                onClick={() => generate.mutate({ data: { month } })}
              >
                {generate.isPending ? "Working…" : "Bill every tenant"}
              </Button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            <StatCard label="Billed (incl. GST)" value={inr(billed)} />
            <StatCard label="Collected" value={inr(collected)} tone="positive" />
            <div className="col-span-2 sm:col-span-1">
              <StatCard label="Pending" value={inr(Math.max(0, billed - collected))} tone="warning" />
            </div>
          </div>

          {invoices.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No rent bills for {monthLabel(month)} yet.
              {creator ? " Use “New bill” to bill an incubatee, or bill all tenants at once." : ""}
            </p>
          ) : (
            <div className="space-y-2">
              {invoices.map((inv) => (
                <div key={inv.invoiceId} className="surface-card p-3.5">
                  <div className="flex items-start gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <ReceiptIndianRupee className="size-4.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <p className="truncate text-sm font-semibold">{inv.company}</p>
                        <p className="font-display shrink-0 text-base leading-tight font-bold">
                          {inr(inv.amount)}
                        </p>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {inv.invoiceNo || inv.invoiceId} · {inv.labId || "no space"} ·{" "}
                        {monthLabel(inv.month)}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <StatusBadge status={inv.status} />
                        <span className="text-[11px] text-muted-foreground">
                          {inv.balance > 0 ? `${inr(inv.balance)} due` : "Fully settled"}
                        </span>
                      </div>
                      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                        Rent {inr(inv.rent)}
                        {inv.maintenance > 0 ? ` + maintenance ${inr(inv.maintenance)}` : ""}
                        {inv.gstApplicable
                          ? ` + CGST ${inr(inv.cgst)} + SGST ${inr(inv.sgst)}`
                          : " · GST not applicable"}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/70 pt-3">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 sm:flex-none"
                      onClick={() => wb && downloadRentInvoicePdf(rentInvoicePdfData(wb, inv))}
                    >
                      <Download className="size-4" /> Tax invoice
                    </Button>
                    {creator && inv.balance > 0 && (
                      <Button size="sm" className="flex-1 sm:flex-none" onClick={() => setPayFor(inv)}>
                        <CheckCheck className="size-4" /> Mark as paid
                      </Button>
                    )}
                    {deleter && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Delete invoice"
                        disabled={remove.isPending}
                        onClick={() => remove.mutate({ data: { invoice_id: inv.invoiceId } })}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {wb && (
        <RentBillDialog wb={wb} draft={draft} onClose={() => setDraft(null)} />
      )}
      <MarkRentPaidDialog invoice={payFor} onClose={() => setPayFor(null)} />
    </AppShell>
  );
}
