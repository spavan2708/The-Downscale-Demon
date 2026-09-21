import React, {useState, useEffect} from 'react';
import {AuthProvider, useAuth} from './context/AppContext';
import TerminalStream from './components/TerminalStream';
import InstanceCard from './components/InstanceCard';
import './fleet.css';
import SnapshotVault from './components/SnapshotVault';
import './command.css';
const button = 'command-button';
const input = 'command-input';
const money = value => Number(value || 0).toFixed(2);
const STATE_KEYS = ['running', 'hibernated', 'stopped', 'idle'];
const workspace = () => ({name: '', instance_type: 't3.medium', shift_start: '09:00', shift_end: '18:00'});
function Dashboard() {
  const {currentUser, token, setSession, api, hasAccess} = useAuth();
  const [timezone, setTimezone] = useState('UTC');
  const [fleet, setFleet] = useState([]), [snapshots, setSnapshots] = useState([]), [analytics, setAnalytics] = useState({});
  const [tab, setTab] = useState('fleet'), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [signupMode, setSignupMode] = useState(false), [signupDetails, setSignupDetails] = useState({name: '', invitation_token: ''});
  const [inviteMode, setInviteMode] = useState(false), [createdInvite, setCreatedInvite] = useState(null);
  const [credentials, setCredentials] = useState({user_id: '', password: ''});
  const [provision, setProvision] = useState(null), [editing, setEditing] = useState(null), [dump, setDump] = useState(null), [addWorkspaces, setAddWorkspaces] = useState(null);
  const [busy, setBusy] = useState(false), [search, setSearch] = useState('');
  const fetchFleet = async () => {
    const data = await api('/api/instances');
    setTimezone(data.timezone || 'UTC'); setFleet(data.fleet); setSnapshots(data.snapshots); setAnalytics(data.analytics);
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
      <div className="command-brand"><p className="eyebrow">FinOps command center</p><h1>Downscale Demon<span className="brand-dot">.</span></h1><p className="account-line">{currentUser.name} &middot; {{employee:'Employee', manager:'Team Lead', admin:'Chief Architect'}[currentUser.role]} &middot; {currentUser.team_id}</p></div>
      <div className="header-actions">
        {hasAccess('manager') && <button className={`${button} command-button-primary`} onClick={() => {setInviteMode(false); setProvision({user_id:'', name:'', password:'', team_id:currentUser.team_id || '', role:'employee', instances:[workspace()]});}}>Add employee</button>}
        {hasAccess('manager') && <button className={button} onClick={() => {setInviteMode(true); setProvision({user_id:'',name:'',password:'',team_id:currentUser.team_id || '',role:'employee',instances:[workspace()]});}}>Invite employee</button>}
        {hasAccess('admin') && <button disabled={busy} className={`${button} command-button-danger`} onClick={() => perform(async () => {for (const inst of fleet.filter(i => !i.exempt && i.state !== 'hibernated')) await post('/api/instance/state', {instance_id:inst.id, target_state:'hibernated'}); await fetchFleet();})}>Hibernate fleet</button>}
        <button className={button} onClick={() => {setSession(null); setProvision(null); setEditing(null); setDump(null); setCreatedInvite(null);}}>Sign out</button>
      </div>
    </header>
    {error && <p role="alert" className="notice notice-error">{error}</p>}
    {notice && <p role="status" className="notice">{notice}</p>}
    <nav className="command-tabs" aria-label="Command center sections">{['fleet','shifts','vault','analytics'].map(t => <button key={t} className={tab === t ? 'is-active' : ''} aria-current={tab === t ? 'page' : undefined} onClick={() => setTab(t)}>{{fleet:'Fleet',shifts:'Shifts',vault:'Snapshot vault',analytics:'Analytics'}[t]}</button>)}</nav>
    {tab === 'fleet' && <section className="fleet-section"><input aria-label="Filter fleet" className={input} placeholder="Search by workspace, instance ID or owner" value={search} onChange={e => setSearch(e.target.value)}/>
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
    {tab === 'analytics' && <section className="analytics-section">
      <div className="section-heading"><div><p className="eyebrow">Fleet economics</p><h2>Cost overview</h2><p>Current-state estimates in USD.</p></div><span className="section-count">30-day billing month</span></div>
      <div className="savings-overview"><div><p>Net daily savings</p><strong>${money(analytics.daily_savings)}<span> / day</span></strong></div><p>Estimated savings against keeping every allocated workspace powered on, after snapshot storage.</p></div>
      <dl className="analytics-grid">{[['Compute / hour',`$${money(analytics.compute_hourly)}`,'Running and idle workspaces'],['Compute / day',`$${money(analytics.compute_daily)}`,'Projected over 24 hours'],['Snapshots / month',`$${money(analytics.snapshot_monthly)}`,'All retained snapshots'],['Downscale rate',`${analytics.downscale_rate || 0}%`,'Non-exempt workspaces hibernated'],['Exempt nodes',analytics.exempt_nodes || 0,'Excluded from automatic cutoff']].map(([label,value,note]) => <div key={label}><dt>{label}</dt><dd>{value}</dd><p>{note}</p></div>)}</dl>
      <p className="section-footnote">Idle workspaces are still powered on. Snapshot storage remains billed after restore. These estimates are not invoices.</p>
    </section>}
    {editing && <Modal title="Update shift" close={() => setEditing(null)}><form className="space-y-4" onSubmit={e => {e.preventDefault(); perform(async () => {await post('/api/shift/update',editing); setEditing(null); await fetchFleet();});}}>{['shift_start','shift_end'].map(key => <label key={key} className="block">{{user_id:"User ID",name:"Full name",password:"Password",team_id:"Team",shift_start:"Shift start",shift_end:"Shift end"}[key] || key}<input required type="time" className={input} value={editing[key]} onChange={e => setEditing({...editing,[key]:e.target.value})}/></label>)}<p>Equal boundaries mean 24 hours; overnight shifts are supported.</p><p role="alert" className="field-error">{error}</p><button disabled={busy} className={button}>SAVE</button></form></Modal>}
    {provision && <Modal title={inviteMode ? "Invite user and allocate workspaces" : "Provision employee and workspaces"} close={() => setProvision(null)}><form className="space-y-3" onSubmit={e => {e.preventDefault(); perform(async () => {if (inviteMode) {const {name,password,...invitation} = provision; setCreatedInvite(await post('/api/invitations',invitation));} else {await post('/api/employees',provision);} setProvision(null); await fetchFleet();});}}>
      {(inviteMode ? ['user_id','team_id'] : ['user_id','name','password','team_id']).map(key => <label key={key} className="block">{{user_id:"User ID",name:"Full name",password:"Password",team_id:"Team",shift_start:"Shift start",shift_end:"Shift end"}[key] || key}<input required type={key === 'password' ? 'password' : 'text'} minLength={key === 'password' ? 12 : 1} disabled={key === 'team_id' && !hasAccess('admin')} className={input} value={provision[key]} onChange={e => setProvision({...provision,[key]:e.target.value})}/></label>)}
      {hasAccess('admin') && <label className="block">Role<select className={input} value={provision.role} onChange={e => setProvision({...provision,role:e.target.value})}><option value="employee">Employee</option><option value="manager">Team Lead</option></select></label>}
      {provision.instances.map((spec,index) => <fieldset key={index} className="workspace-fields"><legend>Workspace {index+1}</legend>{Object.keys(spec).map(key => <label key={key} className="block">{{name:'Workspace name',instance_type:'Machine type',shift_start:'Shift start',shift_end:'Shift end'}[key]}{key === 'instance_type' ? <select className={input} value={spec[key]} onChange={e => setProvision({...provision,instances:provision.instances.map((s,j) => j === index ? {...s,[key]:e.target.value} : s)})}>{['t3.medium','c5.xlarge','r5.large'].map(t => <option key={t}>{t}</option>)}</select> : <input required type={key.startsWith('shift') ? 'time' : 'text'} className={input} value={spec[key]} onChange={e => setProvision({...provision,instances:provision.instances.map((s,j) => j === index ? {...s,[key]:e.target.value} : s)})}/>}</label>)}</fieldset>)}
      <p role="alert" className="field-error">{error}</p><button type="button" className={button} disabled={provision.instances.length >= 20} onClick={() => setProvision({...provision,instances:[...provision.instances,workspace()]})}>ADD WORKSPACE</button><button disabled={busy} className={button}>{inviteMode ? "CREATE INVITATION" : "CREATE"}</button>
    </form></Modal>}
    {createdInvite && <Modal title="Share sign-up invitation" close={() => setCreatedInvite(null)}><p>Send this User ID and code to the intended user. The code expires in 24 hours and works once.</p><p className="form-note">User ID: {createdInvite.user_id}</p><label className="form-note">Invitation code<input readOnly className={input} value={createdInvite.invitation_token} onFocus={e => e.target.select()}/></label></Modal>}
    {addWorkspaces && <Modal title="Add workspaces to employee" close={() => setAddWorkspaces(null)}><form className="space-y-3" onSubmit={e => {e.preventDefault(); perform(async () => {await post(`/api/employees/${addWorkspaces.user_id}/workspaces`, {instances: addWorkspaces.instances}); setAddWorkspaces(null); await fetchFleet();});}}>
      <label className="block">Employee<select className={input} value={addWorkspaces.user_id} onChange={e => setAddWorkspaces({...addWorkspaces, user_id: e.target.value})}>{[...new Set(fleet.map(i => i.owner))].filter(o => o !== currentUser.id).map(id => <option key={id} value={id}>{id}</option>)}</select></label>
      {addWorkspaces.instances.map((spec,index) => <fieldset key={index} className="workspace-fields"><legend>Workspace {index+1}</legend>{Object.keys(spec).map(key => <label key={key} className="block">{{name:'Workspace name',instance_type:'Machine type',shift_start:'Shift start',shift_end:'Shift end'}[key]}{key === 'instance_type' ? <select className={input} value={spec[key]} onChange={e => setAddWorkspaces({...addWorkspaces,instances:addWorkspaces.instances.map((s,j) => j === index ? {...s,[key]:e.target.value} : s)})}>{['t3.medium','c5.xlarge','r5.large'].map(t => <option key={t}>{t}</option>)}</select> : <input required type={key.startsWith('shift') ? 'time' : 'text'} className={input} value={spec[key]} onChange={e => setAddWorkspaces({...addWorkspaces,instances:addWorkspaces.instances.map((s,j) => j === index ? {...s,[key]:e.target.value} : s)})}/>}</label>)}</fieldset>)}
      <p role="alert" className="field-error">{error}</p><button type="button" className={button} disabled={addWorkspaces.instances.length >= 20} onClick={() => setAddWorkspaces({...addWorkspaces,instances:[...addWorkspaces.instances,workspace()]})}>ADD WORKSPACE</button><button disabled={busy} className={button}>CREATE</button>
    </form></Modal>}
    {dump && <TerminalStream instanceId={dump} onClose={() => {setDump(null); perform(fetchFleet);}}/>}
  </main>;
}
function Modal({title,close,children}) {return <div className="modal-backdrop"><section role="dialog" aria-modal="true" aria-label={title} className="command-modal"><div className="modal-heading"><h2 className="dialog-title">{title}</h2><button className={button} onClick={close}>CLOSE</button></div>{children}</section></div>;}
export default function App() {return <AuthProvider><Dashboard/></AuthProvider>;}
