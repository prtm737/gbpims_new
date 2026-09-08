import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArchiveRestore, ExternalLink, Loader2, ScanSearch } from "lucide-react";
import { useState } from "react";

import { AppShell } from "@/components/app-shell";
import { useWorkbookState } from "@/components/workbook-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  backupNowFn,
  connectSheet,
  formatWorkbookFn,
  getBackupDownloadUrlFn,
  listBackupsFn,
  listStaffFn,
  restoreMissingRowsFn,
  saveSettingsFn,
  scanMissingRowsFn,
  setUserRoleFn,
} from "@/lib/gbp.functions";
import { DEFAULT_SETTINGS } from "@/lib/sheets-schema";
import { useMe, useSheetMutation } from "@/lib/use-app-data";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Setup | GBPIMS" },
      {
        name: "description",
        content:
          "Connect the Google Sheet backend, set rent and electricity rates, manage staff access.",
      },
      { property: "og:title", content: "Setup | GBPIMS" },
      { property: "og:description", content: "Workbook, billing rates and staff roles." },
    ],
  }),
  component: SettingsPage,
});

const SETTING_LABELS: Record<string, string> = {
  park_name: "Park name",
  park_address: "Park address (printed on invoices)",
  park_phone: "Office phone",
  park_email: "Office email",
  rent_rate_per_sqft: "Rent rate (₹ per sqft / month)",
  default_monthly_rent: "Fallback rent when area is unknown (₹)",
  rent_due_day: "Rent due day of month",
  lease_reminder_days: "Lease renewal reminder window (days)",
  currency_symbol: "Currency symbol",
  maintenance_rate_per_sqft: "Maintenance charge (₹ per sqft / month)",
  maintenance_pct: "Maintenance fallback (% of rent, when area unknown)",
  cgst_pct: "CGST (%)",
  sgst_pct: "SGST (%)",
  invoice_series: "Rent invoice series",
  tariff_rate: "Electricity rate (₹ per unit)",
  fixed_charge_rate: "Fixed charge rate (₹ per kW)",
  electricity_duty_pct: "Electricity duty (% of energy + fixed)",
  ac_fixed_charge: "Default AC fixed charge (₹)",
  late_surcharge_pct: "Late payment surcharge (%)",
  bank_name: "Bank name",
  bank_account_name: "Account name",
  bank_account_no: "Account number",
  bank_ifsc: "IFSC code",
  upi_id: "UPI ID",
  prepared_by: "Invoice prepared by",
};

