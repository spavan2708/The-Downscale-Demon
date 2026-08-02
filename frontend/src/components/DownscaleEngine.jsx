import { useState } from "react";

export default function DownscaleEngine() {

  const [status, setStatus] = useState("Running");

  function handleScale() {
    setStatus("Scaling to Zero...");

    setTimeout(() => {
      setStatus("Sleeping");
    }, 2500);
  }

  function handleWake() {
    setStatus("Waking Workspace...");

    setTimeout(() => {
      setStatus("Running");
    }, 2000);
  }

  return (
    <div className="mt-10 bg-slate-800 rounded-xl p-6 shadow-lg">

      <h2 className="text-2xl font-bold mb-6">
        😈 Downscale Demon Engine
      </h2>

      <div className="flex justify-between items-center">

        <div>

          <p className="text-slate-400">
            Current Workspace Status
          </p>

          <h1
            className={`text-3xl font-bold mt-3 ${
              status === "Running"
                ? "text-green-400"
                : status === "Sleeping"
                ? "text-red-400"
                : "text-yellow-400"
            }`}
          >
            {status}
          </h1>

        </div>

        <div className="space-x-4">

          <button
            onClick={handleScale}
            className="bg-red-600 hover:bg-red-700 px-5 py-3 rounded-lg"
          >
            Scale to Zero
          </button>

          <button
            onClick={handleWake}
            className="bg-green-600 hover:bg-green-700 px-5 py-3 rounded-lg"
          >
            Wake Workspace
          </button>

        </div>

      </div>

      <div className="mt-8">

        <div className="w-full h-3 bg-slate-700 rounded-full overflow-hidden">

          <div
            className={`h-3 rounded-full transition-all duration-1000 ${
              status === "Running"
                ? "bg-green-500 w-full"
                : status === "Sleeping"
                ? "bg-red-500 w-1/5"
                : "bg-yellow-500 w-2/3"
            }`}
          ></div>

        </div>

      </div>

    </div>
  );
}