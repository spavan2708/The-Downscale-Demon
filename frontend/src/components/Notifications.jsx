import { useApp } from "../context/useApp";
import { timeAgo } from "../utils/format";

const TYPE_STYLES = {
  success: {
    border: "border-l-green-500",
    icon: "text-green-400",
    iconBg: "bg-green-500/10",
    label: "bg-green-500/10 text-green-400",
  },
  warning: {
    border: "border-l-yellow-500",
    icon: "text-yellow-400",
    iconBg: "bg-yellow-500/10",
    label: "bg-yellow-500/10 text-yellow-400",
  },
  info: {
    border: "border-l-cyan-500",
    icon: "text-cyan-400",
    iconBg: "bg-cyan-500/10",
    label: "bg-cyan-500/10 text-cyan-400",
  },
  error: {
    border: "border-l-red-500",
    icon: "text-red-400",
    iconBg: "bg-red-500/10",
    label: "bg-red-500/10 text-red-400",
  },
};

const TYPE_LABELS = { success: "Success", warning: "Warning", info: "Info", error: "Error" };
const TYPE_ICONS = { success: "✓", warning: "⚠", info: "ℹ", error: "✕" };

export default function Notifications() {
  const { notifications } = useApp();

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">Notifications</h2>
        <span className="rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-400">
          {notifications.length} recent
        </span>
      </div>

      <div className="max-h-80 space-y-4 overflow-y-auto pr-1">
        {notifications.length === 0 && (
          <p className="py-6 text-center text-sm text-slate-500">No notifications yet.</p>
        )}

        {notifications.map((n) => {
          const styles = TYPE_STYLES[n.type] || TYPE_STYLES.info;
          return (
            <div
              key={n.id}
              className={`flex items-start gap-4 rounded-r-xl border-l-4 border-slate-800 bg-slate-800/60 p-4 transition hover:bg-slate-800 ${styles.border}`}
            >
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${styles.iconBg} ${styles.icon}`}
              >
                {TYPE_ICONS[n.type] || "ℹ"}
              </div>

              <div className="min-w-0 flex-1">
                <span
                  className={`mb-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${styles.label}`}
                >
                  {TYPE_LABELS[n.type] || "Info"}
                </span>
                <p className="text-sm font-medium text-slate-200">{n.message}</p>
              </div>

              <span className="shrink-0 text-xs text-slate-500">{timeAgo(n.timestamp)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
