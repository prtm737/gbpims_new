// Client-safe types for the Supabase PDF archive (see pdf-archive.server.ts).
export type ArchivedPdfLike = {
  path: string;
  name: string;
  kind: string;
  month: string;
  size: number;
  updatedAt: string;
};

/** Window event fired after a new PDF lands in the archive. */
export const PDF_ARCHIVE_EVENT = "pdf-archive-updated";
