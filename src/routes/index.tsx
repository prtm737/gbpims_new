import { createFileRoute, Link } from "@tanstack/react-router";
import { Building2, LineChart, ReceiptIndianRupee, Zap } from "lucide-react";

import { AppBackdrop } from "@/components/app-backdrop";
import { BrandLogo } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "GBPIMS | Guwahati Biotech Park Incubatee Management System" },
      {
        name: "description",
        content:
          "Staff portal for Guwahati Biotech Park: 26 modular labs, monthly rent, electricity billing and payment tracking in one dashboard.",
      },
      { property: "og:title", content: "GBPIMS | Guwahati Biotech Park Incubatee Management System" },
      {
        property: "og:description",
        content: "Staff portal for Guwahati Biotech Park: 26 modular labs, monthly rent, electricity billing and payment tracking in one dashboard.",
      },
    ],
  }),
  component: Landing,
});

const FEATURES = [
  {
    icon: Building2,
    title: "26 modular labs",
    text: "Live occupancy grid with allotment and notice tracking.",
  },
  {
    icon: ReceiptIndianRupee,
    title: "Monthly rent",
    text: "Generate invoices in one tap, record part payments, chase arrears.",
  },
  {
    icon: Zap,
    title: "Electricity billing",
    text: "Multi-meter readings, fixed charges, arrears and A4 PDF invoices.",
  },
  {
    icon: LineChart,
    title: "Reports",
    text: "Collections, arrears and occupancy, exportable to CSV.",
  },
];

function Landing() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-sidebar text-sidebar-foreground">
      <AppBackdrop variant="feature" />
      <div className="relative mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-8">
        <header className="flex items-center justify-between">
          <div>
            <BrandLogo />
            <p className="mt-2 text-[11px] tracking-[0.18em] text-sidebar-foreground/60 uppercase">
              GBPIMS · Incubatee management system
            </p>
          </div>
          <Button
            asChild
            size="sm"
            className="bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90"
          >
            <Link to="/auth">Staff sign in</Link>
          </Button>
        </header>

        <section className="flex flex-1 flex-col justify-center py-14">
          <p className="text-xs font-semibold tracking-[0.2em] text-sidebar-primary uppercase">
            Single window operations
          </p>
          <h1 className="mt-4 max-w-2xl text-4xl leading-tight font-bold text-white sm:text-5xl">
            Every lab, every rupee of rent and power — on one screen.
          </h1>
          <p className="mt-4 max-w-xl text-sm text-sidebar-foreground/75 sm:text-base">
            Occupancy, monthly rent, electricity bills and payments for all 26 modular labs, stored
            in your own Google Sheet so the team can open the data any time.
          </p>
          <div className="mt-8">
            <Button
              asChild
              size="lg"
              className="bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90"
            >
              <Link to="/auth">Open the dashboard</Link>
            </Button>
          </div>

          <div className="mt-14 grid gap-4 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="rounded-lg border border-sidebar-border bg-sidebar-accent/40 p-4"
              >
                <f.icon className="size-5 text-sidebar-primary" />
                <h2 className="mt-3 text-sm font-semibold text-white">{f.title}</h2>
                <p className="mt-1 text-xs text-sidebar-foreground/70">{f.text}</p>
              </div>
            ))}
          </div>
        </section>

        <footer className="border-t border-sidebar-border pt-4 text-[11px] text-sidebar-foreground/50">
          Internal use only. Access is restricted to park staff accounts.
        </footer>
      </div>
    </div>
  );
}
