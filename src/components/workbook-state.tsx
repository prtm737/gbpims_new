import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkbook } from "@/lib/use-app-data";
import type { Workbook } from "@/lib/sheets-schema";

export function useWorkbookState(): {
  wb: Workbook | null;
  role: string;
  url?: string;
  fallback: ReactNode | null;
  refetch: () => void;
  syncing: boolean;
  updatedAt: number;
  syncError: string | null;
} {
  const query = useWorkbook();
  const sync = {
    syncing: query.isFetching,
    updatedAt: query.dataUpdatedAt,
    syncError: query.error ? query.error.message : null,
  };

  if (query.isPending) {
    return {
      wb: null,
      role: "viewer",
      ...sync,
      fallback: (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ),
      refetch: query.refetch,
    };
  }

  // Only surface the error screen when we have nothing to show. If a cached copy
  // exists (session snapshot or previous fetch), keep rendering it and let the
  // sync indicator report the failure.
  if (query.error && !query.data?.data) {
    return {
      wb: null,
      role: "viewer",
      ...sync,
      fallback: (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-5">
          <h2 className="text-sm font-semibold text-destructive">Could not read the workbook</h2>
          <p className="mt-1 text-sm text-muted-foreground">{query.error.message}</p>
          <Button className="mt-4" size="sm" onClick={() => query.refetch()}>
            Retry
          </Button>
        </div>
      ),
      refetch: query.refetch,
    };
  }

  if (!query.data?.connected || !query.data.data) {
    return {
      wb: null,
      role: query.data?.role ?? "viewer",
      ...sync,
      fallback: (
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="font-display text-base font-semibold">Connect your Google Sheet</h2>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            This system stores all data in a Google Sheet your team owns. An admin needs to paste
            the spreadsheet link once — the tabs and headings are created automatically.
          </p>
          <Button asChild className="mt-4" size="sm">
            <Link to="/settings">Go to setup</Link>
          </Button>
        </div>
      ),
      refetch: query.refetch,
    };
  }

  return {
    wb: query.data.data,
    role: query.data.role,
    url: query.data.url,
    ...sync,
    fallback: null,
    refetch: query.refetch,
  };
}

export function canWrite(role: string) {
  return role === "admin" || role === "staff";
}

/** Staff can create new records (data entry) but not modify existing ones. */
export function canCreate(role: string) {
  return role === "admin" || role === "staff";
}

/** Only the super admin can edit or delete existing records. */
export function canEdit(role: string) {
  return role === "admin";
}

export function canDelete(role: string) {
  return role === "admin";
}
