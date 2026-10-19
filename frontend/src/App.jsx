import React, {useState, useEffect, useRef} from 'react';
import {AuthProvider, useAuth} from './context/AppContext';
import TerminalStream from './components/TerminalStream';
import InstanceCard from './components/InstanceCard';
import GovernanceDashboard from './components/GovernanceDashboard';
import AnalyticsDashboard from './components/AnalyticsDashboard';
import './fleet.css';
import SnapshotVault from './components/SnapshotVault';
import './command.css';
import './governance.css';

const button = 'command-button';
const input = 'command-input';
const STATE_KEYS = ['running', 'idle', 'isolated', 'hibernated', 'stopped'];
const workspace = () => ({name: '', instance_type: 't3.medium', shift_start: '09:00', shift_end: '18:00'});

function Dashboard() {
  const {currentUser, token, setSession, api, hasAccess} = useAuth();
  const [timezone, setTimezone] = useState('UTC');
  const [fleet, setFleet] = useState([]), [snapshots, setSnapshots] = useState([]), [analytics, setAnalytics] = useState({});
  const [governance, setGovernance] = useState(null), [telemetryHistory, setTelemetryHistory] = useState([]), [pingMs, setPingMs] = useState(null);
  const [workspaceTelemetry, setWorkspaceTelemetry] = useState({});
  const [runtimeSyncedAt, setRuntimeSyncedAt] = useState(Date.now()), [clockNow, setClockNow] = useState(Date.now());
  const [tab, setTab] = useState('fleet'), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [signupMode, setSignupMode] = useState(false), [isChiefSignup, setIsChiefSignup] = useState(false), [signupDetails, setSignupDetails] = useState({name: '', invitation_token: ''});
  const [inviteMode, setInviteMode] = useState(false), [createdInvite, setCreatedInvite] = useState(null);
  const [credentials, setCredentials] = useState({user_id: '', password: ''});
  const [provision, setProvision] = useState(null), [editing, setEditing] = useState(null), [dump, setDump] = useState(null), [addWorkspaces, setAddWorkspaces] = useState(null);
  const [newWorkspace, setNewWorkspace] = useState(null), [assignment, setAssignment] = useState(null), [lockoutOpen, setLockoutOpen] = useState(false);
  const [busy, setBusy] = useState(false), [search, setSearch] = useState('');
  const fleetRef = useRef(fleet);
  fleetRef.current = fleet;

  const fetchFleet = async () => {
    const data = await api('/api/instances');
    setTimezone(data.timezone || 'UTC');

    const realFleet = data.fleet || [];
    fleetRef.current = realFleet;
    setFleet(realFleet);
    setSnapshots(data.snapshots || []);
    setAnalytics(data.analytics || {});

    if (hasAccess('manager')) {
      const nextGovernance = await api('/api/governance/overview');
      setGovernance(nextGovernance);
      setRuntimeSyncedAt(Date.now());
    } else {
      setGovernance(null);
    }
  };

  useEffect(() => {
    if (!token) {
      setFleet([]); 
      fleetRef.current = []; 
      setSnapshots([]); 
      setAnalytics({}); 
      setGovernance(null); 
      setTelemetryHistory([]); 
      setWorkspaceTelemetry({}); 
      return;
    }
    let disposed = false, socket, timer, pingTimer, lastPing = null;
    const refresh = () => fetchFleet().catch(e => !disposed && setError(e.message));
    const connect = () => {
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/fleet`);
      socket.onopen = () => {
        socket.send(JSON.stringify({token}));
        pingTimer = setInterval(() => {
          if (socket?.readyState !== WebSocket.OPEN) return;
          lastPing = Date.now();
          socket.send(JSON.stringify({type:'PING',sent_at:lastPing}));
        }, 15000);
      };
      socket.onmessage = event => {
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message.type === 'PONG' && message.sent_at === lastPing) setPingMs(Math.max(0,Date.now()-lastPing));
        if (message.analytics) setAnalytics(message.analytics);
        if (message.runtime) {
          setGovernance(previous => previous ? {...previous, runtime: message.runtime} : previous);
          setRuntimeSyncedAt(Date.parse(message.server_time) || Date.now());
        }
        if (Array.isArray(message.telemetry)) {
          if (message.telemetry.length) {
            const observedAt = Date.now();
            const telemetryById = new Map(message.telemetry.map(item=>[item.instance_id,item]));
            const updatedFleet = fleetRef.current.map(item => {
              const reading=telemetryById.get(item.id);
              return reading ? {
                ...item,cpu:Number(reading.cpu_percent),memory_mb:reading.memory_mb,
                memory_percent:reading.memory_percent,state:reading.state,
                access_mode:Boolean(reading.access_mode),active_user:reading.active_user || null,
                telemetry_updated_at:reading.observed_at || new Date(observedAt).toISOString(),
              } : item;
            });
            fleetRef.current=updatedFleet;
            setFleet(updatedFleet);
            setWorkspaceTelemetry(previous => {
              const next = {...previous};
              for (const item of message.telemetry) {
                const current = Array.isArray(next[item.instance_id]) ? next[item.instance_id].filter(point=>!point.demo) : [];
                next[item.instance_id] = [...current, {
                  at:observedAt,
                  cpu:Number(item.cpu_percent),
                  memory:Number(item.memory_percent),
                  demo:false,
                }].filter(point => Number.isFinite(point.cpu) && Number.isFinite(point.memory)).slice(-240);
              }
              return next;
            });
            const powered = message.telemetry.filter(item => ['running','idle'].includes(item.state));
            if (powered.length) {
              const cpu = powered.map(item => Number(item.cpu_percent)).filter(Number.isFinite);
              const memory = powered.map(item => Number(item.memory_percent)).filter(Number.isFinite);
              setTelemetryHistory(previous => [...previous, {
                at: observedAt,
                cpu: cpu.length ? cpu.reduce((sum, value) => sum + value, 0) / cpu.length : 0,
                memory: memory.length ? memory.reduce((sum, value) => sum + value, 0) / memory.length : null,
              }].slice(-60));
            }
          }
        }
        if (message.type === 'SESSION_TERMINATED') setNotice(`Workspace ${message.instance_id} session terminated.`);
        if (['FLEET_UPDATED','SESSION_TERMINATED','SHIFT_EXTENDED','SHIFT_UPDATED','SUPPORT_REQUEST_CREATED','SUPPORT_REQUEST_UPDATED','OVERTIME_REJECTED'].includes(message.type)) refresh();
      };
      socket.onclose = event => {
        clearInterval(pingTimer);
        if (event.code === 4401) {setSession(null); return;}
        if (!disposed) timer = setTimeout(connect, 1500);
      };
    };
    refresh(); connect();
    return () => {disposed = true; clearTimeout(timer); clearInterval(pingTimer); socket?.close();};
  }, [token]);

  useEffect(() => {
    if (!token) return undefined;
    const timer = setInterval(() => setClockNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [token]);

  const perform = async action => {
    setBusy(true); setError('');
    try {return await action();} catch(e) {setError(e.message); return false;} finally {setBusy(false);}
  };

  const post = (path, body) => api(path, {method: 'POST', body: JSON.stringify(body)});

  const state = (id, target_state) => perform(async () => {
    await post('/api/instance/state', {instance_id:id,target_state});
    await fetchFleet();
  });

  const hibernateFleet = () => perform(async () => {
    const targets=fleet.filter(item=>!item.exempt && item.state!=='hibernated');
    for (const instance of targets) await post('/api/instance/state',{instance_id:instance.id,target_state:'hibernated'});
    await fetchFleet();
  });

  const saveShift = values => perform(async () => {
    await post('/api/shift/update',values);
    await fetchFleet();
    setEditing(null);
  });

  const decideRequest = (requestId, decision) => perform(async () => {
    await post(`/api/support/requests/${encodeURIComponent(requestId)}/${decision === 'approved' ? 'approve' : 'reject'}`,{});
    await fetchFleet();
    setNotice(`Shift extension ${decision}.`);
  });

  const handleAccess = (userId, blocked) => perform(async () => {
    try {await post(`/api/employees/${encodeURIComponent(userId)}/access`,{blocked});}
    finally {await fetchFleet();}
  });

  const handleDelete = (id,name) => perform(async () => {
    await api(`/api/workspaces/${encodeURIComponent(id)}`,{method:'DELETE',body:JSON.stringify({confirmation_name:name})});
    await fetchFleet();
    setNotice('Workspace terminated and removed. Detached EBS data is retained.');
    return true;
  });

  const createWorkspace = values => perform(async () => {
    await post('/api/workspaces',values);
    await fetchFleet();
    setNewWorkspace(null);
  });

  const assignWorkspace = values => perform(async () => {
    await post(`/api/workspaces/${encodeURIComponent(values.instance_id)}/assign`,{user_id:values.user_id});
    await fetchFleet();
    setAssignment(null);
  });

  const pendingOvertime = (governance?.requests || []).filter(request => request.request_type === 'overtime' && request.status === 'open');

  if (!currentUser) return <main className="login-panel">
    <h1 className="login-title">{signupMode ? (isChiefSignup ? 'CHIEF ARCHITECT SETUP' : 'CREATE YOUR ACCOUNT') : 'FINOPS COMMAND LOGIN'}</h1>
    <form className="space-y-4" onSubmit={e => {
      e.preventDefault();
      perform(async () => {
        let endpoint = '/api/auth/login';
        let payload = { user_id: credentials.user_id, id: credentials.user_id, password: credentials.password };
        if (signupMode) {
          if (isChiefSignup) {
            endpoint = '/api/auth/signup/chief-architect';
            payload = { user_id: credentials.user_id, name: signupDetails.name || credentials.user_id, password: credentials.password };
          } else {
            endpoint = '/api/auth/signup';
            payload = { user_id: credentials.user_id, id: credentials.user_id, password: credentials.password, ...signupDetails };
          }
        }
        const session = await post(endpoint, payload);
        setSession(session);
        setCredentials({user_id: '', password: ''});
        setSignupDetails({name: '', invitation_token: ''});
      });
    }}>
      <label className="block">User ID<input required className={input} autoComplete="username" value={credentials.user_id} onChange={e => setCredentials({...credentials, user_id: e.target.value})}/></label>
      {signupMode && (
        <>
          <label className="block">Full name<input required className={input} value={signupDetails.name} onChange={e => setSignupDetails({...signupDetails, name: e.target.value})}/></label>
          {!isChiefSignup && <label className="block">Invitation code<input required className={input} value={signupDetails.invitation_token} onChange={e => setSignupDetails({...signupDetails, invitation_token: e.target.value})}/></label>}
        </>
      )}
      <label className="block">Password<input required type="password" minLength={signupMode ? 8 : undefined} maxLength={128} autoComplete={signupMode ? 'new-password' : 'current-password'} className={input} value={credentials.password} onChange={e => setCredentials({...credentials, password: e.target.value})}/></label>
      <button disabled={busy} className={button}>{signupMode ? 'SIGN UP' : 'SIGN IN'}</button>
      <div className="flex gap-2">
        <button type="button" disabled={busy} className={button} onClick={() => {setSignupMode(!signupMode); setIsChiefSignup(false); setError('');}}>{signupMode ? 'BACK TO SIGN IN' : 'EMPLOYEE SIGN UP'}</button>
        {!signupMode && <button type="button" disabled={busy} className={button} onClick={() => {setSignupMode(true); setIsChiefSignup(true); setError('');}}>CHIEF ARCHITECT SETUP</button>}
      </div>
      {error && <p role="alert" className="field-error">{error}</p>}
    </form>
  </main>;

  return <main className="command-shell">
    <header className="command-header">
      <div className="command-brand"><p className="eyebrow">FinOps command center</p><h1>Downscale Demon<span className="brand-dot">.</span></h1><p className="account-line">{currentUser.name} &middot; {{employee:'Employee', manager:'Team Lead', team_lead:'Team Lead', admin:'Chief Architect', chief_architect:'Chief Architect'}[currentUser.role]} &middot; {currentUser.team_id}</p></div>
      <div className="header-actions">
        {/* Notification Badge */}
        {hasAccess('manager') && (
          <button 
            className={`${button} overtime-bell`} 
            aria-label={`${pendingOvertime.length} pending overtime requests`} 
            onClick={() => setTab('fleet')}
          >
            <span aria-hidden="true">🔔</span> Shift Extensions <b>{pendingOvertime.length}</b>
          </button>
        )}

        {/* Primary Provisioning Actions */}
        {hasAccess('admin') && (
          <button className={`${button} command-button-primary`} onClick={() => setNewWorkspace({name:'', instance_type:'t3.medium', shift_start:'09:00', shift_end:'18:00'})}>
            + New Workspace
          </button>
        )}

        {hasAccess('manager') && (
          <>
            <button className={`${button} command-button-primary`} onClick={() => {setInviteMode(false); setProvision({user_id:'', name:'', password:'', team_id:currentUser.team_id || '', role:'employee', instances:[workspace()]});}}>
              + Provision Employee
            </button>
            <button className={button} onClick={() => {setInviteMode(true); setProvision({user_id:'', name:'', password:'', team_id:currentUser.team_id || '', role:'employee', instances:[workspace()]});}}>
              Invite
            </button>
          </>
        )}

        {hasAccess('admin') && (
          <button className={button} disabled={!fleet.some(item => !item.owner)} onClick={() => setAssignment({
            instance_id: fleet.find(item => !item.owner)?.id || '',
            user_id: governance?.employees.find(item => item.role === 'employee')?.id || '',
          })}>
            Assign Workspace
          </button>
        )}

        {/* System & Emergency Controls */}
        {hasAccess('admin') && (
          <>
            <button disabled={busy} className={`${button} command-button-warning`} onClick={hibernateFleet}>
              Hibernate Fleet
            </button>
            <button className={`${button} command-button-danger`} onClick={() => setLockoutOpen(true)}>
              Emergency Lockout
            </button>
          </>
        )}

        {/* Utility */}
        <button className={`${button} button-secondary`} onClick={() => {setSession(null); setProvision(null); setEditing(null); setDump(null); setCreatedInvite(null);}}>
          Sign out
        </button>
      </div>  
    </header>
    {pendingOvertime.length > 0 && hasAccess('manager') && <button type="button" className="pending-extension-banner" onClick={() => setTab('fleet')}><strong>{pendingOvertime.length} Pending Shift Extension{pendingOvertime.length===1?'':'s'}</strong><span>Review overtime requests in Fleet governance</span></button>}
    {error && <p role="alert" className="notice notice-error">{error}</p>}
    {notice && <p role="status" className="notice">{notice}</p>}
    <nav className="command-tabs" aria-label="Command center sections">{['fleet','shifts','vault','analytics'].map(t => <button key={t} className={tab === t ? 'is-active' : ''} aria-current={tab === t ? 'page' : undefined} onClick={() => setTab(t)}>{{fleet:'Fleet',shifts:'Shifts',vault:'Snapshot vault',analytics:'Analytics'}[t]}</button>)}</nav>
    {tab === 'fleet' && hasAccess('manager') && <GovernanceDashboard fleet={fleet} analytics={analytics} governance={governance} telemetryHistory={telemetryHistory} currentUser={currentUser} isAdmin={hasAccess('admin')} busy={busy} pingMs={pingMs} timezone={timezone} demoMode={false}
      onShift={instance => setEditing({instance_id:instance.id,shift_start:instance.shift_start,shift_end:instance.shift_end})}
      onWake={id => state(id,'running')} onPurge={id => setDump(id)}
      onAccess={handleAccess}
      onDecision={decideRequest}
      onDelete={handleDelete}
    />}
    {tab === 'fleet' && !hasAccess('manager') && <section className="fleet-section"><input aria-label="Filter fleet" className={input} placeholder="Search by workspace, instance ID or owner" value={search} onChange={e => setSearch(e.target.value)}/>
      {!fleet.length && <p>No allocated workspaces.</p>}
      <div className="fleet-summary"><div><h2>Workspaces</h2><p>{fleet.length} allocated &middot; {fleet.filter(i => i.state === 'running').length} running &middot; {fleet.filter(i => i.state === 'hibernated').length} hibernated</p></div>
        {hasAccess('manager') && <button className={button} onClick={() => {
          const employees = [...new Set(fleet.map(i => i.owner))].filter(o => o !== currentUser.id);
          if (!employees.length) return;
          setAddWorkspaces({user_id: employees[0], instances: [workspace()]});
        }}>Add workspace to employee</button>}</div>
      <div className="fleet-grid">{[...fleet].sort((a, b) => STATE_KEYS.indexOf(a.state) - STATE_KEYS.indexOf(b.state)).filter(i => `${i.name} ${i.id} ${i.owner}`.toLowerCase().includes(search.toLowerCase())).map(i => <InstanceCard key={i.id} instance={i} busy={busy} canManage={hasAccess('manager')} onWake={() => state(i.id, 'running')} onPurge={() => setDump(i.id)} onAnomaly={() => perform(async () => {const result = await post('/api/instance/anomaly-simulate', {instance_id:i.id}); setNotice(result.context); await fetchFleet();})}/>)}</div>
      {!!fleet.length && !fleet.some(i => `${i.name} ${i.id} ${i.owner}`.toLowerCase().includes(search.toLowerCase())) && <p className="fleet-empty">No workspaces match your search.</p>}
    </section>}
    {tab === 'shifts' && <section className="shifts-section">
      <div className="section-heading"><div><p className="eyebrow">Access windows</p><h2>Shift schedules</h2><p>Workspace hours, shown in {timezone}.</p></div><span className="section-count">{fleet.length} workspaces</span></div>
      <div className="shift-list">{!fleet.length && <p className="empty-message">No workspaces have been allocated yet.</p>}{fleet.map(i => <article key={i.id} className="shift-row">
        <div className="shift-workspace"><h3>{i.name}</h3><p>Employee {i.owner}</p></div>
        <div className="shift-hours"><span className="field-caption">Scheduled hours</span><strong>{i.shift_start || i.shift.split(' - ')[0]} <span aria-hidden="true">&rarr;</span> {i.shift_end || i.shift.split(' - ')[1]}</strong><span className="shift-note">{i.exempt ? 'Exempt from automatic hibernation' : i.shift_start === i.shift_end ? '24-hour access' : i.shift_start > i.shift_end ? 'Ends the following day' : 'Daily schedule'}</span></div>
        {hasAccess('manager') && !i.exempt && <button className={button} onClick={() => setEditing({instance_id:i.id,shift_start:i.shift_start,shift_end:i.shift_end})}>Edit shift</button>}
      </article>)}</div>
      <p className="section-footnote">Outside their shift, workspaces hibernate automatically. Overnight schedules continue into the next day.</p>
    </section>}
    {tab === 'vault' && <SnapshotVault snapshots={snapshots} fleet={fleet} timezone={timezone} busy={busy} onRestore={id => state(id, 'running')}/>}
    {tab === 'analytics' && <AnalyticsDashboard fleet={fleet} analytics={analytics} timezone={timezone} runtime={governance?.runtime} telemetryHistory={telemetryHistory} telemetryByWorkspace={workspaceTelemetry} canViewRuntime={hasAccess('manager')} runtimeSyncedAt={runtimeSyncedAt} clockNow={clockNow}/>}
    {editing && <Modal title="Update shift" close={() => setEditing(null)}><form className="space-y-4" onSubmit={e => {e.preventDefault();saveShift(editing);}}>{['shift_start','shift_end'].map(key => <label key={key} className="block">{{user_id:"User ID",name:"Full name",password:"Password",team_id:"Team",shift_start:"Shift start",shift_end:"Shift end"}[key] || key}<input required type="time" className={input} value={editing[key]} onChange={e => setEditing({...editing,[key]:e.target.value})}/></label>)}<p>Equal boundaries mean 24 hours; overnight shifts are supported.</p><p role="alert" className="field-error">{error}</p><button disabled={busy} className={button}>SAVE</button></form></Modal>}
    {provision && <Modal title={inviteMode ? "Invite user and allocate workspaces" : "Provision employee and workspaces"} close={() => setProvision(null)}><form className="space-y-3" onSubmit={e => {e.preventDefault(); perform(async () => {if (inviteMode) {const {name,password,...invitation} = provision; setCreatedInvite(await post('/api/invitations',invitation));} else {await post('/api/employees',provision);} setProvision(null); await fetchFleet();});}}>
      {(inviteMode ? ['user_id','team_id'] : ['user_id','name','password','team_id']).map(key => <label key={key} className="block">{{user_id:"User ID",name:"Full name",password:"Password",team_id:"Team",shift_start:"Shift start",shift_end:"Shift end"}[key] || key}<input required type={key === 'password' ? 'password' : 'text'} minLength={key === 'password' ? 8 : 1} disabled={key === 'team_id' && !hasAccess('admin')} className={input} value={provision[key]} onChange={e => setProvision({...provision,[key]:e.target.value})}/></label>)}
      {hasAccess('admin') && <label className="block">Role<select className={input} value={provision.role} onChange={e => setProvision({...provision,role:e.target.value})}><option value="employee">Employee</option><option value="team_lead">Team Lead</option></select></label>}
      {provision.instances.map((spec,index) => <fieldset key={index} className="workspace-fields"><legend>Workspace {index+1}</legend>{Object.keys(spec).map(key => <label key={key} className="block">{{name:'Workspace name',instance_type:'Machine type',shift_start:'Shift start',shift_end:'Shift end'}[key]}{key === 'instance_type' ? <select className={input} value={spec[key]} onChange={e => setProvision({...provision,instances:provision.instances.map((s,j) => j === index ? {...s,[key]:e.target.value} : s)})}>{['t3.medium','c5.xlarge','r5.large'].map(t => <option key={t}>{t}</option>)}</select> : <input required type={key.startsWith('shift') ? 'time' : 'text'} className={input} value={spec[key]} onChange={e => setProvision({...provision,instances:provision.instances.map((s,j) => j === index ? {...s,[key]:e.target.value} : s)})}/>}</label>)}</fieldset>)}
      <p role="alert" className="field-error">{error}</p><button type="button" className={button} disabled={provision.instances.length >= 20} onClick={() => setProvision({...provision,instances:[...provision.instances,workspace()]})}>ADD WORKSPACE</button><button disabled={busy} className={button}>{inviteMode ? "CREATE INVITATION" : "CREATE"}</button>
    </form></Modal>}
    {createdInvite && <Modal title="Share sign-up invitation" close={() => setCreatedInvite(null)}><p>Send this User ID and code to the intended user. The code expires in 24 hours and works once.</p><p className="form-note">User ID: {createdInvite.user_id}</p><label className="form-note">Invitation code<input readOnly className={input} value={createdInvite.invitation_token} onFocus={e => e.target.select()}/></label></Modal>}
    {addWorkspaces && <Modal title="Add workspaces to employee" close={() => setAddWorkspaces(null)}><form className="space-y-3" onSubmit={e => {e.preventDefault(); perform(async () => {await post(`/api/employees/${addWorkspaces.user_id}/workspaces`, {instances: addWorkspaces.instances}); setAddWorkspaces(null); await fetchFleet();});}}>
      <label className="block">Employee<select className={input} value={addWorkspaces.user_id} onChange={e => setAddWorkspaces({...addWorkspaces, user_id: e.target.value})}>{[...new Set(fleet.map(i => i.owner))].filter(o => o !== currentUser.id).map(id => <option key={id} value={id}>{id}</option>)}</select></label>
      {addWorkspaces.instances.map((spec,index) => <fieldset key={index} className="workspace-fields"><legend>Workspace {index+1}</legend>{Object.keys(spec).map(key => <label key={key} className="block">{{name:'Workspace name',instance_type:'Machine type',shift_start:'Shift start',shift_end:'Shift end'}[key]}{key === 'instance_type' ? <select className={input} value={spec[key]} onChange={e => setAddWorkspaces({...addWorkspaces,instances:addWorkspaces.instances.map((s,j) => j === index ? {...s,[key]:e.target.value} : s)})}>{['t3.medium','c5.xlarge','r5.large'].map(t => <option key={t}>{t}</option>)}</select> : <input required type={key.startsWith('shift') ? 'time' : 'text'} className={input} value={spec[key]} onChange={e => setAddWorkspaces({...addWorkspaces,instances:addWorkspaces.instances.map((s,j) => j === index ? {...s,[key]:e.target.value} : s)})}/>}</label>)}</fieldset>)}
      <p role="alert" className="field-error">{error}</p><button type="button" className={button} disabled={addWorkspaces.instances.length >= 20} onClick={() => setAddWorkspaces({...addWorkspaces,instances:[...addWorkspaces.instances,workspace()]})}>ADD WORKSPACE</button><button disabled={busy} className={button}>CREATE</button>
    </form></Modal>}
    {newWorkspace && <Modal title="Create an unassigned workspace" close={() => setNewWorkspace(null)}><form onSubmit={event=>{event.preventDefault();createWorkspace(newWorkspace);}}>
      <label>Workspace name<input required maxLength={80} pattern="[A-Za-z0-9 _-]+" className={input} value={newWorkspace.name} onChange={event=>setNewWorkspace({...newWorkspace,name:event.target.value})}/></label>
      <label>Instance type<select className={input} value={newWorkspace.instance_type} onChange={event=>setNewWorkspace({...newWorkspace,instance_type:event.target.value})}>{['t3.medium','c5.xlarge','r5.large'].map(type=><option key={type}>{type}</option>)}</select></label>
      <label>Shift start<input required type="time" className={input} value={newWorkspace.shift_start} onChange={event=>setNewWorkspace({...newWorkspace,shift_start:event.target.value})}/></label>
      <label>Shift end<input required type="time" className={input} value={newWorkspace.shift_end} onChange={event=>setNewWorkspace({...newWorkspace,shift_end:event.target.value})}/></label>
      <p>New environments are unassigned and hibernated until allocated or woken. AWS provisioning is not performed by this registry action.</p>
      <p role="alert" className="field-error">{error}</p><button disabled={busy} className={button}>Create workspace</button>
    </form></Modal>}
    {assignment && <Modal title="Assign workspace to employee" close={() => setAssignment(null)}><form onSubmit={event=>{event.preventDefault();assignWorkspace(assignment);}}>
      <label>Unassigned workspace<select required className={input} value={assignment.instance_id} onChange={event=>setAssignment({...assignment,instance_id:event.target.value})}>{fleet.filter(item=>!item.owner).map(item=><option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
      <label>Employee<select required className={input} value={assignment.user_id} onChange={event=>setAssignment({...assignment,user_id:event.target.value})}>{(governance?.employees||[]).filter(item=>item.role==='employee').map(item=><option value={item.id} key={item.id}>{item.name} · {item.id}</option>)}</select></label>
      <p role="alert" className="field-error">{error}</p><button disabled={busy || !assignment.instance_id || !assignment.user_id} className={button}>Assign workspace</button>
    </form></Modal>}
    {lockoutOpen && <Modal title="Emergency employee lockout" close={() => setLockoutOpen(false)}><p>Lockout revokes active sessions and requests workspace downscale immediately.</p>
      {(governance?.employees||[]).filter(employee=>employee.role==='employee').map(employee=><article className="lockout-row" key={employee.id}><span><strong>{employee.name}</strong><small>{employee.id}</small></span><button type="button" disabled={busy || employee.access_blocked} className="command-button command-button-danger" onClick={async()=>{if(await handleAccess(employee.id,true)!==false)setLockoutOpen(false);}}>Emergency Revoke / Lockout</button></article>)}
      {!governance?.employees?.some(employee=>employee.role==='employee')&&<p>No employees are in the current governance scope.</p>}
    </Modal>}
    {dump && <TerminalStream instanceId={dump} onClose={() => {setDump(null); perform(fetchFleet);}}/>}
  </main>;
}

function Modal({title,close,children}) {return <div className="modal-backdrop"><section role="dialog" aria-modal="true" aria-label={title} className="command-modal"><div className="modal-heading"><h2 className="dialog-title">{title}</h2><button className={button} onClick={close}>CLOSE</button></div>{children}</section></div>;}

export default function App() {return <AuthProvider><Dashboard/></AuthProvider>;}