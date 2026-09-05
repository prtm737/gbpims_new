import { useServerFn } from "@tanstack/react-start";
import { CheckCheck, Download, MessageCircle, ReceiptIndianRupee, Zap } from "lucide-react";
import { useState } from "react";

import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { reminderMessage, whatsappLink, type DueRow } from "@/lib/derive";
import { recordPaymentFn } from "@/lib/gbp.functions";
import { downloadPdf } from "@/lib/pdf";
import { billPdfDoc } from "@/lib/pdf-docs";
import { inr, monthLabel } from "@/lib/sheets-schema";
import { useSheetMutation } from "@/lib/use-app-data";

export function DuesTable({
  rows,
  canWrite,
  onPay,
  parkName,
}: {
  rows: DueRow[];
  canWrite: boolean;
  onPay: (due: DueRow) => void;
  parkName: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const markPaid = useSheetMutation(useServerFn(recordPaymentFn), "Marked as paid");

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        Nothing here yet.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => {
        const key = `${row.kind}-${row.id}`;
        return (
          <div
            key={key}
            className="surface-card flex flex-wrap items-center justify-between gap-3 p-3.5 transition-all hover:-translate-y-px hover:shadow-[var(--shadow-elevated-value)]"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span
                className={
                  "flex size-9 shrink-0 items-center justify-center rounded-lg " +
                  (row.kind === "rent" ? "bg-primary/12 text-primary" : "bg-accent/15 text-accent")
                }
              >
                {row.kind === "rent" ? (
                  <ReceiptIndianRupee className="size-4" />
                ) : (
                  <Zap className="size-4" />
                )}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{row.company}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {row.labId || "—"} · {row.kind === "rent" ? "Rent" : "Electricity"} ·{" "}
                  {monthLabel(row.month)}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <div className="text-right">
                <p className="font-display text-sm font-bold">{inr(row.balance)}</p>
                <p className="text-[11px] text-muted-foreground">of {inr(row.amount)}</p>
              </div>
              <StatusBadge status={row.status} />
              <Button
                variant="outline"
                size="icon"
                aria-label="Download bill PDF"
                title="Download bill PDF"
                onClick={() => downloadPdf(billPdfDoc(row, parkName))}
              >
                <Download className="size-4" />
              </Button>
              {row.phone && row.balance > 0 && (
                <Button asChild variant="outline" size="icon" aria-label="Send WhatsApp reminder">
                  <a
                    href={whatsappLink(row.phone, reminderMessage(row, parkName))}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <MessageCircle className="size-4" />
                  </a>
                </Button>
              )}
              {canWrite && row.balance > 0 && (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy === key && markPaid.isPending}
                    title="Mark the full balance as received"
                    onClick={() => {
                      setBusy(key);
                      markPaid.mutate({
                        data: {
                          type: row.kind,
                          ref_id: row.id,
                          incubatee_id: row.incubateeId,
                          amount: row.balance,
                          date: new Date().toISOString().slice(0, 10),
                          mode: "manual",
                          notes: "Marked paid from dashboard",
                        },
                      });
                    }}
                  >
                    <CheckCheck className="size-4" /> Mark paid
                  </Button>
                  <Button size="sm" onClick={() => onPay(row)}>
                    Pay
                  </Button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
