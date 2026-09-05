import { useServerFn } from "@tanstack/react-start";
import { Check, Copy, Download, MessageCircle } from "lucide-react";
import { useEffect, useState } from "react";

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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { acknowledgementMessage, whatsappLink } from "@/lib/derive";
import { markRentPaidFn } from "@/lib/gbp.functions";
import { downloadPdf, type PdfDoc } from "@/lib/pdf";
import { receiptPdfDoc } from "@/lib/pdf-docs";
import type { RentInvoiceView } from "@/lib/rent-invoices";
import { inr } from "@/lib/sheets-schema";
import { useSheetMutation } from "@/lib/use-app-data";

const MODES = ["upi", "neft", "cheque", "cash", "other"];

type Ack = {
  company: string;
  phone: string;
  amount: number;
  receiptId: string;
  message: string;
  pdf: PdfDoc;
};

/** Finance-manager action: confirm receipt of a rent invoice; syncs to the Google Sheet. */
export function MarkRentPaidDialog({
  invoice,
  onClose,
  parkName = "Guwahati Biotech Park",
}: {
  invoice: RentInvoiceView | null;
  onClose: () => void;
  parkName?: string;
}) {
  const mark = useSheetMutation(useServerFn(markRentPaidFn), "Payment recorded and sheet updated");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [mode, setMode] = useState("upi");
  const [ref, setRef] = useState("");
  const [remarks, setRemarks] = useState("");
  const [amount, setAmount] = useState("");
  const [ack, setAck] = useState<Ack | null>(null);

  useEffect(() => {
    if (!invoice) return;
    setDate(new Date().toISOString().slice(0, 10));
    setMode("upi");
    setRef("");
    setRemarks("");
    setAmount("");
  }, [invoice]);

  return (
    <>
    <Dialog open={invoice !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Mark rent as paid</DialogTitle>
        </DialogHeader>
        {invoice && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const received = Number(amount) > 0 ? Number(amount) : undefined;
              mark.mutate(
                {
                  data: {
                    invoice_id: invoice.invoiceId,
                    payment_date: date,
                    payment_mode: mode,
                    txn_ref: ref,
                    remarks: remarks,
                    ...(received !== undefined ? { amount: received } : {}),
                  },
                },
                {
                  onSuccess: (out) => {
                    const paidNow = out.amount || invoice.balance;
                    const balance = out.balance ?? 0;
                    const receiptId = out.paymentId || invoice.invoiceNo || invoice.invoiceId;
                    setAck({
                      company: invoice.company,
                      phone: invoice.phone,
                      amount: paidNow,
                      receiptId,
                      pdf: receiptPdfDoc({
                        receiptId,
                        parkName,
                        company: invoice.company,
                        phone: invoice.phone,
                        labId: invoice.labId,
                        month: invoice.month,
                        kind: "rent",
                        amount: paidNow,
                        balance,
                        date,
                        mode,
                        reference: ref,
                      }),
                      message: acknowledgementMessage({
                        company: invoice.company,
                        kind: "rent",
                        month: invoice.month,
                        labId: invoice.labId,
                        amount: paidNow,
                        balance,
                        date,
                        mode,
                        reference: ref,
                        receiptId,
                        parkName,
                      }),
                    });
                    onClose();
                  },
                },
              );
            }}
          >
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs">
              <p className="font-semibold text-foreground">{invoice.company}</p>
              <p className="mt-0.5 text-muted-foreground">
                {invoice.invoiceNo || invoice.invoiceId}
              </p>
              <p className="mt-1 text-sm font-bold text-foreground">
                {inr(invoice.balance)} receivable
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-amount">Amount received</Label>
              <Input
                id="pay-amount"
                type="number"
                inputMode="decimal"
                min="0"
                placeholder={String(invoice.balance)}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                Leave blank for full settlement. A smaller amount is recorded as a part payment and
                the rest stays in balance.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-date">Payment date</Label>
              <Input
                id="pay-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>Mode</Label>
              <Select value={mode} onValueChange={setMode}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODES.map((m) => (
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
                maxLength={80}
                value={ref}
                onChange={(e) => setRef(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-remarks">Remarks</Label>
              <Textarea
                id="pay-remarks"
                rows={2}
                maxLength={300}
                placeholder="e.g. paid in cash / cheque no. 123456"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={mark.isPending}>
                {mark.isPending ? "Saving…" : "Confirm payment"}
              </Button>
            </DialogFooter>
          </form>
        )}
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
              {ack ? `${inr(ack.amount)} received from ${ack.company} · receipt ${ack.receiptId}` : ""}
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
                    >
                      <MessageCircle className="size-4" /> Send on WhatsApp
                    </a>
                  </Button>
                )}
                <Button variant="outline" onClick={() => void downloadPdf(ack.pdf)}>
                  <Download className="size-4" /> Acknowledgement PDF
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
