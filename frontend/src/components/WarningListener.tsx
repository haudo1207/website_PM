'use client';

import { useEffect, useState } from 'react';

interface WarningPayload {
  message?: string;
  conflicts?: Array<{
    member_name?: string;
    leave_type?: string;
    start_date?: string;
    end_date?: string;
  }>;
}

export default function WarningListener() {
  const [warning, setWarning] = useState<WarningPayload | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const payload = (e as CustomEvent<WarningPayload>).detail;
      if (payload) setWarning(payload);
    };
    window.addEventListener('api-warning', handler);
    return () => window.removeEventListener('api-warning', handler);
  }, []);

  useEffect(() => {
    if (!warning) return;
    const timer = window.setTimeout(() => setWarning(null), 6000);
    return () => window.clearTimeout(timer);
  }, [warning]);

  if (!warning) return null;

  const conflicts = warning.conflicts || [];
  return (
    <div className="fixed bottom-4 right-4 z-[500] max-w-sm">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-lg">
        <div className="flex items-start gap-2">
          <span className="text-lg shrink-0">⚠️</span>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-amber-900">{warning.message || 'Cảnh báo'}</p>
            {conflicts.length > 0 && (
              <ul className="mt-2 space-y-1">
                {conflicts.map((c, i) => (
                  <li key={i} className="text-[12px] text-amber-800">
                    {c.member_name} — {c.leave_type} ({c.start_date} → {c.end_date})
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            type="button"
            onClick={() => setWarning(null)}
            className="text-amber-600 hover:text-amber-900 text-sm leading-none"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
