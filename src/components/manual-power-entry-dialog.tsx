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
import { Textarea } from "@/components/ui/textarea";
import { saveManualPowerEntryFn } from "@/lib/gbp.functions";
import type { PowerBill, PowerClient } from "@/lib/power";
import type { Workbook } from "@/lib/sheets-schema";
import { useSheetMutation } from "@/lib/use-app-data";

type Option = { value: string; label: string; hint: string };

/**
 * Every tenant is billable: the picker lists all non-exited tenants (whether or
 * not they already have a billing client row) plus any extra billing clients.
 */
function billableOptions(wb: Workbook | null, clients: PowerClient[]): Option[] {
  const options: Option[] = [];
  const linked = new Set<string>();
  (wb?.incubatees ?? [])
    .filter((t) => (t["company_name"] ?? "").trim() !== "" && t["status"] !== "exited")
    .forEach((t) => {
      const incubateeId = (t["incubatee_id"] ?? "").trim();
      const client = clients.find((c) => c.incubateeId === incubateeId);
      if (client) linked.add(client.clientId);
      options.push({
        value: client ? `cli:${client.clientId}` : `inc:${incubateeId}`,
        label: t["company_name"] ?? "",
        hint: t["lab_id"] || "No space",
      });
    });
  clients
    .filter((c) => !linked.has(c.clientId))
    .forEach((c) =>
      options.push({ value: `cli:${c.clientId}`, label: c.name, hint: "Billing client" }),
    );
  return options.sort((a, b) => a.label.localeCompare(b.label));
}

/** Feed an electricity bill raised outside the app into the electricity ledger. */
export function ManualPowerEntryDialog({
  open,
  clients,
  wb,
  edit,
  onClose,
}: {
  open: boolean;
  clients: PowerClient[];
  wb: Workbook | null;
  edit?: PowerBill | null;
  onClose: () => void;
}) {
  const save = useSheetMutation(
    useServerFn(saveManualPowerEntryFn),
    "Electricity entry saved to the sheet",
  );
  const options = billableOptions(wb, clients);
  const [target, setTarget] = useState("");
  const [form, setForm] = useState({
    billDate: new Date().toISOString().slice(0, 10),
    dueDate: "",
    periodFrom: "",
    periodTo: "",
    units: "",
    total: "",
    remarks: "",
  });

  useEffect(() => {
    if (!open) return;
    setTarget(edit?.clientId ? `cli:${edit.clientId}` : "");
    setForm({
      billDate: edit?.billDate || new Date().toISOString().slice(0, 10),
      dueDate: edit?.dueDate ?? "",
      periodFrom: edit?.periodFrom ?? "",
      periodTo: edit?.periodTo ?? "",
      units: edit ? String(edit.totalUnits || "") : "",
      total: edit ? String(edit.total || "") : "",
      remarks: edit?.remarks ?? "",
    });
  }, [open, edit]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{edit ? `Edit ${edit.billId}` : "Manual electricity entry"}</DialogTitle>
          <DialogDescription>
            {edit
              ? "Update the recorded figures for this ledger entry."
              : "Record an electricity bill you raised outside the app — electricity charges only, no meter readings needed."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!target) return;
            const [kind, id] = target.split(":");
            save.mutate(
              {
                data: {
                  ...(edit ? { bill_id: edit.billId } : {}),
                  ...(kind === "cli" ? { client_id: id } : { incubatee_id: id }),
                  bill_date: form.billDate,
                  due_date: form.dueDate || form.billDate,
                  period_from: form.periodFrom,
                  period_to: form.periodTo,
                  total_units: Number(form.units) || 0,
                  energy_charge: Number(form.total) || 0,
                  total_amount: Number(form.total) || 0,
                  remarks: form.remarks,
                },
              },
              { onSuccess: onClose },
            );
          }}
        >
          <div className="space-y-1.5">
            <Label>Tenant</Label>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger>
                <SelectValue placeholder="Select tenant" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {options.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label} · {o.hint}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {options.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No tenants yet — add a tenant on the Tenants page first.
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Bill date</Label>
              <Input
                type="date"
                value={form.billDate}
                onChange={(e) => setForm({ ...form, billDate: e.target.value })}
                required
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
              <Label>Period from</Label>
              <Input
                type="date"
                value={form.periodFrom}
                onChange={(e) => setForm({ ...form, periodFrom: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Period to</Label>
              <Input
                type="date"
                value={form.periodTo}
                onChange={(e) => setForm({ ...form, periodTo: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Units (optional)</Label>
              <Input
                type="number"
                inputMode="decimal"
                min="0"
                value={form.units}
                onChange={(e) => setForm({ ...form, units: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Electricity amount payable</Label>
            <Input
              type="number"
              inputMode="decimal"
              min="0"
              value={form.total}
              onChange={(e) => setForm({ ...form, total: e.target.value })}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label>Remarks</Label>
            <Textarea
              rows={2}
              placeholder="e.g. bill raised manually, paid by cheque later"
              value={form.remarks}
              onChange={(e) => setForm({ ...form, remarks: e.target.value })}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={save.isPending || !target}>
              {save.isPending ? "Saving…" : "Save entry"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}