import { useApp } from "../context/useApp";
import StatCard from "../components/StatCard";
import Analytics from "../components/Analytics";
import EmployeeTable from "../components/EmployeeTable";
import WorkspaceTable from "../components/WorkspaceTable";
import DownscaleEngine from "../components/DownscaleEngine";
import ManagerPanel from "../components/ManagerPanel";
import Notifications from "../components/Notifications";
import { formatCurrency } from "../utils/format";

export default function Dashboard() {
  const { stats } = useApp();

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Running Workspaces"
          value={stats.running}
          color="green"
          icon="🟢"
        />
        <StatCard
          title="Sleeping Workspaces"
          value={stats.sleeping}
          color="yellow"
          icon="🌙"
        />
        <StatCard
          title="Cloud Savings"
          value={stats.cloudSavings}
          color="cyan"
          icon="💰"
          format={formatCurrency}
        />
        <StatCard
          title="Pending Overtime"
          value={stats.pendingOvertime}
          color="red"
          icon="⏰"
        />
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Analytics />
        <div className="xl:col-span-2">
          <EmployeeTable compact />
        </div>
      </section>

      <WorkspaceTable compact />

      <DownscaleEngine />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <ManagerPanel />
        <Notifications />
      </div>
    </div>
  );
}
