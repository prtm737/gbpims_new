import { createFileRoute } from "@tanstack/react-router";
import { Download, MessageCircle } from "lucide-react";
import { useMemo, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkbookState } from "@/components/workbook-state";
import {
  downloadCsv,
  leaseReminderMessage,
  leaseViews,
  whatsappLink,
  type LeaseView,
} from "@/lib/derive";
import { dateLabel, inr, leaseReminderDays } from "@/lib/sheets-schema";

export const Route = createFileRoute("/_authenticated/leases")({
  head: () => ({
    meta: [
      { title: "Lease agreements & renewals | GBPIMS" },
      {
        name: "description",
        content:
          "Track every incubatee lease agreement, security deposit and renewal date with one-tap WhatsApp renewal reminders.",
      },
      { property: "og:title", content: "Lease agreements & renewals | GBPIMS" },
      { property: "og:description", content: "Agreement register with renewal reminders." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LeasesPage,
});

const TONE: Record<string, string> = {
  expired: "bg-destructive/12 text-destructive",
  expiring: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  active: "bg-primary/12 text-primary",
  unknown: "bg-muted text-muted-foreground",
};

function LeasesPage() {
  const { wb, fallback } = useWorkbookState();
  const [query, setQuery] = useState("");
  const leases = useMemo(() => (wb ? leaseViews(wb) : []), [wb]);
  const parkName = wb?.settings["park_name"] ?? "Guwahati Biotech Park";
  const noticeDays = wb ? leaseReminderDays(wb.settings) : 60;

  const filtered = leases.filter((l) =>
    `${l.company} ${l.labId} ${l.agreementNo}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const expiring = leases.filter((l) => l.state === "expiring").length;
  const expired = leases.filter((l) => l.state === "expired").length;
  const missing = leases.filter((l) => l.state === "unknown").length;

  const label = (l: LeaseView) =>
    l.state === "expired"
      ? `Expired ${Math.abs(l.daysLeft ?? 0)}d ago`
      : l.state === "expiring"
        ? `Renew in ${l.daysLeft}d`
        : l.state === "active"
          ? `${l.daysLeft}d left`
          : "No end date";

  return (
    <AppShell
      title="Lease agreements"
      subtitle={`${leases.length} active agreements · reminder window ${noticeDays} days`}
      actions={
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            downloadCsv(
              "gbpims-lease-register.csv",
              filtered.map((l) => ({
                company: l.company,
                lab: l.labId,
                agreement_no: l.agreementNo,
                start: l.start,
                end: l.end,
                term_months: l.termMonths,
                deposit: l.deposit,
                monthly_rent: l.rent,
                status: l.state,
                days_left: l.daysLeft ?? "",
              })),
            )
          }
        >
          <Download className="size-3.5" /> CSV
        </Button>
      }
    >
      {fallback ?? (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Agreements" value={String(leases.length)} />
            <StatCard label="Due for renewal" value={String(expiring)} tone="warning" />
            <StatCard label="Expired" value={String(expired)} tone={expired ? "danger" : "positive"} />
            <StatCard label="End date missing" value={String(missing)} />
          </div>

          <Input
            className="h-9 w-full sm:w-80"
            placeholder="Search company, lab or agreement no"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          <div className="space-y-2">
            {filtered.map((l) => (
              <article key={l.incubateeId} className="surface-card p-4">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 sm:flex sm:flex-wrap sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <p className="truncate font-semibold">{l.company}</p>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${TONE[l.state]}`}
                      >
                        {label(l)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {[l.labId || "No lab", l.agreementNo && `Agmt ${l.agreementNo}`, l.termMonths && `${l.termMonths} months`]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {dateLabel(l.start)} → {dateLabel(l.end)} · rent {inr(l.rent)}
                      {l.deposit > 0 ? ` · deposit ${inr(l.deposit)}` : ""}
                    </p>
                  </div>
                  {l.phone && (
                    <Button size="sm" variant="outline" className="shrink-0" asChild>
                      <a
                        href={whatsappLink(l.phone, leaseReminderMessage(l, parkName))}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <MessageCircle className="size-3.5" /> Renewal reminder
                      </a>
                    </Button>
                  )}
                </div>
              </article>
            ))}
            {filtered.length === 0 && (
              <p className="surface-card p-8 text-center text-sm text-muted-foreground">
                No agreements here yet. Add agreement dates on the Tenants page.
              </p>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}
