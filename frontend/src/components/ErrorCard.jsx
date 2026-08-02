export default function ErrorCard({ message, onRetry }) {
  return (
    <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-8 text-center shadow-xl">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-500/10 text-2xl">
        ⚠️
      </div>
      <h3 className="mt-4 text-lg font-bold text-red-400">Unable to load data</h3>
      <p className="mt-2 text-sm text-slate-400">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-5 rounded-lg bg-red-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-500"
        >
          Retry
        </button>
      )}
    </div>
  );
}
