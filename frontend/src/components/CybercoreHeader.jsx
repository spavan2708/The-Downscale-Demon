import React from 'react';
import { useAuth } from '../context/AppContext';

export default function CybercoreHeader({ onKillSwitch }) {
  const { currentUser, setCurrentUser, hasAccess } = useAuth();

  return (
    <header className="border-b-2 border-white/20 pb-4 mb-6 flex justify-between items-center">
      <div>
        <h1 className="text-3xl font-black tracking-tighter text-red-600">DOWNSCALE_DEMON // V2</h1>
        <p className="text-xs text-white/50">SHIFT-AWARE FINOPS ORCHESTRATOR</p>
      </div>
      
      <div className="flex gap-4 items-center">
        <select 
          value={currentUser.role}
          onChange={(e) => setCurrentUser({...currentUser, role: e.target.value})}
          className="bg-black border border-white px-2 py-1 text-xs text-white uppercase font-mono"
        >
          <option value="employee">ROLE: EMPLOYEE</option>
          <option value="manager">ROLE: MANAGER</option>
          <option value="admin">ROLE: CEO / ADMIN</option>
        </select>

        {hasAccess('admin') && (
          <button 
            onClick={onKillSwitch}
            className="px-4 py-2 bg-red-600 hover:bg-white hover:text-red-600 font-black text-xs text-white uppercase border border-red-600 transition-none"
          >
            [ EMERGENCY KILL SWITCH ]
          </button>
        )}
      </div>
    </header>
  );
}