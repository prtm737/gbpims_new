import { AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type DeleteTarget = {
  /** Human title, e.g. "Rent invoice GBP/2026/014". */
  title: string;
  /** The exact code the user must retype to confirm. */
  code: string;
  /** Short lines describing what will be removed. */
  impact: string[];
};

/**
 * Typed delete verification: the user must retype the record code, so a stray
 * tap on a phone can never wipe a ledger row.
 */
export function ConfirmDeleteDialog({
  target,
  pending,
  onConfirm,
  onClose,
}: {
  target: DeleteTarget | null;
  pending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState("");
  useEffect(() => setTyped(""), [target?.code]);

  const matches = target ? typed.trim().toUpperCase() === target.code.trim().toUpperCase() : false;

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-4" /> Delete {target?.title}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <p className="text-xs font-semibold text-destructive">This cannot be undone</p>
            <ul className="mt-1.5 space-y-1 text-xs text-muted-foreground">
              {(target?.impact ?? []).map((line) => (
                <li key={line}>• {line}</li>
              ))}
            </ul>
          </div>
          <div>
            <Label className="text-xs">
              Type <span className="font-mono font-semibold">{target?.code}</span> to confirm
            </Label>
            <Input
              autoFocus
              className="mt-1 font-mono"
              value={typed}
              placeholder={target?.code}
              onChange={(e) => setTyped(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={!matches || pending} onClick={onConfirm}>
            {pending ? "Deleting…" : "Delete permanently"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
