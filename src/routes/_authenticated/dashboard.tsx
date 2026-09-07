import { createFileRoute, Link } from "@tanstack/react-router";
import { Building2, FileSignature, IndianRupee, TriangleAlert, Users } from "lucide-react";
import { useState } from "react";

import { AppShell } from "@/components/app-shell";
import { DuesTable } from "@/components/dues-table";
import { LabAllotmentTable } from "@/components/lab-allotment-table";
import { OccupancyMap } from "@/components/occupancy-map";
import { RecordPaymentDialog } from "@/components/record-payment-dialog";
import { StatCard } from "@/components/stat-card";
import { TodayChecklist } from "@/components/today-checklist";
import { canWrite, useWorkbookState } from "@/components/workbook-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/status-badge";
import { leaseViews, summary, type DueRow } from "@/lib/derive";
import { labHistory } from "@/lib/lab-history";
import { currentMonth, inr, monthLabel } from "@/lib/sheets-schema";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard | GBPIMS" },
      {
        name: "description",
        content: "Occupancy, collections and outstanding dues across all 26 modular labs.",
      },
      { property: "og:title", content: "Dashboard | GBPIMS" },
      { property: "og:description", content: "Live occupancy and payment position." },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const { wb, role, fallback } = useWorkbookState();
  const [payDue, setPayDue] = useState<DueRow | null>(null);
  const [month, setMonth] = useState(currentMonth());

  return (
    <AppShell title="Dashboard" subtitle={monthLabel(month)}>
      {fallback ?? <Body />}
      <RecordPaymentDialog
        due={payDue}
        onClose={() => setPayDue(null)}
        parkName={wb?.settings["park_name"] ?? "Guwahati Biotech Park"}
      />
    </AppShell>
  );

  function Body() {
    if (!wb) return null;
    const s = summary(wb);
    const parkName = wb.settings["park_name"] ?? "Guwahati Biotech Park";
    const thisMonth = s.dues.filter((d) => d.month === month);
    const rentRows = thisMonth.filter((d) => d.kind === "rent");
    const powerRows = thisMonth.filter((d) => d.kind === "electricity");
    const totals = (rows: DueRow[]) => ({
      billed: rows.reduce((a, d) => a + d.amount, 0),
      collected: rows.reduce((a, d) => a + d.paid, 0),
      pending: rows.reduce((a, d) => a + d.balance, 0),
    });
    const rentTotals = totals(rentRows);
    const powerTotals = totals(powerRows);
    const pending = s.dues
      .filter((d) => d.balance > 0)
      .sort((a, b) => (a.status === "overdue" ? -1 : 1) - (b.status === "overdue" ? -1 : 1))
      .slice(0, 8);

    return (
      <div className="space-y-6">
        <section className="gradient-hero relative overflow-hidden rounded-2xl p-5 text-sidebar-foreground lg:p-7">
          <p className="text-[10px] tracking-[0.16em] text-sidebar-foreground/60 uppercase">
            {parkName}
          </p>
          <h2 className="font-display mt-1.5 text-xl font-bold lg:text-2xl">
            {inr(s.outstanding)} outstanding across {s.activeIncubatees} incubatees
          </h2>
          <p className="mt-1.5 text-sm text-sidebar-foreground/70">
            {s.occupancyPct}% occupancy · rent roll {inr(s.monthlyRentRoll)} / month ·{" "}
            {s.overdue.length} overdue bills
          </p>
        </section>

        <TodayChecklist wb={wb} />

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Occupancy"
            value={`${s.occupied}/${s.totalLabs}`}
            hint={`${s.occupancyPct}% of labs allotted`}
            icon={Building2}
            tone="positive"
          />
          <StatCard
            label="Active incubatees"
            value={String(s.activeIncubatees)}
            hint={`${s.vacant} labs vacant`}
            icon={Users}
          />
          <StatCard
            label="Rent roll / month"
            value={inr(s.monthlyRentRoll)}
            hint="From occupied labs"
            icon={IndianRupee}
          />
          <StatCard
            label="Outstanding"
            value={inr(s.outstanding)}
            hint={`${s.overdue.length} overdue bills`}
            icon={TriangleAlert}
            tone={s.outstanding > 0 ? "danger" : "positive"}
          />
        </div>

        <section className="surface-card bg-card p-4 lg:p-5">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
            <h2 className="font-display min-w-0 text-sm font-semibold text-foreground">
              Occupancy map
            </h2>
            <Button asChild variant="ghost" size="sm">
              <Link to="/labs">Manage labs</Link>
            </Button>
          </div>
          <div className="mt-3">
            <OccupancyMap labs={s.labs} />
          </div>
          <div className="mt-3 flex gap-4 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-primary" /> Occupied
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-amber-500/80" /> On notice
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full border border-border" /> Vacant
            </span>
          </div>
        </section>

        <section className="surface-card bg-card p-4 lg:p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-sm font-semibold">Month-wise collections</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Rent and electricity for {monthLabel(month)}
              </p>
            </div>
            <Input
              type="month"
              aria-label="Select month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="w-44"
            />
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {(
              [
                { title: "Rent", t: rentTotals, rows: rentRows, to: "/rent" as const },
                {
                  title: "Electricity",
                  t: powerTotals,
                  rows: powerRows,
                  to: "/ledger" as const,
                },
              ] as const
            ).map((group) => (
              <div key={group.title} className="rounded-xl border border-border/70 p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">{group.title}</h3>
                  <Button asChild variant="ghost" size="sm">
                    <Link to={group.to}>Open</Link>
                  </Button>
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                  <StatCard label="Billed" value={inr(group.t.billed)} />
                  <StatCard label="Collected" value={inr(group.t.collected)} tone="positive" />
                  <StatCard label="Pending" value={inr(group.t.pending)} tone="warning" />
                </div>
                <ul className="mt-3 space-y-1.5">
                  {group.rows.slice(0, 5).map((d) => (
                    <li
                      key={`${d.kind}-${d.id}`}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 text-xs"
                    >
                      <span className="truncate text-muted-foreground">{d.company}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="font-medium">{inr(d.amount)}</span>
                        <StatusBadge status={d.status} />
                      </span>
                    </li>
                  ))}
                  {group.rows.length === 0 && (
                    <li className="text-xs text-muted-foreground">
                      No {group.title.toLowerCase()} bills for this month yet.
                    </li>
                  )}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <LabAllotmentTable rows={labHistory(wb)} />

        <LeasePanel />

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold">Needs follow-up</h2>
            <Button asChild variant="ghost" size="sm">
              <Link to="/rent">All rent bills</Link>
            </Button>
          </div>
          <DuesTable
            rows={pending}
            canWrite={canWrite(role)}
            onPay={setPayDue}
            parkName={parkName}
          />
        </section>
      </div>
    );
  }

  function LeasePanel() {
    if (!wb) return null;
    const leases = leaseViews(wb).filter((l) => l.state === "expiring" || l.state === "expired");
    if (leases.length === 0) return null;
    return (
      <section className="surface-card p-4 lg:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display flex items-center gap-2 text-sm font-semibold">
            <FileSignature className="size-4 text-primary" /> Lease renewals due
          </h2>
          <Button asChild variant="ghost" size="sm">
            <Link to="/leases">All agreements</Link>
          </Button>
        </div>
        <ul className="mt-3 space-y-2">
          {leases.slice(0, 5).map((l) => (
            <li
              key={l.incubateeId}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border/70 px-3 py-2 text-sm"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{l.company}</span>
                <span className="text-xs text-muted-foreground">
                  {l.labId || "No lab"} · ends {l.end || "—"}
                </span>
              </span>
              <span
                className={
                  "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase " +
                  (l.state === "expired"
                    ? "bg-destructive/12 text-destructive"
                    : "bg-amber-500/15 text-amber-700 dark:text-amber-400")
                }
              >
                {l.state === "expired"
                  ? `Expired ${Math.abs(l.daysLeft ?? 0)}d`
                  : `${l.daysLeft}d left`}
              </span>
            </li>
          ))}
        </ul>
      </section>
    );
  }
}
