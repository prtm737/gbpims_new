import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: LucideIcon;
  tone?: "default" | "positive" | "warning" | "danger";
}) {
  const toneClass = {
    default: "text-foreground",
    positive: "text-primary",
    warning: "text-amber-600 dark:text-amber-400",
    danger: "text-destructive",
  }[tone];

  const iconWrap = {
    default: "bg-muted text-muted-foreground",
    positive: "bg-primary/10 text-primary",
    warning: "bg-amber-500/12 text-amber-600 dark:text-amber-400",
    danger: "bg-destructive/10 text-destructive",
  }[tone];

  return (
    <div className="surface-card group relative min-w-0 overflow-hidden p-4 transition-shadow hover:shadow-[var(--shadow-elevated-value)] @container">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-[10.5px] font-semibold tracking-[0.09em] text-muted-foreground uppercase">
          {label}
        </p>
        {Icon && (
          <span
            className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", iconWrap)}
          >
            <Icon className="size-4" />
          </span>
        )}
      </div>
      <p
        className={cn(
          "font-display mt-2.5 text-[clamp(1.05rem,11cqw,1.6rem)] leading-tight font-bold tracking-tight tabular-nums break-words",
          toneClass,
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-1.5 text-xs break-words text-muted-foreground">{hint}</p>}
    </div>
  );
}
