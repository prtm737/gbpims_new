import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { AppShell } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { canCreate, canDelete, canEdit, useWorkbookState } from "@/components/workbook-state";
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
import { labViews, type LabView } from "@/lib/derive";
import { deleteLabFn, saveLabFn } from "@/lib/gbp.functions";
import { inr, SPACE_TYPES, spaceTypeLabel } from "@/lib/sheets-schema";
import { useSheetMutation } from "@/lib/use-app-data";

export const Route = createFileRoute("/_authenticated/labs")({
  head: () => ({
    meta: [
      { title: "Rentable spaces | GBPIMS" },
      {
        name: "description",
        content:
          "Occupancy, rent and details for the 26 modular labs plus canteen, utility and other rentable spaces.",
      },
      { property: "og:title", content: "Rentable spaces | GBPIMS" },
      { property: "og:description", content: "Space-wise occupancy and rent register." },
    ],
  }),
  component: LabsPage,
});

type Draft = LabView & { isNew?: boolean };

const EMPTY: Draft = {
  labId: "",
  name: "",
  spaceType: "lab",
  block: "",
  floor: "",
  areaSqft: "",
  rent: 0,
  grossRent: 0,
  discount: 0,
  status: "vacant",
  notes: "",
  occupant: undefined,
  isNew: true,
};

function LabsPage() {
  const { wb, role, fallback } = useWorkbookState();
  const [editing, setEditing] = useState<Draft | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const save = useSheetMutation(useServerFn(saveLabFn), "Lab updated");
  const remove = useSheetMutation(useServerFn(deleteLabFn), "Space deleted");
  const mayCreate = canCreate(role);
  const mayEdit = canEdit(role);
  const mayDelete = canDelete(role);

  const all = wb ? labViews(wb) : [];
  const spaces = filter === "all" ? all : all.filter((s) => (s.spaceType || "lab") === filter);
  const usedTypes = SPACE_TYPES.filter((t) =>
    all.some((s) => (s.spaceType || "lab") === t.value),
  );

  return (
    <AppShell
      title="Rentable spaces"
      subtitle={`${all.length} spaces · labs, canteen, utility and more`}
      actions={
        mayCreate ? (
          <Button size="sm" onClick={() => setEditing({ ...EMPTY })}>
            Add space
          </Button>
        ) : null
      }
    >
      {fallback ??
        (wb ? (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {[{ value: "all", label: `All (${all.length})` }, ...usedTypes].map((t) => (
              <button
                key={t.value}
                onClick={() => setFilter(t.value)}
                className={
                  filter === t.value
                    ? "rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary"
                    : "rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                }
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {spaces.map((lab) => (
              <div
                key={lab.labId}
                className="surface-card p-4 transition-shadow hover:shadow-[var(--shadow-elevated-value)]"
              >
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-display text-base font-bold">
                      {lab.name || lab.labId}
                    </p>
                    <p className="text-[10px] font-semibold tracking-[0.12em] text-primary uppercase">
                      {lab.labId} · {spaceTypeLabel(lab.spaceType)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {[
                        lab.block && `Block ${lab.block}`,
                        lab.floor && `Floor ${lab.floor}`,
                        lab.areaSqft && `${lab.areaSqft} sqft`,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "Details not set"}
                    </p>
                  </div>
                  <StatusBadge status={lab.status} />
                </div>
                <p className="mt-3 text-sm font-semibold">
                  {lab.occupant?.["company_name"] ?? "Vacant"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Rent {inr(lab.rent)}
                  {lab.discount > 0
                    ? ` (gross ${inr(lab.grossRent)} − discount ${inr(lab.discount)})`
                    : ""}
                  {lab.occupant?.["allotment_date"]
                    ? ` · since ${lab.occupant["allotment_date"]}`
                    : ""}
                </p>
                {(mayEdit || mayDelete) && (
                  <div className="mt-3 flex gap-2">
                    {mayEdit && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => setEditing(lab)}
                      >
                        Edit
                      </Button>
                    )}
                    {mayDelete && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        disabled={remove.isPending}
                        onClick={() => {
                          if (confirm(`Delete ${lab.name || lab.labId}?`)) {
                            remove.mutate({ data: { lab_id: lab.labId } });
                          }
                        }}
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          {!mayEdit && mayCreate && (
            <p className="text-xs text-muted-foreground">
              You have data-entry access: you can add new spaces, but editing or deleting existing
              ones needs a super admin.
            </p>
          )}
        </div>
        ) : null)}

      <Dialog open={editing !== null} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editing?.isNew ? "Add rentable space" : `Edit ${editing?.name || editing?.labId}`}
            </DialogTitle>
          </DialogHeader>
          {editing && (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                save.mutate(
                  {
                    data: {
                      lab_id: String(f.get("lab_id") ?? editing.labId).trim(),
                      name: String(f.get("name") ?? ""),
                      space_type: String(f.get("space_type") ?? "lab") as "lab",
                      block: String(f.get("block") ?? ""),
                      floor: String(f.get("floor") ?? ""),
                      area_sqft: String(f.get("area_sqft") ?? ""),
                      monthly_rent: String(f.get("monthly_rent") ?? ""),
                      status: editing.status === "vacant" ? "vacant" : "occupied",
                      notes: String(f.get("notes") ?? ""),
                    },
                  },
                  { onSuccess: () => setEditing(null) },
                );
              }}
            >
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="lab_id">Space ID</Label>
                  <Input
                    id="lab_id"
                    name="lab_id"
                    required
                    maxLength={20}
                    defaultValue={editing.labId}
                    readOnly={!editing.isNew}
                    placeholder="CANTEEN-01"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="space_type">Space type</Label>
                  <select
                    id="space_type"
                    name="space_type"
                    defaultValue={editing.spaceType || "lab"}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {SPACE_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="name">Display name</Label>
                <Input
                  id="name"
                  name="name"
                  maxLength={120}
                  defaultValue={editing.name}
                  placeholder="Ground floor canteen"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="block">Block</Label>
                  <Input id="block" name="block" defaultValue={editing.block} maxLength={30} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="floor">Floor</Label>
                  <Input id="floor" name="floor" defaultValue={editing.floor} maxLength={10} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="area_sqft">Area (sqft)</Label>
                  <Input
                    id="area_sqft"
                    name="area_sqft"
                    defaultValue={editing.areaSqft}
                    maxLength={20}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="monthly_rent">Monthly rent</Label>
                  <Input
                    id="monthly_rent"
                    name="monthly_rent"
                    defaultValue={editing.rent ? String(editing.rent) : ""}
                    maxLength={20}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  name="notes"
                  defaultValue={editing.notes}
                  rows={2}
                  maxLength={500}
                />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending ? "Saving…" : editing.isNew ? "Add space" : "Save space"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
