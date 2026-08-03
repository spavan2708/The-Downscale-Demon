import React, { useContext } from 'react';
import { AppContext } from '../context/AppContext';

export default function DownscaleEngine() {
  const { workspaces, handleWake, handleScaleDown } = useContext(AppContext);

  return (
    <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 shadow-xl">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-emerald-500 animate-pulse"></span>
          Downscale Demon Engine
        </h2>
        <span className="text-xs bg-slate-700 text-slate-300 px-3 py-1 rounded-full font-mono">
          Traffic Monitor Active
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {workspaces.map((ws) => (
          <div key={ws.id} className="bg-slate-900/60 p-4 rounded-lg border border-slate-700/50 flex flex-col justify-between">
            <div>
              <div className="flex justify-between items-start mb-2">
                <div>
                  <h3 className="font-semibold text-slate-200">{ws.developer}</h3>
                  <p className="text-xs text-slate-400">ID: {ws.id} | Shift: {ws.shift}</p>
                </div>
                <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${
                  ws.status === 'Running' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                }`}>
                  {ws.status}
                </span>
              </div>
            </div>

            <div className="flex gap-2 mt-4 pt-3 border-t border-slate-800">
              {ws.status === 'Running' ? (
                <button
                  onClick={() => handleScaleDown(ws.id)}
                  className="flex-1 bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold py-2 px-3 rounded transition-all"
                >
                  Scale to Zero
                </button>
              ) : (
                <button
                  onClick={() => handleWake(ws.id)}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold py-2 px-3 rounded transition-all"
                >
                  Wake Workspace
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}