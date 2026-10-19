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
const isLocalDemoHost = typeof window !== 'undefined'
  && ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
  && import.meta.env.VITE_LOCAL_DEMO !== '0';
function createDemoTelemetry() {
  const cpu = [24, 31, 18, 44, 37, 52, 29, 63, 41, 35];
  const memory = [48, 51, 46, 59, 55, 68, 53, 72, 61, 57];
  const now = Date.now();
  return cpu.map((value, index) => ({
    at: now - (cpu.length - index - 1) * 10_000,
    cpu: value,
    memory: memory[index],
    demo: true,
  }));
}
function createDemoFleet() {
  const at = Date.now();
  return [
    {id:'local-demo-alpha',name:'DEV-SANDBOX-ALPHA',owner:'demo-employee',type:'t3.medium',hourly_rate:0.0416,state:'running',cpu:38.4,memory_mb:768,memory_percent:58.6,shift_start:'09:00',shift_end:'18:00',shift:'09:00 - 18:00',access_mode:true,active_user:'Alex Chen',active_user_id:'demo-employee',is_production:false,exempt:false,anomaly:false,telemetry_updated_at:new Date(at).toISOString()},
    {id:'local-demo-prod',name:'PROD-ANALYTICS-DB',owner:'demo-data-team',type:'r5.large',hourly_rate:0.126,state:'running',cpu:27.2,memory_mb:4096,memory_percent:63.2,shift_start:'00:00',shift_end:'00:00',shift:'00:00 - 00:00',access_mode:true,active_user:'Morgan Lee',active_user_id:'demo-data-team',is_production:true,exempt:true,anomaly:false,telemetry_updated_at:new Date(at).toISOString()},
    {id:'local-demo-build',name:'BUILD-WORKER-IDLE',owner:null,type:'c5.xlarge',hourly_rate:0.17,state:'hibernated',cpu:0,memory_mb:1024,memory_percent:36.8,shift_start:'08:00',shift_end:'18:00',shift:'08:00 - 18:00',access_mode:false,active_user:null,active_user_id:null,is_production:false,exempt:false,anomaly:false,telemetry_updated_at:new Date(at).toISOString()},
    {id:'local-demo-ml',name:'ML-TRAINING-SANDBOX',owner:'demo-ml-team',type:'t3.medium',hourly_rate:0.0416,state:'isolated',cpu:91.2,memory_mb:1536,memory_percent:82.5,shift_start:'09:00',shift_end:'18:00',shift:'09:00 - 18:00',access_mode:false,active_user:null,active_user_id:null,is_production:false,exempt:false,anomaly:true,telemetry_updated_at:new Date(at).toISOString()},
  ];
}
function createDemoGovernance() {
  return {
    employees:[
      {id:'demo-employee',name:'Alex Chen',role:'employee',team_id:'DEMO',workspace_count:1,access_blocked:false},
      {id:'demo-data-team',name:'Morgan Lee',role:'employee',team_id:'DEMO',workspace_count:1,access_blocked:false},
      {id:'demo-build-team',name:'Sam Patel',role:'employee',team_id:'DEMO',workspace_count:1,access_blocked:false},
      {id:'demo-ml-team',name:'Jamie Rivera',role:'employee',team_id:'DEMO',workspace_count:1,access_blocked:false},
    ],
    requests:[{
      id:'local-demo-overtime',owner_id:'demo-employee',team_id:'DEMO',instance_id:'local-demo-alpha',
      request_type:'overtime',extension_hours:2,subject:'+2 Hours Shift Extension',
      details:'Release verification needs an additional two-hour shift window.',
      status:'open',created_at:new Date().toISOString(),
    }],
    runtime:{
      workspaces:[
        {instance_id:'local-demo-alpha',active_hours:4.5,hibernated_hours:2.25,managed_compute_usd:0.1872},
        {instance_id:'local-demo-prod',active_hours:24,hibernated_hours:0,managed_compute_usd:3.024},
        {instance_id:'local-demo-build',active_hours:1.75,hibernated_hours:12,managed_compute_usd:0.2975},
        {instance_id:'local-demo-ml',active_hours:0.5,hibernated_hours:20,managed_compute_usd:0.0208},
      ],
      active_hours:30.75,hibernated_hours:34.25,tracked_hours:65,
      today_active_hours:30.75,today_hibernated_hours:34.25,
      today_estimated_credits_preserved_usd:2.9024,
      estimated_credits_preserved_usd:2.9024,
      baseline_compute_usd:4.3776,managed_compute_usd:3.5295,
      daily_tracking_timezone:'UTC',
    },
    audit:[],
    aws_lifecycle_enabled:false,
  };
}
function createDemoWorkspaceTelemetry() {
  const readings = {
    'local-demo-alpha': [[31,52],[28,55],[43,62],[35,57],[48,70],[38.4,58.6]],
    'local-demo-prod': [[24,58],[29,61],[33,67],[22,60],[31,65],[27.2,63.2]],
    'local-demo-build': [[9,33],[13,35],[7,31],[18,41],[11,37],[0,36.8]],
    'local-demo-ml': [[44,58],[59,65],[72,74],[83,80],[91,85],[91.2,82.5]],
  };
  const now = Date.now();
  return Object.fromEntries(Object.entries(readings).map(([id, points]) => [
    id, points.map(([cpu,memory],index) => ({
      at:now - (points.length-index-1)*60_000,cpu,memory,
      shift_start_cpu:points[0][0],shift_start_memory:points[0][1],demo:true,
    })),
  ]));
}
function createTelemetryFallbackForFleet(items) {
  const now=Date.now();
  return Object.fromEntries(items.map((item,workspaceIndex)=>[
    item.id,
    Array.from({length:10},(_,index)=>({
      at:now-(9-index)*60_000,
      cpu:15+((index*17+workspaceIndex*13)%51),
      memory:40+((index*9+workspaceIndex*11)%36),
      demo:true,
    })),
  ]));
}
const button = 'command-button';
const input = 'command-input';
const STATE_KEYS = ['running', 'idle', 'isolated', 'hibernated', 'stopped'];
const workspace = () => ({name: '', instance_type: 't3.medium', shift_start: '09:00', shift_end: '18:00'});
function Dashboard() {
  const {currentUser, token, setSession, api, hasAccess} = useAuth();
  const [timezone, setTimezone] = useState('UTC');
  const [fleet, setFleet] = useState([]), [snapshots, setSnapshots] = useState([]), [analytics, setAnalytics] = useState({});
  const [governance, setGovernance] = useState(null), [telemetryHistory, setTelemetryHistory] = useState(() => isLocalDemoHost ? createDemoTelemetry() : []), [pingMs, setPingMs] = useState(null);
  const [workspaceTelemetry, setWorkspaceTelemetry] = useState(() => isLocalDemoHost ? createDemoWorkspaceTelemetry() : {});
  const [demoMode, setDemoMode] = useState(false), [runtimeSyncedAt, setRuntimeSyncedAt] = useState(Date.now()), [clockNow, setClockNow] = useState(Date.now());
  const [tab, setTab] = useState('fleet'), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [signupMode, setSignupMode] = useState(false), [signupDetails, setSignupDetails] = useState({name: '', invitation_token: ''});
  const [inviteMode, setInviteMode] = useState(false), [createdInvite, setCreatedInvite] = useState(null);
  const [credentials, setCredentials] = useState({user_id: '', password: ''});
  const [provision, setProvision] = useState(null), [editing, setEditing] = useState(null), [dump, setDump] = useState(null), [addWorkspaces, setAddWorkspaces] = useState(null);
  const [newWorkspace, setNewWorkspace] = useState(null), [assignment, setAssignment] = useState(null), [lockoutOpen, setLockoutOpen] = useState(false);
  const [busy, setBusy] = useState(false), [search, setSearch] = useState('');
  const demoModeRef = useRef(false);
  const fleetRef = useRef(fleet);
  fleetRef.current = fleet;
  const updateDemoFleet = update => {
    const next = update(fleetRef.current);
    fleetRef.current = next;
    setFleet(next);
  };
  const fetchFleet = async () => {
    const data = await api('/api/instances');
    setTimezone(data.timezone || 'UTC');
    const useDemo = isLocalDemoHost && !data.fleet?.length;
    if (useDemo) {
      demoModeRef.current = true;
      setDemoMode(true);
      const fallbackFleet = fleetRef.current.length ? fleetRef.current : createDemoFleet();
      fleetRef.current = fallbackFleet;
      setFleet(fallbackFleet);
      setSnapshots(current => current.length ? current : []);
      const demoRates = fallbackFleet.reduce((sum,item) => sum + (['running','idle'].includes(item.state) ? item.hourly_rate : 0),0);
      setAnalytics({
        compute_hourly:demoRates,compute_daily:demoRates*24,total_daily:demoRates*24,
        daily_savings:fallbackFleet.reduce((sum,item)=>sum+(item.hourly_rate||0),0)*24-demoRates*24,
        downscale_rate:50,currency:'USD',
        billing_basis:'Illustrative localhost demo estimate; not AWS billing',
      });
      if (hasAccess('manager')) {
        const dataGovernance = await api('/api/governance/overview');
        setGovernance(previous => ({
          ...createDemoGovernance(),
          ...dataGovernance,
          employees:dataGovernance.employees?.length ? dataGovernance.employees : previous?.employees?.length ? previous.employees : createDemoGovernance().employees,
          requests:dataGovernance.requests?.length ? dataGovernance.requests : previous?.requests?.length ? previous.requests : createDemoGovernance().requests,
          runtime:createDemoGovernance().runtime,
          audit:dataGovernance.audit || [],
        }));
      } else setGovernance(null);
      setRuntimeSyncedAt(Date.now());
      setTelemetryHistory(previous => previous.length ? previous : createDemoTelemetry());
      setWorkspaceTelemetry(previous => Object.keys(previous).length ? previous : createDemoWorkspaceTelemetry());
      return;
    }
    demoModeRef.current = false;
    setDemoMode(false);
    fleetRef.current = data.fleet;
    setFleet(data.fleet);
    setSnapshots(data.snapshots);
    setAnalytics(data.analytics);
    if (isLocalDemoHost && data.fleet.length) {
      setWorkspaceTelemetry(previous => {
        const seeded=createTelemetryFallbackForFleet(data.fleet);
        return Object.fromEntries(data.fleet.map(item=>[
          item.id,
          Array.isArray(previous[item.id]) && previous[item.id].length ? previous[item.id] : seeded[item.id],
        ]));
      });
      setTelemetryHistory(previous=>previous.length?previous:createDemoTelemetry());
    }
    if (hasAccess('manager')) {
      const nextGovernance = await api('/api/governance/overview');
      setGovernance(nextGovernance);
      setRuntimeSyncedAt(Date.now());
    } else setGovernance(null);
  };
  useEffect(() => {
    if (!token) {setFleet([]); fleetRef.current=[]; setSnapshots([]); setAnalytics({}); setGovernance(null); setTelemetryHistory(isLocalDemoHost ? createDemoTelemetry() : []); setWorkspaceTelemetry(isLocalDemoHost ? createDemoWorkspaceTelemetry() : {}); demoModeRef.current=false; setDemoMode(false); return;}
    let disposed = false, socket, timer, pingTimer, lastPing = null;
    const refresh = () => fetchFleet().catch(e => !disposed && setError(e.message));
    const connect = () => {
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/fleet`);
      socket.onopen = () => {
        socket.send(JSON.stringify({token}));
        if (isLocalDemoHost) {
          setTelemetryHistory(previous => previous.length ? previous : createDemoTelemetry());
        }
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
        if (message.analytics && !demoModeRef.current) setAnalytics(message.analytics);
        if (message.runtime) {
          if (!demoModeRef.current) {
            setGovernance(previous => previous ? {...previous, runtime: message.runtime} : previous);
            setRuntimeSyncedAt(Date.parse(message.server_time) || Date.now());
          }
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
            setTelemetryHistory(previous => [...(previous.some(sample => sample.demo) ? [] : previous), {
              at: observedAt,
              cpu: cpu.length ? cpu.reduce((sum, value) => sum + value, 0) / cpu.length : 0,
              memory: memory.length ? memory.reduce((sum, value) => sum + value, 0) / memory.length : null,
            }].slice(-60));
            }
          } else if (isLocalDemoHost && !demoModeRef.current) setTelemetryHistory(previous => previous.length ? previous : createDemoTelemetry());
        }
        if (message.type === 'SESSION_TERMINATED') setNotice(`Workspace ${message.instance_id} session terminated.`);
        if (['FLEET_UPDATED','SESSION_TERMINATED','SHIFT_UPDATED','SUPPORT_REQUEST_CREATED','SUPPORT_REQUEST_UPDATED','OVERTIME_REJECTED'].includes(message.type)) refresh();
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
    if (demoModeRef.current && id.startsWith('local-demo-')) {
      updateDemoFleet(items => items.map(item => item.id === id ? {
        ...item,state:target_state === 'running' ? 'running' : target_state,
        access_mode:target_state === 'running' && Boolean(item.owner),
        active_user:target_state === 'running' && item.owner ? item.active_user || item.owner : null,
        cpu:target_state === 'running' ? Math.max(18,Number(item.cpu)||0) : 0,
      } : item));
      setNotice(`${id} ${target_state === 'running' ? 'woken' : 'hibernated'} in local demo mode; no AWS resource was changed.`);
      return;
    }
    await post('/api/instance/state', {instance_id:id,target_state});
    await fetchFleet();
  });
  const hibernateFleet = () => perform(async () => {
    const targets=fleet.filter(item=>!item.exempt && item.state!=='hibernated');
    if (demoModeRef.current) {
      const targetIds=new Set(targets.map(item=>item.id));
      updateDemoFleet(items=>items.map(item=>targetIds.has(item.id)?{...item,state:'hibernated',cpu:0,access_mode:false,active_user:null}:item));
      setNotice('Sample workspaces hibernated in local demo mode; no AWS resource was changed.');
      return;
    }
    for (const instance of targets) await post('/api/instance/state',{instance_id:instance.id,target_state:'hibernated'});
    await fetchFleet();
  });
  const saveShift = values => perform(async () => {
    if (demoModeRef.current && values.instance_id.startsWith('local-demo-')) {
      updateDemoFleet(items=>items.map(item=>item.id===values.instance_id?{
        ...item,shift_start:values.shift_start,shift_end:values.shift_end,
        shift:`${values.shift_start} - ${values.shift_end}`,
      }:item));
      setNotice('Shift bounds updated in local demo mode; no backend or AWS resource was changed.');
    } else {
      await post('/api/shift/update',values);
      await fetchFleet();
    }
    setEditing(null);
  });
  const decideRequest = (requestId, decision) => perform(async () => {
    if (demoModeRef.current && requestId.startsWith('local-demo-')) {
      const isApproval = decision === 'approved';
      const request = (governance?.requests || []).find(item => item.id === requestId);
      const extensionHours = Number(request?.extension_hours || 2);
      if (isApproval && request?.instance_id) {
        updateDemoFleet(items => items.map(item => item.id === request.instance_id ? {
          ...item,
          shift_end:`${String((Number(item.shift_end.slice(0,2))+extensionHours)%24).padStart(2,'0')}:${item.shift_end.slice(3,5)}`,
          shift:`${item.shift_start} - ${String((Number(item.shift_end.slice(0,2))+extensionHours)%24).padStart(2,'0')}:${item.shift_end.slice(3,5)}`,
        } : item));
      }
      setGovernance(previous => previous ? {...previous,requests:previous.requests.map(item=>item.id===requestId?{...item,status:decision}:item)}:previous);
      setNotice(`Local demo overtime request ${decision}; no backend or AWS resource was changed.`);
      return;
    }
    await post(`/api/requests/${encodeURIComponent(requestId)}/${decision === 'approved' ? 'approve' : 'reject'}`,{});
    await fetchFleet();
    setNotice(`Shift extension ${decision}.`);
  });
  const handleAccess = (userId, blocked) => perform(async () => {
    if (demoModeRef.current && userId.startsWith('demo-')) {
      setGovernance(previous => previous ? {...previous,employees:previous.employees.map(item=>item.id===userId?{...item,access_blocked:blocked}:item)}:previous);
      updateDemoFleet(items => items.map(item => item.owner === userId ? {
        ...item,state:blocked ? 'hibernated' : item.state,
        access_mode:false,active_user:null,
      }:item));
      setNotice(`Local demo access ${blocked ? 'revoked' : 'restored'}; no backend or AWS resource was changed.`);
      return;
    }
    try {await post(`/api/employees/${encodeURIComponent(userId)}/access`,{blocked});}
    finally {await fetchFleet();}
  });
  const handleDelete = (id,name) => perform(async () => {
    if (demoModeRef.current && id.startsWith('local-demo-')) {
      updateDemoFleet(items => items.filter(item=>item.id!==id));
      setNotice(`${name} removed from the local demo fleet; no AWS resource was changed.`);
      return true;
    }
    await api(`/api/workspaces/${encodeURIComponent(id)}`,{method:'DELETE',body:JSON.stringify({confirmation_name:name})});
    await fetchFleet();
    setNotice('Workspace terminated and removed. Detached EBS data is retained.');
    return true;
  });
  const createWorkspace = values => perform(async () => {
    if (demoModeRef.current) {
      const id=`local-demo-${crypto.randomUUID()}`;
      const hourly_rate={'t3.medium':0.0416,'c5.xlarge':0.17,'r5.large':0.126}[values.instance_type];
      updateDemoFleet(items=>[...items,{...values,id,owner:null,type:values.instance_type,hourly_rate,state:'hibernated',cpu:0,memory_mb:1024,memory_percent:42,shift:`${values.shift_start} - ${values.shift_end}`,access_mode:false,active_user:null,active_user_id:null,is_production:false,exempt:false,anomaly:false}]);
      setNotice(`${values.name} created in local demo mode; no AWS resource was provisioned.`);
    } else {
      await post('/api/workspaces',values);
      await fetchFleet();
    }
    setNewWorkspace(null);
  });
  const assignWorkspace = values => perform(async () => {
    if (demoModeRef.current) {
      const employee=governance?.employees.find(item=>item.id===values.user_id);
      updateDemoFleet(items=>items.map(item=>item.id===values.instance_id?{...item,owner:values.user_id,active_user:employee?.name||values.user_id}:item));
      setNotice('Workspace assigned in local demo mode; no backend or AWS resource was changed.');
    } else {
      await post(`/api/workspaces/${encodeURIComponent(values.instance_id)}/assign`,{user_id:values.user_id});
      await fetchFleet();
    }
    setAssignment(null);
  });
  const pendingOvertime = (governance?.requests || []).filter(request => request.request_type === 'overtime' && request.status === 'open');
  if (!currentUser) return <main className="login-panel">
    <h1 className="login-title">{signupMode ? 'CREATE YOUR ACCOUNT' : 'FINOPS COMMAND LOGIN'}</h1>
    <form className="space-y-4" onSubmit={e => {e.preventDefault(); perform(async () => {const session = await post(signupMode ? '/api/auth/signup' : '/api/auth/login', signupMode ? {...credentials, ...signupDetails} : credentials); setSession(session); setCredentials({user_id: '', password: ''}); setSignupDetails({name: '', invitation_token: ''});});}}>
      <label className="block">User ID<input required className={input} autoComplete="username" value={credentials.user_id} onChange={e => setCredentials({...credentials, user_id: e.target.value})}/></label>
      {signupMode && <><p>Use the invitation code and User ID supplied by your Team Lead or Chief Architect.</p>{['name','invitation_token'].map(key => <label key={key} className="block">{key === 'name' ? 'Full name' : 'Invitation code'}<input required className={input} value={signupDetails[key]} onChange={e => setSignupDetails({...signupDetails,[key]:e.target.value})}/></label>)}</>}
      <label className="block">Password<input required type="password" minLength={signupMode ? 12 : undefined} maxLength={128} autoComplete={signupMode ? 'new-password' : 'current-password'} className={input} value={credentials.password} onChange={e => setCredentials({...credentials, password: e.target.value})}/></label>
      <button disabled={busy} className={button}>{signupMode ? 'SIGN UP' : 'SIGN IN'}</button>
      <button type="button" disabled={busy} className={button} onClick={() => {setSignupMode(!signupMode); setError('');}}>{signupMode ? 'BACK TO SIGN IN' : 'SIGN UP'}</button>
      {error && <p role="alert" className="field-error">{error}</p>}
    </form></main>;
  return <main className="command-shell">
    <header className="command-header">
      <div className="command-brand"><p className="eyebrow">FinOps command center</p><h1>Downscale Demon<span className="brand-dot">.</span></h1><p className="account-line">{currentUser.name} &middot; {{employee:'Employee', manager:'Team Lead', team_lead:'Team Lead', admin:'Chief Architect', chief_architect:'Chief Architect'}[currentUser.role]} &middot; {currentUser.team_id}</p></div>
      <div className="header-actions">
        {hasAccess('manager') && <button className={`${button} overtime-bell`} aria-label={`${pendingOvertime.length} pending overtime requests`} onClick={() => setTab('fleet')}><span aria-hidden="true">🔔</span> Shift extensions <b>{pendingOvertime.length}</b></button>}
        {hasAccess('admin') && <>
          <button className={`${button} command-button-primary`} onClick={() => setNewWorkspace({name:'',instance_type:'t3.medium',shift_start:'09:00',shift_end:'18:00'})}>+ Create New Workspace</button>
          <button className={button} disabled={!fleet.some(item=>!item.owner)} onClick={() => setAssignment({
            instance_id:fleet.find(item=>!item.owner)?.id || '',
            user_id:governance?.employees.find(item=>item.role==='employee')?.id || '',
          })}>+ Assign Workspace to Employee</button>
          <button className={`${button} command-button-danger`} onClick={() => setLockoutOpen(true)}>Emergency Lockout / Revoke Access</button>
        </>}
        {hasAccess('manager') && <button className={`${button} command-button-primary`} onClick={() => {setInviteMode(false); setProvision({user_id:'', name:'', password:'', team_id:currentUser.team_id || '', role:'employee', instances:[workspace()]});}}>Add employee</button>}
        {hasAccess('manager') && <button className={button} onClick={() => {setInviteMode(true); setProvision({user_id:'',name:'',password:'',team_id:currentUser.team_id || '',role:'employee',instances:[workspace()]});}}>Invite employee</button>}
        {hasAccess('admin') && <button disabled={busy} className={`${button} command-button-danger`} onClick={hibernateFleet}>Hibernate fleet</button>}
        <button className={button} onClick={() => {setSession(null); setProvision(null); setEditing(null); setDump(null); setCreatedInvite(null);}}>Sign out</button>
      </div>
    </header>
    {demoMode && <p className="demo-mode-banner" role="status">Illustrative localhost demo fleet · sample telemetry and costs only · sample workspace actions do not call AWS.</p>}
    {pendingOvertime.length > 0 && hasAccess('manager') && <button type="button" className="pending-extension-banner" onClick={() => setTab('fleet')}><strong>{pendingOvertime.length} Pending Shift Extension{pendingOvertime.length===1?'':'s'}</strong><span>Review overtime requests in Fleet governance</span></button>}
    {error && <p role="alert" className="notice notice-error">{error}</p>}
    {notice && <p role="status" className="notice">{notice}</p>}
    <nav className="command-tabs" aria-label="Command center sections">{['fleet','shifts','vault','analytics'].map(t => <button key={t} className={tab === t ? 'is-active' : ''} aria-current={tab === t ? 'page' : undefined} onClick={() => setTab(t)}>{{fleet:'Fleet',shifts:'Shifts',vault:'Snapshot vault',analytics:'Analytics'}[t]}</button>)}</nav>
    {tab === 'fleet' && hasAccess('manager') && <GovernanceDashboard fleet={fleet} analytics={analytics} governance={governance} telemetryHistory={telemetryHistory} currentUser={currentUser} isAdmin={hasAccess('admin')} busy={busy} pingMs={pingMs} timezone={timezone} demoMode={demoMode}
      onShift={instance => setEditing({instance_id:instance.id,shift_start:instance.shift_start,shift_end:instance.shift_end})}
      onWake={id => state(id,'running')} onPurge={id => demoModeRef.current ? state(id,'hibernated') : setDump(id)}
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
      {(inviteMode ? ['user_id','team_id'] : ['user_id','name','password','team_id']).map(key => <label key={key} className="block">{{user_id:"User ID",name:"Full name",password:"Password",team_id:"Team",shift_start:"Shift start",shift_end:"Shift end"}[key] || key}<input required type={key === 'password' ? 'password' : 'text'} minLength={key === 'password' ? 12 : 1} disabled={key === 'team_id' && !hasAccess('admin')} className={input} value={provision[key]} onChange={e => setProvision({...provision,[key]:e.target.value})}/></label>)}
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
