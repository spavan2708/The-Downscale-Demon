import DownscaleEngine from "../components/DownscaleEngine";
import { useEffect, useState } from "react";
import Sidebar from "../components/Sidebar";
import ManagerPanel from "../components/ManagerPanel";
import { getEmployees } from "../services/employeeService";

export default function Dashboard() {

  const [employees, setEmployees] = useState([]);

  useEffect(() => {
    async function loadEmployees() {
      try {
        const data = await getEmployees();
        setEmployees(data);
      } catch (error) {
        console.error("Failed to load employees:", error);
      }
    }

    loadEmployees();
  }, []);

  return (
    <div className="flex min-h-screen bg-slate-950 text-white">

      <Sidebar />

      <div className="flex-1 p-8">

        {/* Header */}

        <div>

          <h1 className="text-4xl font-bold">
            The Downscale Demon
          </h1>

          <p className="text-slate-400 mt-2">
            Enterprise Scale-to-Zero Cloud Workspace Manager
          </p>

        </div>

        {/* Statistics */}

        <div className="grid grid-cols-4 gap-6 mt-10">

          <div className="bg-slate-800 rounded-xl p-6 shadow-lg">

            <h2 className="text-slate-400">
              Running Workspaces
            </h2>

            <p className="text-4xl font-bold mt-3 text-green-400">
              32
            </p>

          </div>

          <div className="bg-slate-800 rounded-xl p-6 shadow-lg">

            <h2 className="text-slate-400">
              Sleeping Workspaces
            </h2>

            <p className="text-4xl font-bold mt-3 text-yellow-400">
              92
            </p>

          </div>

          <div className="bg-slate-800 rounded-xl p-6 shadow-lg">

            <h2 className="text-slate-400">
              Cloud Savings
            </h2>

            <p className="text-4xl font-bold mt-3 text-cyan-400">
              ₹18,430
            </p>

          </div>

          <div className="bg-slate-800 rounded-xl p-6 shadow-lg">

            <h2 className="text-slate-400">
              Pending Overtime
            </h2>

            <p className="text-4xl font-bold mt-3 text-red-400">
              3
            </p>

          </div>

        </div>

        {/* Employee Shift Access */}

        <div className="mt-10 bg-slate-800 rounded-xl p-6">

          <h2 className="text-2xl font-bold mb-6">
            Employee Shift Access
          </h2>

          <table className="w-full">

            <thead>

              <tr className="border-b border-slate-700 text-slate-400">

                <th className="text-left pb-3">
                  Employee
                </th>

                <th className="text-left pb-3">
                  Role
                </th>

                <th className="text-left pb-3">
                  Shift
                </th>

                <th className="text-left pb-3">
                  Workspace
                </th>

                <th className="text-left pb-3">
                  Access
                </th>

              </tr>

            </thead>

            <tbody>

              {employees.map((emp) => (

                <tr
                  key={emp.id}
                  className="border-b border-slate-700"
                >

                  <td className="py-4">
                    {emp.name}
                  </td>

                  <td>
                    {emp.role}
                  </td>

                  <td>
                    {emp.shift}
                  </td>

                  <td>
                    {emp.workspace}
                  </td>

                  <td
                    className={`font-bold ${
                      emp.access
                        ? "text-green-400"
                        : "text-red-400"
                    }`}
                  >
                    {emp.access ? "✅ Allowed" : "❌ Blocked"}
                  </td>

                </tr>

              ))}

            </tbody>

          </table>

        </div>

        {/* Workspace Monitor */}

        <div className="mt-10 bg-slate-800 rounded-xl p-6">

          <h2 className="text-2xl font-bold mb-6">
            Workspace Monitor
          </h2>

          <table className="w-full">

            <thead>

              <tr className="border-b border-slate-700 text-slate-400">

                <th className="text-left pb-3">
                  Workspace
                </th>

                <th className="text-left pb-3">
                  Owner
                </th>

                <th className="text-left pb-3">
                  Status
                </th>

                <th className="text-left pb-3">
                  Action
                </th>

              </tr>

            </thead>

            <tbody>

              <tr className="border-b border-slate-700">

                <td className="py-4">
                  Feature-Login
                </td>

                <td>
                  Ravi Kumar
                </td>

                <td className="text-green-400 font-bold">
                  🟢 Running
                </td>

                <td>

                  <button className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded">

                    Scale Down

                  </button>

                </td>

              </tr>

              <tr className="border-b border-slate-700">

                <td className="py-4">
                  Feature-Payment
                </td>

                <td>
                  Priya Sharma
                </td>

                <td className="text-yellow-400 font-bold">
                  🟡 Idle (28 mins)
                </td>

                <td>

                  <button className="bg-yellow-600 hover:bg-yellow-700 px-4 py-2 rounded">

                    Monitor

                  </button>

                </td>

              </tr>

              <tr>

                <td className="py-4">
                  Feature-Dashboard
                </td>

                <td>
                  Arjun
                </td>

                <td className="text-red-400 font-bold">
                  🔴 Sleeping
                </td>

                <td>

                  <button className="bg-green-600 hover:bg-green-700 px-4 py-2 rounded">

                    Wake Workspace

                  </button>

                </td>

              </tr>

            </tbody>

          </table>

        </div>

        {/* Manager Panel */}

        <ManagerPanel />
        <DownscaleEngine />

      </div>

    </div>
  );
}