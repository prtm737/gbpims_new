// Per-lab allotment and collection history, derived from the workbook.
import { dueRows, labViews, type LabView } from "./derive";
import { num, spaceIds, type Row, type Workbook } from "./sheets-schema";

export type LabHistory = LabView & {
  occupantName: string;
  founder: string;
  phone: string;
  allotmentDate: string;
  agreementEnd: string;
  billed: number;
  collected: number;
  outstanding: number;
  months: number;
  lastPayment: string;
  pastOccupants: Row[];
};

export function labHistory(wb: Workbook): LabHistory[] {
  const dues = dueRows(wb);
  return labViews(wb).map((lab) => {
    const labDues = dues.filter((d) => d.labId === lab.labId);
    const months = new Set(labDues.map((d) => d.month)).size;
    const incIds = new Set(
      wb.incubatees
        .filter((i) => spaceIds(i["lab_id"]).includes(lab.labId))
        .map((i) => i["incubatee_id"]),
    );
    const payments = wb.payments
      .filter((p) => incIds.has(p["incubatee_id"] ?? ""))
      .sort((a, b) => String(b["date"]).localeCompare(String(a["date"])));

    return {
      ...lab,
      occupantName: lab.occupant?.["company_name"] ?? "",
      founder: lab.occupant?.["founder_name"] ?? "",
      phone: lab.occupant?.["phone"] ?? "",
      allotmentDate: lab.occupant?.["allotment_date"] ?? "",
      agreementEnd: lab.occupant?.["agreement_end"] ?? "",
      billed: labDues.reduce((a, d) => a + d.amount, 0),
      collected: labDues.reduce((a, d) => a + d.paid, 0),
      outstanding: labDues.reduce((a, d) => a + d.balance, 0),
      months,
      lastPayment: payments[0]?.["date"] ?? "",
      pastOccupants: wb.incubatees.filter(
        (i) => spaceIds(i["lab_id"]).includes(lab.labId) && i["status"] === "exited",
      ),
    };
  });
}

export function totalCollected(wb: Workbook): number {
  return wb.payments.reduce((a, p) => a + num(p["amount"]), 0);
}
