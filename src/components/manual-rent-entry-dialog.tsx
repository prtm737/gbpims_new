import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Textarea } from "@/components/ui/textarea";
import { saveManualRentEntryFn } from "@/lib/gbp.functions";
import { currentMonth, formatAmount, inr, type Workbook } from "@/lib/sheets-schema";
import { useSheetMutation } from "@/lib/use-app-data";

/** Feed a rent bill that was raised manually outside the app into the rent ledger. */
export function ManualRentEntryDialog({
  open,
  month,
  wb,
  edit,
  onClose,
}: {
  open: boolean;
  month: string;
  wb: Workbook | null;
  edit?: {
    invoiceId: string;
    invoiceNo: string;
    incubateeId: string;
    month: string;
    invoiceDate: string;
    dueDate: string;
    rent: number;
    maintenance: number;
    gstApplicable: boolean;
    remarks: string;
  } | null;
  onClose: () => void;
}) {
  const save = useSheetMutation(useServerFn(saveManualRentEntryFn), "Rent entry saved to the sheet");
  const [tenant, setTenant] = useState("");
  const [form, setForm] = useState({
    month: month || currentMonth(),
    invoiceNo: "",
    invoiceDate: new Date().toISOString().slice(0, 10),
    dueDate: "",
    rent: "",
    maintenance: "",
    gst: false,
    remarks: "",
  });

  useEffect(() => {
    if (!open) return;
    setTenant(edit?.incubateeId ?? "");
    setForm({
      month: edit?.month || month || currentMonth(),
      invoiceNo: edit?.invoiceNo ?? "",
      invoiceDate: edit?.invoiceDate || new Date().toISOString().slice(0, 10),
      dueDate: edit?.dueDate ?? "",
      rent: edit ? String(edit.rent || "") : "",
      maintenance: edit ? String(edit.maintenance || "") : "",
      gst: edit?.gstApplicable ?? false,
      remarks: edit?.remarks ?? "",
    });
  }, [open, month, edit]);

  const tenants = (wb?.incubatees ?? []).filter((i) => (i["incubatee_id"] ?? "").trim() !== "");
  const rent = Number(form.rent) || 0;
  const maintenance = Number(form.maintenance) || 0;
  const taxable = rent + maintenance;
  const gstAmount = form.gst ? Math.round(taxable * 0.18 * 100) / 100 : 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{edit ? `Edit ${edit.invoiceNo || edit.invoiceId}` : "Manual rent entry"}</DialogTitle>
          <DialogDescription>
            Record a rent bill you raised outside the app. Amounts are stored exactly as typed.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!tenant) return;
            save.mutate(
              {
                data: {
                  ...(edit ? { invoice_id: edit.invoiceId } : {}),
                  incubatee_id: tenant,
                  month: form.month,
                  invoice_no: form.invoiceNo,
                  invoice_date: form.invoiceDate,
                  due_date: form.dueDate,
                  rent_amount: rent,
                  maintenance_amount: maintenance,
                  gst_applicable: form.gst,
                  remarks: form.remarks,
                },
              },
              { onSuccess: onClose },
            );
          }}
        >
          <div className="space-y-1.5">
            <Label>Tenant</Label>
            <Select value={tenant} onValueChange={setTenant}>
              <SelectTrigger>
                <SelectValue placeholder="Select tenant" />
              </SelectTrigger>
              <SelectContent>
                {tenants.map((t) => (
                  <SelectItem key={t["incubatee_id"]} value={t["incubatee_id"] ?? ""}>
                    {t["company_name"]} {t["lab_id"] ? `· ${t["lab_id"]}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Month</Label>
              <Input
                type="month"
                value={form.month}
                onChange={(e) => setForm({ ...form, month: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>Bill no. (optional)</Label>
              <Input
                value={form.invoiceNo}
                placeholder="GBP/IN/25-26/001"
                onChange={(e) => setForm({ ...form, invoiceNo: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Bill date</Label>
              <Input
                type="date"
                value={form.invoiceDate}
                onChange={(e) => setForm({ ...form, invoiceDate: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Due date</Label>
              <Input
                type="date"
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Rent amount</Label>
              <Input
                inputMode="decimal"
                min="0"
                value={form.rent}
                onChange={(e) => setForm({ ...form, rent: e.target.value })}
                onBlur={(e) => setForm((f) => ({ ...f, rent: formatAmount(e.target.value) }))}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>Electricity charges</Label>
              <Input
                inputMode="decimal"
                min="0"
                value={form.maintenance}
                onChange={(e) => setForm({ ...form, maintenance: e.target.value })}
                onBlur={(e) =>
                  setForm((f) => ({ ...f, maintenance: formatAmount(e.target.value) }))
                }
              />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
            <div>
              <p className="text-sm font-medium">Add GST (9% + 9%)</p>
              <p className="text-xs text-muted-foreground">
                Leave off if your manual bill amount already includes tax.
              </p>
            </div>
            <Switch
              checked={form.gst}
              onCheckedChange={(v) => setForm({ ...form, gst: v })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Remarks</Label>
            <Textarea
              rows={2}
              placeholder="e.g. billed manually, cheque expected"
              value={form.remarks}
              onChange={(e) => setForm({ ...form, remarks: e.target.value })}
            />
          </div>
          <p className="rounded-lg bg-muted px-3 py-2 text-sm">
            Payable: <span className="font-semibold">{inr(Math.round(taxable + gstAmount))}</span>
          </p>
          <DialogFooter>
            <Button type="submit" disabled={save.isPending || !tenant}>
              {save.isPending ? "Saving…" : "Save entry"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}