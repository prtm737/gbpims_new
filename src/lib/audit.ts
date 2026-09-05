// Client-safe view over the AuditLog tab.
import { num, type Workbook } from "./sheets-schema";

export type AuditRow = {
  id: string;
  at: string;
  actor: string;
  action: string;
  entity: string;
  entityId: string;
  entityName: string;
  month: string;
  amount: number;
  details: string;
};

export function auditRows(wb: Workbook, filter?: "rent" | "electricity"): AuditRow[] {
  return (wb.audit ?? [])
    .filter((r) => (r["audit_id"] ?? "").trim() !== "")
    .filter((r) => !filter || (r["entity"] ?? "") === filter)
    .map((r) => ({
      id: r["audit_id"] ?? "",
      at: r["timestamp"] ?? "",
      actor: r["actor"] ?? "",
      action: r["action"] ?? "",
      entity: r["entity"] ?? "",
      entityId: r["entity_id"] ?? "",
      entityName: r["entity_name"] ?? "",
      month: r["month"] ?? "",
      amount: num(r["amount"]),
      details: r["details"] ?? "",
    }))
    .sort((a, b) => b.at.localeCompare(a.at));
}

export function auditTimeLabel(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}