import React, { useState, useEffect } from 'react';

export default function TerminalStream({ instanceId, onClose }) {
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    const ws = new WebSocket(`ws://${window.location.host}/ws/criu-dump/${instanceId}`);
    ws.onmessage = (event) => setLogs((prev) => [...prev, event.data]);
    return () => ws.close();
  }, [instanceId]);

  return (
    <div className="fixed inset-0 bg-black/60 z-50 p-8 font-mono flex items-center justify-center">
      <div className="border-4 border-black max-w-4xl w-full bg-white p-6 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
        <div className="flex justify-between items-center border-b-2 border-black pb-3 mb-4">
          <span className="text-red-600 font-black text-sm">> LIVE CRIU KERNEL MEMORY DUMP TELEMETRY</span>
          <button 
            onClick={onClose} 
            className="text-xs font-black border-2 border-black px-3 py-1 bg-red-600 text-white hover:bg-black transition-none"
          >
            [ DISMISS ]
          </button>
        </div>
        <div className="h-64 overflow-y-auto text-xs font-bold text-black space-y-1 bg-slate-100 border-2 border-black p-4">
          {logs.map((log, i) => (
            <div key={i} className={log.includes('COMPLETE') ? 'text-emerald-700 font-black' : ''}>
              {log}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}