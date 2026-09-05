CREATE TABLE IF NOT EXISTS public.workbook_snapshots (
  spreadsheet_id text PRIMARY KEY,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.workbook_snapshots TO service_role;
ALTER TABLE public.workbook_snapshots ENABLE ROW LEVEL SECURITY;