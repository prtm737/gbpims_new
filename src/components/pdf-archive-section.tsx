import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, FileText, HardDriveUpload, Receipt, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { getPdfDownloadUrlFn, listPdfArchiveFn } from "@/lib/gbp.functions";
import { PDF_ARCHIVE_EVENT, type ArchivedPdfLike } from "@/lib/pdf-archive-shared";
import { useWorkbookState } from "@/components/workbook-state";
import { powerBills, type PowerBill } from "@/lib/power";
import { rentInvoiceViews, type RentInvoiceView } from "@/lib/rent-invoices";

const KIND_META: Record<
  string,
  { label: string; icon: typeof Zap; className: string }
> = {
  electricity: {
    label: "Electricity",
    icon: Zap,
    className: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  },
  rent: {
    label: "Rent",
    icon: FileText,
    className: "bg-primary/10 text-primary border-primary/30",
  },
  receipt: {
    label: "Receipt",
    icon: Receipt,
    className: "bg-sky-500/10 text-sky-600 border-sky-500/30",
  },
};

function prettyName(name: string): string {
  return name.replace(/\.pdf$/i, "").replace(/_/g, " · ");
}

function prettySize(size: number): string {
  return size > 1024 * 1024
    ? `${(size / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(size / 1024))} KB`;
}

/** Month-wise archive of every bill/invoice/receipt PDF stored in Supabase. */
export function PdfArchiveSection() {
  const listFn = useServerFn(listPdfArchiveFn);
  const urlFn = useServerFn(getPdfDownloadUrlFn);
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [openMonth, setOpenMonth] = useState<string | null>(null);

  const files = useQuery({
    queryKey: ["pdf-archive"],
    queryFn: () => listFn() as Promise<{ files: ArchivedPdfLike[] }>,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const { wb } = useWorkbookState();
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    const refresh = () => queryClient.invalidateQueries({ queryKey: ["pdf-archive"] });
    window.addEventListener(PDF_ARCHIVE_EVENT, refresh);
    return () => window.removeEventListener(PDF_ARCHIVE_EVENT, refresh);
  }, [queryClient]);

  const months = useMemo(() => {
    const all = files.data?.files ?? [];
    const byMonth = new Map<string, ArchivedPdfLike[]>();
    for (const f of all) {
      const list = byMonth.get(f.month) ?? [];
      list.push(f);
      byMonth.set(f.month, list);
    }
    return [...byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [files.data]);

  // Bills/invoices whose PDFs have not yet been stored — regeneratable from the sheet.
  const missing = useMemo(() => {
    if (!wb) return { electricity: 0, rent: 0, total: 0, elec: [] as PowerBill[], rents: [] as RentInvoiceView[] };
    const archived = new Set((files.data?.files ?? []).map((f) => f.name));
    const hasArchived = (refId: string) => {
      const safe = refId.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 80);
      return [...archived].some((n) => n === `${safe}.pdf` || n.startsWith(`${safe}_`));
    };
    const elec = powerBills(wb).filter((b) => !hasArchived(b.billId));
    const rents = rentInvoiceViews(wb).filter((r) => !hasArchived(r.invoiceNo || r.invoiceId));
    return { electricity: elec.length, rent: rents.length, total: elec.length + rents.length, elec, rents };
  }, [wb, files.data]);

  async function restoreMissing() {
    if (!wb || missing.total === 0) return;
    setRestoring(true);
    let ok = 0;
    let fail = 0;
    try {
      const { defaultPowerBillOptions, powerBillPdfBase64 } = await import("@/lib/pdf");
      const { rentInvoicePdfData } = await import("@/lib/rent-invoices");
      const { rentInvoicePdfBase64 } = await import("@/lib/pdf-rent");
      const { archiveMonth, archivePdfQuiet } = await import("@/lib/pdf-archive-client");
      for (const bill of missing.elec) {
        try {
          const opts = defaultPowerBillOptions(wb, bill);
          const month = archiveMonth(bill.monthKey, bill.billDate.slice(0, 7));
          if (!month) { fail += 1; continue; }
          const pdf_base64 = await powerBillPdfBase64(bill, opts);
          await archivePdfQuiet({ kind: "electricity", month, ref_id: bill.billId, label: bill.clientName, pdf_base64 });
          ok += 1;
        } catch { fail += 1; }
      }
      for (const inv of missing.rents) {
        try {
          const data = rentInvoicePdfData(wb, inv);
          const month = archiveMonth(inv.month, (inv.invoiceDate || "").slice(0, 7));
          if (!month) { fail += 1; continue; }
          const pdf_base64 = await rentInvoicePdfBase64(data);
          await archivePdfQuiet({ kind: "rent", month, ref_id: inv.invoiceNo || inv.invoiceId, label: data.party, pdf_base64 });
          ok += 1;
        } catch { fail += 1; }
      }
      if (ok > 0) toast.success(`Stored ${ok} missing PDF(s)`);
      if (fail > 0) toast.warning(`${fail} PDF(s) could not be stored — check console`);
      await files.refetch();
    } finally {
      setRestoring(false);
    }
  }

  async function download(path: string) {
    setBusy(path);
    try {
      const out = (await urlFn({ data: { path } })) as { url: string };
      window.open(out.url, "_blank", "noopener");
    } catch (err) {
      files.refetch();
      throw err;
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="surface-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h2 className="font-display text-base font-semibold">Stored PDFs</h2>
          <p className="text-xs text-muted-foreground">
            Every bill, invoice and receipt you download is saved here month-wise —
            re-download any time.
          </p>
        </div>
        <div className="flex gap-2">
          {missing.total > 0 && (
            <Button size="sm" variant="default" disabled={restoring || files.isFetching} onClick={() => void restoreMissing()}>
              <HardDriveUpload className="size-3.5" />
              {restoring ? "Storing…" : `Store ${missing.total} missing PDF(s)`}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={files.isFetching || restoring}
            onClick={() => files.refetch()}
          >
            {files.isFetching ? "Loading…" : "Refresh"}
          </Button>
        </div>
      </div>

      {months.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          {files.isLoading
            ? "Loading stored PDFs…"
            : "No stored PDFs yet — download any bill or receipt and it is saved here automatically."}
        </p>
      ) : (
        <div className="divide-y divide-border">
          {months.map(([month, list]) => {
            const open = openMonth === month;
            return (
              <div key={month}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
                  onClick={() => setOpenMonth(open ? null : month)}
                >
                  <span className="font-semibold">
                    {new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1).toLocaleDateString("en-IN", {
                      month: "long",
                      year: "numeric",
                    })}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {list.length} PDF{list.length === 1 ? "" : "s"} {open ? "▲" : "▼"}
                  </span>
                </button>
                {open && (
                  <div className="divide-y divide-border border-t border-border bg-muted/20">
                    {list.map((f) => {
                      const meta = KIND_META[f.kind] ?? KIND_META["receipt"]!;
                      const Icon = meta.icon;
                      return (
                        <div
                          key={f.path}
                          className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{prettyName(f.name)}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {prettySize(f.size)}
                              {f.updatedAt
                                ? ` · stored ${new Date(f.updatedAt).toLocaleDateString("en-IN")}`
                                : ""}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <span
                              className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${meta.className}`}
                            >
                              <Icon className="size-3" />
                              {meta.label}
                            </span>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy === f.path}
                              onClick={() => void download(f.path)}
                            >
                              <Download className="size-3.5" />
                              {busy === f.path ? "Opening…" : "Download"}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
