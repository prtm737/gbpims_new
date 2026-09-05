import { useServerFn } from "@tanstack/react-start";
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
import { Textarea } from "@/components/ui/textarea";
import { updateLedgerRemarksFn } from "@/lib/gbp.functions";
import { useSheetMutation } from "@/lib/use-app-data";

/** Edit the remark stored against a ledger entry (rent invoice or electricity bill). */
export function EditRemarkDialog({
  target,
  onClose,
}: {
  target: { kind: "rent" | "electricity"; id: string; label: string; remarks: string } | null;
  onClose: () => void;
}) {
  const save = useSheetMutation(useServerFn(updateLedgerRemarksFn), "Remark updated on the sheet");
  const [text, setText] = useState("");

  useEffect(() => {
    setText(target?.remarks ?? "");
  }, [target]);

  return (
    <Dialog open={target !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Update remark</DialogTitle>
          <DialogDescription>{target?.label}</DialogDescription>
        </DialogHeader>
        <Textarea
          rows={4}
          value={text}
          placeholder="e.g. paid by cheque no. 123456 on 5 Aug"
          onChange={(e) => setText(e.target.value)}
        />
        <DialogFooter>
          <Button
            disabled={save.isPending || !target}
            onClick={() =>
              target &&
              save.mutate(
                { data: { kind: target.kind, id: target.id, remarks: text.trim() } },
                { onSuccess: onClose },
              )
            }
          >
            {save.isPending ? "Saving…" : "Save remark"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}