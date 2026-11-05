import type { AssignmentStatus } from "@/lib/types";

const STYLES: Record<AssignmentStatus, string> = {
  unsent: "bg-stone-100 text-stone-600",
  pending: "bg-amber-100 text-amber-800",
  accepted: "bg-green-100 text-green-800",
  declined: "bg-red-100 text-red-800",
};
const LABELS: Record<AssignmentStatus, string> = {
  unsent: "Not sent",
  pending: "Pending",
  accepted: "Confirmed",
  declined: "Declined",
};

export default function StatusChip({ status }: { status: AssignmentStatus }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STYLES[status]}`}>{LABELS[status]}</span>;
}
