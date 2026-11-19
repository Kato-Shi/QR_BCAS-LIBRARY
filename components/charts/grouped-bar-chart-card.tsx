"use client";

import type { ReactNode } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

export interface ChartSummaryItem {
  label: string;
  value: string | number;
  tone?: "emerald" | "blue" | "amber" | "slate";
}

interface GroupedBarChartCardProps {
  title: string;
  subtitle?: string;
  headerRight?: ReactNode;
  summaryItems?: ChartSummaryItem[];
  emptyMessage?: string;
  data: object[];
  xAxisKey: string;
  bars: { dataKey: string; fill: string; name: string }[];
  tooltipLabelFormatter?: (
    label: string,
    payload?: readonly { payload?: Record<string, unknown> }[]
  ) => string;
}

const TONE_CLASSES: Record<NonNullable<ChartSummaryItem["tone"]>, string> = {
  emerald: "bg-emerald-50 border-emerald-200 text-emerald-800",
  blue: "bg-blue-50 border-blue-200 text-blue-800",
  amber: "bg-amber-50 border-amber-200 text-amber-800",
  slate: "bg-slate-50 border-slate-200 text-slate-700",
};

export default function GroupedBarChartCard({
  title,
  subtitle,
  headerRight,
  summaryItems,
  emptyMessage,
  data,
  xAxisKey,
  bars,
  tooltipLabelFormatter,
}: GroupedBarChartCardProps) {
  const hasAnyValue =
    data.length > 0 &&
    data.some((row) => {
      const rec = row as Record<string, unknown>;
      return bars.some((b) => Number(rec[b.dataKey] ?? 0) > 0);
    });

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 h-full flex flex-col">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
        <div>
          <h3 className="text-base sm:text-lg font-bold text-slate-900">{title}</h3>
          {subtitle && (
            <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
          )}
        </div>
        {headerRight && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">{headerRight}</div>
        )}
      </div>

      {summaryItems && summaryItems.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
          {summaryItems.map((item) => (
            <div
              key={item.label}
              className={`px-3 py-2 rounded-lg border ${
                TONE_CLASSES[item.tone ?? "slate"]
              }`}
            >
              <p className="text-[11px] font-medium opacity-80 truncate">{item.label}</p>
              <p className="text-sm sm:text-base font-bold mt-0.5 truncate">{item.value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="h-56 sm:h-64 relative flex-1 min-h-[224px]">
        {!hasAnyValue && emptyMessage ? (
          <div className="h-full flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-4 text-center">
            <p className="text-sm font-medium text-slate-600">{emptyMessage}</p>
            <p className="text-xs text-slate-400 mt-1">
              Try selecting a different week from the filter above.
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} barCategoryGap="22%">
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis
                dataKey={xAxisKey}
                tick={{ fontSize: 11, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 11, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
                width={32}
              />
              <Tooltip
                cursor={{ fill: "#f8fafc" }}
                labelFormatter={
                  tooltipLabelFormatter
                    ? (label, payload) =>
                        tooltipLabelFormatter(
                          String(label ?? ""),
                          payload as readonly { payload?: Record<string, unknown> }[]
                        )
                    : undefined
                }
                contentStyle={{
                  borderRadius: "10px",
                  border: "1px solid #e2e8f0",
                  boxShadow: "0 4px 12px rgba(15, 23, 42, 0.08)",
                  fontSize: "13px",
                }}
              />
              <Legend
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }}
              />
              {bars.map((bar) => (
                <Bar
                  key={bar.dataKey}
                  dataKey={bar.dataKey}
                  name={bar.name}
                  fill={bar.fill}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={28}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
