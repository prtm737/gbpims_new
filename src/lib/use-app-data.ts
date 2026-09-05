import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { getMe, getWorkbook } from "./gbp.functions";

type WorkbookResult = Awaited<ReturnType<typeof getWorkbook>>;

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
    initialDataUpdatedAt: 0,
    staleTime: 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
    retry: false,
  });
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
      queryClient.invalidateQueries({ queryKey: ["workbook"] });
      queryClient.invalidateQueries({ queryKey: ["me"] });
      toast.success(typeof successMessage === "function" ? successMessage(out) : successMessage);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Something went wrong");
    },
  });
}
