import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  CheckCircle2,
  ChevronDown,
  Download,
  Eye,
  FilePlus2,
  History,
  MessageCircle,
  MessageSquarePlus,
  Pencil,
  Receipt,
  ShieldAlert,
  Trash2,
  Users,
  Zap,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { BulkReminderDialog } from "@/components/bulk-reminder-dialog";
import { ConfirmDeleteDialog, type DeleteTarget } from "@/components/confirm-delete-dialog";
import { EditRemarkDialog } from "@/components/edit-remark-dialog";
import { ManualPowerEntryDialog } from "@/components/manual-power-entry-dialog";
import { ManualRentEntryDialog } from "@/components/manual-rent-entry-dialog";
import { MarkRentPaidDialog } from "@/components/mark-rent-paid-dialog";
import { PdfArchiveSection } from "@/components/pdf-archive-section";
import { PdfPreviewDialog } from "@/components/pdf-preview-dialog";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { SyncStatus } from "@/components/sync-status";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { canCreate, canWrite, useWorkbookState } from "@/components/workbook-state";
import { auditRows, auditTimeLabel } from "@/lib/audit";
import { whatsappLink, downloadCsv } from "@/lib/derive";
import {
  cleanupOrphansFn,
  deletePowerBillFn,
  deleteRentInvoiceFn,
  markPowerBillPaidFn,
} from "@/lib/gbp.functions";
import { downloadRentInvoicePdf, rentInvoicePdfUrl } from "@/lib/pdf-rent";
import { downloadPowerBillPdf, powerBillPdfUrl } from "@/lib/pdf";
import { rentInvoicePdfData, rentInvoiceViews, type RentInvoiceView } from "@/lib/rent-invoices";
import {
  isOrphanBill,
  powerBillMessage,
  powerBills,
  powerClients,
  powerPaidMessage,
  type PowerBill,
} from "@/lib/power";
import { billTerms, dateLabel, inr, monthLabel, parkProfile, periodLabel } from "@/lib/sheets-schema";
import { useSheetMutation } from "@/lib/use-app-data";