function SettingsPage() {
  const { data: me } = useMe();
  const { wb, url, fallback } = useWorkbookState();
  const isAdmin = me?.role === "admin";
  const [link, setLink] = useState("");

  const connect = useSheetMutation(useServerFn(connectSheet), "Workbook connected and initialised");
  const formatWorkbook = useSheetMutation(
    useServerFn(formatWorkbookFn),
    "Workbook colours and layout refreshed",
  );
  const saveSettings = useSheetMutation(useServerFn(saveSettingsFn), "Settings saved");
  const setRole = useSheetMutation(useServerFn(setUserRoleFn), "Role updated");
  const listStaff = useServerFn(listStaffFn);
  const staff = useQuery({
    queryKey: ["staff"],
    queryFn: () => listStaff(),
    enabled: Boolean(isAdmin),
    retry: false,
  });

  const connected = Boolean(me?.workbook.connected);
  const values = { ...DEFAULT_SETTINGS, ...(wb?.settings ?? {}) };

  return (
    <AppShell title="Setup" subtitle="Workbook, billing rates and staff access">
      <div className="space-y-6">
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="font-display text-sm font-semibold">Google Sheet backend</h2>
          {connected ? (
            <div className="mt-2 space-y-3">
              <p className="text-sm text-muted-foreground">
                Connected. All labs, incubatees, invoices and payments live in this spreadsheet.
              </p>
              <div className="flex flex-wrap gap-2">
                {(url ?? me?.workbook.url) && (
                  <Button asChild variant="outline" size="sm">
                    <a href={url ?? me?.workbook.url} target="_blank" rel="noreferrer">
                      <ExternalLink className="size-4" /> Open spreadsheet
                    </a>
                  </Button>
                )}
                {isAdmin && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => formatWorkbook.mutate({ data: undefined })}
                    disabled={formatWorkbook.isPending}
                  >
                    {formatWorkbook.isPending ? "Formatting…" : "Format workbook"}
                  </Button>
                )}
              </div>
            </div>
          ) : isAdmin ? (
            <form
              className="mt-3 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                connect.mutate({ data: { link } });
              }}
            >
              <p className="text-sm text-muted-foreground">
                Create a blank Google Sheet, share it with edit access to the connected Google
                account, and paste its link below. The six tabs are created automatically.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="link">Spreadsheet link or ID</Label>
                <Input
                  id="link"
                  required
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/…"
                />
              </div>
              <Button type="submit" disabled={connect.isPending}>
                {connect.isPending ? "Connecting…" : "Connect workbook"}
              </Button>
            </form>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              Not connected yet. Ask an admin to link the office spreadsheet.
            </p>
          )}
        </section>

        {connected && (
          <BackupsCard isAdmin={isAdmin} />
        )}

        {connected && isAdmin && (
          <RecoveryCard />
        )}

        {connected && (
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="font-display text-sm font-semibold">Billing defaults</h2>
            {fallback ? (
              <div className="mt-3">{fallback}</div>
            ) : (
              <form
                className="mt-3 space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  const next: Record<string, string> = {};
                  for (const key of Object.keys(SETTING_LABELS)) {
                    const value = String(f.get(key) ?? "").trim();
                    // Blank fields keep the current/default value instead of wiping the rate.
                    if (value !== "") next[key] = value;
                  }
                  saveSettings.mutate({ data: { values: next } });
                }}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  {Object.entries(SETTING_LABELS).map(([key, label]) => (
                    <div key={key} className="space-y-1.5">
                      <Label htmlFor={key}>{label}</Label>
                      <Input
                        id={key}
                        key={values[key] ?? ""}
                        name={key}
                        defaultValue={values[key] ?? ""}
                        maxLength={200}
                        disabled={!isAdmin}
                      />
                    </div>
                  ))}
                </div>
                {isAdmin && (
                  <Button type="submit" disabled={saveSettings.isPending}>
                    {saveSettings.isPending ? "Saving…" : "Save settings"}
                  </Button>
                )}
              </form>
            )}
          </section>
        )}

        {isAdmin && (
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="font-display text-sm font-semibold">Staff access</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Admins manage everything, staff can bill and record payments, viewers are read-only.
            </p>
            <ul className="mt-3 divide-y divide-border">
              {(staff.data ?? []).map((person) => (
                <li key={person.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {person.fullName || person.email}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{person.email}</p>
                  </div>
                  <Select
                    value={person.role}
                    onValueChange={(role) =>
                      setRole.mutate({
                        data: { userId: person.id, role: role as "admin" | "staff" | "viewer" },
                      })
                    }
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["admin", "staff", "viewer"].map((r) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </li>
              ))}
              {staff.data?.length === 0 && (
                <li className="py-3 text-sm text-muted-foreground">No staff accounts yet.</li>
              )}
            </ul>
          </section>
        )}
      </div>
    </AppShell>
  );
}

