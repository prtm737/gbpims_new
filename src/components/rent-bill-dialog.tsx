import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { saveRentInvoiceFn } from "@/lib/gbp.functions";
import { archiveMonth, archivePdfQuiet } from "@/lib/pdf-archive-client";
import { rentInvoicePdfBase64 } from "@/lib/pdf-rent";
import type { RentDraftFields } from "@/lib/rent-invoices";
import {
  computeRentBill,
  DEFAULT_SETTINGS,
  formatAmount,
  grossRent,
  gstEnabled,
  inr,
  num,
  spaceIds,
  totalArea,
  type Workbook,
} from "@/lib/sheets-schema";
import { useSheetMutation } from "@/lib/use-app-data";

export type RentDraft = Partial<RentDraftFields> & { month: string };

export function RentBillDialog({
  wb,
  draft,
  onClose,
}: {
  wb: Workbook;
  draft: RentDraft | null;
  onClose: () => void;
}) {
  const save = useSheetMutation(useServerFn(saveRentInvoiceFn), "Rent bill saved");
  const setting = (k: string) => wb.settings[k] || DEFAULT_SETTINGS[k] || "";

  const tenants = useMemo(
    () => wb.incubatees.filter((i) => (i["status"] ?? "active") !== "exited"),
    [wb.incubatees],
  );

  const [incubateeId, setIncubateeId] = useState("");
  const [month, setMonth] = useState(draft?.month ?? "");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [gross, setGross] = useState("");
  const [discountPct, setDiscountPct] = useState("");
  const [discountAmount, setDiscountAmount] = useState("");
  const [maintenancePct, setMaintenancePct] = useState("");
  const [maintenanceAmount, setMaintenanceAmount] = useState("");
  const [gst, setGst] = useState(true);
  const [cgstPct, setCgstPct] = useState("");
  const [sgstPct, setSgstPct] = useState("");
  const [gstin, setGstin] = useState("");
  const [remarks, setRemarks] = useState("");

  // Reset the form each time a draft is opened.
  useEffect(() => {
    if (!draft) return;
    setIncubateeId(draft.incubatee_id ?? "");
    setMonth(draft.month);
    setInvoiceDate(draft.invoice_date ?? "");
    setDueDate(draft.due_date ?? "");
    setGross(draft.gross_amount ?? "");
    setDiscountPct(draft.discount_pct ?? "");
    setDiscountAmount(draft.discount_amount ?? "");
    setMaintenancePct(draft.maintenance_pct ?? setting("maintenance_pct"));
    setMaintenanceAmount(draft.maintenance_amount ?? "");
    setGst(draft.gst_applicable ?? gstEnabled(wb.settings));
    setCgstPct(setting("cgst_pct"));
    setSgstPct(setting("sgst_pct"));
    setGstin(draft.party_gstin ?? "");
    setRemarks(draft.remarks ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const tenant = tenants.find((t) => t["incubatee_id"] === incubateeId);
  const tenantSpaces = spaceIds(tenant?.["lab_id"]);
  const billedArea = totalArea(wb.labs, tenant?.["lab_id"]);
  const autoGross = grossRent(
    billedArea,
    wb.settings,
    num(tenant?.["monthly_rent"]) ||
      tenantSpaces.reduce(
        (sum, id) => sum + num(wb.labs.find((l) => l["lab_id"] === id)?.["monthly_rent"]),
        0,
      ),
  );
  const effectiveGross = num(gross) > 0 ? num(gross) : autoGross;

  const preview = computeRentBill({
    gross: effectiveGross,
    discountPct: discountPct || tenant?.["discount_pct"],
    discountAmount: discountAmount || tenant?.["discount_amount"],
    maintenancePct: maintenancePct,
    maintenanceAmount: maintenanceAmount,
    maintenanceRatePerSqft: setting("maintenance_rate_per_sqft"),
    areaSqft: billedArea,
    gstApplicable: gst,
    cgstPct: num(cgstPct),
    sgstPct: num(sgstPct),
  });

  // Auto-fill the tenant's GSTIN when one is on record.
  useEffect(() => {
    if (tenant?.["gstin"] && !gstin) setGstin(tenant["gstin"]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incubateeId]);

  return (
    <Dialog open={draft !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[88dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{draft?.invoice_id ? "Revise rent bill" : "Generate rent bill"}</DialogTitle>
        </DialogHeader>

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!incubateeId) return;
            save.mutate(
              {
                data: {
                  ...(draft?.invoice_id ? { invoice_id: draft.invoice_id } : {}),
                  incubatee_id: incubateeId,
                  month,
                  invoice_date: invoiceDate,
                  due_date: dueDate,
                  gross_amount: effectiveGross,
                  discount_pct: discountPct,
                  discount_amount: discountAmount,
                  maintenance_pct: maintenancePct,
                  maintenance_amount: maintenanceAmount,
                  gst_applicable: gst,
                  cgst_pct: num(cgstPct),
                  sgst_pct: num(sgstPct),
                  party_gstin: gstin,
                  remarks: remarks,
                },
              },
              { onSuccess: (out) => {
                  onClose();
                  // Store the invoice PDF in the month-wise archive the moment
                  // the bill is generated.
                  void (async () => {
                    try {
                      const archiveKey = archiveMonth(month);
                      if (!archiveKey || !tenant) return;
                      const invoice = computeRentBill({
                        gross: effectiveGross,
                        discountPct: discountPct || tenant["discount_pct"],
                        discountAmount: discountAmount || tenant["discount_amount"],
                        maintenancePct,
                        maintenanceAmount,
                        maintenanceRatePerSqft: setting("maintenance_rate_per_sqft"),
                        areaSqft: billedArea,
                        gstApplicable: gst,
                        cgstPct: num(cgstPct),
                        sgstPct: num(sgstPct),
                      });
                      const pdf_base64 = await rentInvoicePdfBase64({
                        invoiceNo: out.invoiceNo,
                        invoiceDate: invoiceDate || `${archiveKey}-28`,
                        month: archiveKey,
                        parkName: setting("park_name"),
                        unitName: setting("park_unit_name"),
                        parkAddressLines: setting("park_address")
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                        parkGstin: setting("park_gstin"),
                        stateName: setting("state_name"),
                        stateCode: setting("state_code"),
                        panNo: setting("pan_no"),
                        vatTin: setting("vat_tin"),
                        party: tenant["company_name"] ?? "",
                        partyAddressLines: (tenant["address"] ?? "")
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                        partyGstin: gstin,
                        labId: tenant["lab_id"] ?? "",
                        dueDate,
                        rentAmount: invoice.rent,
                        maintenanceAmount: invoice.maintenance,
                        hsnRent: setting("hsn_rent"),
                        hsnMaintenance: setting("hsn_maintenance"),
                        cgstPct: num(cgstPct),
                        sgstPct: num(sgstPct),
                        cgst: invoice.cgst,
                        sgst: invoice.sgst,
                        roundOff: invoice.roundOff,
                        total: invoice.total,
                        paid: 0,
                        remarks: remarks,
                        status: "pending",
                      });
                      await archivePdfQuiet({
                        kind: "rent",
                        month: archiveKey,
                        ref_id: out.invoiceNo || out.invoiceId,
                        label: tenant["company_name"] ?? "",
                        pdf_base64,
                      });
                    } catch {
                      /* the invoice itself is already saved */
                    }
                  })();
                } },
            );
          }}
        >
          <div className="space-y-1.5">
            <Label>Incubatee</Label>
            <Select
              value={incubateeId}
              onValueChange={setIncubateeId}
              disabled={Boolean(draft?.invoice_id)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select incubatee" />
              </SelectTrigger>
              <SelectContent>
                {tenants.map((t) => (
                  <SelectItem key={t["incubatee_id"]} value={t["incubatee_id"] ?? ""}>
                    {t["company_name"]}
                    {t["lab_id"] ? ` · ${t["lab_id"]}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="bill-month">Billing month</Label>
              <Input
                id="bill-month"
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bill-date">Invoice date</Label>
              <Input
                id="bill-date"
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bill-due">Due date</Label>
              <Input
                id="bill-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bill-gross">Rent (gross ₹)</Label>
              <Input
                id="bill-gross"
                inputMode="decimal"
                value={gross}
                onChange={(e) => setGross(e.target.value)}
                onBlur={(e) => setGross(formatAmount(e.target.value))}
                placeholder={autoGross ? String(autoGross) : "auto from area"}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bill-dpct">Discount %</Label>
              <Input
                id="bill-dpct"
                inputMode="decimal"
                value={discountPct}
                onChange={(e) => setDiscountPct(e.target.value)}
                placeholder={tenant?.["discount_pct"] || "0"}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bill-damt">Flat discount ₹</Label>
              <Input
                id="bill-damt"
                inputMode="decimal"
                value={discountAmount}
                onChange={(e) => setDiscountAmount(e.target.value)}
                onBlur={(e) => setDiscountAmount(formatAmount(e.target.value))}
                placeholder={tenant?.["discount_amount"] || "0"}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bill-mpct">Maintenance %</Label>
              <Input
                id="bill-mpct"
                inputMode="decimal"
                value={maintenancePct}
                onChange={(e) => setMaintenancePct(e.target.value)}
                placeholder="10"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bill-mamt">Maintenance ₹ (override)</Label>
              <Input
                id="bill-mamt"
                inputMode="decimal"
                value={maintenanceAmount}
                onChange={(e) => setMaintenanceAmount(e.target.value)}
                onBlur={(e) => setMaintenanceAmount(formatAmount(e.target.value))}
                placeholder="auto"
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">Apply GST</p>
              <p className="text-xs text-muted-foreground">CGST + SGST on rent & maintenance</p>
            </div>
            <Switch checked={gst} onCheckedChange={setGst} aria-label="Apply GST" />
          </div>

          {gst && (
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="bill-cgst">CGST %</Label>
                <Input
                  id="bill-cgst"
                  inputMode="decimal"
                  value={cgstPct}
                  onChange={(e) => setCgstPct(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bill-sgst">SGST %</Label>
                <Input
                  id="bill-sgst"
                  inputMode="decimal"
                  value={sgstPct}
                  onChange={(e) => setSgstPct(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bill-gstin">Party GSTIN</Label>
                <Input
                  id="bill-gstin"
                  maxLength={30}
                  value={gstin}
                  onChange={(e) => setGstin(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="bill-remarks">Remarks</Label>
            <Input
              id="bill-remarks"
              maxLength={300}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder={`Bill for the month of ${month}`}
            />
          </div>

          <div className="space-y-1 rounded-lg border border-border bg-muted/40 p-3 text-xs">
            <Line label="Rent" value={inr(preview.rent)} />
            {preview.discount > 0 && (
              <Line label="Discount applied" value={`− ${inr(preview.discount)}`} />
            )}
            {preview.maintenance > 0 && (
              <Line label="Maintenance charges" value={inr(preview.maintenance)} />
            )}
            <Line label="Taxable value" value={inr(preview.taxable)} />
            {gst && (
              <>
                <Line label={`CGST ${num(cgstPct)}%`} value={inr(preview.cgst)} />
                <Line label={`SGST ${num(sgstPct)}%`} value={inr(preview.sgst)} />
              </>
            )}
            <div className="mt-1 flex justify-between border-t border-border pt-2 text-sm font-bold">
              <span>Total payable</span>
              <span>{inr(preview.total)}</span>
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={save.isPending || !incubateeId}>
              {save.isPending ? "Saving…" : "Save bill"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-muted-foreground">
      <span>{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}
