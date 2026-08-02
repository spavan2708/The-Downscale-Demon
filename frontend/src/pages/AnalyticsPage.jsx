import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useApp } from "../context/useApp";
import PageHeader from "../components/PageHeader";

const tooltipStyle = {
  backgroundColor: "#0f172a",
  border: "1px solid #334155",
  borderRadius: "0.75rem",
  fontSize: "12px",
};
const axisProps = { stroke: "#64748b", fontSize: 12, tickLine: false };

function chartCard(title, badge, children) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-lg font-bold text-white">{title}</h2>
        {badge && (
          <span className="rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-400">
            {badge}
          </span>
        )}
      </div>
      <div className="h-64">{children}</div>
    </div>
  );
}

export default function AnalyticsPage() {
  const { metrics, workspaces, stats } = useApp();

  const cpuData = metrics.history.cpu.map((value, i) => ({ index: i, value }));
  const memoryData = metrics.history.memory.map((value, i) => ({ index: i, value }));
  const networkData = metrics.history.network.map((value, i) => ({ index: i, value }));
  const requestsData = metrics.history.requests.map((value, i) => ({ index: i, value }));
  const statusData = [
    { name: "Running", value: stats.running, color: "#22c55e" },
    { name: "Sleeping", value: stats.sleeping, color: "#ef4444" },
  ];
  const distributionData = workspaces.reduce((acc, ws) => {
    const existing = acc.find((d) => d.name === ws.namespace.split("-")[1]);
    if (existing) existing.workspaces += 1;
    else acc.push({ name: ws.namespace.split("-")[1], workspaces: 1 });
    return acc;
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        subtitle="Live Kubernetes cluster telemetry — metrics refresh every 3 seconds."
      />

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {chartCard("CPU Trend", `${metrics.cpu}% now`, (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={cpuData}>
              <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
              <XAxis dataKey="index" {...axisProps} />
              <YAxis {...axisProps} />
              <Tooltip contentStyle={tooltipStyle} />
              <Line type="monotone" dataKey="value" name="CPU %" stroke="#22d3ee" strokeWidth={2} dot={false} animationDuration={800} />
            </LineChart>
          </ResponsiveContainer>
        ))}

        {chartCard("Memory Trend", `${metrics.memory}% now`, (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={memoryData}>
              <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
              <XAxis dataKey="index" {...axisProps} />
              <YAxis {...axisProps} />
              <Tooltip contentStyle={tooltipStyle} />
              <Line type="monotone" dataKey="value" name="Memory %" stroke="#facc15" strokeWidth={2} dot={false} animationDuration={800} />
            </LineChart>
          </ResponsiveContainer>
        ))}

        {chartCard("Running vs Sleeping", null, (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={60} outerRadius={90} paddingAngle={4} animationDuration={800}>
                {statusData.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        ))}

        {chartCard("Workspace Distribution", null, (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={distributionData}>
              <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
              <XAxis dataKey="name" {...axisProps} />
              <YAxis {...axisProps} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="workspaces" name="Workspaces" fill="#a78bfa" radius={[6, 6, 0, 0]} animationDuration={800} />
            </BarChart>
          </ResponsiveContainer>
        ))}

        {chartCard("API Requests", `${metrics.requests} req/min`, (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={requestsData}>
              <defs>
                <linearGradient id="reqFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
              <XAxis dataKey="index" {...axisProps} />
              <YAxis {...axisProps} />
              <Tooltip contentStyle={tooltipStyle} />
              <Area type="monotone" dataKey="value" name="Requests/min" stroke="#22d3ee" strokeWidth={2} fill="url(#reqFill)" animationDuration={800} />
            </AreaChart>
          </ResponsiveContainer>
        ))}

        {chartCard("Network Traffic", `${metrics.network} Mbps`, (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={networkData}>
              <defs>
                <linearGradient id="netFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#34d399" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
              <XAxis dataKey="index" {...axisProps} />
              <YAxis {...axisProps} />
              <Tooltip contentStyle={tooltipStyle} />
              <Area type="monotone" dataKey="value" name="Mbps" stroke="#34d399" strokeWidth={2} fill="url(#netFill)" animationDuration={800} />
            </AreaChart>
          </ResponsiveContainer>
        ))}
      </section>
    </div>
  );
}