/** Daily automatic workbook backups stored in Supabase, with manual download. */
function BackupsCard({ isAdmin }: { isAdmin: boolean }) {
  const listFn = useServerFn(listBackupsFn);
  const urlFn = useServerFn(getBackupDownloadUrlFn);
  const backupNow = useSheetMutation(useServerFn(backupNowFn), "Backup created");
  const files = useQuery({
    queryKey: ["backups"],
    queryFn: () => listFn() as Promise<{ files: { path: string; day: string; size: number; updatedAt: string }[] }>,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const [busy, setBusy] = useState<string | null>(null);

  async function download(path: string) {
    setBusy(path);
    try {
      const out = (await urlFn({ data: { path } })) as { url: string };
      window.open(out.url, "_blank", "noopener");
    } finally {
      setBusy(null);
    }
  }

  const list = files.data?.files ?? [];
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-sm font-semibold">Data backups</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            A full copy of every tab is saved here automatically each day (90 days kept).
          </p>
        </div>
        {isAdmin && (
          <Button
            size="sm"
            variant="outline"
            disabled={backupNow.isPending}
            onClick={() => backupNow.mutate({ data: undefined })}
          >
            {backupNow.isPending ? "Backing up…" : "Back up now"}
          </Button>
        )}
      </div>
      {list.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {files.isLoading ? "Checking for backups…" : "No backups yet — the first one appears within a day of opening the app."}
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {list.map((f) => (
            <li key={f.path} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 text-sm">
                <span className="font-medium">{f.day}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {f.size > 1024 * 1024
                    ? `${(f.size / (1024 * 1024)).toFixed(1)} MB`
                    : `${Math.max(1, Math.round(f.size / 1024))} KB`}
                </span>
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={busy === f.path}
                onClick={() => void download(f.path)}
              >
                {busy === f.path ? "Opening…" : "Download"}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type RecoveryReport = {
  backupDays: string[];
  scannedBackups: number;
  missing: { tab: string; id: string; summary: string; backupDay: string }[];
  error?: string;
};

/** Compares the live sheet with the daily backups and restores anything lost. */
function RecoveryCard() {
  const queryClient = useQueryClient();
  const scanFn = useServerFn(scanMissingRowsFn);
  const restoreFn = useServerFn(restoreMissingRowsFn);
  const [report, setReport] = useState<RecoveryReport | null>(null);
  const [scanning, setScanning] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [scanError, setScanError] = useState("");

  async function scan() {
    setScanning(true);
    setScanError("");
    try {
      const out = (await scanFn()) as RecoveryReport;
      setReport(out);
      if (out.error) setScanError(out.error);
    } catch (err) {
      setScanError((err as Error).message);
    } finally {
      setScanning(false);
    }
  }

  async function restoreAll() {
    if (!report || report.missing.length === 0) return;
    if (
      !confirm(
        `Restore ${report.missing.length} missing row(s) from the backups into the live sheet?`,
      )
    )
      return;
    setRestoring(true);
    try {
      const out = (await restoreFn({
        data: {
          ids: report.missing.map((m) => ({
            tab: m.tab as
              | "ledger"
              | "rent"
              | "labs"
              | "incubatees"
              | "clients"
              | "payments",
            id: m.id,
          })),
        },
      })) as { restored: number; stillMissing: string[] };
      if (out.restored > 0) {
        toast.success(`Restored ${out.restored} row(s) into the sheet`);
      } else {
        toast.info("Nothing needed restoring — the sheet already has those rows.");
      }
      if (out.stillMissing.length > 0) {
        toast.warning(
          `${out.stillMissing.length} row(s) could not be found in any backup: ${out.stillMissing.slice(0, 5).join(", ")}${out.stillMissing.length > 5 ? "…" : ""}`,
        );
      }
      setReport(null);
      // Pull the freshly restored rows into every page immediately.
      await queryClient.invalidateQueries({ queryKey: ["workbook"] });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setRestoring(false);
    }
  }

  return (
    <section className="rounded-lg border border-amber-500/30 bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-sm font-semibold flex items-center gap-2">
            <ArchiveRestore className="size-4 text-amber-500" />
            Recover lost rows
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Compares every daily backup against the live sheet and restores rows that went
            missing (bills, invoices, tenants, clients…). Read-only until you press restore.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={scanning || restoring}
          onClick={() => void scan()}
        >
          {scanning ? <Loader2 className="mr-1 size-4 animate-spin" /> : <ScanSearch className="mr-1 size-4" />}
          {scanning ? "Scanning backups…" : "Scan for lost rows"}
        </Button>
      </div>
      {scanError && (
        <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
          {scanError}
        </p>
      )}
      {report && !scanError && (
        <div className="mt-3">
          <p className="text-xs text-muted-foreground">
            Scanned {report.scannedBackups} backup file(s) across {report.backupDays.length} day(s).
          </p>
          {report.missing.length === 0 ? (
            <p className="mt-2 rounded-md border border-primary/25 bg-primary/5 p-3 text-sm">
              ✅ No lost rows found — the live sheet contains everything the backups do.
            </p>
          ) : (
            <>
              <ul className="mt-2 max-h-64 divide-y divide-border overflow-y-auto rounded-md border border-border">
                {report.missing.map((m) => (
                  <li key={`${m.tab}:${m.id}`} className="px-3 py-2 text-sm">
                    <span className="font-medium">{m.id}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {m.tab} · from backup {m.backupDay} · {m.summary}
                    </span>
                  </li>
                ))}
              </ul>
              <Button className="mt-3" size="sm" disabled={restoring} onClick={() => void restoreAll()}>
                {restoring ? <Loader2 className="mr-1 size-4 animate-spin" /> : <ArchiveRestore className="mr-1 size-4" />}
                {restoring
                  ? "Restoring…"
                  : `Restore ${report.missing.length} row(s) into the sheet`}
              </Button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
