// Client-side helper: stores a generated PDF in the Supabase month-wise
// archive. Used by the PDF download helpers so every downloaded bill, invoice
// or receipt is also saved for later re-download.
import { toast } from "sonner";

import { archivePdfFn } from "./gbp.functions";
import { PDF_ARCHIVE_EVENT } from "./pdf-archive-shared";

export async function archivePdfQuiet(input: {
  kind: "electricity" | "rent" | "receipt";
  month: string;
  ref_id: string;
  label?: string;
  pdf_base64: string;
}): Promise<void> {
  try {
    await archivePdfFn({ data: input });
    toast.success("PDF stored in the month-wise archive");
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(PDF_ARCHIVE_EVENT));
    }
  } catch (err) {
    toast.warning(
      `Downloaded, but could not store in the archive: ${(err as Error).message}`,
    );
  }
}

export function archiveMonth(...candidates: (string | undefined)[]): string | null {
  for (const value of candidates) {
    if (value && /^\d{4}-\d{2}$/.test(value)) return value;
  }
  return null;
}
