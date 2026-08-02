import PageHeader from "../components/PageHeader";
import WorkspaceTable from "../components/WorkspaceTable";

export default function Workspaces() {
  return (
    <div>
      <PageHeader
        title="Workspaces"
        subtitle="Manage cloud workspaces, scale to zero and wake resources on demand."
      />
      <WorkspaceTable />
    </div>
  );
}
