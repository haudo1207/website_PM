'use client';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface PieDataItem {
  name: string;
  value: number;
  fill: string;
}

interface PieChartCardProps {
  title: string;
  data: PieDataItem[];
}

export default function PieChartCard({ title, data }: PieChartCardProps) {
  return (
    <div className="bg-white rounded-xl border border-[#c2c6d6]/60 p-5 shadow-sm">
      <h3 className="text-xs font-bold text-[#0b1c30] uppercase tracking-wider mb-4">{title}</h3>
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie data={data} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value">
            {data.map((entry, idx) => (
              <Cell key={idx} fill={entry.fill} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }}
            formatter={(value) => [value, '']}
          />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
