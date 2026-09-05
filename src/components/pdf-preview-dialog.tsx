import { Download, ExternalLink, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Renders a generated invoice PDF inline so staff can check it before sharing. */
export function PdfPreviewDialog({
  open,
  title,
  subtitle,
  build,
  onDownload,
  onClose,
}: {
  open: boolean;
  title: string;
  subtitle?: string | undefined;
  build: (() => Promise<string>) | null;
  onDownload?: (() => void) | undefined;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !build) return;
    let active = true;
    let created = "";
    setUrl(null);
    setError(null);
    build()
      .then((next) => {
        created = next;
        if (active) setUrl(next);
        else URL.revokeObjectURL(next);
      })
      .catch((e: Error) => active && setError(e.message));
    return () => {
      active = false;
      if (created) URL.revokeObjectURL(created);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, build]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92dvh] max-w-3xl overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="text-base">{title}</DialogTitle>
          {subtitle && <DialogDescription>{subtitle}</DialogDescription>}
        </DialogHeader>
        <div className="h-[60vh] bg-muted/50">
          {error ? (
            <p className="p-6 text-sm text-destructive">{error}</p>
          ) : url ? (
            <iframe src={url} title={title} className="size-full border-0" />
          ) : (
            <div className="flex size-full items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" /> Building preview…
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2 border-t border-border px-5 py-3">
          {onDownload && (
            <Button size="sm" onClick={onDownload}>
              <Download className="size-3.5" /> Download PDF
            </Button>
          )}
          {url && (
            <Button size="sm" variant="outline" asChild>
              <a href={url} target="_blank" rel="noreferrer">
                <ExternalLink className="size-3.5" /> Open in new tab
              </a>
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}