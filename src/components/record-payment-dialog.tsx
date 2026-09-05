import { useServerFn } from "@tanstack/react-start";
import { Check, MessageCircle, Copy, Download } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { acknowledgementMessage, whatsappLink, type DueRow } from "@/lib/derive";
import { recordPaymentFn } from "@/lib/gbp.functions";
import { downloadPdf, type PdfDoc } from "@/lib/pdf";
import { receiptPdfDoc } from "@/lib/pdf-docs";
import { inr } from "@/lib/sheets-schema";
import { useSheetMutation } from "@/lib/use-app-data";

type Ack = {
  message: string;
  phone: string;
  amount: number;
  balance: number;
  receiptId: string;
  company: string;
  pdf: PdfDoc;
};

export function RecordPaymentDialog({
  due,
  onClose,
  parkName = "Guwahati Biotech Park",
}: {
  due: DueRow | null;
  onClose: () => void;
  parkName?: string;
}) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [mode, setMode] = useState("upi");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [ack, setAck] = useState<Ack | null>(null);

  const record = useSheetMutation(useServerFn(recordPaymentFn), "Payment recorded");

  const open = due !== null;
  const balance = due?.balance ?? 0;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!due) return;
    const value = Number(amount || balance);
    if (!Number.isFinite(value) || value <= 0) return;
    record.mutate(
      {
        data: {
          type: due.kind,
          ref_id: due.id,
          incubatee_id: due.incubateeId,
          amount: value,
          date,
          mode,
          reference,
          notes,
        },
      },
      {
        onSuccess: (out) => {
          setAck({
            company: due.company,
            phone: due.phone,
            amount: value,
            balance: out.balance,
            receiptId: out.paymentId,
            pdf: receiptPdfDoc({
              receiptId: out.paymentId,
              parkName,
              company: due.company,
              phone: due.phone,
              labId: due.labId,
              month: due.month,
              kind: due.kind,
              amount: value,
              balance: out.balance,
              date,
              mode,
              reference,
            }),
            message: acknowledgementMessage({
              company: due.company,
              kind: due.kind,
              month: due.month,
              labId: due.labId,
              amount: value,
              balance: out.balance,
              date,
              mode,
              reference,
              receiptId: out.paymentId,
              parkName,
            }),
          });
          setAmount("");
          setReference("");
          setNotes("");
          onClose();
        },
      },
    );
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record payment</DialogTitle>
            <DialogDescription>
              {due
                ? `${due.company} · ${due.kind === "rent" ? "Rent" : "Electricity"} ${due.month} · balance ${inr(balance)}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="pay-amount">Amount</Label>
                <Input
                  id="pay-amount"
                  type="number"
                  min="1"
                  step="0.01"
                  placeholder={String(balance)}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pay-date">Date</Label>
                <Input
                  id="pay-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Mode</Label>
              <Select value={mode} onValueChange={setMode}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["upi", "neft", "cheque", "cash", "other"].map((m) => (
                    <SelectItem key={m} value={m}>
                      {m.toUpperCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-ref">Reference / UTR</Label>
              <Input
                id="pay-ref"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                maxLength={80}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-notes">Notes</Label>
              <Textarea
                id="pay-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={300}
                rows={2}
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={record.isPending}>
                {record.isPending ? "Saving…" : "Save payment"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={ack !== null} onOpenChange={(v) => !v && setAck(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Check className="size-5" />
            </div>
            <DialogTitle className="text-center">Payment acknowledged</DialogTitle>
            <DialogDescription className="text-center">
              {ack
                ? `${inr(ack.amount)} received from ${ack.company} · receipt ${ack.receiptId}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {ack && (
            <div className="space-y-3">
              <pre className="max-h-56 overflow-y-auto rounded-lg border border-border bg-muted/40 p-3 text-xs whitespace-pre-wrap">
                {ack.message}
              </pre>
              <div className="flex flex-wrap gap-2">
                {ack.phone && (
                  <Button asChild className="flex-1">
                    <a
                      href={whatsappLink(ack.phone, ack.message)}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => setAck(null)}
                    >
                      <MessageCircle className="size-4" /> Send on WhatsApp
                    </a>
                  </Button>
                )}
                <Button variant="outline" onClick={() => void downloadPdf(ack.pdf)}>
                  <Download className="size-4" /> Receipt PDF
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void navigator.clipboard?.writeText(ack.message)}
                >
                  <Copy className="size-4" /> Copy
                </Button>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAck(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
