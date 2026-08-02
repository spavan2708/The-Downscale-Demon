import { useMemo, useState } from "react";
import { useApp } from "../context/useApp";
import Modal from "./Modal";
import StatusBadge from "./StatusBadge";
import { formatIdle, percent } from "../utils/format";

const PAGE_SIZE = 6;
const STATUS_FILTERS = ["All", "Running", "Idle", "Sleeping", "Scaling", "Starting", "Restarting"];

const inputClass =
  "rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none";

const actionButton = (color, hover) =>
  `rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition ${color} ${hover} disabled:cursor-not-allowed disabled:opacity-40`;

export default function WorkspaceTable({ compact = false }) {
  const { workspaces, doScale, doWake, doRestart, doDelete } = useApp();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [sortKey, setSortKey] = useState("name");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const list = workspaces.filter((ws) => {
      const matchesSearch =
        !query ||
        ws.name.toLowerCase().includes(query) ||
        ws.owner.toLowerCase().includes(query) ||
        ws.namespace.toLowerCase().includes(query);
      const matchesStatus = statusFilter === "All" || ws.status === statusFilter;
      return matchesSearch && matchesStatus;
    });

    return [...list].sort((a, b) => {
      const av = a[sortKey] ?? "";
      const bv = b[sortKey] ?? "";
      return typeof av === "string" ? av.localeCompare(bv) : av - bv;
    });
  }, [workspaces, search, statusFilter, sortKey]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const rows = compact
    ? filtered.slice(0, PAGE_SIZE)
    : filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const busy = ["Scaling", "Starting", "Restarting"];

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 px-6 py-5">
        <h2 className="text-xl font-bold text-white">Workspace Monitor</h2>
        {!compact && (
          <div className="flex flex-wrap items-center gap-3">
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search workspace, owner, namespace..."
              className={`${inputClass} w-52`}
            />
            <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className={inputClass}>
              {STATUS_FILTERS.map((s) => <option key={s}>{s}</option>)}
            </select>
            <select value={sortKey} onChange={(e) => setSortKey(e.target.value)} className={inputClass}>
              <option value="name">Sort: Name</option>
              <option value="owner">Sort: Owner</option>
              <option value="cpu">Sort: CPU</option>
              <option value="idle">Sort: Idle Time</option>
            </select>
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-800/40 text-xs uppercase tracking-wider text-slate-400">
              <th className="px-6 py-3.5">Workspace</th>
              <th className="px-6 py-3.5">Owner</th>
              <th className="px-6 py-3.5">CPU</th>
              <th className="px-6 py-3.5">Memory</th>
              <th className="px-6 py-3.5">Pods</th>
              <th className="px-6 py-3.5">Idle</th>
              <th className="px-6 py-3.5">Status</th>
              <th className="px-6 py-3.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((ws) => (
              <tr
                key={ws.id}
                onClick={() => setSelected(ws)}
                className="cursor-pointer border-b border-slate-800/60 transition hover:bg-slate-800/40"
              >
                <td className="px-6 py-4">
                  <p className="font-medium text-slate-200">{ws.name}</p>
                  <p className="text-xs text-slate-500">{ws.namespace}</p>
                </td>
                <td className="px-6 py-4 text-slate-300">{ws.owner}</td>
                <td className="px-6 py-4 tabular-nums text-slate-300">{percent(ws.cpu)}</td>
                <td className="px-6 py-4 tabular-nums text-slate-300">{percent(ws.memory)}</td>
                <td className="px-6 py-4 tabular-nums text-slate-300">{ws.pods}</td>
                <td className="px-6 py-4 tabular-nums text-slate-300">
                  {ws.status === "Sleeping" ? "—" : formatIdle(ws.idle)}
                </td>
                <td className="px-6 py-4">
                  <StatusBadge status={ws.status} />
                </td>
                <td className="px-6 py-4">
                  <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => doScale(ws.id)}
                      disabled={busy.includes(ws.status) || ws.status === "Sleeping"}
                      className={actionButton("bg-red-600", "hover:bg-red-500")}
                    >
                      Scale
                    </button>
                    <button
                      onClick={() => doWake(ws.id)}
                      disabled={busy.includes(ws.status) || ws.status === "Running" || ws.status === "Idle"}
                      className={actionButton("bg-green-600", "hover:bg-green-500")}
                    >
                      Wake
                    </button>
                    <button
                      onClick={() => doRestart(ws.id)}
                      disabled={busy.includes(ws.status)}
                      className={actionButton("bg-cyan-600", "hover:bg-cyan-500")}
                    >
                      Restart
                    </button>
                    <button
                      onClick={() => doDelete(ws.id)}
                      className={actionButton("bg-slate-700", "hover:bg-red-600")}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-6 py-10 text-center text-sm text-slate-500">
                  No workspaces match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {!compact && pageCount > 1 && (
        <div className="flex items-center justify-between border-t border-slate-800 px-6 py-4">
          <p className="text-sm text-slate-400">
            Showing {rows.length} of {filtered.length} workspaces
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage === 1}
              className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold transition hover:bg-slate-700 disabled:opacity-40"
            >
              Prev
            </button>
            <span className="flex items-center px-2 text-sm text-slate-400">
              {safePage} / {pageCount}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={safePage === pageCount}
              className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold transition hover:bg-slate-700 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}

      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected?.name || "Workspace"}>
        {selected && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-white">{selected.name}</p>
                <p className="text-xs text-slate-400">
                  {selected.owner} · {selected.namespace}
                </p>
              </div>
              <StatusBadge status={selected.status} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              {[
                ["CPU Usage", percent(selected.cpu)],
                ["Memory Usage", percent(selected.memory)],
                ["Active Pods", String(selected.pods)],
                ["Idle Time", selected.status === "Sleeping" ? "—" : formatIdle(selected.idle)],
                ["Traffic", `${selected.traffic.toLocaleString()} req/min`],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-slate-800/60 p-3">
                  <p className="text-xs text-slate-400">{label}</p>
                  <p className="mt-1 text-sm font-bold tabular-nums text-white">{value}</p>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-3 pt-2">
              <button
                onClick={() => doScale(selected.id)}
                disabled={busy.includes(selected.status) || selected.status === "Sleeping"}
                className={actionButton("bg-red-600", "hover:bg-red-500")}
              >
                Scale to Zero
              </button>
              <button
                onClick={() => doWake(selected.id)}
                disabled={busy.includes(selected.status) || selected.status === "Running" || selected.status === "Idle"}
                className={actionButton("bg-green-600", "hover:bg-green-500")}
              >
                Wake Workspace
              </button>
              <button
                onClick={() => doRestart(selected.id)}
                disabled={busy.includes(selected.status)}
                className={actionButton("bg-cyan-600", "hover:bg-cyan-500")}
              >
                Restart
              </button>
              <button
                onClick={() => doDelete(selected.id)}
                className={actionButton("bg-slate-700", "hover:bg-red-600")}
              >
                Delete Workspace
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
