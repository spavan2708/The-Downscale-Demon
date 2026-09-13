import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AppContext';
import TerminalStream from './components/TerminalStream';

function DashboardContent() {
  const { currentUser, setCurrentUser, hasAccess } = useAuth();
  const [instances, setInstances] = useState([]);
  const [activeTab, setActiveTab] = useState('fleet');
  const [activeDumpTarget, setActiveDumpTarget] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Shift modal state
  const [editingInstance, setEditingInstance] = useState(null);
  const [newStart, setNewStart] = useState('09:00');
  const [newEnd, setNewEnd] = useState('18:00');

  const fetchFleet = () => {
    fetch('/api/instances')
      .then((res) => res.json())
      .then((data) => setInstances(data));
  };

  useEffect(() => {
    fetchFleet();
  }, []);

  const handleStateChange = (instanceId, newState) => {
    fetch('/api/instance/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instance_id: instanceId, target_state: newState })
    }).then(() => fetchFleet());
  };

  const handleSimulateAnomaly = (instanceId) => {
    fetch('/api/instance/anomaly-simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instance_id: instanceId })
    }).then(() => fetchFleet());
  };

  const handleSaveShift = () => {
    if (!editingInstance) return;
    fetch('/api/shift/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instance_id: editingInstance.id, shift_start: newStart, shift_end: newEnd })
    }).then(() => {
      setEditingInstance(null);
      fetchFleet();
    });
  };

  const filteredInstances = instances.filter(inst => 
    inst.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    inst.id.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Top Header */}
      <header className="border-4 border-black bg-white p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-black text-black tracking-tight">DOWNSCALE_DEMON // FINOPS COMMAND</h1>
          <p className="text-xs font-bold text-slate-600 mt-1">AUTOMATED SHIFT-AWARE CLOUD INFRASTRUCTURE ORCHESTRATOR</p>
        </div>

        <div className="flex gap-4 items-center">
          <div className="border-2 border-black bg-slate-100 px-3 py-1.5 text-xs font-bold">
            <span className="text-slate-500 mr-2">SESSION:</span>
            <select 
              value={currentUser.role}
              onChange={(e) => setCurrentUser({...currentUser, role: e.target.value})}
              className="bg-transparent font-bold text-black uppercase focus:outline-none cursor-pointer"
            >
              <option value="employee">EMP: DEV_OPERATOR</option>
              <option value="manager">MGR: TEAM_LEAD</option>
              <option value="admin">ADMIN: CHIEF_ARCHITECT</option>
            </select>
          </div>

          {hasAccess('admin') && (
            <button 
              onClick={() => {
                instances.forEach(inst => {
                  if (!inst.exempt) handleStateChange(inst.id, 'hibernated');
                });
                alert("GLOBAL PURGE EXECUTED: All non-exempt nodes hibernated.");
              }}
              className="px-4 py-2 bg-red-600 hover:bg-black text-white font-black text-xs uppercase border-2 border-black transition-none shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
            >
              [ KILL SWITCH ]
            </button>
          )}
        </div>
      </header>

      {/* Navigation Tabs */}
      <div className="flex border-b-4 border-black gap-2">
        {[
          { id: 'fleet', label: 'FLEET CONTROL' },
          { id: 'shifts', label: 'SHIFT SCHEDULES' },
          { id: 'vault', label: 'CRIU SNAPSHOT VAULT' },
          { id: 'analytics', label: 'FINOPS ANALYTICS' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-6 py-3 font-black text-xs border-t-4 border-x-4 border-black transition-none ${
              activeTab === tab.id ? 'bg-red-600 text-white border-b-0' : 'bg-white text-black hover:bg-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* TAB 1: FLEET CONTROL */}
      {activeTab === 'fleet' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center bg-white p-4 border-2 border-black">
            <input 
              type="text"
              placeholder="Filter by Instance Name or ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="border-2 border-black p-2 text-xs w-72 font-bold focus:outline-none"
            />
            <span className="text-xs font-bold">TOTAL NODES: {filteredInstances.length}</span>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {filteredInstances.map((inst) => (
              <div key={inst.id} className={`bg-white border-2 border-black p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] ${
                inst.anomaly ? 'border-red-600 bg-red-50' : ''
              }`}>
                <div>
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg font-black text-black">{inst.name}</h3>
                    <span className={`text-[10px] font-bold px-2 py-0.5 border border-black ${
                      inst.state === 'idle' ? 'bg-amber-100 text-amber-800' : 
                      inst.state === 'running' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-800'
                    }`}>
                      {inst.state.toUpperCase()}
                    </span>
                    {inst.anomaly && (
                      <span className="text-[10px] font-black px-2 py-0.5 bg-red-600 text-white animate-pulse">
                        OFF-HOURS THREAT DETECTED
                      </span>
                    )}
                    <span className="text-[10px] font-bold px-2 py-0.5 bg-slate-100 border border-black">{inst.type}</span>
                  </div>
                  <p className="text-xs text-slate-600 mt-2 font-bold">
                    ID: {inst.id} | OWNER: {inst.owner} | CPU LOAD: {inst.cpu}% | SHIFT: {inst.shift}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {inst.state !== 'running' && (
                    <button 
                      onClick={() => handleStateChange(inst.id, 'running')}
                      className="px-3 py-1.5 bg-emerald-600 text-white font-bold text-xs border-2 border-black hover:bg-black"
                    >
                      [ WAKE ]
                    </button>
                  )}
                  {hasAccess('manager') && inst.state === 'running' && (
                    <button 
                      onClick={() => setActiveDumpTarget(inst.id)}
                      className="px-3 py-1.5 bg-red-600 text-white font-bold text-xs border-2 border-black hover:bg-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                    >
                      [ CRIU PURGE ]
                    </button>
                  )}
                  <button 
                    onClick={() => handleSimulateAnomaly(inst.id)}
                    className="px-3 py-1.5 bg-white text-black font-bold text-xs border-2 border-black hover:bg-slate-200"
                  >
                    [ TEST ANOMALY ]
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 2: SHIFT SCHEDULES */}
      {activeTab === 'shifts' && (
        <div className="bg-white border-2 border-black p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] space-y-4">
          <h2 className="text-xl font-black text-black">DEVELOPER SHIFT BOUNDARIES</h2>
          <table className="w-full text-left border-collapse border-2 border-black text-xs font-bold">
            <thead>
              <tr className="bg-slate-200 border-b-2 border-black">
                <th className="p-3 border-r-2 border-black">DEVELOPER ID</th>
                <th className="p-3 border-r-2 border-black">ASSIGNED INSTANCE</th>
                <th className="p-3 border-r-2 border-black">SHIFT WINDOW</th>
                <th className="p-3">ACTION</th>
              </tr>
            </thead>
            <tbody>
              {instances.map(inst => (
                <tr key={inst.id} className="border-b border-black hover:bg-slate-50">
                  <td className="p-3 border-r-2 border-black">{inst.owner}</td>
                  <td className="p-3 border-r-2 border-black">{inst.name}</td>
                  <td className="p-3 border-r-2 border-black">{inst.shift}</td>
                  <td className="p-3">
                    {!inst.exempt ? (
                      <button 
                        onClick={() => {
                          setEditingInstance(inst);
                          setNewStart(inst.shift_start);
                          setNewEnd(inst.shift_end);
                        }}
                        className="px-3 py-1 bg-red-600 text-white text-xs font-bold border border-black hover:bg-black"
                      >
                        EDIT SHIFT
                      </button>
                    ) : (
                      <span className="text-slate-400">EXEMPT</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* TAB 3: CRIU VAULT */}
      {activeTab === 'vault' && (
        <div className="bg-white border-2 border-black p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] space-y-4">
          <h2 className="text-xl font-black text-black">STORED MEMORY SNAPSHOTS (CRIU)</h2>
          <div className="grid grid-cols-2 gap-4">
            {instances.filter(i => i.state === 'hibernated').map(inst => (
              <div key={inst.id} className="border-2 border-black p-4 bg-slate-50">
                <span className="text-xs font-black text-red-600">SNAPSHOT_{inst.id}.IMG</span>
                <p className="text-xs text-slate-600 mt-1">NODE: {inst.name} | TMUX PANES: 2 | ARCH: x86_64</p>
                <button 
                  onClick={() => handleStateChange(inst.id, 'running')}
                  className="mt-3 px-3 py-1 bg-black text-white text-xs font-bold hover:bg-red-600"
                >
                  RESTORE SESSION
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 4: FINOPS ANALYTICS */}
      {activeTab === 'analytics' && (
        <div className="bg-white border-2 border-black p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] grid grid-cols-3 gap-4 text-center">
          <div className="border-2 border-black p-6 bg-slate-50">
            <span className="text-xs font-bold text-slate-500">ESTIMATED DAILY SAVINGS</span>
            <div className="text-3xl font-black text-red-600 mt-2">$42.80</div>
          </div>
          <div className="border-2 border-black p-6 bg-slate-50">
            <span className="text-xs font-bold text-slate-500">OFF-HOURS DOWNSCALE RATE</span>
            <div className="text-3xl font-black text-black mt-2">94.2%</div>
          </div>
          <div className="border-2 border-black p-6 bg-slate-50">
            <span className="text-xs font-bold text-slate-500">ACTIVE FINOPS EXEMPTIONS</span>
            <div className="text-3xl font-black text-black mt-2">1 NODE</div>
          </div>
        </div>
      )}

      {/* Edit Shift Modal */}
      {editingInstance && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white border-4 border-black p-6 max-w-md w-full shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] space-y-4">
            <h3 className="text-lg font-black text-black">UPDATE SHIFT WINDOW: {editingInstance.name}</h3>
            <div className="flex gap-4">
              <div>
                <label className="text-xs font-bold block mb-1">START TIME</label>
                <input 
                  type="text" 
                  value={newStart} 
                  onChange={(e) => setNewStart(e.target.value)} 
                  className="border-2 border-black p-2 text-xs font-bold w-full"
                />
              </div>
              <div>
                <label className="text-xs font-bold block mb-1">END TIME</label>
                <input 
                  type="text" 
                  value={newEnd} 
                  onChange={(e) => setNewEnd(e.target.value)} 
                  className="border-2 border-black p-2 text-xs font-bold w-full"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button 
                onClick={() => setEditingInstance(null)}
                className="px-4 py-2 border-2 border-black text-xs font-bold"
              >
                CANCEL
              </button>
              <button 
                onClick={handleSaveShift}
                className="px-4 py-2 bg-red-600 text-white border-2 border-black text-xs font-bold hover:bg-black"
              >
                SAVE SHIFT
              </button>
            </div>
          </div>
        </div>
      )}

      {activeDumpTarget && (
        <TerminalStream 
          instanceId={activeDumpTarget} 
          onClose={() => {
            setActiveDumpTarget(null);
            fetchFleet();
          }} 
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <DashboardContent />
    </AuthProvider>
  );
}