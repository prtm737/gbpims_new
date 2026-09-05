import { CloudOff, RefreshCw } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function ago(updatedAt: number): string {
  if (!updatedAt) return "not synced yet";
  const secs = Math.max(0, Math.round((Date.now() - updatedAt) / 1000));
  if (secs < 10) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  return `${Math.round(mins / 60)} h ago`;
}

/** Plain-language reason for the most common sheet sync conflicts. */
function conflictHint(error: string): string {
  const e = error.toLowerCase();
  if (e.includes("429") || e.includes("quota") || e.includes("limit"))
    return "Google Sheets hit its read limit for the minute. The app is showing the last saved copy and will retry shortly.";
  if (e.includes("401") || e.includes("403") || e.includes("permission"))
    return "The sheet rejected access. Check that the service account still has editor rights on the spreadsheet.";
  if (e.includes("404") || e.includes("not found"))
    return "The linked spreadsheet or one of its tabs could not be found. Re-check the sheet link in Settings.";
  if (e.includes("network") || e.includes("fetch") || e.includes("timeout"))
    return "The connection to Google dropped mid-sync. Your local copy is intact — retry when you have signal.";
  return "The sheet could not be read on the last attempt. Any change you make now is written straight to the sheet once the sync recovers.";
}

/** Live Google Sheets sync indicator with a manual refresh and conflict details. */
export function SyncStatus({
  syncing,
  updatedAt,
  error,
  onRefresh,
  className,
}: {
  syncing: boolean;
  updatedAt: number;
  error?: string | null;
  onRefresh: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const tone = error
    ? "border-destructive/40 bg-destructive/10 text-destructive"
    : syncing
      ? "border-primary/40 bg-primary/10 text-primary"
      : "border-border bg-card/80 text-muted-foreground";

  return (
    <div className={cn("relative", className)}>
      <div
        className={cn(
          "flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-medium",
          tone,
        )}
      >
        {error ? (
          <CloudOff className="size-3.5" />
        ) : (
          <span
            className={cn(
              "size-2 rounded-full",
              syncing ? "animate-pulse bg-primary" : "bg-emerald-500",
            )}
          />
        )}
        <button
          type="button"
          className="whitespace-nowrap underline-offset-2 hover:underline"
          onClick={() => setOpen((v) => !v)}
        >
          {error ? "Sheet sync conflict" : syncing ? "Syncing sheet…" : `Sheet synced ${ago(updatedAt)}`}
        </button>
        <Button
          size="icon"
          variant="ghost"
          className="size-6 rounded-full"
          aria-label="Refresh from Google Sheets"
          onClick={onRefresh}
        >
          <RefreshCw className={cn("size-3.5", syncing && "animate-spin")} />
        </Button>
      </div>

      {open && (
        <div className="surface-card absolute right-0 z-30 mt-2 w-[min(20rem,80vw)] space-y-2 p-3.5 text-left shadow-lg">
          <p className="text-xs font-semibold">Sync details</p>
          <dl className="space-y-1 text-[11px] text-muted-foreground">
            <div className="flex justify-between gap-3">
              <dt>State</dt>
              <dd className="font-medium text-foreground">
                {error ? "Conflict" : syncing ? "Syncing" : "Up to date"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Last successful read</dt>
              <dd className="font-medium text-foreground">
                {updatedAt ? new Date(updatedAt).toLocaleString() : "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Source</dt>
              <dd className="font-medium text-foreground">
                {error ? "Cached copy" : "Google Sheet"}
              </dd>
            </div>
          </dl>
          {error && (
            <>
              <p className="text-[11px] text-muted-foreground">{conflictHint(error)}</p>
              <p className="rounded-md bg-muted/60 p-2 font-mono text-[10px] break-words">
                {error}
              </p>
            </>
          )}
          <Button size="sm" variant="outline" className="w-full" onClick={onRefresh}>
            <RefreshCw className={cn("size-3.5", syncing && "animate-spin")} /> Retry sync now
          </Button>
        </div>
      )}
    </div>
  );
}
