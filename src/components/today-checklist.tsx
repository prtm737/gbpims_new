import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  CircleCheck,
  CircleDashed,
  FileSignature,
  FileSpreadsheet,
  ReceiptIndianRupee,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Workbook } from "@/lib/sheets-schema";
import { currentMonth, inr, num } from "@/lib/sheets-schema";

type Task = {
  id: string;
  done: boolean;
  title: string;
  detail: string;
  icon: typeof Zap;
  to?: string;
  tone: "ok" | "todo" | "warn";
};

function daysUntil(dateStr: string): number | null {
  if (!dateStr) return null;
  const t = new Date(dateStr).getTime();
  if (Number.isNaN(t)) return null;
  return Math.round((t - Date.now()) / 86_400_000);
}

/** Morning briefing: what is done, what still needs action today. */
export function TodayChecklist({ wb }: { wb: Workbook }) {
  const month = currentMonth();
  const rent = wb.rent.filter((r) => r["month"] === month);
  const rentOutstanding = wb.rent.reduce(
    (sum, r) => sum + Math.max(0, num(r["amount"]) - num(r["amount_paid"])),
    0,
  );
  const powerOutstanding = wb.ledger.reduce(
    (sum, b) => sum + Math.max(0, num(b["total_amount"]) - num(b["amount_paid"])),
    0,
  );
  const unpaidPower = wb.ledger.filter(
    (b) => (b["status"] ?? "") !== "paid" && num(b["balance"]) > 0,
  );
  const overdueRent = wb.rent.filter(
    (r) =>
      (r["status"] ?? "") === "overdue" ||
      ((r["status"] ?? "") !== "paid" &&
        r["due_date"] !== "" &&
        r["due_date"] !== undefined &&
        new Date(r["due_date"]) < new Date()),
  );
  const expiring = wb.incubatees
    .filter((i) => i["status"] !== "exited")
    .map((i) => ({ name: i["company_name"] ?? "", end: i["agreement_end"] ?? "" }))
    .map((i) => ({ ...i, days: daysUntil(i.end) }))
    .filter((i) => i.days !== null && i.days <= 60)
    .sort((a, b) => (a.days ?? 0) - (b.days ?? 0));

  const tasks: Task[] = [
    {
      id: "rent",
      done: rent.length > 0,
      title: "Rent invoices generated",
      detail:
        rent.length > 0
          ? `${rent.length} invoices for ${month} exist`
          : `No rent invoices for ${month} yet`,
      icon: ReceiptIndianRupee,
      to: "/rent",
      tone: rent.length > 0 ? "ok" : "todo",
    },
    {
      id: "power",
      done: unpaidPower.length === 0,
      title: "Electricity bills settled",
      detail:
        unpaidPower.length > 0
          ? `${unpaidPower.length} bill${unpaidPower.length === 1 ? "" : "s"} unpaid · ${inr(powerOutstanding)} due`
          : "All electricity bills are paid",
      icon: Zap,
      to: "/ledger",
      tone: unpaidPower.length === 0 ? "ok" : "todo",
    },
    {
      id: "overdue",
      done: overdueRent.length === 0,
      title: "No overdue rent",
      detail:
        overdueRent.length > 0
          ? `${overdueRent.length} invoice${overdueRent.length === 1 ? "" : "s"} past due · ${inr(rentOutstanding)} outstanding`
          : "Nothing overdue right now",
      icon: AlertTriangle,
      to: "/ledger",
      tone: overdueRent.length === 0 ? "ok" : "warn",
    },
    {
      id: "leases",
      done: expiring.length === 0,
      title: "Leases on track",
      detail:
        expiring.length > 0
          ? `${expiring[0]!.name} ends in ${expiring[0]!.days}d · ${expiring.length} total need renewal`
          : "No agreements expiring within 60 days",
      icon: FileSignature,
      to: "/leases",
      tone: expiring.length === 0 ? "ok" : "warn",
    },
    {
      id: "backup",
      done: true,
      title: "Data backed up",
      detail: "Automatic daily copy stored in the cloud (Settings → Data backups)",
      icon: FileSpreadsheet,
      tone: "ok",
    },
  ];

  const done = tasks.filter((t) => t.done).length;

  return (
    <section className="surface-card animate-fade-up p-4 lg:p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-sm font-semibold">Today's checklist</h2>
        <span className="text-xs text-muted-foreground">
          {done}/{tasks.length} done
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all duration-700 ease-out"
          style={{ width: `${(done / tasks.length) * 100}%` }}
        />
      </div>
      <ul className="mt-3 space-y-1.5">
        {tasks.map((t, i) => {
          const Icon = t.icon;
          return (
            <li
              key={t.id}
              className="animate-fade-up flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2 transition-colors hover:bg-muted/40"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              {t.done ? (
                <CircleCheck className="size-4 shrink-0 text-primary" />
              ) : (
                <CircleDashed
                  className={`size-4 shrink-0 ${t.tone === "warn" ? "text-destructive" : "text-muted-foreground"}`}
                />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{t.title}</span>
                <span className="block truncate text-xs text-muted-foreground">{t.detail}</span>
              </span>
              {t.to && (
                <Button asChild variant="ghost" size="sm" className="shrink-0">
                  <Link to={t.to}>Open</Link>
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
