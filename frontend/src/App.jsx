import React, {useState, useEffect} from 'react';
import {AuthProvider, useAuth} from './context/AppContext';
import TerminalStream from './components/TerminalStream';
const button = 'border-2 border-black px-3 py-2 font-bold text-xs bg-white hover:bg-slate-200';
const input = 'border-2 border-black p-2 w-full text-sm';
const money = value => Number(value || 0).toFixed(2);
const workspace = () => ({name: '', instance_type: 't3.medium', shift_start: '09:00', shift_end: '18:00'});
function Dashboard() {
  const {currentUser, token, setSession, api, hasAccess} = useAuth();
  const [fleet, setFleet] = useState([]), [snapshots, setSnapshots] = useState([]), [analytics, setAnalytics] = useState({});
  const [tab, setTab] = useState('fleet'), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [signupMode, setSignupMode] = useState(false), [signupDetails, setSignupDetails] = useState({name: '', invitation_token: ''});
  const [inviteMode, setInviteMode] = useState(false), [createdInvite, setCreatedInvite] = useState(null);
  const [credentials, setCredentials] = useState({user_id: '', password: ''});
  const [provision, setProvision] = useState(null), [editing, setEditing] = useState(null), [dump, setDump] = useState(null);
  const [busy, setBusy] = useState(false), [search, setSearch] = useState('');
  const fetchFleet = async () => {
    const data = await api('/api/instances');
    setFleet(data.fleet); setSnapshots(data.snapshots); setAnalytics(data.analytics);
  };
  useEffect(() => {
    if (!token) {setFleet([]); setSnapshots([]); setAnalytics({}); return;}
    let disposed = false, socket, timer;
    const refresh = () => fetchFleet().catch(e => !disposed && setError(e.message));
    const connect = () => {
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/fleet`);
      socket.onopen = () => socket.send(JSON.stringify({token}));
      socket.onmessage = event => {
        const message = JSON.parse(event.data);
        if (message.type === 'SESSION_TERMINATED') setNotice(`Workspace ${message.instance_id} session terminated.`);
        refresh();
      };
      socket.onclose = event => {
        if (event.code === 4401) {setSession(null); return;}
        if (!disposed) timer = setTimeout(connect, 1500);
      };
    };
    refresh(); connect();
    return () => {disposed = true; clearTimeout(timer); socket?.close();};
  }, [token]);
  const perform = async action => {
    setBusy(true); setError('');
    try {await action();} catch(e) {setError(e.message);} finally {setBusy(false);}
  };
  const post = (path, body) => api(path, {method: 'POST', body: JSON.stringify(body)});
  const state = (id, target_state) => perform(async () => {await post('/api/instance/state', {instance_id: id, target_state}); await fetchFleet();});
  if (!currentUser) return <main className="max-w-md mx-auto p-8 bg-white border-4 border-black">
    <h1 className="text-2xl font-black mb-4">{signupMode ? 'CREATE YOUR ACCOUNT' : 'FINOPS COMMAND LOGIN'}</h1>
    <form className="space-y-4" onSubmit={e => {e.preventDefault(); perform(async () => {const session = await post(signupMode ? '/api/auth/signup' : '/api/auth/login', signupMode ? {...credentials, ...signupDetails} : credentials); setSession(session); setCredentials({user_id: '', password: ''}); setSignupDetails({name: '', invitation_token: ''});});}}>
      <label className="block">User ID<input required className={input} autoComplete="username" value={credentials.user_id} onChange={e => setCredentials({...credentials, user_id: e.target.value})}/></label>
      {signupMode && <><p>Use the invitation code and User ID supplied by your Team Lead or Chief Architect.</p>{['name','invitation_token'].map(key => <label key={key} className="block">{key === 'name' ? 'Full name' : 'Invitation code'}<input required className={input} value={signupDetails[key]} onChange={e => setSignupDetails({...signupDetails,[key]:e.target.value})}/></label>)}</>}
      <label className="block">Password<input required type="password" minLength={signupMode ? 12 : undefined} maxLength={128} autoComplete={signupMode ? 'new-password' : 'current-password'} className={input} value={credentials.password} onChange={e => setCredentials({...credentials, password: e.target.value})}/></label>
      <button disabled={busy} className={button}>{signupMode ? 'SIGN UP' : 'SIGN IN'}</button>
      <button type="button" disabled={busy} className={button} onClick={() => {setSignupMode(!signupMode); setError('');}}>{signupMode ? 'BACK TO SIGN IN' : 'SIGN UP'}</button>
      {error && <p role="alert" className="text-red-700">{error}</p>}
    </form></main>;
  return <main className="max-w-7xl mx-auto space-y-6">
    <header className="border-4 border-black bg-white p-6 flex justify-between gap-4 flex-wrap">
      <div><h1 className="text-3xl font-black">DOWNSCALE DEMON // FINOPS COMMAND</h1><p>{currentUser.name} · {{employee:'Employee', manager:'Team Lead', admin:'Chief Architect'}[currentUser.role]} · {currentUser.team_id}</p></div>
      <div className="flex gap-2">
        {hasAccess('manager') && <button className={button} onClick={() => {setInviteMode(false); setProvision({user_id:'', name:'', password:'', team_id:currentUser.team_id || '', role:'employee', instances:[workspace()]});}}>ADD EMPLOYEE + WORKSPACE</button>}
        {hasAccess('manager') && <button className={button} onClick={() => {setInviteMode(true); setProvision({user_id:'',name:'',password:'',team_id:currentUser.team_id || '',role:'employee',instances:[workspace()]});}}>INVITE TO SIGN UP</button>}
        {hasAccess('admin') && <button disabled={busy} className={button} onClick={() => perform(async () => {for (const inst of fleet.filter(i => !i.exempt && i.state !== 'hibernated')) await post('/api/instance/state', {instance_id:inst.id, target_state:'hibernated'}); await fetchFleet();})}>KILL SWITCH</button>}
        <button className={button} onClick={() => {setSession(null); setProvision(null); setEditing(null); setDump(null); setCreatedInvite(null);}}>SIGN OUT</button>
      </div>
    </header>
    {error && <p role="alert" className="bg-red-100 p-4 text-red-800">{error}</p>}
    {notice && <p role="status" className="bg-amber-100 p-4">{notice}</p>}
    <nav className="flex gap-2">{['fleet','shifts','vault','analytics'].map(t => <button key={t} className={`${button} ${tab === t ? 'bg-red-200' : ''}`} onClick={() => setTab(t)}>{t.toUpperCase()}</button>)}</nav>
    {tab === 'fleet' && <section className="space-y-4"><input aria-label="Filter fleet" className={input} placeholder="Filter instance name or ID" value={search} onChange={e => setSearch(e.target.value)}/>
      {!fleet.length && <p>No allocated workspaces.</p>}
      {fleet.filter(i => `${i.name} ${i.id}`.toLowerCase().includes(search.toLowerCase())).map(i => <article key={i.id} className="bg-white border-2 border-black p-5 flex justify-between gap-4 flex-wrap">
        <div><h2 className="font-black text-lg">{i.name} · {i.state.toUpperCase()}</h2><p>{i.id} · {i.owner} · {i.type} · CPU {i.cpu}% · {i.shift}</p>{i.anomaly && <strong className="text-red-700">OFF-HOURS THREAT</strong>}</div>
        <div className="flex gap-2">
          {i.state !== 'running' && <button disabled={busy} className={button} onClick={() => state(i.id,'running')}>WAKE</button>}
          {hasAccess('manager') && ['running','idle'].includes(i.state) && <button className={button} onClick={() => setDump(i.id)}>CRIU PURGE</button>}
          {['running','idle'].includes(i.state) && <button disabled={busy} className={button} onClick={() => perform(async () => {const result = await post('/api/instance/anomaly-simulate',{instance_id:i.id}); setNotice(result.context); await fetchFleet();})}>TEST ANOMALY</button>}
        </div></article>)}
    </section>}
    {tab === 'shifts' && <section className="bg-white border-2 border-black p-6 space-y-4"><h2 className="font-black">SHIFT SCHEDULES (configured server timezone)</h2>{fleet.map(i => <div key={i.id} className="flex justify-between border-b p-2"><span>{i.owner} · {i.name} · {i.shift}{i.exempt ? ' · EXEMPT' : ''}</span>{hasAccess('manager') && !i.exempt && <button className={button} onClick={() => setEditing({instance_id:i.id,shift_start:i.shift_start,shift_end:i.shift_end})}>EDIT SHIFT</button>}</div>)}</section>}
    {tab === 'vault' && <section className="grid grid-cols-1 md:grid-cols-2 gap-4">{!snapshots.length && <p>No stored snapshots.</p>}{snapshots.map(s => <article key={s.id} className="bg-white border-2 border-black p-5"><h2 className="font-black break-all">{s.filename}</h2><p>{s.instance_id} · {s.size_mb} MiB · {s.tmux_panes} tmux panes</p><button disabled={busy} className={button} onClick={() => state(s.instance_id,'running')}>RESTORE SESSION</button></article>)}</section>}
    {tab === 'analytics' && <section className="bg-white border-2 border-black p-6"><p>USD estimates at current fleet state; 30-day month. Idle instances remain powered on. Snapshot storage remains billed after restore.</p><div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-4">{[['COMPUTE / HOUR',`$${money(analytics.compute_hourly)}`],['COMPUTE / DAY',`$${money(analytics.compute_daily)}`],['SNAPSHOTS / MONTH',`$${money(analytics.snapshot_monthly)}`],['NET DAILY SAVINGS',`$${money(analytics.daily_savings)}`],['DOWNSCALE RATE',`${analytics.downscale_rate || 0}%`],['EXEMPT NODES',analytics.exempt_nodes || 0]].map(([label,value]) => <div key={label} className="border-2 border-black p-5"><p>{label}</p><strong className="text-3xl">{value}</strong></div>)}</div></section>}
    {editing && <Modal title="Update shift" close={() => setEditing(null)}><form className="space-y-4" onSubmit={e => {e.preventDefault(); perform(async () => {await post('/api/shift/update',editing); setEditing(null); await fetchFleet();});}}>{['shift_start','shift_end'].map(key => <label key={key} className="block">{key}<input required type="time" className={input} value={editing[key]} onChange={e => setEditing({...editing,[key]:e.target.value})}/></label>)}<p>Equal boundaries mean 24 hours; overnight shifts are supported.</p><p role="alert" className="text-red-700">{error}</p><button disabled={busy} className={button}>SAVE</button></form></Modal>}
    {provision && <Modal title={inviteMode ? "Invite user and allocate workspaces" : "Provision employee and workspaces"} close={() => setProvision(null)}><form className="space-y-3" onSubmit={e => {e.preventDefault(); perform(async () => {if (inviteMode) {const {name,password,...invitation} = provision; setCreatedInvite(await post('/api/invitations',invitation));} else {await post('/api/employees',provision);} setProvision(null); await fetchFleet();});}}>
      {(inviteMode ? ['user_id','team_id'] : ['user_id','name','password','team_id']).map(key => <label key={key} className="block">{key}<input required type={key === 'password' ? 'password' : 'text'} minLength={key === 'password' ? 12 : 1} disabled={key === 'team_id' && !hasAccess('admin')} className={input} value={provision[key]} onChange={e => setProvision({...provision,[key]:e.target.value})}/></label>)}
      {hasAccess('admin') && <label className="block">Role<select className={input} value={provision.role} onChange={e => setProvision({...provision,role:e.target.value})}><option value="employee">Employee</option><option value="manager">Team Lead</option></select></label>}
      {provision.instances.map((spec,index) => <fieldset key={index} className="border-2 p-3 space-y-2"><legend>Workspace {index+1}</legend>{Object.keys(spec).map(key => <label key={key} className="block">{key}{key === 'instance_type' ? <select className={input} value={spec[key]} onChange={e => setProvision({...provision,instances:provision.instances.map((s,j) => j === index ? {...s,[key]:e.target.value} : s)})}>{['t3.medium','c5.xlarge','r5.large'].map(t => <option key={t}>{t}</option>)}</select> : <input required type={key.startsWith('shift') ? 'time' : 'text'} className={input} value={spec[key]} onChange={e => setProvision({...provision,instances:provision.instances.map((s,j) => j === index ? {...s,[key]:e.target.value} : s)})}/>}</label>)}</fieldset>)}
      <p role="alert" className="text-red-700">{error}</p><button type="button" className={button} disabled={provision.instances.length >= 20} onClick={() => setProvision({...provision,instances:[...provision.instances,workspace()]})}>ADD WORKSPACE</button><button disabled={busy} className={button}>{inviteMode ? "CREATE INVITATION" : "CREATE"}</button>
    </form></Modal>}
    {createdInvite && <Modal title="Share sign-up invitation" close={() => setCreatedInvite(null)}><p>Send this User ID and code to the intended user. The code expires in 24 hours and works once.</p><p className="mt-4">User ID: {createdInvite.user_id}</p><label className="block mt-4">Invitation code<input readOnly className={input} value={createdInvite.invitation_token} onFocus={e => e.target.select()}/></label></Modal>}
    {dump && <TerminalStream instanceId={dump} onClose={() => {setDump(null); perform(fetchFleet);}}/>}
  </main>;
}
function Modal({title,close,children}) {return <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"><section role="dialog" aria-modal="true" aria-label={title} className="bg-white border-4 border-black p-6 max-w-lg w-full max-h-[90vh] overflow-auto"><div className="flex justify-between mb-4"><h2 className="font-black">{title}</h2><button className={button} onClick={close}>CLOSE</button></div>{children}</section></div>;}
export default function App() {return <AuthProvider><Dashboard/></AuthProvider>;}
