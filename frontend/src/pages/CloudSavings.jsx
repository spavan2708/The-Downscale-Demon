import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useApp } from "../context/useApp";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import { formatCurrency } from "../utils/format";

export default function CloudSavings() {
  const { savings, savingsTrend } = useApp();
  const reduction = Math.round((savings.total / (savings.total + 100000)) * 100);

  const costCard = (title, value, color, icon) => (
    <StatCard title={title} value={value} color={color} icon={icon} format={formatCurrency} />
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cloud Savings"
        subtitle="Cost reduction from scale-to-zero automation, updated in real time."
      />

      <section className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
        {costCard("Today's Savings", savings.today, "green", "📅")}
        {costCard("Weekly Savings", savings.week, "cyan", "🗓️")}
        {costCard("Monthly Savings", savings.month, "yellow", "📈")}
        {costCard("Yearly Projection", savings.year, "violet", "🚀")}
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl xl:col-span-2">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-xl font-bold text-white">Savings Trend</h2>
            <span className="text-sm font-semibold text-green-400">↑ {reduction}% cost reduction</span>
          </div>

          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={savingsTrend} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="savingsFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                <XAxis dataKey="time" stroke="#64748b" fontSize={12} tickLine={false} />
                <YAxis stroke="#64748b" fontSize={12} tickLine={false} tickFormatter={(v) => `₹${v / 1000}k`} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#0f172a", border: "1px solid #334155", borderRadius: "0.75rem" }}
                  labelStyle={{ color: "#94a3b8" }}
                  formatter={(value) => [`₹${Number(value).toLocaleString("en-IN")}`, "Total Savings"]}
                />
                <Area
                  type="monotone"
                  dataKey="total"
                  stroke="#22d3ee"
                  strokeWidth={2}
                  fill="url(#savingsFill)"
                  animationDuration={800}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
            <h2 className="mb-4 text-xl font-bold text-white">Total Savings</h2>
            <p className="text-4xl font-bold tabular-nums text-green-400">
              {formatCurrency(savings.total)}
            </p>
            <p className="mt-2 text-sm text-slate-400">
              ₹45 saved per workspace scaled to zero
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
            <h2 className="mb-4 text-xl font-bold text-white">Cost Reduction</h2>
            <div className="flex items-center gap-4">
              <p className="text-4xl font-bold tabular-nums text-cyan-400">{reduction}%</p>
              <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-700">
                <div
                  className="h-3 rounded-full bg-gradient-to-r from-cyan-500 to-green-500 transition-all duration-1000"
                  style={{ width: `${reduction}%` }}
                ></div>
              </div>
            </div>
            <p className="mt-3 text-sm text-slate-400">
              vs. leaving all workspaces running 24×7
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
