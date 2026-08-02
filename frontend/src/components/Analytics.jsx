import { useApp } from "../context/useApp";
import { percent } from "../utils/format";

const METRIC_STYLES = {
  cpu: { bar: "bg-cyan-400", label: "CPU Usage" },
  memory: { bar: "bg-yellow-400", label: "Memory Usage" },
  storage: { bar: "bg-green-500", label: "Storage" },
  network: { bar: "bg-violet-400", label: "Network" },
};

export default function Analytics() {
  const { metrics, workspaces } = useApp();

  const podPercent = Math.min(
    100,
    Math.round((workspaces.reduce((sum, w) => sum + w.pods, 0) / 96) * 100)
  );
  const requestPercent = Math.min(100, Math.round((metrics.requests / 420) * 100));

  const items = [
    { ...METRIC_STYLES.cpu, value: metrics.cpu },
    { ...METRIC_STYLES.memory, value: metrics.memory },
    { ...METRIC_STYLES.storage, value: metrics.storage },
    { ...METRIC_STYLES.network, value: metrics.network },
    { bar: "bg-purple-400", label: "Active Pods", value: podPercent },
    { bar: "bg-cyan-500", label: "API Requests", value: requestPercent },
  ];

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">Resource Analytics</h2>
        <span className="rounded-full bg-green-500/10 px-3 py-1 text-xs font-semibold text-green-400">
          Live
        </span>
      </div>

      <div className="space-y-5">
        {items.map((m) => (
          <div key={m.label}>
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium text-slate-300">{m.label}</span>
              <span className="font-bold tabular-nums text-white">{percent(m.value)}</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-700">
              <div
                className={`h-2.5 rounded-full transition-all duration-1000 ease-out ${m.bar}`}
                style={{ width: `${percent(m.value)}` }}
              ></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
