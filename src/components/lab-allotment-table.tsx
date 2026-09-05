import { History } from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import type { LabHistory } from "@/lib/lab-history";
import { inr } from "@/lib/sheets-schema";

/** Which lab is allotted to whom, with lifetime billing history per lab. */
export function LabAllotmentTable({ rows }: { rows: LabHistory[] }) {
  return (
    <div className="surface-card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <History className="size-4 text-primary" />
        <h2 className="font-display text-sm font-semibold">Lab allotment &amp; earnings history</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] tracking-wider text-muted-foreground uppercase">
              <th className="px-4 py-2.5 font-semibold">Lab</th>
              <th className="px-4 py-2.5 font-semibold">Incubatee</th>
              <th className="px-4 py-2.5 font-semibold">Since</th>
              <th className="px-4 py-2.5 text-right font-semibold">Rent / mo</th>
              <th className="px-4 py-2.5 text-right font-semibold">Billed</th>
              <th className="px-4 py-2.5 text-right font-semibold">Collected</th>
              <th className="px-4 py-2.5 text-right font-semibold">Due</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((lab) => (
              <tr
                key={lab.labId}
                className="border-b border-border/60 last:border-0 hover:bg-muted/40"
              >
                <td className="px-4 py-2.5 font-display font-bold">{lab.labId}</td>
                <td className="px-4 py-2.5">
                  <p className="font-medium">{lab.occupantName || "—"}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {lab.areaSqft ? `${lab.areaSqft} sqft` : "area not set"}
                    {lab.pastOccupants.length > 0 &&
                      ` · ${lab.pastOccupants.length} past tenant(s)`}
                  </p>
                </td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">
                  {lab.allotmentDate || "—"}
                </td>
                <td className="px-4 py-2.5 text-right">{inr(lab.rent)}</td>
                <td className="px-4 py-2.5 text-right">{inr(lab.billed)}</td>
                <td className="px-4 py-2.5 text-right font-semibold text-primary">
                  {inr(lab.collected)}
                </td>
                <td
                  className={
                    "px-4 py-2.5 text-right font-semibold " +
                    (lab.outstanding > 0 ? "text-destructive" : "text-muted-foreground")
                  }
                >
                  {inr(lab.outstanding)}
                </td>
                <td className="px-4 py-2.5">
                  <StatusBadge status={lab.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
