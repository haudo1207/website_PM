
'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';

// Giả sử bạn có một hook `useApi` để gọi API, nếu không có, bạn có thể dùng `fetch`
// import { useApi } from '../../hooks/useApi';

interface TaskAlerts {
  overdue_tasks: number;
  pending_approval_tasks: number;
}

const MemberTaskAlerts = () => {
  const [alerts, setAlerts] = useState<TaskAlerts | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // const { get } = useApi(); // Ví dụ nếu dùng hook

  useEffect(() => {
    const fetchAlerts = async () => {
      setIsLoading(true);
      try {
        // Thay thế bằng URL API của bạn và cách bạn quản lý xác thực (ví dụ: gửi token)
        const response = await fetch('/api/v1/users/me/task_alerts', {
          headers: {
            // 'Authorization': `Bearer ${token}` // Thêm header xác thực nếu cần
          },
        });
        if (!response.ok) {
          throw new Error('Failed to fetch alerts');
        }
        const data = await response.json();
        setAlerts(data);
      } catch (error) {
        console.error("Failed to fetch task alerts:", error);
        setAlerts(null);
      } finally {
        setIsLoading(false);
      }
    };

    fetchAlerts();
  }, []); // Chỉ chạy một lần khi component được mount

  const totalAlerts = (alerts?.overdue_tasks || 0) + (alerts?.pending_approval_tasks || 0);

  if (isLoading || !alerts || totalAlerts === 0) {
    return null; // Không hiển thị gì nếu đang tải, có lỗi, hoặc không có cảnh báo
  }

  return (
    <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-800 p-4 rounded-md shadow-md" role="alert">
      <p className="font-bold text-lg">Công việc cần chú ý</p>
      <ul className="list-disc list-inside mt-2 space-y-1">
        {alerts.overdue_tasks > 0 && (
          <li>
            Bạn có <strong>{alerts.overdue_tasks}</strong> công việc đã trễ hạn.
          </li>
        )}
        {alerts.pending_approval_tasks > 0 && (
          <li>
            Bạn có <strong>{alerts.pending_approval_tasks}</strong> công việc đã hoàn thành đang chờ duyệt.
          </li>
        )}
      </ul>
      <div className="mt-4">
        <Link href="/project-hub" legacyBehavior>
          <a className="font-semibold text-yellow-900 hover:text-yellow-700 transition-colors">
            Xem lại các công việc →
          </a>
        </Link>
      </div>
    </div>
  );
};

export default MemberTaskAlerts;
