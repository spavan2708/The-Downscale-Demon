import { useApp } from "../context/useApp";
import PageHeader from "../components/PageHeader";
import StatusBadge from "../components/StatusBadge";
import useClock from "../hooks/useClock";

const inputClass =
  "rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none";

export default function ShiftManagement() {
  const { employees, employeesLoading, changeShift, toggleAccess, toggleOvertime } = useApp();
  const clock = useClock();

  if (employeesLoading) {
    return (
      <div>
        <PageHeader title="Shift Management" subtitle="Loading employee shift data..." />
        <div className="h-40 animate-pulse rounded-2xl bg-slate-900"></div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Shift Management"
        subtitle="Approve overtime, change shifts and control workspace access in real time."
        actions={
          <div className="flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900 px-4 py-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75"></span>
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-cyan-400"></span>
            </span>
            <span className="text-sm font-semibold tabular-nums text-cyan-400">{clock}</span>
          </div>
        }
      />

      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-800/40 text-xs uppercase tracking-wider text-slate-400">
                <th className="px-6 py-3.5">Employee</th>
                <th className="px-6 py-3.5">Shift</th>
                <th className="px-6 py-3.5">Workspace</th>
                <th className="px-6 py-3.5">Access</th>
                <th className="px-6 py-3.5">Overtime</th>
                <th className="px-6 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => (
                <tr
                  key={emp.id}
                  className="border-b border-slate-800/60 transition hover:bg-slate-800/40"
                >
                  <td className="px-6 py-4">
                    <p className="font-medium text-slate-200">{emp.name}</p>
                    <p className="text-xs text-slate-500">{emp.role}</p>
                  </td>
                  <td className="px-6 py-4">
                    <select
                      value={emp.shift}
                      onChange={(e) => changeShift(emp.name, e.target.value)}
                      className={inputClass}
                    >
                      <option>Day Shift</option>
                      <option>Night Shift</option>
                      <option>Flexible</option>
                    </select>
                  </td>
                  <td className="px-6 py-4 text-slate-300">{emp.workspace}</td>
                  <td className="px-6 py-4">
                    <StatusBadge status={emp.access ? "Allowed" : "Blocked"} />
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge status={emp.overtime ? "Approved" : "Pending"} />
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => toggleOvertime(emp.name, !emp.overtime)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition ${
                          emp.overtime
                            ? "bg-slate-700 hover:bg-red-600"
                            : "bg-green-600 hover:bg-green-500"
                        }`}
                      >
                        {emp.overtime ? "Reject Overtime" : "Approve Overtime"}
                      </button>
                      <button
                        onClick={() => toggleAccess(emp.name)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition ${
                          emp.access
                            ? "bg-red-600 hover:bg-red-500"
                            : "bg-cyan-600 hover:bg-cyan-500"
                        }`}
                      >
                        {emp.access ? "Block Access" : "Grant Access"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
