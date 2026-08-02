import useCountUp from "../hooks/useCountUp";

const COLOR_STYLES = {
  green: {
    text: "text-green-400",
    border: "from-green-500/60",
    iconBg: "bg-green-500/10 border-green-500/30",
    glow: "hover:shadow-green-500/10",
  },
  yellow: {
    text: "text-yellow-400",
    border: "from-yellow-500/60",
    iconBg: "bg-yellow-500/10 border-yellow-500/30",
    glow: "hover:shadow-yellow-500/10",
  },
  cyan: {
    text: "text-cyan-400",
    border: "from-cyan-500/60",
    iconBg: "bg-cyan-500/10 border-cyan-500/30",
    glow: "hover:shadow-cyan-500/10",
  },
  red: {
    text: "text-red-400",
    border: "from-red-500/60",
    iconBg: "bg-red-500/10 border-red-500/30",
    glow: "hover:shadow-red-500/10",
  },
  violet: {
    text: "text-violet-400",
    border: "from-violet-500/60",
    iconBg: "bg-violet-500/10 border-violet-500/30",
    glow: "hover:shadow-violet-500/10",
  },
};

export default function StatCard({ title, value, color = "cyan", icon, format = (n) => n }) {
  const animated = useCountUp(value);
  const styles = COLOR_STYLES[color] || COLOR_STYLES.cyan;

  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl transition-all duration-300 hover:-translate-y-1 hover:border-slate-700 hover:shadow-2xl ${styles.glow}`}
    >
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r ${styles.border} to-transparent`}
      ></div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium text-slate-400">{title}</h2>
          <p className={`mt-3 text-4xl font-bold tabular-nums ${styles.text}`}>
            {format(animated)}
          </p>
        </div>
        {icon && (
          <div
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border text-xl transition-transform duration-300 group-hover:scale-110 ${styles.iconBg}`}
          >
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
