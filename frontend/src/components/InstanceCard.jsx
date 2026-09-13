import React from 'react';
import { useAuth } from '../context/AppContext';

export default function InstanceCard({ instance, onPurge }) {
  const { currentUser, hasAccess } = useAuth();
  const isIdle = instance.state === 'idle';

  return (
    <div className={`p-4 border-[1px] font-mono flex justify-between items-center ${isIdle ? 'border-red-600 bg-red-950/20' : 'border-white/20 bg-black'}`}>
      <div>
        <div className="flex gap-3 items-center">
          <h3 className={`text-lg font-bold ${isIdle ? 'text-red-500 animate-pulse' : 'text-white'}`}>{instance.name}</h3>
          <span className="text-[10px] px-2 py-0.5 border border-white/40">{instance.type}</span>
        </div>
        <p className="text-xs text-white/50 mt-1">ID: {instance.id} | OWNER: {instance.owner} | CPU: {instance.cpu}%</p>
      </div>

      <div className="flex gap-2">
        {/* Employees can wake their assigned instance */}
        {(hasAccess('employee') && instance.owner === currentUser.id) && (
          <button className="px-3 py-1.5 border border-white text-white text-xs font-bold hover:bg-white hover:text-black">
            [ WAKE ]
          </button>
        )}

        {/* Managers and Admins can trigger state preservation & cut-off */}
        {hasAccess('manager') && (
          <button 
            onClick={() => onPurge(instance.id)}
            className="px-3 py-1.5 bg-red-600 text-white text-xs font-bold border border-red-600 hover:bg-white hover:text-red-600"
          >
            [ C-R-I-U DUMP & PURGE ]
          </button>
        )}
      </div>
    </div>
  );
}