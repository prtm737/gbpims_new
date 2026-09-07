import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Download, Eye, Pencil, Plus, Trash2, Users, Zap } from "lucide-react";
import { useMemo, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { ConfirmDeleteDialog, type DeleteTarget } from "@/components/confirm-delete-dialog";
import { PdfArchiveSection } from "@/components/pdf-archive-section";
import { PdfPreviewDialog } from "@/components/pdf-preview-dialog";
import { StatCard } from "@/components/stat-card";
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
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { canWrite, useWorkbookState } from "@/components/workbook-state";
import {
  deletePowerClientFn,
  deletePowerBillFn,
  importTenantClientsFn,
  savePowerBillFn,
  savePowerClientFn,
} from "@/lib/gbp.functions";
import {
  billPreview,
  lastReadings,
  outstandingArrears,
  powerBills,
  powerClients,
  powerSummary,
  type PowerBill,
  type PowerClient,
} from "@/lib/power";
import {
  billTerms,
  electricityDutyPct,
  electricityFixedChargeRate,
  electricityTariffRate,
  inr,
  inr2,
  nextBillNumber,
  num,
  parkProfile,
} from "@/lib/sheets-schema";
import { downloadPowerBillPdf, powerBillPdfUrl } from "@/lib/pdf";
import { useSheetMutation } from "@/lib/use-app-data";

export const Route = createFileRoute("/_authenticated/billing")({
  head: () => ({
    meta: [
      { title: "Electricity billing engine | GBPIMS" },
      {
        name: "description",
        content:
          "Generate precise multi-meter electricity bills for Guwahati Biotech Park clients with energy, fixed charge, arrears and surcharge breakdown.",
      },
      { property: "og:title", content: "Electricity billing engine | GBPIMS" },
      {
        property: "og:description",
        content: "Multi-meter readings, automated charges and A4 PDF invoices.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: BillingPage,
});

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

type MeterDraft = { id: string; labName: string; meterNo: string };

function BillingPage() {
  const { wb, role, fallback } = useWorkbookState();
  const writable = canWrite(role);
  const clients = useMemo(() => (wb ? powerClients(wb) : []), [wb]);
  const stats = wb ? powerSummary(wb) : null;

  const saveClient = useSheetMutation(useServerFn(savePowerClientFn), "Billing client saved");
  const removeClient = useSheetMutation(useServerFn(deletePowerClientFn), "Client removed");
  const importClients = useSheetMutation(
    useServerFn(importTenantClientsFn),
    (out) =>
      out.created > 0
        ? `${out.created} billing client${out.created > 1 ? "s" : ""} created from tenants`
        : "Every active tenant already has a billing client",
  );
  const saveBill = useSheetMutation(
    useServerFn(savePowerBillFn),
    (out) => `Bill ${out.billId} generated · ${inr(out.total)}`,
  );
  const removeBill = useSheetMutation(useServerFn(deletePowerBillFn), "Electricity bill deleted");

  const [editing, setEditing] = useState<PowerClient | null>(null);
  const [form, setForm] = useState({
    client_name: "",
    address: "",
    connected_load_kw: "",
    whatsapp: "",
    fixed_ac_units: "",
    ac_fixed_charge: "",
    notes: "",
  });
  const [meters, setMeters] = useState<MeterDraft[]>([
    { id: "m1", labName: "Main meter", meterNo: "" },
  ]);
  const [search, setSearch] = useState("");

  // Billing engine state
  const [clientId, setClientId] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [preparedBy, setPreparedBy] = useState("");
  const [billSearch, setBillSearch] = useState("");
  const [showClientSetup, setShowClientSetup] = useState(false);
  const [editingBillId, setEditingBillId] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<DeleteTarget | null>(null);


  const [billDate, setBillDate] = useState(today());
  const [dueDate, setDueDate] = useState(plusDays(10));
  const [periodFrom, setPeriodFrom] = useState(plusDays(-31));
  const [periodTo, setPeriodTo] = useState(today());
  const [applyFixed, setApplyFixed] = useState(true);
  const [loadInput, setLoadInput] = useState("");
  const [applyDuty, setApplyDuty] = useState(true);
  const [includeAcCharge, setIncludeAcCharge] = useState(false);
  const [acChargeInput, setAcChargeInput] = useState("");
  const [applyArrears, setApplyArrears] = useState(true);
  const [arrearsInput, setArrearsInput] = useState("");
  const [surchargeMonths, setSurchargeMonths] = useState("1");
  const [present, setPresent] = useState<Record<string, string>>({});
  const [prevOverride, setPrevOverride] = useState<Record<string, string>>({});
  const [generatedBill, setGeneratedBill] = useState<PowerBill | null>(null);
  const [pdfPreview, setPdfPreview] = useState<{ title: string; subtitle: string } | null>(null);
  const [pdfBuilder, setPdfBuilder] = useState<(() => Promise<string>) | null>(null);
  const [pdfDownloader, setPdfDownloader] = useState<(() => void) | null>(null);

  const selected = clients.find((c) => c.clientId === clientId);
  const prevMap = wb && selected ? lastReadings(wb, selected.clientId) : {};
  const autoArrears = wb && selected ? outstandingArrears(wb, selected.clientId) : 0;
  const tariffRate = electricityTariffRate(wb?.settings);
  const fixedRate = electricityFixedChargeRate(wb?.settings);
  const surchargePct = Number(wb?.settings?.["late_surcharge_pct"] || 1.5) || 1.5;
  const dutySetting = electricityDutyPct(wb?.settings);
  const dutyPct = applyDuty ? dutySetting : 0;
  // Fixed charge = connected load (kW) x fixed rate. The load is editable per bill so a
  // client profile without a sanctioned load still bills correctly.
  const loadKwValue = loadInput.trim() !== "" ? num(loadInput) : (selected?.loadKw ?? 0);
  const acChargeValue = num(acChargeInput) || (selected?.acFixedCharge ?? 0);
  // Arrears are optional and fully editable: the auto figure only prefills the field.
  const arrearsValue = applyArrears
    ? arrearsInput.trim() !== ""
      ? num(arrearsInput)
      : autoArrears
    : 0;


  const meterReadings = (selected?.meters ?? []).map((m) => {
    const key = m.meterNo || m.labName;
    const prevRaw = prevOverride[key] ?? String(prevMap[key] ?? 0);
    return {
      labName: m.labName,
      meterNo: m.meterNo,
      prevReading: num(prevRaw),
      presReading: num(present[key] ?? ""),
      key,
      prevRaw,
    };
  });

  // Enabling AC fixed charge adds an extra reading row (AC meter) right under the meters;
  // its consumption feeds straight into the total units.
  const AC_KEY = "AC";
  const acRow = (() => {
    const prevRaw = prevOverride[AC_KEY] ?? "0";
    return {
      labName: "AC fixed unit",
      meterNo: AC_KEY,
      prevReading: num(prevRaw),
      presReading: num(present[AC_KEY] ?? ""),
      key: AC_KEY,
      prevRaw,
    };
  })();

  const readings = includeAcCharge ? [...meterReadings, acRow] : meterReadings;

  const preview =
    selected &&
    billPreview({
      client: selected,
      readings: readings.map(({ labName, meterNo, prevReading, presReading }) => ({
        labName,
        meterNo,
        prevReading,
        presReading,
      })),
      periodFrom,
      periodTo,
      includeAc: false,
      acUnits: 0,
      applyFixed,
      connectedLoadKw: loadKwValue,
      includeAcCharge,
      acCharge: acChargeValue,
      dutyPct,
      arrears: arrearsValue,
      surchargeMonths: num(surchargeMonths) || 0,
      tariffRate,
      fixedChargeRate: fixedRate,
      surchargePct,
    });

  const nextBill = wb
    ? nextBillNumber(
        wb.ledger.map((b) => b["bill_id"] ?? ""),
        new Date(billDate || Date.now()).getFullYear(),
      )
    : "GBP-0000";
  const billNo = editingBillId || invoiceNo.trim() || nextBill;
  const duplicateNo =
    invoiceNo.trim() !== "" &&
    (wb?.ledger ?? []).some((b) => (b["bill_id"] ?? "") === invoiceNo.trim());

  const profile = parkProfile(wb?.settings ?? {});

  function powerPdfOptions(bill: PowerBill) {
    const client = clients.find((c) => c.clientId === bill.clientId) ?? selected;
    return {
      ...profile,
      ...(preparedBy.trim() ? { preparedBy: preparedBy.trim() } : {}),
      clientAddress: client?.address ?? "",
      clientPhone: client?.whatsapp ?? "",
      terms: wb ? billTerms(wb.settings) : [],
    };
  }

  function previewGeneratedBill(bill: PowerBill) {
    const options = powerPdfOptions(bill);
    setPdfPreview({
      title: `Electricity bill ${bill.billId}`,
      subtitle: `${bill.clientName} · ${inr(bill.total)}`,
    });
    setPdfBuilder(() => () => powerBillPdfUrl(bill, options));
    setPdfDownloader(() => () => void downloadPowerBillPdf(bill, options));
  }

  function loadGeneratedBill(bill: PowerBill) {
    setEditingBillId(bill.billId);
    setClientId(bill.clientId);
    setInvoiceNo(bill.billId);
    setBillDate(bill.billDate || today());
    setDueDate(bill.dueDate || plusDays(10));
    setPeriodFrom(bill.periodFrom || plusDays(-31));
    setPeriodTo(bill.periodTo || today());
    setApplyFixed(bill.fixedCharge > 0 || bill.fixedChargeRate > 0);
    setLoadInput(bill.loadKw > 0 ? String(bill.loadKw) : "");
    setApplyDuty(bill.duty > 0 || bill.dutyPct > 0);
    setIncludeAcCharge(
      bill.acCharge > 0 || bill.readings.some((r) => (r.meterNo || r.labName) === "AC"),
    );
    setAcChargeInput(bill.acCharge > 0 ? String(bill.acCharge) : "");
    setApplyArrears(bill.arrears > 0);
    setArrearsInput(bill.arrears > 0 ? String(bill.arrears) : "");
    setSurchargeMonths(String(bill.surchargeMonths || 0));
    const nextPrev: Record<string, string> = {};
    const nextPresent: Record<string, string> = {};
    bill.readings.forEach((r) => {
      const key = r.meterNo || r.labName;
      nextPrev[key] = String(r.prevReading);
      nextPresent[key] = String(r.presReading);
    });
    setPrevOverride(nextPrev);
    setPresent(nextPresent);
    setGeneratedBill(null);
    window.requestAnimationFrame(() =>
      document.getElementById("electricity-engine")?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }

  function cancelBillEdit() {
    setEditingBillId("");
    setInvoiceNo("");
    setPresent({});
    setPrevOverride({});
    setGeneratedBill(null);
  }

  function runDeleteBill() {
    if (!confirmDelete) return;
    removeBill.mutate(
      { data: { bill_id: confirmDelete.code } },
      { onSuccess: () => setConfirmDelete(null) },
    );
  }



  function resetClientForm() {
    setEditing(null);
    setForm({
      client_name: "",
      address: "",
      connected_load_kw: "",
      whatsapp: "",
      fixed_ac_units: "",
      ac_fixed_charge: "",
      notes: "",
    });
    setMeters([{ id: "m1", labName: "Main meter", meterNo: "" }]);
  }

  function loadClient(c: PowerClient) {
    setEditing(c);
    setForm({
      client_name: c.name,
      address: c.address,
      connected_load_kw: String(c.loadKw || ""),
      whatsapp: c.whatsapp,
      fixed_ac_units: String(c.fixedAcUnits || ""),
      ac_fixed_charge: String(c.acFixedCharge || ""),
      notes: c.notes,
    });
    setMeters(
      c.meters.length > 0 ? c.meters : [{ id: "m1", labName: "Main meter", meterNo: "" }],
    );
  }

  const allBills = useMemo(() => (wb ? powerBills(wb) : []), [wb]);
  const visibleBills = useMemo(() => {
    const q = billSearch.trim().toLowerCase();
    return allBills
      .filter((b) => !b.manual)
      .filter((b) => !q || `${b.billId} ${b.clientName}`.toLowerCase().includes(q))
      .slice(0, 40);
  }, [allBills, billSearch]);

  const filtered = clients.filter((c) =>
    `${c.name} ${c.clientId} ${c.address}`.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <AppShell
      title="Electricity billing"
      subtitle={`₹${tariffRate}/unit · fixed ₹${fixedRate}/kW · next bill ${nextBill}`}
    >
      {fallback ?? (
        <div className="space-y-7">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Billing clients" value={String(stats?.clients ?? 0)} />
            <StatCard label="Units billed" value={String(stats?.units ?? 0)} />
            <StatCard label="Collected" value={inr(stats?.collected ?? 0)} tone="positive" />
            <StatCard
              label="Outstanding"
              value={inr(stats?.outstanding ?? 0)}
              tone="warning"
              hint={`${stats?.unpaidCount ?? 0} unpaid bills`}
            />
          </div>

          {/* Billing engine */}
          <section id="electricity-engine" className="surface-card scroll-mt-24 p-4 lg:p-6">
            <div className="flex items-center gap-2">
              <Zap className="size-4 text-primary" />
              <h2 className="font-display text-base font-semibold">Generate a bill</h2>
            </div>
            {editingBillId && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/35 bg-amber-500/10 p-3 text-sm">
                <span className="font-medium">Editing generated bill {editingBillId}</span>
                <Button size="sm" variant="outline" onClick={cancelBillEdit}>
                  Cancel edit
                </Button>
              </div>
            )}

            {clients.length === 0 && (
              <div className="mt-3 rounded-lg border border-primary/25 bg-primary/5 p-3 text-sm">
                <p className="font-medium">No tenants pulled in yet</p>
                <p className="mt-0.5 text-muted-foreground">
                  Your tenants are the clients you bill. Tap below to pull every active tenant in —
                  each gets a meter row you can set up.
                </p>
                {writable && (
                  <Button
                    size="sm"
                    className="mt-3"
                    disabled={importClients.isPending}
                    onClick={() => importClients.mutate({ data: undefined })}
                  >
                    <Users className="mr-1 size-4" />
                    {importClients.isPending ? "Syncing…" : "Sync tenants"}
                  </Button>
                )}
              </div>
            )}

            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <div className="sm:col-span-2">
                <Label className="text-xs">Client</Label>
                <Select
                  value={clientId}
                  onValueChange={(v) => {
                    setClientId(v);
                    setPresent({});
                    setPrevOverride({});
                    const c = clients.find((x) => x.clientId === v);
                    setIncludeAcCharge((c?.acFixedCharge ?? 0) > 0);
                    setAcChargeInput(c?.acFixedCharge ? String(c.acFixedCharge) : "");
                    setArrearsInput("");
                    setLoadInput(c?.loadKw ? String(c.loadKw) : "");

                  }}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select a client" />
                  </SelectTrigger>
                  <SelectContent>
                    {clients.length === 0 && (
                      <div className="px-3 py-2 text-sm text-muted-foreground">
                        Sync your tenants first
                      </div>
                    )}
                    {clients.map((c) => (
                      <SelectItem key={c.clientId} value={c.clientId}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Period from</Label>
                <Input
                  type="date"
                  className="mt-1"
                  value={periodFrom}
                  onChange={(e) => setPeriodFrom(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">Period to</Label>
                <Input
                  type="date"
                  className="mt-1"
                  value={periodTo}
                  onChange={(e) => setPeriodTo(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Bill date</Label>
                  <Input
                    type="date"
                    className="mt-1"
                    value={billDate}
                    onChange={(e) => setBillDate(e.target.value)}
                  />
                </div>
                <div>
                  <Label className="text-xs">Due date</Label>
                  <Input
                    type="date"
                    className="mt-1"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <Label className="text-xs">Invoice no.</Label>
                <Input
                  className="mt-1"
                  placeholder={nextBill}
                  value={invoiceNo}
                  disabled={Boolean(editingBillId)}
                  onChange={(e) => setInvoiceNo(e.target.value)}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {editingBillId
                    ? "Invoice number is locked while editing an existing bill."
                    : duplicateNo
                    ? "This invoice number already exists — it will update that bill."
                    : `Leave blank to use the next number in series (${nextBill}).`}
                </p>
              </div>
              <div>
                <Label className="text-xs">Prepared by (printed on the PDF)</Label>
                <Input
                  className="mt-1"
                  placeholder={profile.preparedBy || "Junior Engineer, GBP"}
                  value={preparedBy}
                  onChange={(e) => setPreparedBy(e.target.value)}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Leave blank to use the default ({profile.preparedBy || "Junior Engineer, GBP"}).
                </p>
              </div>

            </div>


            {selected ? (
              <div className="mt-5 space-y-4">
                <div className="overflow-x-auto rounded-xl border border-border bg-card">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/60 text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Lab / meter</th>
                        <th className="px-3 py-2 text-left font-medium">Previous</th>
                        <th className="px-3 py-2 text-left font-medium">Present</th>
                        <th className="px-3 py-2 text-right font-medium">Units</th>
                      </tr>
                    </thead>
                    <tbody>
                      {readings.map((r) => (
                        <tr key={r.key} className="border-t border-border">
                          <td className="px-3 py-2">
                            <span className="font-semibold">{r.labName}</span>
                            <span className="block text-xs text-muted-foreground">
                              {r.meterNo || "—"}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              className="h-9 w-28"
                              inputMode="decimal"
                              disabled={!writable}
                              value={r.prevRaw}
                              onChange={(e) =>
                                setPrevOverride((p) => ({ ...p, [r.key]: e.target.value }))
                              }
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              className="h-9 w-28"
                              inputMode="decimal"
                              disabled={!writable}
                              value={present[r.key] ?? ""}
                              onChange={(e) =>
                                setPresent((p) => ({ ...p, [r.key]: e.target.value }))
                              }
                            />
                          </td>
                          <td className="px-3 py-2 text-right font-semibold">
                            {Math.round(Math.max(0, r.presReading - r.prevReading) * 100) / 100 ||
                              "—"}
                          </td>

                        </tr>
                      ))}
                      {readings.length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                            This client has no meters yet — add one below.
                          </td>
                        </tr>
                      )}
                    </tbody>
                    {readings.length > 0 && (
                      <tfoot>
                        <tr className="border-t border-border bg-muted/40">
                          <td className="px-3 py-2 text-xs font-semibold tracking-wide uppercase" colSpan={3}>
                            Total units consumed
                          </td>
                          <td className="px-3 py-2 text-right font-bold text-primary">
                            {preview?.totalUnits ?? 0}
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>

                <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-6">
                      <label className="flex items-center gap-2 text-sm">
                        <Switch checked={applyFixed} onCheckedChange={setApplyFixed} />
                        Apply fixed charge (₹{fixedRate}/kW)
                      </label>
                      {applyFixed && (
                        <label className="flex items-center gap-2 text-sm">
                          Connected load
                          <Input
                            className="h-9 w-24"
                            inputMode="decimal"
                            value={loadInput}
                            placeholder={String(selected.loadKw || 0)}
                            onChange={(e) => setLoadInput(e.target.value)}
                          />
                          kW = {inr(preview ? preview.fixedCharge : 0)}
                        </label>
                      )}
                      <label className="flex items-center gap-2 text-sm">
                        <Switch checked={includeAcCharge} onCheckedChange={setIncludeAcCharge} />
                        Add AC fixed charge (adds an AC row above)
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <Switch checked={applyDuty} onCheckedChange={setApplyDuty} />
                        Apply electricity duty ({dutySetting}%)
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <Switch checked={applyArrears} onCheckedChange={setApplyArrears} />
                        Add arrears
                      </label>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">

                      <div>
                        <Label className="text-xs">AC fixed charge (₹)</Label>
                        <Input
                          className="mt-1"
                          inputMode="decimal"
                          placeholder="0"
                          disabled={!includeAcCharge}
                          value={acChargeInput}
                          onChange={(e) => setAcChargeInput(e.target.value)}
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Electricity duty</Label>
                        <Input
                          className="mt-1"
                          value={
                            applyDuty ? `${dutySetting}% of energy + fixed` : "Disabled for this bill"
                          }
                          readOnly
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Arrears (₹)</Label>
                        <Input
                          className="mt-1"
                          inputMode="decimal"
                          placeholder={inr2(autoArrears)}
                          disabled={!applyArrears}
                          value={arrearsInput}
                          onChange={(e) => setArrearsInput(e.target.value)}
                        />
                        <p className="mt-1 text-xs text-muted-foreground">
                          {applyArrears
                            ? `Auto figure from unpaid bills: ${inr2(autoArrears)} — edit or clear as needed.`
                            : "No arrears will be added to this bill."}
                        </p>
                      </div>

                      <div>
                        <Label className="text-xs">Months delayed (surcharge)</Label>
                        <Input
                          className="mt-1"
                          inputMode="numeric"
                          value={surchargeMonths}
                          onChange={(e) => setSurchargeMonths(e.target.value)}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-border bg-muted/40 p-4">
                    <ul className="space-y-1.5 text-sm">
                      <Line
                        label={`Units (${preview?.totalUnits ?? 0} × ₹${tariffRate}/unit)`}
                        value={inr2(preview?.energyCharge ?? 0)}
                      />
                      <Line label="Fixed charge" value={inr2(preview?.fixedCharge ?? 0)} />
                      <Line label="AC fixed charge" value={inr2(preview?.acCharge ?? 0)} />
                      <Line
                        label={`Electricity duty (${dutyPct}%)`}
                        value={inr2(preview?.duty ?? 0)}
                      />
                      <Line label="Arrears" value={inr2(preview?.arrears ?? 0)} />
                      <Line
                        label={`Delayed surcharge (${surchargePct}% per month)`}
                        value={inr2(preview?.surcharge ?? 0)}
                      />
                    </ul>
                    <div className="mt-3 flex items-baseline justify-between border-t border-border pt-3">
                      <span className="text-xs tracking-wide text-muted-foreground uppercase">
                        Total payable
                      </span>
                      <span className="font-display text-2xl font-bold text-primary">
                        {inr(preview?.total ?? 0)}
                      </span>
                    </div>
                    {writable && (
                      <Button
                        className="mt-3 w-full"
                        disabled={saveBill.isPending || readings.length === 0}
                        onClick={() => {
                          if (!preview) return;
                          const billSnapshot: PowerBill = {
                            billId: billNo,
                            clientId: selected.clientId,
                            clientName: selected.name,
                            billDate,
                            dueDate,
                            periodFrom,
                            periodTo,
                            days: preview.days,
                            meterUnits: preview.meterUnits,
                            acUnits: preview.acUnits,
                            totalUnits: preview.totalUnits,
                            tariffRate,
                            energyCharge: preview.energyCharge,
                            loadKw: loadKwValue,
                            fixedChargeRate: applyFixed ? fixedRate : 0,
                            fixedCharge: preview.fixedCharge,
                            acCharge: preview.acCharge,
                            dutyPct,
                            duty: preview.duty,
                            arrears: preview.arrears,
                            surcharge: preview.surcharge,
                            surchargeMonths: num(surchargeMonths) || 0,
                            total: preview.total,
                            amountPaid: 0,
                            balance: preview.total,
                            partial: false,
                            paid: false,
                            paymentDate: "",
                            paymentMode: "",
                            txnRef: "",
                            readings: preview.readings,
                            generatedBy: "",
                            monthKey: billDate.slice(0, 7),
                            remarks: "",
                            manual: false,
                          };
                          saveBill.mutate(
                            {
                               data: {
                                 ...(editingBillId || invoiceNo.trim()
                                   ? { bill_id: editingBillId || invoiceNo.trim() }
                                   : {}),
                                client_id: selected.clientId,
                                bill_date: billDate,
                                due_date: dueDate,
                                period_from: periodFrom,
                                period_to: periodTo,
                                readings: readings.map((r) => ({
                                  labName: r.labName,
                                  meterNo: r.meterNo,
                                  prevReading: r.prevReading,
                                  presReading: r.presReading,
                                })),
                                include_ac_units: false,
                                ac_units: 0,
                                apply_fixed_charge: applyFixed,
                                connected_load_kw: loadKwValue,
                                include_ac_charge: includeAcCharge,
                                ac_charge: acChargeValue,
                                arrears: arrearsValue,
                                surcharge_months: num(surchargeMonths) || 0,
                                duty_pct: dutyPct,
                              },
                            },
                            {
                              onSuccess: (out) => {
                                setGeneratedBill({
                                  ...billSnapshot,
                                  billId: out.billId,
                                  total: out.total,
                                  balance: out.total,
                                });
                                setPresent({});
                                setPrevOverride({});
                                setArrearsInput("");
                                  setEditingBillId("");
                                  setInvoiceNo("");
                              },
                            },
                          )
                        }}
                      >
                        {saveBill.isPending
                          ? editingBillId
                            ? "Updating…"
                            : "Generating…"
                          : editingBillId
                            ? `Update ${editingBillId}`
                            : `Generate ${billNo}`}

                      </Button>
                    )}
                    {generatedBill && (
                      <div className="mt-3 rounded-lg border border-primary/25 bg-primary/5 p-3">
                        <p className="text-sm font-semibold text-foreground">
                          {generatedBill.billId} saved in the electricity ledger
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Download it now or access it any time from Ledger → Electricity.
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" onClick={() => previewGeneratedBill(generatedBill)}>
                            <Eye className="size-3.5" /> Preview
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => void downloadPowerBillPdf(generatedBill, powerPdfOptions(generatedBill))}
                          >
                            <Download className="size-3.5" /> Download PDF
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">
                Select a client to fetch previous readings and compute the bill.
              </p>
            )}
          </section>

          {/* Generated electricity bills */}
          <section className="surface-card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div>
                <h2 className="font-display text-base font-semibold">Electricity bills</h2>
                <p className="text-xs text-muted-foreground">
                  Billing-engine bills only — manual ledger records stay in Ledger.
                </p>
              </div>
              <Input
                className="h-9 w-full sm:w-56"
                placeholder="Search bill no. or client"
                value={billSearch}
                onChange={(e) => setBillSearch(e.target.value)}
              />
            </div>
            <div className="divide-y divide-border">
              {visibleBills.map((b) => (
                <div key={b.billId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">
                      {b.billId} · {b.clientName || "—"}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {b.billDate || "—"} · {b.totalUnits} units · {inr(b.total)} ·{" "}
                      {b.paid ? "Paid" : b.partial ? `Partial · ${inr(b.balance)} due` : "Unpaid"}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button size="sm" variant="outline" onClick={() => previewGeneratedBill(b)}>
                      <Eye className="size-3.5" /> Preview
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void downloadPowerBillPdf(b, powerPdfOptions(b))}
                    >
                      <Download className="size-3.5" /> PDF
                    </Button>
                    {role === "admin" && (
                      <Button size="sm" variant="outline" onClick={() => loadGeneratedBill(b)}>
                        <Pencil className="size-3.5" /> Edit
                      </Button>
                    )}
                    {role === "admin" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Delete ${b.billId}`}
                        onClick={() =>
                          setConfirmDelete({
                            title: `electricity bill ${b.billId}`,
                            code: b.billId,
                            impact: [
                              `${b.clientName || "Client"} · ${b.billDate || "undated"}`,
                              `${inr(b.total)} will be removed from the electricity ledger and reports.`,
                            ],
                          })
                        }
                      >
                        <Trash2 className="size-3.5 text-destructive" /> Delete
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              {visibleBills.length === 0 && (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                  No electricity bills yet — generate one above.
                </p>
              )}
            </div>
          </section>



          {/* Month-wise PDF archive */}
          <PdfArchiveSection />

          {/* Clients */}
          <section className="surface-card overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
                <div>
                  <h2 className="font-display text-base font-semibold">Tenant billing setup</h2>
                  <p className="text-xs text-muted-foreground">
                    Open only when meters, connected load or tenant sync need setup.
                  </p>
                </div>
                <div className="flex w-full items-center gap-2 sm:w-auto">
                  {writable && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={importClients.isPending}
                      onClick={() => importClients.mutate({ data: undefined })}
                    >
                      <Users className="size-3.5" />
                      {importClients.isPending ? "Syncing…" : "Sync tenants"}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant={showClientSetup ? "secondary" : "default"}
                    onClick={() => setShowClientSetup((v) => !v)}
                  >
                    {showClientSetup ? "Hide setup" : "Open setup"}
                  </Button>
                </div>
              </div>
              {showClientSetup && (
                <div>
                  <div className="border-b border-border px-4 py-3">
                    <Input
                      className="h-9 w-full sm:w-72"
                      placeholder="Search name, ID or address"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  <div className="divide-y divide-border">
                    {filtered.map((c) => (
                      <div key={c.clientId} className="flex items-start justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <p className="truncate font-semibold">{c.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {c.clientId} · {c.loadKw} kW · {c.meters.length} meter
                            {c.meters.length === 1 ? "" : "s"}
                            {c.fixedAcUnits > 0 ? ` · AC ${c.fixedAcUnits} units` : ""}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">{c.address}</p>
                        </div>
                        {writable && (
                          <div className="flex shrink-0 gap-1">
                            <Button size="sm" variant="outline" onClick={() => loadClient(c)}>
                              Meters &amp; load
                            </Button>
                            {role === "admin" && (
                              <Button
                                size="icon"
                                variant="ghost"
                                aria-label={`Delete ${c.name}`}
                                onClick={() => {
                                  if (confirm(`Delete ${c.name} and all its bills?`)) {
                                    removeClient.mutate({ data: { client_id: c.clientId } });
                                  }
                                }}
                              >
                                <Trash2 className="size-4 text-destructive" />
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                    {filtered.length === 0 && (
                      <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                        No tenants yet — add tenants in the Tenants tab, then tap “Sync tenants”.
                      </p>
                    )}
                  </div>
                </div>
              )}
          </section>

          <Dialog open={editing !== null} onOpenChange={(open) => !open && resetClientForm()}>
            <DialogContent className="max-h-[85dvh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Billing setup · {editing?.name}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <Field label="Billing address">
                  <Input
                    value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Connected load (kW)">
                    <Input
                      inputMode="decimal"
                      value={form.connected_load_kw}
                      onChange={(e) => setForm({ ...form, connected_load_kw: e.target.value })}
                    />
                  </Field>
                  <Field label="Fixed AC units">
                    <Input
                      inputMode="decimal"
                      value={form.fixed_ac_units}
                      onChange={(e) => setForm({ ...form, fixed_ac_units: e.target.value })}
                    />
                  </Field>
                </div>
                <Field label="AC fixed charge (₹ per month)">
                  <Input
                    inputMode="decimal"
                    value={form.ac_fixed_charge}
                    onChange={(e) => setForm({ ...form, ac_fixed_charge: e.target.value })}
                  />
                </Field>
                <Field label="WhatsApp number">
                  <Input
                    value={form.whatsapp}
                    placeholder="+9198xxxxxxxx"
                    onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
                  />
                </Field>

                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Labs / meters</p>
                  {meters.map((m, i) => (
                    <div key={m.id} className="flex gap-2">
                      <Input
                        className="h-9"
                        placeholder="Lab name"
                        value={m.labName}
                        onChange={(e) =>
                          setMeters(
                            meters.map((x, j) => (i === j ? { ...x, labName: e.target.value } : x)),
                          )
                        }
                      />
                      <Input
                        className="h-9"
                        placeholder="Meter no"
                        value={m.meterNo}
                        onChange={(e) =>
                          setMeters(
                            meters.map((x, j) => (i === j ? { ...x, meterNo: e.target.value } : x)),
                          )
                        }
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Remove meter"
                        onClick={() => setMeters(meters.filter((_, j) => j !== i))}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setMeters([
                        ...meters,
                        { id: `m${meters.length + 1}-${Date.now()}`, labName: "", meterNo: "" },
                      ])
                    }
                  >
                    <Plus className="size-3.5" /> Add meter
                  </Button>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={resetClientForm}>
                  Cancel
                </Button>
                <Button
                  disabled={saveClient.isPending || editing === null}
                  onClick={() =>
                    editing &&
                    saveClient.mutate(
                      {
                        data: {
                          client_id: editing.clientId,
                          ...form,
                          client_name: editing.name,
                          incubatee_id: editing.incubateeId,
                          meters: meters.filter((m) => m.labName.trim() !== ""),
                        },
                      },
                      { onSuccess: resetClientForm },
                    )
                  }
                >
                  {saveClient.isPending ? "Saving…" : "Save setup"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <PdfPreviewDialog
            open={pdfPreview !== null}
            title={pdfPreview?.title ?? ""}
            subtitle={pdfPreview?.subtitle}
            build={pdfBuilder}
            onDownload={pdfDownloader ?? undefined}
            onClose={() => {
              setPdfPreview(null);
              setPdfBuilder(null);
              setPdfDownloader(null);
            }}
          />
          <ConfirmDeleteDialog
            target={confirmDelete}
            pending={removeBill.isPending}
            onConfirm={runDeleteBill}
            onClose={() => setConfirmDelete(null)}
          />
        </div>
      )}
    </AppShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </li>
  );
}
