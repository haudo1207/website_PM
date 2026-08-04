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

export const leaveTypeClasses: Record<string, string> = {
  'Offline': 'bg-red-100 text-red-700',
  'Work Remotely': 'bg-blue-100 text-blue-700',
  'Go on Business': 'bg-orange-100 text-orange-700',
  'Workshop': 'bg-violet-100 text-violet-700',
  'Work Weekend': 'bg-gray-100 text-gray-700',
};

export function LeaveTypeBadge({ type }: { type: string }) {
  const cls = leaveTypeClasses[type] || 'bg-slate-100 text-slate-700';
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${cls}`}>
      {type}
    </span>
  );
}
