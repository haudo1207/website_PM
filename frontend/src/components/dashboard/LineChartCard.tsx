'use client';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';

interface LineChartCardProps {
  title: string;
  data: any[];
  lines: { key: string; name: string; stroke: string; dashed?: boolean }[];
  xKey: string;
  height?: number;
}

export default function LineChartCard({ title, data, lines, xKey, height = 220 }: LineChartCardProps) {
  return (
    <div className="bg-white rounded-xl border border-[#c2c6d6]/60 p-5 shadow-sm h-full">
      <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider mb-4">{title}</h3>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 0, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey={xKey} tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
          {lines.map(l => (
            <Line
              key={l.key}
              type="monotone"
              dataKey={l.key}
              name={l.name}
              stroke={l.stroke}
              strokeWidth={2}
              strokeDasharray={l.dashed ? '5 5' : undefined}
              dot={{ r: 4, fill: l.stroke }}
              activeDot={{ r: 6 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
