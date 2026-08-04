import React from 'react';
import SvgIcon, { IconName } from './Icons';

interface KpiCardProps {
  label: string;
  value: number | string;
  icon: IconName | string;
  border: string;  // e.g. 'border-l-[#0058be]'
  text: string;    // e.g. 'text-[#0058be]'
  trend?: string;
}

export default function KpiCard({ label, value, icon, border, text, trend }: KpiCardProps) {
  return (
    <div className={`relative overflow-hidden rounded-xl border border-[#c2c6d6]/60 border-l-4 ${border} bg-white p-5 shadow-sm`}>
      <div className={`absolute right-3 top-3 opacity-15 select-none ${text}`}>
        <SvgIcon name={icon} className="w-10 h-10" />
      </div>
      <p className="text-[10px] font-bold text-[#565e74] uppercase tracking-wider">{label}</p>
      <p className={`text-3xl font-extrabold mt-2 ${text}`}>
        {typeof value === 'number' ? value.toLocaleString('vi-VN') : value}
      </p>
      {trend && (
        <p className="text-[11px] text-slate-400 mt-1.5 font-medium">{trend}</p>
      )}
    </div>
  );
}
