import { useApp } from "../context/useApp";
import StatusBadge from "./StatusBadge";

export default function ManagerPanel() {
  const { overtimeRequests, approveRequest, rejectRequest } = useApp();

  const pending = overtimeRequests.filter((r) => r.status === "pending");
  const history = overtimeRequests.filter((r) => r.status !== "pending");

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">Manager Overtime Requests</h2>
        <span className="rounded-full bg-yellow-500/10 px-3 py-1 text-xs font-semibold text-yellow-400">
          {pending.length} pending
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] text-left">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-800/40 text-xs uppercase tracking-wider text-slate-400">
              <th className="px-4 py-3">Employee</th>
              <th className="px-4 py-3">Workspace</th>
              <th className="px-4 py-3">Reason</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pending.map((req) => (
              <tr
                key={req.id}
                className="border-b border-slate-800/60 transition hover:bg-slate-800/40"
              >
                <td className="px-4 py-4 font-medium text-slate-200">{req.employee}</td>
                <td className="px-4 py-4 text-slate-300">{req.workspace}</td>
                <td className="px-4 py-4 text-slate-300">{req.reason}</td>
                <td className="px-4 py-4">
                  <StatusBadge status="Pending" />
                </td>
                <td className="px-4 py-4">
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => approveRequest(req.id)}
                      className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-green-500"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => rejectRequest(req.id)}
                      className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-500"
                    >
                      Reject
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {pending.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">
                  No pending overtime requests.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {history.length > 0 && (
        <div className="mt-6 border-t border-slate-800 pt-6">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-400">
            Request History
          </h3>
          <div className="space-y-3">
            {history.map((req) => (
              <div
                key={req.id}
                className="flex items-center justify-between rounded-xl bg-slate-800/50 px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-slate-200">
                    {req.employee} · {req.workspace}
                  </p>
                  <p className="text-xs text-slate-500">{req.reason}</p>
                </div>
                <StatusBadge status={req.status === "approved" ? "Approved" : "Rejected"} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
