"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { money, shortDate } from "@/lib/format";
import type { DashboardSummary, FinanceSummary } from "@/lib/models";

const tooltip = { background: "var(--surface)", border: "1px solid var(--line)", color: "var(--ink)", borderRadius: ".6rem" };
const axisStyle = { fill: "var(--muted)", fontSize: 12, fontFamily: "var(--body)" };
const chartSize = { width: 480, height: 190 };

export function AttendanceChart({ data }: { data: DashboardSummary["series"] }) {
  return <>
    <div className="chart-frame">
      <ResponsiveContainer width="100%" height="100%" initialDimension={chartSize}>
        <BarChart accessibilityLayer data={data} margin={{ left: -20, top: 8, bottom: 4, right: 2 }} barSize={22}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="3 4" vertical={false} />
          <XAxis dataKey="day" tickFormatter={shortDate} tick={axisStyle} tickLine={false} axisLine={false} minTickGap={10} />
          <YAxis allowDecimals={false} tick={axisStyle} tickLine={false} axisLine={false} domain={[0, (max: number) => Math.max(max, 4)]} />
          <Tooltip contentStyle={tooltip} labelFormatter={value => shortDate(String(value))} cursor={{ fill: "var(--surface-soft)" }} />
          <Bar dataKey="completed" name="Concluídos" fill="var(--accent)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="scheduled" name="Em aberto" fill="var(--pink)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
    <div className="chart-legend"><span><i className="legend-dot" />Concluídos</span><span><i className="legend-dot secondary" />Em aberto</span></div>
  </>;
}

export function FinanceChart({ data }: { data: FinanceSummary["series"] }) {
  return <div className="chart-frame">
    <ResponsiveContainer width="100%" height="100%" initialDimension={chartSize}>
      <AreaChart accessibilityLayer data={data} margin={{ left: 8, top: 8, bottom: 4, right: 8 }}>
        <CartesianGrid stroke="var(--line)" strokeDasharray="3 4" vertical={false} />
        <XAxis dataKey="day" tickFormatter={shortDate} tick={axisStyle} tickLine={false} axisLine={false} minTickGap={17} />
        <YAxis tickFormatter={value => money(value).replace(",00", "")} tick={axisStyle} tickLine={false} axisLine={false} width={90} />
        <Tooltip contentStyle={tooltip} labelFormatter={value => shortDate(String(value))} formatter={value => money(Number(value))} />
        <Area type="monotone" dataKey="income" name="Recebido" stroke="var(--accent)" strokeWidth={2} fill="var(--pink)" fillOpacity={.23} isAnimationActive={false} />
        <Area type="monotone" dataKey="expense" name="Despesas pagas" stroke="var(--amber)" strokeWidth={2} fill="var(--amber)" fillOpacity={.1} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  </div>;
}
