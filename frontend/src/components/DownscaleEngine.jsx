import { useState } from "react";
import { useApp } from "../context/useApp";
import { formatIdle, percent } from "../utils/format";

const STATUS_STYLES = {
  Running: { text: "text-green-400", dot: "bg-green-500", bar: "bg-green-500 w-full" },
  Idle: { text: "text-yellow-400", dot: "bg-yellow-400", bar: "bg-yellow-400 w-1/3" },
  Scaling: { text: "text-yellow-400", dot: "bg-yellow-400 animate-pulse", bar: "bg-yellow-400 w-2/3" },
  Sleeping: { text: "text-red-400", dot: "bg-red-500", bar: "bg-red-500 w-1/5" },
  Starting: { text: "text-cyan-400", dot: "bg-cyan-400 animate-pulse", bar: "bg-cyan-400 w-2/3" },
  Restarting: { text: "text-violet-400", dot: "bg-violet-400 animate-pulse", bar: "bg-violet-400 w-1/2" },
};

export default function DownscaleEngine() {
  const {
    workspaces,
    settings,
    doScale,
    doWake,
    toggleAutoScale,
    toggleEnginePaused,
  } = useApp();
  const [selectedId, setSelectedId] = useState(workspaces[0]?.id);

  const current = workspaces.find((w) => w.id === selectedId) || workspaces[0];
  if (!current) return null;

  const styles = STATUS_STYLES[current.status] || STATUS_STYLES.Idle;
  const isBusy = ["Scaling", "Starting", "Restarting"].includes(current.status);
  const idleProgress = Math.min(100, (current.idle / settings.idleTimeout) * 100);
  const decision =
    settings.enginePaused
      ? "Engine paused — monitoring suspended"
      : current.status === "Sleeping"
        ? "Workspace sleeping — wake to restore"
        : current.status === "Idle" && settings.autoScale
          ? `Idle limit reached in ${Math.max(0, settings.idleTimeout - current.idle)} min`
          : current.status === "Idle"
            ? "Idle — auto scale disabled"
            : "Healthy — no scaling action required";

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white">Downscale Demon Engine</h2>
          <p className="mt-1 text-sm text-slate-400">Autonomous scale-to-zero controller</p>
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-400">
          Current Workspace
          <select
            value={current.id}
            onChange={(e) => setSelectedId(Number(e.target.value))}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-medium text-white focus:border-cyan-500 focus:outline-none"
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-slate-800 bg-slate-800/60 p-4">
          <p className="text-xs text-slate-400">Status</p>
          <div className="mt-2 flex items-center gap-2">
            <span className={`h-3 w-3 animate-pulse rounded-full ${styles.dot}`}></span>
            <span className={`text-lg font-bold ${styles.text}`}>{current.status}</span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-800/60 p-4">
          <p className="text-xs text-slate-400">Idle Timer</p>
          <p className="mt-2 text-lg font-bold tabular-nums text-white">
            {current.status === "Sleeping" ? "—" : formatIdle(current.idle)}
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-800/60 p-4">
          <p className="text-xs text-slate-400">CPU / Memory</p>
          <p className="mt-2 text-lg font-bold tabular-nums text-white">
            {percent(current.cpu)} / {percent(current.memory)}
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-800/60 p-4">
          <p className="text-xs text-slate-400">Traffic (req/min)</p>
          <p className="mt-2 text-lg font-bold tabular-nums text-white">
            {current.traffic.toLocaleString()}
          </p>
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-slate-800 bg-slate-800/60 p-4">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="text-slate-400">Idle Progress</span>
          <span className="font-semibold text-slate-300">
            {current.idle} / {settings.idleTimeout} min
          </span>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full bg-slate-700">
          <div
            className={`h-3 rounded-full transition-all duration-1000 ease-out ${styles.bar}`}
            style={{ width: `${Math.max(5, idleProgress)}%` }}
          ></div>
        </div>
        <p className="mt-3 text-xs font-medium text-cyan-400">Scaling decision: {decision}</p>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          onClick={() => doScale(current.id)}
          disabled={isBusy || current.status === "Sleeping"}
          className="rounded-lg bg-red-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Scale to Zero
        </button>

        <button
          onClick={() => doWake(current.id)}
          disabled={isBusy || current.status === "Running" || current.status === "Idle"}
          className="rounded-lg bg-green-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Wake Workspace
        </button>

        <button
          onClick={toggleEnginePaused}
          className={`rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition ${
            settings.enginePaused
              ? "bg-emerald-600 hover:bg-emerald-500"
              : "bg-slate-700 hover:bg-slate-600"
          }`}
        >
          {settings.enginePaused ? "Resume Engine" : "Pause Engine"}
        </button>

        <button
          onClick={toggleAutoScale}
          className={`rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition ${
            settings.autoScale
              ? "bg-cyan-600 hover:bg-cyan-500"
              : "bg-slate-700 hover:bg-slate-600"
          }`}
        >
          {settings.autoScale ? "Disable Auto Scale" : "Enable Auto Scale"}
        </button>
      </div>
    </div>
  );
}
