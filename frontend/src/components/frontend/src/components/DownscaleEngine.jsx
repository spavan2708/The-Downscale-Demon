import { useState } from "react";

export default function DownscaleEngine() {

  const [workspaces, setWorkspaces] = useState([
    {
      id: 1,
      name: "Feature-Login",
      idle: 12,
      status: "Running"
    },
    {
      id: 2,
      name: "Feature-Payment",
      idle: 31,
      status: "Idle"
    },
    {
      id: 3,
      name: "Feature-Dashboard",
      idle: 0,
      status: "Sleeping"
    }
  ]);

  function runDownscale() {

    const updated = workspaces.map((ws) => {

      if (ws.idle >= 30 && ws.status !== "Sleeping") {

        return {
          ...ws,
          status: "Sleeping"
        };

      }

      return ws;

    });

    setWorkspaces(updated);

  }

  function wakeWorkspace(id) {

    const updated = workspaces.map((ws) => {

      if (ws.id === id) {

        return {
          ...ws,
          status: "Running",
          idle: 0
        };

      }

      return ws;

    });

    setWorkspaces(updated);

  }

  return (

    <div className="mt-10 bg-slate-800 rounded-xl p-6">

      <div className="flex justify-between items-center mb-6">

        <h2 className="text-2xl font-bold">
          😈 Downscale Demon Engine
        </h2>

        <button
          onClick={runDownscale}
          className="bg-red-600 hover:bg-red-700 px-5 py-2 rounded"
        >
          Run Idle Scan
        </button>

      </div>

      <table className="w-full">

        <thead>

          <tr className="border-b border-slate-700 text-slate-400">

            <th className="text-left pb-3">Workspace</th>
            <th className="text-left pb-3">Idle Time</th>
            <th className="text-left pb-3">Status</th>
            <th className="text-left pb-3">Action</th>

          </tr>

        </thead>

        <tbody>

          {workspaces.map((ws) => (

            <tr
              key={ws.id}
              className="border-b border-slate-700"
            >

              <td className="py-4">
                {ws.name}
              </td>

              <td>

                {ws.status === "Sleeping"
                  ? "-"
                  : `${ws.idle} mins`}

              </td>

              <td>

                {ws.status === "Running" && (
                  <span className="text-green-400 font-bold">
                    🟢 Running
                  </span>
                )}

                {ws.status === "Idle" && (
                  <span className="text-yellow-400 font-bold">
                    🟡 Idle
                  </span>
                )}

                {ws.status === "Sleeping" && (
                  <span className="text-red-400 font-bold">
                    🔴 Sleeping
                  </span>
                )}

              </td>

              <td>

                {ws.status === "Sleeping" ? (

                  <button
                    onClick={() => wakeWorkspace(ws.id)}
                    className="bg-green-600 hover:bg-green-700 px-4 py-2 rounded"
                  >
                    Wake
                  </button>

                ) : (

                  <span className="text-slate-400">
                    Monitoring...
                  </span>

                )}

              </td>

            </tr>

          ))}

        </tbody>

      </table>

    </div>

  );

}