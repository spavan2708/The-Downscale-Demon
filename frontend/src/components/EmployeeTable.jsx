import { useMemo, useState } from "react";
import { useApp } from "../context/useApp";
import LoadingSkeleton from "./LoadingSkeleton";
import ErrorCard from "./ErrorCard";
import Modal from "./Modal";
import StatusBadge from "./StatusBadge";

const PAGE_SIZE = 5;
const ROLE_FILTERS = ["All", "Developer", "Manager"];
const SHIFT_FILTERS = ["All", "Day Shift", "Night Shift", "Flexible"];
const ACCESS_FILTERS = ["All", "Allowed", "Blocked"];

const inputClass =
  "rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none";

export default function EmployeeTable({ compact = false }) {
  const { employees, employeesLoading, employeesError, loadEmployees } = useApp();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("All");
  const [shiftFilter, setShiftFilter] = useState("All");
  const [accessFilter, setAccessFilter] = useState("All");
  const [sortKey, setSortKey] = useState("name");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const list = employees.filter((emp) => {
      const matchesSearch =
        !query ||
        emp.name.toLowerCase().includes(query) ||
        emp.role.toLowerCase().includes(query) ||
        emp.workspace.toLowerCase().includes(query);
      const matchesRole = roleFilter === "All" || emp.role === roleFilter;
      const matchesShift = shiftFilter === "All" || emp.shift === shiftFilter;
      const matchesAccess =
        accessFilter === "All" ||
        (accessFilter === "Allowed" && emp.access) ||
        (accessFilter === "Blocked" && !emp.access);
      return matchesSearch && matchesRole && matchesShift && matchesAccess;
    });

    return [...list].sort((a, b) => {
      const av = a[sortKey] ?? "";
      const bv = b[sortKey] ?? "";
      return typeof av === "string" ? av.localeCompare(bv) : av - bv;
    });
  }, [employees, search, roleFilter, shiftFilter, accessFilter, sortKey]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const rows = compact ? filtered.slice(0, PAGE_SIZE) : filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  if (employeesLoading) return <LoadingSkeleton rows={5} />;
  if (employeesError) return <ErrorCard message={employeesError} onRetry={loadEmployees} />;

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 px-6 py-5">
        <h2 className="text-xl font-bold text-white">Employee Shift Access</h2>
        {!compact && (
          <div className="flex flex-wrap items-center gap-3">
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search name, role, workspace..."
              className={`${inputClass} w-52`}
            />
            <select value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }} className={inputClass}>
              {ROLE_FILTERS.map((r) => <option key={r}>{r}</option>)}
            </select>
            <select value={shiftFilter} onChange={(e) => { setShiftFilter(e.target.value); setPage(1); }} className={inputClass}>
              {SHIFT_FILTERS.map((s) => <option key={s}>{s}</option>)}
            </select>
            <select value={accessFilter} onChange={(e) => { setAccessFilter(e.target.value); setPage(1); }} className={inputClass}>
              {ACCESS_FILTERS.map((a) => <option key={a}>{a}</option>)}
            </select>
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-800/40 text-xs uppercase tracking-wider text-slate-400">
              {["name", "role", "shift", "workspace", "access"].map((key) => (
                <th key={key} className="px-6 py-3.5">
                  {compact ? (
                    key.charAt(0).toUpperCase() + key.slice(1)
                  ) : (
                    <button
                      onClick={() => setSortKey(key)}
                      className={`uppercase tracking-wider transition hover:text-cyan-400 ${sortKey === key ? "text-cyan-400" : ""}`}
                    >
                      {key === "access" ? "Access" : key.charAt(0).toUpperCase() + key.slice(1)}
                      {sortKey === key ? " ↓" : ""}
                    </button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((emp) => (
              <tr
                key={emp.id}
                onClick={() => setSelected(emp)}
                className="cursor-pointer border-b border-slate-800/60 transition hover:bg-slate-800/40"
              >
                <td className="px-6 py-4 font-medium text-slate-200">{emp.name}</td>
                <td className="px-6 py-4 text-slate-300">{emp.role}</td>
                <td className="px-6 py-4 text-slate-300">{emp.shift}</td>
                <td className="px-6 py-4 text-slate-300">{emp.workspace}</td>
                <td className="px-6 py-4">
                  <StatusBadge status={emp.access ? "Allowed" : "Blocked"} />
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-10 text-center text-sm text-slate-500">
                  No employees match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {!compact && pageCount > 1 && (
        <div className="flex items-center justify-between border-t border-slate-800 px-6 py-4">
          <p className="text-sm text-slate-400">
            Showing {rows.length} of {filtered.length} employees
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

      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected?.name || "Employee"}>
        {selected && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {[
                ["Role", selected.role],
                ["Shift", selected.shift],
                ["Workspace", selected.workspace],
                ["Department", selected.department || "—"],
                ["Manager", selected.manager || "—"],
                ["Overtime", selected.overtime ? "Approved" : "None"],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-slate-800/60 p-3">
                  <p className="text-xs text-slate-400">{label}</p>
                  <p className="mt-1 text-sm font-semibold text-white">{value}</p>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between rounded-xl bg-slate-800/60 p-3">
              <div>
                <p className="text-xs text-slate-400">Access Status</p>
                <p className="mt-1 text-sm font-semibold text-white">
                  {selected.access ? "Workspace access allowed" : "Workspace access blocked"}
                </p>
              </div>
              <StatusBadge status={selected.access ? "Allowed" : "Blocked"} />
            </div>

            <div className="rounded-xl bg-slate-800/60 p-3">
              <p className="text-xs text-slate-400">Recent Activity</p>
              <p className="mt-1 text-sm text-slate-200">
                {selected.activity || "No recent activity recorded"}
              </p>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
