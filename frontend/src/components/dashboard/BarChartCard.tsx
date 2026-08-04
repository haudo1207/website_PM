'use client';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface BarChartCardProps {
  title: string;
  data: any[];
  bars: { key: string; name: string; fill: string }[];
  xKey: string;
  height?: number;
}

export default function BarChartCard({ title, data, bars, xKey, height = 220 }: BarChartCardProps) {
  return (
    <div className="bg-white rounded-xl border border-[#c2c6d6]/60 p-5 shadow-sm h-full">
      <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider mb-4">{title}</h3>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 0, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey={xKey} tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
          {bars.map(b => (
            <Bar key={b.key} dataKey={b.key} name={b.name} fill={b.fill} radius={[4, 4, 0, 0]} maxBarSize={32} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
