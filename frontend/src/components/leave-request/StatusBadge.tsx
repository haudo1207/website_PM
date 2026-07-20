import { LeaveStatus } from '@/lib/leave-request';

interface StatusBadgeProps {
  status: LeaveStatus;
}

const statusClasses: Record<LeaveStatus, string> = {
  Approved: 'bg-emerald-100 text-emerald-700',
  Pending: 'bg-amber-100 text-amber-700',
  Rejected: 'bg-rose-100 text-rose-700',
};

export default function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusClasses[status]}`}>
      {status}
    </span>
  );
}
