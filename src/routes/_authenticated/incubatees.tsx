import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Plus, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { AppShell } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { TenantDetailDialog } from "@/components/tenant-detail-dialog";
import { canCreate, canEdit, useWorkbookState } from "@/components/workbook-state";
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
import { incubateeRent, labViews } from "@/lib/derive";
import { deleteIncubateeFn, saveIncubateeFn, vacateIncubateeFn } from "@/lib/gbp.functions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  discountValue,
  grossRent,
  inr,
  rentRate,
  spaceIds,
  totalArea,
  type Row,
} from "@/lib/sheets-schema";
import { useSheetMutation } from "@/lib/use-app-data";

export const Route = createFileRoute("/_authenticated/incubatees")({
  head: () => ({
    meta: [
      { title: "Incubatees | GBPIMS" },
      {
        name: "description",
        content: "Startup register with lab allotment, agreement dates, deposits and contacts.",
      },
      { property: "og:title", content: "Incubatees | GBPIMS" },
      { property: "og:description", content: "Startup and allotment register." },
    ],
  }),
  component: IncubateesPage,
});

type Draft = Partial<Row> & { incubatee_id?: string };

function IncubateesPage() {
  const { wb, role, fallback } = useWorkbookState();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [status, setStatus] = useState("active");
  const [labId, setLabId] = useState("");
  const [discountPct, setDiscountPct] = useState("");
  const [discountAmount, setDiscountAmount] = useState("");
  const save = useSheetMutation(useServerFn(saveIncubateeFn), "Incubatee saved");
  const vacate = useSheetMutation(useServerFn(vacateIncubateeFn), "Lab vacated");
  const removeTenant = useSheetMutation(useServerFn(deleteIncubateeFn), "Tenant deleted");
  const [confirmDelete, setConfirmDelete] = useState<Row | null>(null);
  const [detail, setDetail] = useState<Row | null>(null);
  const writable = canCreate(role);
  const editable = canEdit(role);

  function openDraft(row: Draft) {
    setDraft(row);
    setStatus(row["status"] ?? "active");
    setLabId(row["lab_id"] ?? "");
    setDiscountPct(row["discount_pct"] ?? "");
    setDiscountAmount(row["discount_amount"] ?? "");
  }

  const settings = wb?.settings ?? {};
  const selectedSpaces: string[] = spaceIds(labId);
  const previewGross = grossRent(totalArea(wb?.labs ?? [], labId), settings);
  const previewDiscount = discountValue(previewGross, discountPct, discountAmount);

  return (
    <AppShell
      title="Incubatees"
      subtitle="Startups, allotments and contacts"
      actions={
        writable ? (
          <Button size="sm" onClick={() => openDraft({})}>
            <Plus className="size-4" /> Add
          </Button>
        ) : undefined
      }
    >
      {fallback ??
        (wb ? (
          <div className="space-y-2">
            {wb.incubatees.length === 0 && (
              <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                No incubatees yet. Add your first startup to allot a lab.
              </p>
            )}
            {wb.incubatees.map((row) => (
              <div
                key={row["incubatee_id"]}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4"
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => setDetail(row)}
                  title="View full tenant record"
                >
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold">{row["company_name"]}</p>
                    <StatusBadge status={row["status"] ?? "active"} />
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {[row["lab_id"] || "No lab", row["founder_name"], row["phone"]]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {wb && (
                    <p className="text-xs text-muted-foreground">
                      Rent {inr(incubateeRent(wb, row).net)}
                      {incubateeRent(wb, row).discount > 0
                        ? ` (after ${inr(incubateeRent(wb, row).discount)} discount)`
                        : ""}
                      {row["agreement_end"] ? ` · agreement till ${row["agreement_end"]}` : ""}
                    </p>
                  )}
                  <p className="mt-1 text-[11px] font-semibold text-primary">
                    View all bills & payments →
                  </p>
                </button>
                {editable && (
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => openDraft(row)}>
                      Edit
                    </Button>
                    {row["status"] !== "exited" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          vacate.mutate({ data: { incubatee_id: row["incubatee_id"] ?? "" } })
                        }
                      >
                        Vacate
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setConfirmDelete(row)}
                    >
                      Delete
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : null)}

      <TenantDetailDialog tenant={detail} wb={wb ?? null} onClose={() => setDetail(null)} />

      <AlertDialog open={confirmDelete !== null} onOpenChange={(v) => !v && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {confirmDelete?.["company_name"]}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the tenant, its rent invoices and its electricity billing
              client from the Google Sheet, and frees the allotted space. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep tenant</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                removeTenant.mutate({
                  data: { incubatee_id: confirmDelete?.["incubatee_id"] ?? "" },
                });
                setConfirmDelete(null);
              }}
            >
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={draft !== null} onOpenChange={(v) => !v && setDraft(null)}>
        <DialogContent className="max-h-[85dvh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {draft?.["incubatee_id"] ? "Edit incubatee" : "Add incubatee"}
            </DialogTitle>
          </DialogHeader>
          {draft && (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const get = (k: string) => String(f.get(k) ?? "");
                // Duplicate guard: a company already on record probably means
                // the tenant should be edited, not entered twice.
                const name = get("company_name").trim().toLowerCase();
                const duplicate =
                  !draft["incubatee_id"] &&
                  wb?.incubatees.some(
                    (i) =>
                      (i["company_name"] ?? "").trim().toLowerCase() === name &&
                      (i["status"] ?? "active") !== "exited",
                  );
                if (duplicate && !window.confirm(`"${get("company_name")}" already exists as a tenant. Add another row for the same company anyway?\n\nChoose Cancel if you meant to edit the existing tenant instead.`)) {
                  return;
                }
                save.mutate(
                  {
                    data: {
                      incubatee_id: draft["incubatee_id"] ?? "",
                      company_name: get("company_name"),
                      founder_name: get("founder_name"),
                      phone: get("phone"),
                      email: get("email"),
                      lab_id: labId,
                      allotment_date: get("allotment_date"),
                      agreement_end: get("agreement_end"),
                      security_deposit: get("security_deposit"),
                      monthly_rent: get("monthly_rent"),
                      discount_pct: discountPct,
                      discount_amount: discountAmount,
                      status: status as "active" | "notice" | "exited",
                      notes: get("notes"),
                      agreement_start: get("agreement_start"),
                      agreement_no: get("agreement_no"),
                      lease_term_months: get("lease_term_months"),
                      gstin: get("gstin"),
                      address: get("address"),
                    },
                  },
                  { onSuccess: () => setDraft(null) },
                );
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="company_name">Company name</Label>
                <Input
                  id="company_name"
                  name="company_name"
                  required
                  maxLength={120}
                  defaultValue={draft["company_name"] ?? ""}
                />
                {!draft["incubatee_id"] &&
                  wb?.incubatees.some(
                    (i) =>
                      (i["status"] ?? "active") !== "exited" &&
                      (i["company_name"] ?? "").trim().toLowerCase() ===
                        (draft["company_name"] ?? "").trim().toLowerCase(),
                  ) && (
                    <p className="flex items-center gap-1.5 text-xs text-amber-600">
                      <TriangleAlert className="size-3.5" /> A tenant with this name already
                      exists — consider editing that row instead.
                    </p>
                  )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="founder_name">Founder</Label>
                  <Input
                    id="founder_name"
                    name="founder_name"
                    maxLength={120}
                    defaultValue={draft["founder_name"] ?? ""}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="phone">Phone (WhatsApp)</Label>
                  <Input
                    id="phone"
                    name="phone"
                    maxLength={20}
                    defaultValue={draft["phone"] ?? ""}
                  />
                </div>
                <div className="space-y-1.5 col-span-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    maxLength={160}
                    defaultValue={draft["email"] ?? ""}
                  />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label>Spaces allotted</Label>
                  <p className="text-xs text-muted-foreground">
                    Tick every lab or space this tenant holds — one single bill covers them all.
                  </p>
                  <div className="grid max-h-44 grid-cols-2 gap-1 overflow-y-auto rounded-lg border border-border p-2 sm:grid-cols-3">
                    {wb &&
                      labViews(wb).map((lab) => {
                        const selected = selectedSpaces.includes(lab.labId);
                        const takenByOther =
                          lab.occupant && lab.occupant["incubatee_id"] !== draft["incubatee_id"];
                        return (
                          <button
                            key={lab.labId}
                            type="button"
                            onClick={() =>
                              setLabId(
                                (selected
                                  ? selectedSpaces.filter((id) => id !== lab.labId)
                                  : [...selectedSpaces, lab.labId]
                                ).join(", "),
                              )
                            }
                            className={`min-h-10 rounded-md border px-2 py-1.5 text-left text-xs font-medium transition-colors ${
                              selected
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border text-muted-foreground hover:bg-muted"
                            }`}
                          >
                            {lab.labId}
                            {takenByOther && !selected ? " · taken" : ""}
                          </button>
                        );
                      })}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Status</Label>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["active", "notice", "exited"].map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="allotment_date">Allotment date</Label>
                  <Input
                    id="allotment_date"
                    name="allotment_date"
                    type="date"
                    defaultValue={draft["allotment_date"] ?? ""}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="agreement_start">Agreement start</Label>
                  <Input
                    id="agreement_start"
                    name="agreement_start"
                    type="date"
                    defaultValue={draft["agreement_start"] ?? ""}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="agreement_end">Agreement end</Label>
                  <Input
                    id="agreement_end"
                    name="agreement_end"
                    type="date"
                    defaultValue={draft["agreement_end"] ?? ""}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="lease_term_months">Lease term (months)</Label>
                  <Input
                    id="lease_term_months"
                    name="lease_term_months"
                    inputMode="numeric"
                    maxLength={6}
                    defaultValue={draft["lease_term_months"] ?? ""}
                    placeholder="36"
                  />
                </div>
                <div className="space-y-1.5 col-span-2">
                  <Label htmlFor="agreement_no">Agreement number</Label>
                  <Input
                    id="agreement_no"
                    name="agreement_no"
                    maxLength={60}
                    defaultValue={draft["agreement_no"] ?? ""}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="gstin">GSTIN / UIN</Label>
                  <Input
                    id="gstin"
                    name="gstin"
                    maxLength={30}
                    defaultValue={draft["gstin"] ?? ""}
                    placeholder="18AAAAA0000A1Z5"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="address">Billing address</Label>
                  <Input
                    id="address"
                    name="address"
                    maxLength={300}
                    defaultValue={draft["address"] ?? ""}
                    placeholder="Street, city, PIN"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="monthly_rent">Monthly rent</Label>
                  <Input
                    id="monthly_rent"
                    name="monthly_rent"
                    maxLength={20}
                    defaultValue={draft["monthly_rent"] ?? ""}
                    placeholder={previewGross ? String(previewGross) : "auto from area"}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="security_deposit">Security deposit</Label>
                  <Input
                    id="security_deposit"
                    name="security_deposit"
                    maxLength={20}
                    defaultValue={draft["security_deposit"] ?? ""}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="discount_pct">Discount %</Label>
                  <Input
                    id="discount_pct"
                    inputMode="decimal"
                    maxLength={10}
                    value={discountPct}
                    onChange={(e) => setDiscountPct(e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="discount_amount">Flat discount (₹)</Label>
                  <Input
                    id="discount_amount"
                    inputMode="decimal"
                    maxLength={20}
                    value={discountAmount}
                    onChange={(e) => setDiscountAmount(e.target.value)}
                    placeholder="0"
                  />
                </div>
              </div>
              <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs">
                <p className="font-medium">
                  {totalArea(wb?.labs ?? [], labId) > 0
                    ? `${totalArea(wb?.labs ?? [], labId).toLocaleString("en-IN")} sqft across ${selectedSpaces.length} space${selectedSpaces.length > 1 ? "s" : ""} × ${inr(rentRate(settings))}/sqft`
                    : "Tick the allotted spaces (with area recorded) to auto-compute rent"}
                </p>
                <p className="mt-1 text-muted-foreground">
                  Gross {inr(previewGross)} − discount {inr(previewDiscount)} ={" "}
                  <span className="font-semibold text-foreground">
                    {inr(Math.max(0, previewGross - previewDiscount))} / month
                  </span>
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="notes">Notes</Label>
                <Input
                  id="notes"
                  name="notes"
                  maxLength={500}
                  defaultValue={draft["notes"] ?? ""}
                />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending ? "Saving…" : "Save incubatee"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
