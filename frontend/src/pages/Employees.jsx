import PageHeader from "../components/PageHeader";
import EmployeeTable from "../components/EmployeeTable";

export default function Employees() {
  return (
    <div>
      <PageHeader
        title="Employees"
        subtitle="Shift access, workspaces and overtime status for every team member."
      />
      <EmployeeTable />
    </div>
  );
}
