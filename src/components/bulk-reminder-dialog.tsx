import { ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { reminderMessage, whatsappLink } from "@/lib/derive";
import { cn } from "@/lib/utils";

export type BulkReminderRow = {
  id: string;
  kind: "rent" | "electricity";
  company: string;
  month: string;
  amount: number;
  paid: number;
  balance: number;
  dueDate: string;
  phone: string;
};

/**
 * Bulk payment reminders: walks through every selected due one by one,
 * opening WhatsApp with the amount and month pre-filled. One tap per tenant
 * keeps it personal instead of one giant blast.
 */
export function BulkReminderDialog({
  rows,
  parkName,
  onClose,
}: {
  rows: BulkReminderRow[];
  parkName: string;
  onClose: () => void;
}) {
  const pending = useMemo(
    () => rows.filter((r) => r.balance > 0 && (r.phone ?? "").trim() !== ""),
    [rows],
  );
  const noPhone = useMemo(
    () => rows.filter((r) => r.balance > 0 && (r.phone ?? "").trim() === ""),
    [rows],
  );
  const [sent, setSent] = useState<string[]>([]);

  function open(row: BulkReminderRow) {
    const phone = (row.phone ?? "").replace(/[^\d]/g, "");
    window.open(whatsappLink(phone, reminderMessage(row, parkName)), "_blank", "noopener");
    setSent((s) => (s.includes(row.id) ? s : [...s, row.id]));
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[85dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Send payment reminders</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          WhatsApp opens with the bill details already typed — check and press send. The
          next tenant opens automatically after each one.
        </p>
        {pending.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nothing to remind — every selected due is either paid or has no phone number.
          </p>
        )}
        <ul className="space-y-1.5">
          {pending.map((r, i) => (
            <li
              key={r.id}
              className={cn(
                "animate-fade-up flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2",
                sent.includes(r.id) && "border-primary/30 bg-primary/5",
              )}
              style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{r.company}</span>
                <span className="block text-xs text-muted-foreground">
                  {r.kind === "rent" ? "Rent" : "Electricity"} · {r.month} ·{" "}
                  {r.balance.toFixed(0)} due
                </span>
              </span>
              {sent.includes(r.id) ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => open(r)}
                  className="shrink-0 text-primary"
                >
                  <ExternalLink className="size-3.5" /> Again
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => open(r)} className="shrink-0">
                  Open WhatsApp
                </Button>
              )}
            </li>
          ))}
          {noPhone.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-border px-3 py-2 opacity-60"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{r.company}</span>
                <span className="block text-xs text-muted-foreground">No phone number on record</span>
              </span>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
