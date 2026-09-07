import { createFileRoute } from "@tanstack/react-router";
import { Download } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { AppShell } from "@/components/app-shell";
import { StatCard } from "@/components/stat-card";
import { useWorkbookState } from "@/components/workbook-state";
import { Button } from "@/components/ui/button";
import { downloadCsv, duesByKind, monthlySplitSeries, summary } from "@/lib/derive";
import { inr, monthLabel, num } from "@/lib/sheets-schema";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({
    meta: [
      { title: "Reports | GBPIMS" },
      {
        name: "description",
        content: "Collections, arrears and occupancy trends with CSV export for office records.",
      },
      { property: "og:title", content: "Reports | GBPIMS" },
      { property: "og:description", content: "Collections and occupancy analytics." },
    ],
  }),
  component: ReportsPage,
});

function ReportsPage() {
  const { wb, fallback } = useWorkbookState();

  return (
    <AppShell
      title="Reports"
      subtitle="Collections, arrears and occupancy"
      actions={
        wb ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              downloadCsv(
                `gbp-dues-${new Date().toISOString().slice(0, 10)}.csv`,
                summary(wb).dues.map((d) => ({
                  type: d.kind,
                  id: d.id,
                  company: d.company,
                  lab: d.labId,
                  month: d.month,
                  amount: d.amount,
                  paid: d.paid,
                  balance: d.balance,
                  status: d.status,
                })),
              )
            }
          >
            <Download className="size-4" /> CSV
          </Button>
        ) : undefined
      }
    >
      {fallback ?? <Body />}
    </AppShell>
  );

  function Body() {
    if (!wb) return null;
    const s = summary(wb);
    const series = monthlySplitSeries(wb);
    const kinds = duesByKind(wb);
    // Security-deposit register: total held vs refundable for exited tenants.
    const deposits = (() => {
      const rows = wb.incubatees
        .filter((i) => num(i["security_deposit"]) > 0)
        .map((i) => ({
          id: i["incubatee_id"] ?? i["company_name"] ?? "",
          company: i["company_name"] || "Unnamed",
          labId: i["lab_id"] ?? "",
          deposit: num(i["security_deposit"]),
          status: i["status"] || "active",
        }));
      const active = rows.filter((r) => r.status !== "exited");
      const exited = rows.filter((r) => r.status === "exited");
      return {
        all: [...active, ...exited],
        active,
        exited,
        activeTotal: active.reduce((sum, r) => sum + r.deposit, 0),
        exitedTotal: exited.reduce((sum, r) => sum + r.deposit, 0),
      };
    })();
    const occupancyData = [
      { name: "Occupied", value: s.occupied },
      { name: "Vacant", value: s.vacant },
    ];
    const arrears = [...s.dues]
      .filter((d) => d.balance > 0)
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 10);

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Total billed" value={inr(s.billed)} />
          <StatCard label="Total collected" value={inr(s.collected)} tone="positive" />
          <StatCard label="Outstanding" value={inr(s.outstanding)} tone="danger" />
          <StatCard
            label="Collection rate"
            value={`${s.billed ? Math.round((s.collected / s.billed) * 100) : 0}%`}
          />
        </div>

        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="font-display text-sm font-semibold">
            Rent vs electricity billed, and collections (6 months)
          </h2>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={series}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="month" fontSize={11} stroke="var(--muted-foreground)" />
                <YAxis fontSize={11} stroke="var(--muted-foreground)" width={60} />
                <Tooltip
                  formatter={(v: number) => inr(v)}
                  contentStyle={{
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="rent" name="Rent" fill="var(--chart-3)" radius={[4, 4, 0, 0]} />
                <Bar
                  dataKey="electricity"
                  name="Electricity"
                  fill="var(--chart-2)"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="collected"
                  name="Collected"
                  fill="var(--chart-1)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              ["Rent", kinds.rent],
              ["Electricity", kinds.electricity],
            ] as const
          ).map(([label, k]) => (
            <section key={label} className="rounded-lg border border-border bg-card p-4">
              <h2 className="font-display text-sm font-semibold">{label}</h2>
              <dl className="mt-3 space-y-2 text-sm">
                {(
                  [
                    ["Bills", String(k.rows.length)],
                    ["Billed", inr(k.billed)],
                    ["Collected", inr(k.collected)],
                    ["Outstanding", inr(k.outstanding)],
                  ] as const
                ).map(([dt, dd]) => (
                  <div key={dt} className="flex items-center justify-between">
                    <dt className="text-muted-foreground">{dt}</dt>
                    <dd className="font-semibold">{dd}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="font-display text-sm font-semibold">Occupancy</h2>
            <div className="mt-2 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={occupancyData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={50}
                    outerRadius={80}
                  >
                    <Cell fill="var(--chart-1)" />
                    <Cell fill="var(--muted)" />
                  </Pie>
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="font-display text-sm font-semibold">Top arrears</h2>
            <ul className="mt-3 divide-y divide-border text-sm">
              {arrears.map((d) => (
                <li key={`${d.kind}-${d.id}`} className="flex items-center justify-between py-2">
                  <span className="min-w-0 truncate">
                    {d.company}
                    <span className="text-xs text-muted-foreground">
                      {" "}
                      · {d.kind} · {monthLabel(d.month)}
                    </span>
                  </span>
                  <span className="font-semibold text-destructive">{inr(d.balance)}</span>
                </li>
              ))}
              {arrears.length === 0 && (
                <li className="py-4 text-center text-muted-foreground">No arrears. All clear.</li>
              )}
            </ul>
          </section>
          <section className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-sm font-semibold">Security deposits held</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Deposits of active tenants. Exited tenants show separately for refund tracking.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  downloadCsv("gbp-deposits.csv", [
                    ...deposits.active.map((d) => ({
                      company: d.company,
                      lab: d.labId,
                      deposit: d.deposit,
                      status: d.status,
                    })),
                    ...deposits.exited.map((d) => ({
                      company: d.company,
                      lab: d.labId,
                      deposit: d.deposit,
                      status: d.status,
                    })),
                  ])
                }
              >
                <Download className="size-3.5" /> CSV
              </Button>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <StatCard
                label="Held (active tenants)"
                value={inr(deposits.activeTotal)}
                tone="positive"
              />
              <StatCard
                label="Exited — refund due"
                value={inr(deposits.exitedTotal)}
                tone="warning"
              />
            </div>
            <ul className="mt-3 max-h-72 divide-y divide-border overflow-y-auto text-sm">
              {deposits.all.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0 truncate">
                    {d.company}
                    <span className="text-xs text-muted-foreground"> · {d.labId || "no space"}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="font-semibold">{inr(d.deposit)}</span>
                    <span
                      className={
                        "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase " +
                        (d.status === "exited"
                          ? "bg-muted text-muted-foreground"
                          : "bg-primary/10 text-primary")
                      }
                    >
                      {d.status}
                    </span>
                  </span>
                </li>
              ))}
              {deposits.all.length === 0 && (
                <li className="py-4 text-center text-muted-foreground">No deposits on record.</li>
              )}
            </ul>
          </section>
        </div>
      </div>
    );
  }
}
