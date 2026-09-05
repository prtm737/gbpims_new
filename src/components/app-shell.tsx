import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  Building2,
  ExternalLink,
  FileSignature,
  LayoutDashboard,
  ListChecks,
  LogOut,
  MoreHorizontal,
  ReceiptIndianRupee,
  Settings,
  Users,
  Zap,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { AppBackdrop } from "@/components/app-backdrop";
import { BrandLogo } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { authClient } from "@/lib/auth-client";
import { useMe } from "@/lib/use-app-data";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/dashboard", label: "Home", icon: LayoutDashboard },
  { to: "/labs", label: "Spaces", icon: Building2 },
  { to: "/incubatees", label: "Tenants", icon: Users },
  { to: "/leases", label: "Leases", icon: FileSignature },
  { to: "/rent", label: "Rent", icon: ReceiptIndianRupee },
  { to: "/billing", label: "Electricity", icon: Zap },
  { to: "/ledger", label: "Ledger", icon: ListChecks },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/settings", label: "Setup", icon: Settings },
] as const;

// Five primary destinations stay on the mobile tab bar; the rest live in "More"
// so every tap target keeps a comfortable size.
const MOBILE_PRIMARY = ["/dashboard", "/labs", "/incubatees", "/rent", "/billing"] as const;

export function AppShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { data: me } = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [moreOpen, setMoreOpen] = useState(false);

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await authClient.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const sheetUrl = me?.workbook.connected ? me.workbook.url : undefined;

  return (
    <div className="relative isolate min-h-screen overflow-x-clip bg-background lg:flex">
      <AppBackdrop />
      <aside className="gradient-hero sticky top-0 isolate z-10 hidden h-screen w-64 shrink-0 flex-col overflow-hidden px-3 py-5 text-sidebar-foreground lg:flex">
        <AppBackdrop variant="feature" />
        <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="px-1 pb-6">
          <BrandLogo />
          <p className="mt-2 px-1 text-[10px] tracking-[0.16em] text-sidebar-foreground/55 uppercase">
            GBPIMS · Incubatee management
          </p>
        </div>
        <nav className="-mr-1 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                pathname === item.to
                  ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_2px_0_0_0_var(--sidebar-primary)]"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
              )}
            >
              <item.icon className="size-4" />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-3 shrink-0 space-y-2 border-t border-sidebar-border pt-3">
          {sheetUrl && (
            <a
              href={sheetUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium text-sidebar-foreground/70 hover:text-sidebar-accent-foreground"
            >
              <ExternalLink className="size-3.5" /> Open Google Sheet
            </a>
          )}
          <div className="px-3">
            <p className="truncate text-xs text-sidebar-foreground/70">{me?.email}</p>
            <p className="text-[11px] tracking-wide text-sidebar-primary uppercase">{me?.role}</p>
          </div>
          <button
            onClick={signOut}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs font-medium text-sidebar-foreground/70 hover:text-sidebar-accent-foreground"
          >
            <LogOut className="size-3.5" /> Sign out
          </button>
        </div>
        </div>
      </aside>

      <div className="relative z-10 flex min-w-0 flex-1 flex-col pb-24 lg:pb-0">
        <header className="sticky top-0 z-20 border-b border-border bg-background/92 backdrop-blur-xl">
          <div className="flex items-start justify-between gap-3 px-4 py-4 lg:px-8 lg:py-5">
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold lg:text-[1.75rem]">{title}</h1>
              {subtitle && (
                <p className="mt-0.5 truncate text-xs text-muted-foreground lg:text-sm">
                  {subtitle}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {actions}
              {sheetUrl && (
                <Button
                  asChild
                  variant="ghost"
                  size="icon"
                  className="lg:hidden"
                  aria-label="Open Google Sheet"
                >
                  <a href={sheetUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="size-4" />
                  </a>
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                onClick={signOut}
                aria-label="Sign out"
              >
                <LogOut className="size-4" />
              </Button>
            </div>
          </div>
        </header>

        <main className="relative z-10 flex-1 px-4 py-4 lg:px-8 lg:py-6">{children}</main>
      </div>

      <nav className="fixed right-0 bottom-0 left-0 z-30 grid grid-cols-6 border-t border-border bg-card/97 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_-18px_oklch(0.3_0.05_200/0.5)] backdrop-blur-xl lg:hidden">
        {NAV.filter((item) => MOBILE_PRIMARY.includes(item.to as (typeof MOBILE_PRIMARY)[number])).map(
          (item) => (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 px-0.5 text-center text-[11px] leading-tight font-medium transition-colors active:bg-muted",
                pathname === item.to ? "text-primary" : "text-muted-foreground",
              )}
            >
              <item.icon className="size-5 shrink-0" />
              <span className="w-full truncate">{item.label}</span>
            </Link>
          ),
        )}
        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetTrigger
            className={cn(
              "flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 px-0.5 text-center text-[11px] leading-tight font-medium transition-colors active:bg-muted",
              MOBILE_PRIMARY.includes(pathname as (typeof MOBILE_PRIMARY)[number])
                ? "text-muted-foreground"
                : "text-primary",
            )}
            aria-label="More sections"
          >
            <MoreHorizontal className="size-5 shrink-0" />
            <span className="w-full truncate">More</span>
          </SheetTrigger>
          <SheetContent side="bottom" className="rounded-t-2xl">
            <SheetHeader>
              <SheetTitle>All sections</SheetTitle>
            </SheetHeader>
            <div className="grid grid-cols-2 gap-2 p-4 pt-0">
              {NAV.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setMoreOpen(false)}
                  className={cn(
                    "flex min-h-12 items-center gap-2.5 rounded-lg border border-border px-3 text-sm font-medium",
                    pathname === item.to
                      ? "border-primary bg-primary/10 text-primary"
                      : "text-foreground",
                  )}
                >
                  <item.icon className="size-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </Link>
              ))}
            </div>
          </SheetContent>
        </Sheet>
      </nav>
    </div>
  );
}
