import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { getFreshWorkbook, getMe, getWorkbook } from "./gbp.functions";

type WorkbookResult = Awaited<ReturnType<typeof getFreshWorkbook>>;

// The workbook is a read-mostly snapshot, so we keep the last successful copy in
// the browser. Pages then paint instantly on reload/navigation while a fresh
// copy loads quietly in the background.
const CACHE_KEY = "gbpims.workbook.v1";
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function readLocalWorkbook(): WorkbookResult | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { at: number; data: WorkbookResult };
    if (!parsed?.at || Date.now() - parsed.at > CACHE_MAX_AGE_MS) return undefined;
    return parsed.data;
  } catch {
    return undefined;
  }
}

function writeLocalWorkbook(data: WorkbookResult): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data }));
  } catch {
    /* storage full or unavailable — caching is best effort */
  }
}

export function useMe() {
  const fn = useServerFn(getMe);
  return useQuery({ queryKey: ["me"], queryFn: () => fn(), staleTime: 5 * 60 * 1000 });
}

export function useWorkbook() {
  const fn = useServerFn(getWorkbook);
  return useQuery({
    queryKey: ["workbook"],
    queryFn: async () => {
      const result = (await fn()) as WorkbookResult;
      if (result?.connected) writeLocalWorkbook(result);
      return result;
    },
    initialData: readLocalWorkbook,
    // The localStorage copy is only a paint booster: mark it stale immediately
    // so a refetch is always queued. A long-frozen session cache made bills
    // written in another tab/session vanish until a hard reload.
    initialDataUpdatedAt: 0,
    staleTime: 0,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    placeholderData: (prev) => prev,
    retry: false,
  });
}

/**
 * Pull a guaranteed-fresh copy of the workbook straight from the Google Sheet
 * (bypassing every server cache) and push it into the query cache. Used after
 * every write and by the manual sync button so the app can never show a row
 * that is not actually stored in the sheet.
 */
export async function fetchFreshWorkbook(
  queryClient: QueryClient,
): Promise<WorkbookResult> {
  const fresh = (await getFreshWorkbook()) as WorkbookResult;
  if (fresh?.connected) {
    writeLocalWorkbook(fresh);
    queryClient.setQueryData(["workbook"], fresh);
  }
  return fresh;
}

/** Mutation helper that refreshes the workbook and toasts the outcome. */
export function useSheetMutation<TInput, TOutput>(
  fn: (input: TInput) => Promise<TOutput>,
  successMessage: string | ((out: TOutput) => string),
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (out) => {
      toast.success(
        typeof successMessage === "function" ? successMessage(out) : successMessage,
      );
      queryClient.invalidateQueries({ queryKey: ["me"] });
      // Re-read the sheet immediately: what the user sees must equal what the
      // sheet contains. Fall back to a plain refetch if the fresh read fails.
      fetchFreshWorkbook(queryClient)
        .then((fresh) => {
          if (!fresh?.connected) queryClient.invalidateQueries({ queryKey: ["workbook"] });
        })
        .catch(() =>
          queryClient.invalidateQueries({ queryKey: ["workbook"] }),
        );
    },
    onError: (error: Error) => {
      toast.error(error.message || "Something went wrong");
    },
  });
}
