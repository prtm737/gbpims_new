import { Link } from "@tanstack/react-router";
import {
  Building2,
  ReceiptIndianRupee,
  Search,
  Users,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { inr, num, type Workbook } from "@/lib/sheets-schema";
import { cn } from "@/lib/utils";

type Hit = {
  id: string;
  kind: "tenant" | "lab" | "rent" | "electricity";
  title: string;
  subtitle: string;
  right: string;
  to: string;
};

function searchWorkbook(wb: Workbook, term: string): Hit[] {
  const q = term.trim().toLowerCase();
  if (q.length < 2) return [];
  const hits: Hit[] = [];
  const match = (...values: (string | undefined)[]) =>
    values.some((v) => (v ?? "").toLowerCase().includes(q));

  for (const i of wb.incubatees) {
    if (match(i["company_name"], i["founder_name"], i["phone"], i["gstin"])) {
      hits.push({
        id: `t-${i["incubatee_id"]}`,
        kind: "tenant",
        title: i["company_name"] || "Unnamed tenant",
        subtitle: `${i["lab_id"] || "No space"} · ${i["status"] || "active"}`,
        right: inr(num(i["monthly_rent"])) + "/mo",
        to: "/incubatees",
      });
    }
  }
  for (const l of wb.labs) {
    if (match(l["lab_id"], l["name"], l["notes"])) {
      hits.push({
        id: `l-${l["lab_id"]}`,
        kind: "lab",
        title: `${l["lab_id"]}${l["name"] ? ` · ${l["name"]}` : ""}`,
        subtitle: `${l["status"] || "vacant"}${l["space_type"] ? ` · ${l["space_type"]}` : ""}`,
        right: inr(num(l["monthly_rent"])) + "/mo",
        to: "/labs",
      });
    }
  }
  for (const r of wb.rent) {
    if (match(r["invoice_no"], r["invoice_id"], r["company_name"], r["month"])) {
      const paid = num(r["amount_paid"]);
      const total = num(r["amount"]);
      hits.push({
        id: `r-${r["invoice_id"]}`,
        kind: "rent",
        title: `${r["invoice_no"] || r["invoice_id"]} · ${r["company_name"]}`,
        subtitle: `${r["month"]} · due ${r["due_date"] || "—"}`,
        right:
          inr(total) +
          (total - paid > 0 ? ` · ${inr(total - paid)} due` : " · paid"),
        to: "/rent",
      });
    }
  }
  for (const b of wb.ledger) {
    if (match(b["bill_id"], b["client_name"], b["bill_date"])) {
      const paid = num(b["amount_paid"]);
      const total = num(b["total_amount"]);
      hits.push({
        id: `p-${b["bill_id"]}`,
        kind: "electricity",
        title: `${b["bill_id"]} · ${b["client_name"]}`,
        subtitle: `${b["bill_date"]} · ${b["total_units"]} units`,
        right:
          inr(total) +
          (total - paid > 0 ? ` · ${inr(total - paid)} due` : " · paid"),
        to: "/ledger",
      });
    }
  }
  return hits.slice(0, 24);
}

const KIND_META = {
  tenant: { label: "Tenant", icon: Users, cls: "bg-primary/10 text-primary" },
  lab: { label: "Space", icon: Building2, cls: "bg-sky-500/10 text-sky-600" },
  rent: { label: "Rent", icon: ReceiptIndianRupee, cls: "bg-emerald-500/10 text-emerald-600" },
  electricity: { label: "Electricity", icon: Zap, cls: "bg-amber-500/10 text-amber-600" },
} as const;

/** Command-palette style search across tenants, spaces, rent and electricity. */
export function GlobalSearch({ wb, onClose }: { wb: Workbook | null; onClose: () => void }) {
  const [term, setTerm] = useState("");
  const hits = useMemo(() => (wb ? searchWorkbook(wb, term) : []), [wb, term]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-start justify-center bg-background/70 p-4 pt-[12vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="animate-pop surface-card w-full max-w-xl overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Search className="size-4 text-muted-foreground" />
          <Input
            autoFocus
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search company, bill no, space, phone…"
            className="h-8 border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
          <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            Esc
          </kbd>
        </div>
        <ul className="max-h-[55vh] divide-y divide-border overflow-y-auto">
          {hits.map((h, i) => {
            const meta = KIND_META[h.kind];
            const Icon = meta.icon;
            return (
              <li key={h.id} className="animate-fade-up" style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}>
                <Button
                  asChild
                  variant="ghost"
                  className="flex h-auto w-full items-center justify-between gap-3 rounded-none px-4 py-2.5 text-left"
                  onClick={onClose}
                >
                  <Link to={h.to}>
                    <span className="flex min-w-0 items-center gap-3">
                      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", meta.cls)}>
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{h.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">{h.subtitle}</span>
                      </span>
                    </span>
                    <span className="shrink-0 text-xs font-medium text-muted-foreground">{h.right}</span>
                  </Link>
                </Button>
              </li>
            );
          })}
          {term.trim().length >= 2 && hits.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-muted-foreground">
              No match for “{term}”.
            </li>
          )}
          {term.trim().length < 2 && (
            <li className="px-4 py-6 text-center text-xs text-muted-foreground">
              Type at least 2 characters — searches tenants, spaces, rent invoices and
              electricity bills at once.
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
