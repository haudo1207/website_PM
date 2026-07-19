export type LeaveType = 'Work Remotely' | 'Offline' | 'Go on Business' | 'Workshop' | 'Work Weekend';
export type LeaveStatus = 'Approved' | 'Pending' | 'Rejected';

export interface LeaveRequest {
  id: number;
  user_id: number;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  man_day: number;
  month: string;
  year: number;
  time: string;
  province: string;
  ward: string;
  address?: string;
  reason: string;
  status: LeaveStatus;
  created_at?: string;
  user?: {
    id: number;
    full_name: string;
    email: string;
  };
}

export interface LeaveRequestFormValues {
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  reason: string;
  province: string;
  ward: string;
  address: string;
  manDay: number;
}

export interface ProvinceOption {
  province: string;
  wards: string[];
}

export const leaveTypes: LeaveType[] = ['Work Remotely', 'Offline', 'Go on Business', 'Workshop', 'Work Weekend'];

import { locations as vnLocations } from '@/lib/vn-locations';

export const locations: ProvinceOption[] = vnLocations;

export const mockLeaveRequests: LeaveRequest[] = [
  {
    id: 1,
    user_id: 1,
    leave_type: 'Work Remotely',
    start_date: '2026-07-01',
    end_date: '2026-07-03',
    man_day: 3,
    month: 'July',
    year: 2026,
    time: '2026-07-01 09:00',
    province: 'Hà Nội',
    ward: 'Phúc Tân',
    address: '68 Ngô Sĩ Liên, Tổ 7',
    reason: 'Support internal sprint review and prepare documentation.',
    status: 'Approved',
  },
  {
    id: 2,
    user_id: 2,
    leave_type: 'Offline',
    start_date: '2026-07-05',
    end_date: '2026-07-05',
    man_day: 1,
    month: 'July',
    year: 2026,
    time: '2026-07-02 08:30',
    province: 'Đà Nẵng',
    ward: 'Hải Châu',
    address: '12 Bạch Đằng',
    reason: 'Visit customer office for requirement clarification.',
    status: 'Pending',
  },
  {
    id: 3,
    user_id: 3,
    leave_type: 'Go on Business',
    start_date: '2026-07-10',
    end_date: '2026-07-12',
    man_day: 3,
    month: 'July',
    year: 2026,
    time: '2026-07-03 10:15',
    province: 'TP. Hồ Chí Minh',
    ward: 'Quận 1',
    address: '23 Lê Lợi',
    reason: 'Attend project kickoff meeting with the partner team.',
    status: 'Approved',
  },
  {
    id: 4,
    user_id: 4,
    leave_type: 'Workshop',
    start_date: '2026-07-14',
    end_date: '2026-07-14',
    man_day: 1,
    month: 'July',
    year: 2026,
    time: '2026-07-06 13:40',
    province: 'Hải Phòng',
    ward: 'Lê Chân',
    address: '8 Lạch Tray',
    reason: 'Join new training workshop for product compliance.',
    status: 'Rejected',
  },
  {
    id: 5,
    user_id: 5,
    leave_type: 'Work Weekend',
    start_date: '2026-07-18',
    end_date: '2026-07-19',
    man_day: 2,
    month: 'July',
    year: 2026,
    time: '2026-07-07 15:20',
    province: 'Hà Nội',
    ward: 'Cầu Giấy',
    address: '45 Phạm Văn Đồng',
    reason: 'Support deployment tasks during weekend release.',
    status: 'Pending',
  },
  {
    id: 6,
    user_id: 1,
    leave_type: 'Work Remotely',
    start_date: '2026-07-21',
    end_date: '2026-07-21',
    man_day: 1,
    month: 'July',
    year: 2026,
    time: '2026-07-09 09:10',
    province: 'Đà Nẵng',
    ward: 'Thanh Khê',
    address: '3 Nguyễn Hữu Thọ',
    reason: 'Prepare weekly status summary for stakeholders.',
    status: 'Approved',
  },
  {
    id: 7,
    user_id: 2,
    leave_type: 'Offline',
    start_date: '2026-07-25',
    end_date: '2026-07-27',
    man_day: 3,
    month: 'July',
    year: 2026,
    time: '2026-07-10 11:45',
    province: 'TP. Hồ Chí Minh',
    ward: 'Thủ Đức',
    address: '101 Kha Vạn Cân',
    reason: 'Attend client site to validate implementation progress.',
    status: 'Pending',
  },
  {
    id: 8,
    user_id: 3,
    leave_type: 'Go on Business',
    start_date: '2026-07-29',
    end_date: '2026-07-30',
    man_day: 2,
    month: 'July',
    year: 2026,
    time: '2026-07-12 16:20',
    province: 'Hải Phòng',
    ward: 'Ngô Quyền',
    address: '77 Trần Phú',
    reason: 'Support coordination for the regional operation review.',
    status: 'Rejected',
  },
  {
    id: 9,
    user_id: 4,
    leave_type: 'Workshop',
    start_date: '2026-08-02',
    end_date: '2026-08-02',
    man_day: 1,
    month: 'August',
    year: 2026,
    time: '2026-07-14 08:00',
    province: 'Hà Nội',
    ward: 'Hoàn Kiếm',
    address: '10 Hàng Bạc',
    reason: 'Participate in knowledge transfer session for new process.',
    status: 'Approved',
  },
  {
    id: 10,
    user_id: 5,
    leave_type: 'Work Remotely',
    start_date: '2026-08-05',
    end_date: '2026-08-06',
    man_day: 2,
    month: 'August',
    year: 2026,
    time: '2026-07-16 10:05',
    province: 'Đà Nẵng',
    ward: 'Ngũ Hành Sơn',
    address: '5 Võ Nguyên Giáp',
    reason: 'Complete remaining tasks after the planned release window.',
    status: 'Pending',
  },
];

export function calculateManDay(startDate: string, endDate: string): number | null {
  if (!startDate || !endDate) return null;
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  if (end < start) return -1;
  const diff = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  return diff + 1;
}

export function formatDateLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function getStorageKey(): string {
  return 'leave-requests-demo';
}
