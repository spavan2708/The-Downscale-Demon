const STATUS_STYLES = {
  Running: "bg-green-500/10 text-green-400 border-green-500/30",
  Idle: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  Scaling: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30 animate-pulse",
  Sleeping: "bg-red-500/10 text-red-400 border-red-500/30",
  Starting: "bg-cyan-500/10 text-cyan-400 border-cyan-500/30 animate-pulse",
  Restarting: "bg-violet-500/10 text-violet-400 border-violet-500/30 animate-pulse",
  Allowed: "bg-green-500/10 text-green-400 border-green-500/30",
  Blocked: "bg-red-500/10 text-red-400 border-red-500/30",
  Approved: "bg-green-500/10 text-green-400 border-green-500/30",
  Rejected: "bg-red-500/10 text-red-400 border-red-500/30",
  Pending: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
};

const STATUS_DOTS = {
  Running: "bg-green-500",
  Idle: "bg-yellow-400",
  Scaling: "bg-yellow-400 animate-pulse",
  Sleeping: "bg-red-500",
  Starting: "bg-cyan-400 animate-pulse",
  Restarting: "bg-violet-400 animate-pulse",
};

export default function StatusBadge({ status }) {
  const styles = STATUS_STYLES[status];
  const dot = STATUS_DOTS[status];

  if (!styles) {
    return (
      <span className="inline-block rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-300">
        {status}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${styles}`}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${dot}`}></span>}
      {status}
    </span>
  );
}
