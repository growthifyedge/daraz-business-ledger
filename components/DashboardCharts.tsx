'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { CURRENCY } from '@/lib/config';

function compact(n: number) {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return `${n}`;
}

function money(n: number) {
  return `${CURRENCY.symbol} ${Number(n).toLocaleString()}`;
}

export function TrendChart({
  data,
}: {
  data: { label: string; sales: number; profit: number }[];
}) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f7" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 12, fill: '#94a3b8' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={compact}
            tick={{ fontSize: 12, fill: '#94a3b8' }}
            axisLine={false}
            tickLine={false}
            width={44}
          />
          <Tooltip
            formatter={(v: number) => money(v)}
            contentStyle={{
              borderRadius: 12,
              border: '1px solid #e2e8f0',
              fontSize: 12,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="sales" name="Gross Sales" fill="#93c5fd" radius={[4, 4, 0, 0]} />
          <Bar dataKey="profit" name="Net Profit" fill="#2563eb" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SplitChart({
  yahya,
  owner,
}: {
  yahya: number;
  owner: number;
}) {
  const data = [
    { name: 'Yahya (50%)', value: Math.max(0, yahya) },
    { name: 'Owner (50%)', value: Math.max(0, owner) },
  ];
  const colors = ['#8b5cf6', '#2563eb'];
  const total = data.reduce((s, d) => s + d.value, 0);

  if (total <= 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-slate-400">
        No profit to distribute yet.
      </div>
    );
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={55}
            outerRadius={85}
            paddingAngle={3}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={colors[i]} />
            ))}
          </Pie>
          <Tooltip formatter={(v: number) => money(v)} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
