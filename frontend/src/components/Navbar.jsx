import { useApp } from "../context/useApp";

const ACCENTS = {
  cyan: "from-cyan-500 to-blue-600",
  emerald: "from-emerald-500 to-teal-600",
  violet: "from-violet-500 to-purple-600",
};

export default function Navbar({ onMenuClick }) {
  const { settings } = useApp();
  const accent = ACCENTS[settings.accent] || ACCENTS.cyan;

  return (
    <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 bg-slate-900/80 px-4 py-4 shadow-md backdrop-blur sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <button
          onClick={onMenuClick}
          className="rounded-lg border border-slate-700 p-2 text-slate-400 transition hover:bg-slate-800 hover:text-white lg:hidden"
          aria-label="Open menu"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold tracking-tight text-white sm:text-2xl">
            TechNova <span className={settings.accent === "emerald" ? "text-emerald-400" : settings.accent === "violet" ? "text-violet-400" : "text-cyan-400"}>Solutions</span>
          </h1>
          <p className="mt-0.5 truncate text-xs text-slate-400 sm:text-sm">
            Enterprise Scale-to-Zero Cloud Workspace Manager
          </p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 rounded-full border border-slate-700 bg-slate-800 px-3 py-1.5">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500"></span>
          </span>
          <span className="text-xs font-semibold text-green-400">System Online</span>
        </div>

        <div className="flex items-center gap-3 rounded-full border border-slate-700 bg-slate-800 py-1.5 pl-1.5 pr-4">
          <div
            className={`flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br text-sm font-bold text-white ${accent}`}
          >
            AP
          </div>
          <div className="hidden sm:block">
            <p className="text-sm font-semibold text-white">Admin</p>
            <p className="text-xs text-slate-400">Platform Owner</p>
          </div>
        </div>
      </div>
    </header>
  );
}
