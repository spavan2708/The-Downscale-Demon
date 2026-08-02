export default function Sidebar() {
  return (
    <div className="w-64 bg-slate-900 min-h-screen p-6 border-r border-slate-700">

      <h1 className="text-2xl font-bold text-cyan-400 mb-10">
        😈 Downscale Demon
      </h1>

      <div className="space-y-5">

        <div className="cursor-pointer hover:text-cyan-400">
          📊 Dashboard
        </div>

        <div className="cursor-pointer hover:text-cyan-400">
          👨‍💼 Employees
        </div>

        <div className="cursor-pointer hover:text-cyan-400">
          ☁️ Workspaces
        </div>

        <div className="cursor-pointer hover:text-cyan-400">
          ⏰ Shift Management
        </div>

        <div className="cursor-pointer hover:text-cyan-400">
          💰 Cloud Savings
        </div>

        <div className="cursor-pointer hover:text-cyan-400">
          📈 Analytics
        </div>

        <div className="cursor-pointer hover:text-cyan-400">
          ⚙️ Settings
        </div>

      </div>

    </div>
  );
}