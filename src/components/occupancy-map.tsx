import { Link } from "@tanstack/react-router";

import type { LabView } from "@/lib/derive";
import { inr } from "@/lib/sheets-schema";
import { cn } from "@/lib/utils";

const tone: Record<string, string> = {
  occupied: "border-primary/30 bg-primary/8 hover:border-primary/60",
  notice: "border-amber-500/40 bg-amber-500/10 hover:border-amber-500/70",
  vacant: "border-border bg-muted/40 hover:border-primary/40",
};

const dot: Record<string, string> = {
  occupied: "bg-primary",
  notice: "bg-amber-500",
  vacant: "bg-muted-foreground/40",
};

/** Space-by-space occupancy grid showing which tenant holds each lab/space. */
export function OccupancyMap({ labs }: { labs: LabView[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {labs.map((lab) => {
        const company = lab.occupant?.["company_name"] ?? "";
        return (
          <Link
            key={lab.labId}
            to="/labs"
            title={`${lab.labId} · ${company || "Vacant"}`}
            className={cn(
              "flex min-w-0 flex-col gap-1 rounded-xl border p-2.5 transition-colors",
              tone[lab.status] ?? tone["vacant"],
            )}
          >
            <div className="flex min-w-0 items-center gap-1.5">
              <span className={cn("size-2 shrink-0 rounded-full", dot[lab.status])} />
              <span className="font-display truncate text-xs font-bold">{lab.labId}</span>
              <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                {lab.areaSqft ? `${lab.areaSqft} sqft` : ""}
              </span>
            </div>
            <p className="truncate text-[12px] leading-tight font-semibold">
              {company || "Vacant"}
            </p>
            <p className="truncate text-[10.5px] text-muted-foreground">
              {lab.status === "vacant" ? "Available for allotment" : `${inr(lab.rent)} / month`}
            </p>
          </Link>
        );
      })}
    </div>
  );
}