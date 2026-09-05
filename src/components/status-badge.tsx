import { cn } from "@/lib/utils";

const styles: Record<string, string> = {
  paid: "bg-primary/10 text-primary border-primary/25",
  occupied: "bg-primary/10 text-primary border-primary/25",
  active: "bg-primary/10 text-primary border-primary/25",
  partial: "bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300",
  pending: "bg-muted text-muted-foreground border-border",
  notice: "bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300",
  vacant: "bg-muted text-muted-foreground border-border",
  overdue: "bg-destructive/12 text-destructive border-destructive/30",
  exited: "bg-muted text-muted-foreground border-border",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize",
        styles[status] ?? "bg-muted text-muted-foreground border-border",
        className,
      )}
    >
      {status}
    </span>
  );
}
