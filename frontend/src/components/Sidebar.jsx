import { NavLink } from "react-router-dom";
import { useApp } from "../context/useApp";

const menuItems = [
  {
    label: "Dashboard",
    path: "/",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 13h6V4H4v9zm0 7h6v-3H4v3zm10 0h6v-9h-6v9zm0-16v3h6V4h-6z" />
      </svg>
    ),
  },
  {
    label: "Employees",
    path: "/employees",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6-2a3 3 0 10-3-3 3 3 0 003 3z" />
      </svg>
    ),
  },
  {
    label: "Workspaces",
    path: "/workspaces",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 15a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4zm5-8h.01M9 15v3m6-3v3m-9-8h.01M7 7h.01M7 10h.01M17 7h.01M17 10h.01" />
      </svg>
    ),
  },
  {
    label: "Shift Management",
    path: "/shift-management",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    label: "Cloud Savings",
    path: "/cloud-savings",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.66 0-3-1.34-3-3S10.34 2 12 2s3 1.34 3 3-1.34 3-3 3zm0 2c3.87 0 7 3.13 7 7v5H5v-5c0-3.87 3.13-7 7-7z" />
      </svg>
    ),
  },
  {
    label: "Analytics",
    path: "/analytics",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 12l3-3 3 3 4-4M8 21h8m-4-4v4m-8 0h16M4 3h16v18H4V3z" />
      </svg>
    ),
  },
  {
    label: "Settings",
    path: "/settings",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
];

const ACCENTS = {
  cyan: {
    brand: "from-cyan-500 to-blue-600",
    activeText: "text-cyan-400",
    activeBar: "bg-cyan-400",
    activeBg: "bg-cyan-500/15",
  },
  emerald: {
    brand: "from-emerald-500 to-teal-600",
    activeText: "text-emerald-400",
    activeBar: "bg-emerald-400",
    activeBg: "bg-emerald-500/15",
  },
  violet: {
    brand: "from-violet-500 to-purple-600",
    activeText: "text-violet-400",
    activeBar: "bg-violet-400",
    activeBg: "bg-violet-500/15",
  },
};

export default function Sidebar({ open, onClose }) {
  const { settings } = useApp();
  const accent = ACCENTS[settings.accent] || ACCENTS.cyan;

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        ></div>
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-slate-800 bg-slate-900 transition-transform duration-300 lg:static lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-3 border-b border-slate-800 px-6 py-5">
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br text-xl ${accent.brand}`}
          >
            😈
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">Downscale Demon</h1>
            <p className="text-[11px] text-slate-400">Scale-to-Zero Manager</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {menuItems.map((item) => (
            <NavLink
              key={item.label}
              to={item.path}
              end={item.path === "/"}
              onClick={onClose}
              className={({ isActive }) =>
                `flex cursor-pointer items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? `${accent.activeBg} ${accent.activeText}`
                    : "text-slate-400 hover:translate-x-1 hover:bg-slate-800 hover:text-cyan-400"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span className={isActive ? accent.activeText : ""}>{item.icon}</span>
                  {item.label}
                  {isActive && (
                    <span
                      className={`ml-auto h-2 w-2 rounded-full ${accent.activeBar}`}
                    ></span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-slate-800 px-6 py-4">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500"></span>
            </span>
            <p className="text-xs font-medium text-green-400">Infrastructure Healthy</p>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">v2.4.1 · Kubernetes Cluster</p>
        </div>
      </aside>
    </>
  );
}
