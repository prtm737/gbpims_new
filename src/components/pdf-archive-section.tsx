import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, FileText, Receipt, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { getPdfDownloadUrlFn, listPdfArchiveFn } from "@/lib/gbp.functions";
import { PDF_ARCHIVE_EVENT, type ArchivedPdfLike } from "@/lib/pdf-archive-shared";

const KIND_META: Record<
  string,
  { label: string; icon: typeof Zap; className: string }
> = {
  electricity: {
    label: "Electricity",
    icon: Zap,
    className: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  },
  rent: {
    label: "Rent",
    icon: FileText,
    className: "bg-primary/10 text-primary border-primary/30",
  },
  receipt: {
    label: "Receipt",
    icon: Receipt,
    className: "bg-sky-500/10 text-sky-600 border-sky-500/30",
  },
};

function prettyName(name: string): string {
  return name.replace(/\.pdf$/i, "").replace(/_/g, " · ");
}

function prettySize(size: number): string {
  return size > 1024 * 1024
    ? `${(size / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(size / 1024))} KB`;
}

/** Month-wise archive of every bill/invoice/receipt PDF stored in Supabase. */
export function PdfArchiveSection() {
  const listFn = useServerFn(listPdfArchiveFn);
  const urlFn = useServerFn(getPdfDownloadUrlFn);
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [openMonth, setOpenMonth] = useState<string | null>(null);

  const files = useQuery({
    queryKey: ["pdf-archive"],
    queryFn: () => listFn() as Promise<{ files: ArchivedPdfLike[] }>,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const refresh = () => queryClient.invalidateQueries({ queryKey: ["pdf-archive"] });
    window.addEventListener(PDF_ARCHIVE_EVENT, refresh);
    return () => window.removeEventListener(PDF_ARCHIVE_EVENT, refresh);
  }, [queryClient]);

  const months = useMemo(() => {
    const all = files.data?.files ?? [];
    const byMonth = new Map<string, ArchivedPdfLike[]>();
    for (const f of all) {
      const list = byMonth.get(f.month) ?? [];
      list.push(f);
      byMonth.set(f.month, list);
    }
    return [...byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [files.data]);

  async function download(path: string) {
    setBusy(path);
    try {
      const out = (await urlFn({ data: { path } })) as { url: string };
      window.open(out.url, "_blank", "noopener");
    } catch (err) {
      files.refetch();
      throw err;
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="surface-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h2 className="font-display text-base font-semibold">Stored PDFs</h2>
          <p className="text-xs text-muted-foreground">
            Every bill, invoice and receipt you download is saved here month-wise —
            re-download any time.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={files.isFetching}
          onClick={() => files.refetch()}
        >
          {files.isFetching ? "Loading…" : "Refresh"}
        </Button>
      </div>

      {months.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          {files.isLoading
            ? "Loading stored PDFs…"
            : "No stored PDFs yet — download any bill or receipt and it is saved here automatically."}
        </p>
      ) : (
        <div className="divide-y divide-border">
          {months.map(([month, list]) => {
            const open = openMonth === month;
            return (
              <div key={month}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
                  onClick={() => setOpenMonth(open ? null : month)}
                >
                  <span className="font-semibold">
                    {new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1).toLocaleDateString("en-IN", {
                      month: "long",
                      year: "numeric",
                    })}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {list.length} PDF{list.length === 1 ? "" : "s"} {open ? "▲" : "▼"}
                  </span>
                </button>
                {open && (
                  <div className="divide-y divide-border border-t border-border bg-muted/20">
                    {list.map((f) => {
                      const meta = KIND_META[f.kind] ?? KIND_META["receipt"]!;
                      const Icon = meta.icon;
                      return (
                        <div
                          key={f.path}
                          className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{prettyName(f.name)}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {prettySize(f.size)}
                              {f.updatedAt
                                ? ` · stored ${new Date(f.updatedAt).toLocaleDateString("en-IN")}`
                                : ""}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <span
                              className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${meta.className}`}
                            >
                              <Icon className="size-3" />
                              {meta.label}
                            </span>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy === f.path}
                              onClick={() => void download(f.path)}
                            >
                              <Download className="size-3.5" />
                              {busy === f.path ? "Opening…" : "Download"}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