export const Route = createFileRoute("/_authenticated/ledger")({
  head: () => ({
    meta: [
      { title: "Client ledger | GBPIMS" },
      {
        name: "description",
        content:
          "Tally-style client ledger: every rent and electricity entry grouped under the tenant, month wise, with mark paid, part payment, remarks and PDF invoices.",
      },
      { property: "og:title", content: "Client ledger | GBPIMS" },
      {
        property: "og:description",
        content: "One row per client, month-wise entries, payments and PDF archive.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LedgerPage,
});

type RemarkTarget = { kind: "rent" | "electricity"; id: string; label: string; remarks: string };

/** One ledger line — a rent invoice or an electricity bill, normalised. */
type Entry = {
  key: string;
  kind: "rent" | "power";
  ref: string;
  date: string;
  month: string;
  note: string;
  amount: number;
  paid: number;
  balance: number;
  status: string;
  remarks: string;
  manual: boolean;
  orphan: boolean;
  rent?: RentInvoiceView;
  bill?: PowerBill;
};

type ClientLedger = {
  id: string;
  name: string;
  lab: string;
  phone: string;
  entries: Entry[];
  billed: number;
  received: number;
  outstanding: number;
  orphan: boolean;
};

function LedgerPage() {
  const { wb, role, fallback, refetch, syncing, updatedAt, syncError } = useWorkbookState();
  const writable = canWrite(role);
  const creator = canCreate(role);
  const admin = role === "admin";
  const bills = useMemo(() => (wb ? powerBills(wb) : []), [wb]);
  const clients = useMemo(() => (wb ? powerClients(wb) : []), [wb]);
  const rentRows = useMemo(() => (wb ? rentInvoiceViews(wb) : []), [wb]);
  const trail = useMemo(() => (wb ? auditRows(wb) : []), [wb]);

  const markPaid = useSheetMutation(useServerFn(markPowerBillPaidFn), "Payment recorded");
  const removeBill = useSheetMutation(useServerFn(deletePowerBillFn), "Electricity entry deleted");
  const removeRent = useSheetMutation(useServerFn(deleteRentInvoiceFn), "Rent entry deleted");
  const cleanup = useSheetMutation(
    useServerFn(cleanupOrphansFn),
    (out) =>
      out.removed > 0
        ? `${out.removed} orphaned record${out.removed > 1 ? "s" : ""} removed`
        : "No orphaned records found",
  );

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "unpaid" | "paid">("all");
  const [kindFilter, setKindFilter] = useState<"all" | "rent" | "power">("all");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [payBill, setPayBill] = useState<PowerBill | null>(null);
  const [manualPower, setManualPower] = useState(false);
  const [editPower, setEditPower] = useState<PowerBill | null>(null);
  const [manualRent, setManualRent] = useState(false);
  const [editRent, setEditRent] = useState<RentInvoiceView | null>(null);
  const [payRent, setPayRent] = useState<RentInvoiceView | null>(null);
  const [remark, setRemark] = useState<RemarkTarget | null>(null);
  const [showAudit, setShowAudit] = useState(false);
  const [bulkRemind, setBulkRemind] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<
    (DeleteTarget & { kind: "rent" | "electricity" }) | null
  >(null);
  const [confirmCleanup, setConfirmCleanup] = useState(false);
  const [preview, setPreview] = useState<{ title: string; subtitle: string } | null>(null);
  const [builder, setBuilder] = useState<(() => Promise<string>) | null>(null);
  const [downloader, setDownloader] = useState<(() => void) | null>(null);
  const [payment, setPayment] = useState({
    date: new Date().toISOString().slice(0, 10),
    mode: "upi",
    ref: "",
    remarks: "",
    amount: "",
  });

  const profile = parkProfile(wb?.settings ?? {});
  const parkName = profile.parkName;
  const pdfOptions = useCallback(
    (bill: PowerBill) => {
      const client = clients.find((c) => c.clientId === bill.clientId);
      return {
        ...profile,
        clientAddress: client?.address ?? "",
        clientPhone: client?.whatsapp ?? "",
        terms: wb ? billTerms(wb.settings) : [],
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clients, wb],
  );

  function previewPower(bill: PowerBill) {
    const options = pdfOptions(bill);
    setPreview({
      title: `Electricity bill ${bill.billId}`,
      subtitle: `${bill.clientName} · ${inr(bill.total)}`,
    });
    setBuilder(() => () => powerBillPdfUrl(bill, options));
    setDownloader(() => () => void downloadPowerBillPdf(bill, options));
  }

  function previewRent(inv: RentInvoiceView) {
    if (!wb) return;
    const data = rentInvoicePdfData(wb, inv);
    setPreview({
      title: `Rent invoice ${inv.invoiceNo || inv.invoiceId}`,
      subtitle: `${inv.company} · ${inr(inv.amount)}`,
    });
    setBuilder(() => () => rentInvoicePdfUrl(data));
    setDownloader(() => () => void downloadRentInvoicePdf(data));
  }

  /** Every rent invoice + electricity bill grouped under the client that owes it.
   *  Tenants are matched by company name (case-insensitive) so a company
   *  occupying several labs — recorded as multiple tenant rows — appears as
   *  ONE ledger group with every lab and entry merged. */
  const ledgers: ClientLedger[] = useMemo(() => {
    const map = new Map<string, ClientLedger>();
    const keyOf = (name: string) => name.trim().toLowerCase();
    const ensure = (name: string, lab: string, phone: string, orphan: boolean) => {
      const id = keyOf(name) || `orphan:${name}`;
      const existing = map.get(id);
      if (existing) {
        const labIds = new Set(
          existing.lab.split(",").map((s) => s.trim()).filter(Boolean),
        );
        if (lab) lab.split(",").forEach((s) => labIds.add(s.trim()));
        existing.lab = [...labIds].sort().join(", ");
        if (!existing.phone && phone) existing.phone = phone;
        return existing;
      }
      const fresh: ClientLedger = {
        id,
        name: name.trim(),
        lab: lab
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .sort()
          .join(", "),
        phone,
        entries: [],
        billed: 0,
        received: 0,
        outstanding: 0,
        orphan,
      };
      map.set(id, fresh);
      return fresh;
    };

    // Tenants first so a client with no entry yet still shows as a row.
    (wb?.incubatees ?? [])
      .filter((i) => (i["incubatee_id"] ?? "").trim() !== "")
      .forEach((i) =>
        ensure(
          i["company_name"] || i["founder_name"] || (i["incubatee_id"] ?? ""),
          i["lab_id"] ?? "",
          i["phone"] ?? "",
          false,
        ),
      );

    rentRows.forEach((r) => {
      const orphan = r.orphan || !r.incubateeId;
      const name = orphan ? `Orphaned — ${r.company || "unknown"}` : r.company;
      const c = ensure(name, r.labId, r.phone, orphan);
      c.entries.push({
        key: `rent:${r.invoiceId}`,
        kind: "rent",
        ref: r.invoiceNo || r.invoiceId,
        date: r.invoiceDate,
        month: r.month || r.invoiceDate.slice(0, 7),
        note: `Rent ${inr(r.rent)}${r.maintenance > 0 ? ` + maint. ${inr(r.maintenance)}` : ""}${
          r.gstApplicable ? " + GST" : ""
        }`,
        amount: r.amount,
        paid: r.paid,
        balance: r.balance,
        status: r.status,
        remarks: r.remarks,
        manual: true,
        orphan: r.orphan,
        rent: r,
      });
    });

    bills.forEach((b) => {
      const client = clients.find(
        (c) => c.clientId === b.clientId || c.clientIds.includes(b.clientId),
      );
      const tenantId = (client?.incubateeId ?? "").trim();
      // Resolve the company name from the billing client, falling back to the
      // tenant list so a client row without an incubatee link still merges
      // under the right company instead of showing as a separate entry.
      const tenant = tenantId
        ? (wb?.incubatees ?? []).find((i) => i["incubatee_id"] === tenantId)
        : undefined;
      const companyName =
        tenant?.["company_name"]?.trim() ||
        client?.name?.trim() ||
        b.clientName?.trim() ||
        "";
      const orphan = isOrphanBill(b, clients) || companyName === "";
      const name = orphan ? `Orphaned — ${b.clientName || "unknown"}` : companyName;
      const c = ensure(name, "", client?.whatsapp ?? "", orphan);
      c.entries.push({
        key: `power:${b.billId}`,
        kind: "power",
        ref: b.billId,
        date: b.billDate,
        month: b.monthKey || b.billDate.slice(0, 7),
        note: `${b.totalUnits} units · ${periodLabel(b.periodFrom, b.periodTo)}`,
        amount: b.total,
        paid: b.amountPaid,
        balance: b.balance,
        status: b.paid ? "paid" : b.partial ? "partial" : b.balance > 0 ? "pending" : "pending",
        remarks: b.remarks,
        manual: b.manual,
        orphan,
        bill: b,
      });
    });

    const term = query.trim().toLowerCase();
    return [...map.values()]
      .map((c) => {
        const entries = c.entries
          .filter((e) => (kindFilter === "all" ? true : e.kind === kindFilter))
          .filter((e) =>
            filter === "all" ? true : filter === "paid" ? e.balance <= 0 : e.balance > 0,
          )
          .sort((a, b) => (b.month + b.date).localeCompare(a.month + a.date));
        const billed = entries.reduce((s, e) => s + e.amount, 0);
        const received = entries.reduce((s, e) => s + e.paid, 0);
        return {
          ...c,
          entries,
          billed,
          received,
          outstanding: entries.reduce((s, e) => s + e.balance, 0),
        };
      })
      .filter((c) => {
        if (term === "") return true;
        if (`${c.name} ${c.lab} ${c.id}`.toLowerCase().includes(term)) return true;
        return c.entries.some((e) =>
          `${e.ref} ${e.month} ${e.remarks}`.toLowerCase().includes(term),
        );
      })
      .sort(
        (a, b) =>
          b.outstanding - a.outstanding ||
          b.entries.length - a.entries.length ||
          a.name.localeCompare(b.name),
      );
  }, [wb, rentRows, bills, clients, query, filter, kindFilter]);

  const totalBilled = ledgers.reduce((s, c) => s + c.billed, 0);
  const totalReceived = ledgers.reduce((s, c) => s + c.received, 0);
  const totalOutstanding = ledgers.reduce((s, c) => s + c.outstanding, 0);
  const entryCount = ledgers.reduce((s, c) => s + c.entries.length, 0);
  const orphanCount =
    rentRows.filter((r) => r.orphan).length + bills.filter((b) => isOrphanBill(b, clients)).length;

  function runDelete() {
    if (!confirmDelete) return;
    const done = { onSuccess: () => setConfirmDelete(null) };
    if (confirmDelete.kind === "rent") {
      removeRent.mutate({ data: { invoice_id: confirmDelete.code } }, done);
    } else {
      removeBill.mutate({ data: { bill_id: confirmDelete.code } }, done);
    }
  }

  function exportCsv() {
    downloadCsv(
      "gbpims-client-ledger.csv",
      ledgers.flatMap((c) =>
        c.entries.map((e) => ({
          client: c.name,
          lab: c.lab,
          type: e.kind === "rent" ? "Rent" : "Electricity",
          reference: e.ref,
          month: e.month,
          date: e.date,
          amount: e.amount,
          received: e.paid,
          balance: e.balance,
          status: e.status,
          remarks: e.remarks,
        })),
      ),
    );
  }

  return (
    <AppShell
      title="Client ledger"
      subtitle={`${ledgers.length} clients · ${entryCount} ledger entries`}
    >
      {fallback ?? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              {creator && (
                <Button size="sm" className="h-10" onClick={() => setManualRent(true)}>
                  <FilePlus2 className="size-4" /> Rent entry
                </Button>
              )}
              {creator && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-10"
                  onClick={() => setManualPower(true)}
                >
                  <Zap className="size-4" /> Electricity entry
                </Button>
              )}
              <Button size="sm" variant="outline" className="h-10" onClick={exportCsv}>
                <Download className="size-3.5" /> CSV
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-10"
                onClick={() => setBulkRemind(true)}
              >
                <MessageCircle className="size-3.5" /> Remind all
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-10"
                onClick={() => setShowAudit(true)}
              >
                <History className="size-3.5" /> Audit
              </Button>
            </div>
            <SyncStatus
              syncing={syncing}
              updatedAt={updatedAt}
              error={syncError}
              onRefresh={refetch}
            />
          </div>

          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <StatCard label="Billed" value={inr(totalBilled)} />
            <StatCard label="Collected" value={inr(totalReceived)} tone="positive" />
            <StatCard label="Outstanding" value={inr(totalOutstanding)} tone="warning" />
            <StatCard label="Entries" value={String(entryCount)} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="h-10 w-full sm:w-72"
              placeholder="Search client, lab, bill no, month or remark"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="flex flex-1 gap-2">
              {(["all", "unpaid", "paid"] as const).map((f) => (
                <Button
                  key={f}
                  size="sm"
                  variant={filter === f ? "default" : "outline"}
                  onClick={() => setFilter(f)}
                  className="h-10 flex-1 capitalize sm:flex-none"
                >
                  {f}
                </Button>
              ))}
            </div>
            <div className="flex flex-1 gap-2">
              {(
                [
                  ["all", "Both"],
                  ["rent", "Rent"],
                  ["power", "Electricity"],
                ] as const
              ).map(([value, label]) => (
                <Button
                  key={value}
                  size="sm"
                  variant={kindFilter === value ? "secondary" : "outline"}
                  onClick={() => setKindFilter(value)}
                  className="h-10 flex-1 sm:flex-none"
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>

          {orphanCount > 0 && (
            <div className="surface-card flex flex-wrap items-center justify-between gap-3 border-amber-500/40 bg-amber-500/10 p-3.5">
              <div className="flex min-w-0 items-start gap-2.5">
                <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold">
                    {orphanCount} orphaned record{orphanCount > 1 ? "s" : ""} detected
                  </p>
                  <p className="text-xs text-muted-foreground">
                    These entries point at a tenant or billing client that was deleted, so they are
                    grouped separately instead of under a live client.
                  </p>
                </div>
              </div>
              {admin && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-10"
                  onClick={() => setConfirmCleanup(true)}
                >
                  Run cleanup
                </Button>
              )}
            </div>
          )}

          {/* Tally-style client rows: one line per client, expand for month-wise entries. */}
          <div className="surface-card overflow-hidden p-0">
            <div className="hidden grid-cols-[minmax(0,1fr)_repeat(3,7.5rem)_5rem] gap-3 border-b border-border/70 bg-muted/40 px-4 py-2.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase lg:grid">
              <span>Client</span>
              <span className="text-right">Billed</span>
              <span className="text-right">Received</span>
              <span className="text-right">Outstanding</span>
              <span className="text-right">Entries</span>
            </div>

            {ledgers.map((c) => {
              const expanded = open[c.id] ?? false;
              const byMonth = c.entries.reduce<Record<string, Entry[]>>((acc, e) => {
                (acc[e.month || "unknown"] ??= []).push(e);
                return acc;
              }, {});
              return (
                <section key={c.id} className="border-b border-border/60 last:border-b-0">
                  <button
                    type="button"
                    onClick={() => setOpen((p) => ({ ...p, [c.id]: !expanded }))}
                    className="grid w-full grid-cols-2 items-center gap-2 px-4 py-3 text-left transition hover:bg-muted/40 lg:grid-cols-[minmax(0,1fr)_repeat(3,7.5rem)_5rem] lg:gap-3"
                  >
                    <div className="col-span-2 flex min-w-0 items-center gap-2 lg:col-span-1">
                      <ChevronDown
                        className={`size-4 shrink-0 text-muted-foreground transition ${
                          expanded ? "rotate-0" : "-rotate-90"
                        }`}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{c.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {c.orphan ? "Orphaned records" : c.lab || "No space allotted"}
                        </span>
                      </span>
                    </div>
                    <span className="text-left lg:text-right">
                      <span className="block text-[10px] tracking-wide text-muted-foreground uppercase lg:hidden">
                        Billed
                      </span>
                      <span className="text-sm font-semibold tabular-nums">{inr(c.billed)}</span>
                    </span>
                    <span className="text-left lg:text-right">
                      <span className="block text-[10px] tracking-wide text-muted-foreground uppercase lg:hidden">
                        Received
                      </span>
                      <span className="text-sm font-semibold tabular-nums text-primary">
                        {inr(c.received)}
                      </span>
                    </span>
                    <span className="text-left lg:text-right">
                      <span className="block text-[10px] tracking-wide text-muted-foreground uppercase lg:hidden">
                        Outstanding
                      </span>
                      <span
                        className={`text-sm font-bold tabular-nums ${
                          c.outstanding > 0 ? "text-destructive" : "text-muted-foreground"
                        }`}
                      >
                        {inr(c.outstanding)}
                      </span>
                    </span>
                    <span className="text-left lg:text-right">
                      <span className="text-xs text-muted-foreground">
                        {c.entries.length} entr{c.entries.length === 1 ? "y" : "ies"}
                      </span>
                    </span>
                  </button>

                  {expanded && (
                    <div className="space-y-3 border-t border-border/60 bg-muted/20 px-3 py-3 sm:px-4">
                      {c.entries.length === 0 && (
                        <p className="py-3 text-center text-xs text-muted-foreground">
                          No ledger entries for this client in the current filter.
                        </p>
                      )}
                      {Object.entries(byMonth)
                        .sort((a, b) => b[0].localeCompare(a[0]))
                        .map(([month, rows]) => (
                          <div key={month} className="space-y-2">
                            <div className="flex items-baseline justify-between gap-2">
                              <h3 className="font-display text-xs font-semibold">
                                {month === "unknown" ? "Undated" : monthLabel(month)}
                              </h3>
                              <span className="text-[11px] text-muted-foreground">
                                {inr(rows.reduce((s, e) => s + e.amount, 0))} billed ·{" "}
                                {inr(rows.reduce((s, e) => s + e.balance, 0))} due
                              </span>
                            </div>
                            {rows.map((e) => (
                              <article
                                key={e.key}
                                className="rounded-xl border border-border/70 bg-card/80 p-3"
                              >
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5">
                                      {e.kind === "rent" ? (
                                        <Receipt className="size-3.5 shrink-0 text-primary" />
                                      ) : (
                                        <Zap className="size-3.5 shrink-0 text-sky-600" />
                                      )}
                                      <p className="truncate text-sm font-semibold">
                                        {e.kind === "rent" ? "Rent" : "Electricity"} · {e.ref}
                                      </p>
                                    </div>
                                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                                      {dateLabel(e.date)} · {e.note}
                                    </p>
                                  </div>
                                  <div className="shrink-0 text-right">
                                    <p className="font-display text-base font-bold tabular-nums">
                                      {inr(e.amount)}
                                    </p>
                                    <StatusBadge status={e.status} />
                                  </div>
                                </div>

                                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                                  <div className="rounded-lg bg-muted/60 px-2.5 py-1.5">
                                    <p className="text-[10px] tracking-wide text-muted-foreground uppercase">
                                      Received
                                    </p>
                                    <p className="text-sm font-semibold tabular-nums">
                                      {inr(e.paid)}
                                    </p>
                                  </div>
                                  <div className="rounded-lg bg-muted/60 px-2.5 py-1.5">
                                    <p className="text-[10px] tracking-wide text-muted-foreground uppercase">
                                      Balance
                                    </p>
                                    <p className="text-sm font-semibold tabular-nums">
                                      {inr(e.balance)}
                                    </p>
                                  </div>
                                  <div className="col-span-2 rounded-lg border border-dashed border-border px-2.5 py-1.5 sm:col-span-1">
                                    <p className="text-[10px] tracking-wide text-muted-foreground uppercase">
                                      Remark
                                    </p>
                                    <p className="truncate text-xs">
                                      {e.remarks || (
                                        <span className="text-muted-foreground">None</span>
                                      )}
                                    </p>
                                  </div>
                                </div>

                                <div className="mt-2.5 flex flex-wrap gap-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                      e.rent ? previewRent(e.rent) : e.bill && previewPower(e.bill)
                                    }
                                  >
                                    <Eye className="size-3.5" /> Preview
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      if (e.rent && wb)
                                        void downloadRentInvoicePdf(rentInvoicePdfData(wb, e.rent));
                                      else if (e.bill)
                                        void downloadPowerBillPdf(e.bill, pdfOptions(e.bill));
                                    }}
                                  >
                                    <Download className="size-3.5" /> PDF
                                  </Button>
                                  {e.bill && c.phone && (
                                    <Button size="sm" variant="outline" asChild>
                                      <a
                                        href={whatsappLink(
                                          c.phone,
                                          e.bill.paid
                                            ? powerPaidMessage(e.bill, parkName)
                                            : powerBillMessage(e.bill, parkName),
                                        )}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        <MessageCircle className="size-3.5" />
                                        {e.bill.paid ? "Receipt" : "Send"}
                                      </a>
                                    </Button>
                                  )}
                                  {writable && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() =>
                                        setRemark({
                                          kind: e.kind === "rent" ? "rent" : "electricity",
                                          id: e.rent ? e.rent.invoiceId : (e.bill?.billId ?? ""),
                                          label: `${e.ref} · ${c.name}`,
                                          remarks: e.remarks,
                                        })
                                      }
                                    >
                                      <MessageSquarePlus className="size-3.5" /> Remark
                                    </Button>
                                  )}
                                  {writable && e.balance > 0 && (
                                    <Button
                                      size="sm"
                                      onClick={() =>
                                        e.rent ? setPayRent(e.rent) : e.bill && setPayBill(e.bill)
                                      }
                                    >
                                      <CheckCircle2 className="size-3.5" />
                                      {e.paid > 0 ? "Record payment" : "Mark paid"}
                                    </Button>
                                  )}
                                  {admin && (e.rent || e.bill?.manual) && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() =>
                                        e.rent ? setEditRent(e.rent) : e.bill && setEditPower(e.bill)
                                      }
                                    >
                                      <Pencil className="size-3.5" /> Edit
                                    </Button>
                                  )}
                                  {admin && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      aria-label="Delete ledger entry"
                                      onClick={() =>
                                        setConfirmDelete(
                                          e.rent
                                            ? {
                                                kind: "rent",
                                                title: `rent entry ${e.ref}`,
                                                code: e.rent.invoiceId,
                                                impact: [
                                                  `${c.name} · ${monthLabel(e.month) || e.month}`,
                                                  `Invoice value ${inr(e.amount)}, received ${inr(e.paid)}`,
                                                  "The row is cleared from the RentInvoices sheet and logged in the audit trail",
                                                ],
                                              }
                                            : {
                                                kind: "electricity",
                                                title: `electricity bill ${e.ref}`,
                                                code: e.bill?.billId ?? "",
                                                impact: [
                                                  `${c.name} · ${monthLabel(e.month) || e.month}`,
                                                  `Bill value ${inr(e.amount)} · ${
                                                    e.balance <= 0 ? "already paid" : "unpaid"
                                                  }`,
                                                  "The row is cleared from the Ledger sheet and logged in the audit trail",
                                                ],
                                              },
                                        )
                                      }
                                    >
                                      <Trash2 className="size-3.5 text-destructive" />
                                    </Button>
                                  )}
                                </div>
                              </article>
                            ))}
                          </div>
                        ))}
                    </div>
                  )}
                </section>
              );
            })}

            {ledgers.length === 0 && (
              <p className="p-8 text-center text-sm text-muted-foreground">
                <Users className="mx-auto mb-2 size-5 opacity-60" />
                No client matches this view yet.
              </p>
            )}
          </div>

          {/* Month-wise archive of every downloaded bill / invoice / receipt. */}
          <PdfArchiveSection />
        </div>
      )}

      {bulkRemind && (
        <BulkReminderDialog
          parkName={parkName}
          onClose={() => setBulkRemind(false)}
          rows={[
            ...rentRows
              .filter((r) => r.balance > 0)
              .map((r) => ({
                id: `rent-${r.invoiceId}`,
                kind: "rent" as const,
                company: r.company,
                month: r.month,
                amount: r.amount,
                paid: r.paid,
                balance: r.balance,
                dueDate: r.dueDate,
                phone: r.phone,
              })),
            ...bills
              .filter((b) => b.balance > 0)
              .map((b) => {
                const client = clients.find((c) => c.clientId === b.clientId);
                return {
                  id: `power-${b.billId}`,
                  kind: "electricity" as const,
                  company: b.clientName,
                  month: b.monthKey || b.billDate.slice(0, 7),
                  amount: b.total,
                  paid: b.amountPaid,
                  balance: b.balance,
                  dueDate: b.dueDate,
                  phone: client?.whatsapp ?? "",
                };
              }),
          ]}
        />
      )}

      <Dialog open={showAudit} onOpenChange={(o) => !o && setShowAudit(false)}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto">          <DialogHeader>
            <DialogTitle>Ledger audit trail</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Every ledger change — entries, edits, remarks, payments and deletions — is written to the
            AuditLog tab of your Google Sheet.
          </p>
          <div className="space-y-2">
            {trail.map((row) => (
              <article key={row.id} className="rounded-xl border border-border/70 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold capitalize">
                    {row.entity === "rent" ? "Rent" : "Electricity"} · {row.action}
                  </p>
                  <p className="text-[11px] text-muted-foreground">{auditTimeLabel(row.at)}</p>
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {row.entityId}
                  {row.month ? ` · ${monthLabel(row.month)}` : ""}
                  {row.amount ? ` · ${inr(row.amount)}` : ""}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  by {row.actor || "—"}
                  {row.details ? ` · ${row.details}` : ""}
                </p>
              </article>
            ))}
            {trail.length === 0 && (
              <p className="p-6 text-center text-sm text-muted-foreground">
                No ledger activity has been logged yet.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ManualRentEntryDialog
        open={manualRent || editRent !== null}
        month={new Date().toISOString().slice(0, 7)}
        wb={wb}
        edit={
          editRent
            ? {
                invoiceId: editRent.invoiceId,
                invoiceNo: editRent.invoiceNo,
                incubateeId: editRent.incubateeId,
                month: editRent.month,
                invoiceDate: editRent.invoiceDate,
                dueDate: editRent.dueDate,
                rent: editRent.rent,
                maintenance: editRent.maintenance,
                gstApplicable: editRent.gstApplicable,
                remarks: editRent.remarks,
              }
            : null
        }
        onClose={() => {
          setManualRent(false);
          setEditRent(null);
        }}
      />
      <ManualPowerEntryDialog
        open={manualPower || editPower !== null}
        clients={clients}
        wb={wb ?? null}
        edit={editPower}
        onClose={() => {
          setManualPower(false);
          setEditPower(null);
        }}
      />
      <MarkRentPaidDialog invoice={payRent} onClose={() => setPayRent(null)} parkName={parkName} />
      <ConfirmDeleteDialog
        target={confirmDelete}
        pending={removeRent.isPending || removeBill.isPending}
        onConfirm={runDelete}
        onClose={() => setConfirmDelete(null)}
      />
      <ConfirmDeleteDialog
        target={
          confirmCleanup
            ? {
                title: `${orphanCount} orphaned record${orphanCount > 1 ? "s" : ""}`,
                code: "CLEANUP",
                impact: [
                  "Every rent invoice and electricity bill whose tenant or billing client no longer exists is cleared",
                  "Billing clients left behind by a deleted tenant are removed too",
                  "The sweep is written to the audit trail with your name",
                ],
              }
            : null
        }
        pending={cleanup.isPending}
        onConfirm={() => cleanup.mutate({} as never, { onSuccess: () => setConfirmCleanup(false) })}
        onClose={() => setConfirmCleanup(false)}
      />
      <EditRemarkDialog target={remark} onClose={() => setRemark(null)} />
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

      <Dialog open={payBill !== null} onOpenChange={(open) => !open && setPayBill(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record payment · {payBill?.billId}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs">
              <p className="font-semibold text-foreground">{payBill?.clientName}</p>
              <p className="mt-0.5 text-muted-foreground">
                Bill {inr(payBill?.total ?? 0)}
                {payBill && payBill.amountPaid > 0 ? ` · received ${inr(payBill.amountPaid)}` : ""}
              </p>
              <p className="mt-1 text-sm font-bold text-foreground">
                {inr(payBill?.balance ?? 0)} receivable
              </p>
            </div>
            <div>
              <Label className="text-xs">Amount received</Label>
              <Input
                type="number"
                inputMode="decimal"
                min="0"
                className="mt-1"
                placeholder={String(payBill?.balance ?? 0)}
                value={payment.amount}
                onChange={(e) => setPayment({ ...payment, amount: e.target.value })}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Leave blank to settle the full balance. Enter a smaller figure for a part payment —
                the remainder stays as balance.
              </p>
            </div>
            <div>
              <Label className="text-xs">Payment date</Label>
              <Input
                type="date"
                className="mt-1"
                value={payment.date}
                onChange={(e) => setPayment({ ...payment, date: e.target.value })}
              />
            </div>
            <div>
              <Label className="text-xs">Mode</Label>
              <div className="mt-1 flex flex-wrap gap-2">
                {["upi", "bank", "cash", "cheque"].map((m) => (
                  <Button
                    key={m}
                    size="sm"
                    variant={payment.mode === m ? "default" : "outline"}
                    onClick={() => setPayment({ ...payment, mode: m })}
                    className="capitalize"
                  >
                    {m}
                  </Button>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-xs">Transaction reference</Label>
              <Input
                className="mt-1"
                value={payment.ref}
                placeholder="TXN / UTR number"
                onChange={(e) => setPayment({ ...payment, ref: e.target.value })}
              />
            </div>
            <div>
              <Label className="text-xs">Remarks</Label>
              <Textarea
                rows={2}
                className="mt-1"
                value={payment.remarks}
                placeholder="e.g. paid in cash at office / cheque no. 123456"
                onChange={(e) => setPayment({ ...payment, remarks: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={markPaid.isPending}
              onClick={() =>
                payBill &&
                markPaid.mutate(
                  {
                    data: {
                      bill_id: payBill.billId,
                      payment_date: payment.date,
                      payment_mode: payment.mode,
                      txn_ref: payment.ref,
                      remarks: payment.remarks,
                      ...(Number(payment.amount) > 0 ? { amount: Number(payment.amount) } : {}),
                    },
                  },
                  {
                    onSuccess: () => {
                      setPayBill(null);
                      setPayment({ ...payment, amount: "", ref: "", remarks: "" });
                    },
                  },
                )
              }
            >
              {markPaid.isPending ? "Saving…" : "Confirm receipt"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
