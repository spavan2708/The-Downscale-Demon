import React, {useState} from 'react';
import './SnapshotVault.css';

export default function SnapshotVault({snapshots = [], fleet = [], onRestore, busy = false, dark = false, timezone = 'UTC'}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState({});
  const dateTime = value => new Intl.DateTimeFormat(undefined, {dateStyle: 'medium', timeStyle: 'medium', timeZone: timezone}).format(new Date(value));
  const timestamp = s => Date.parse(s.created_at || s.legacy_date || '') || 0;
  const items = [...snapshots].sort((a,b) => timestamp(b) - timestamp(a) || a.id.localeCompare(b.id));
  const groups = new Map();
  for (const snapshot of items) {
    if (!groups.has(snapshot.instance_id)) groups.set(snapshot.instance_id, []);
    groups.get(snapshot.instance_id).push(snapshot);
  }
  const visible = [...groups.entries()].filter(([id, history]) =>
    `${id} ${fleet.find(i => i.id === id)?.name || ''} ${history.map(s => s.filename).join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  return <section className={`snapshot-vault ${dark ? 'vault-dark' : ''}`} aria-label="Snapshot vault">
    <div className="vault-heading"><div><h2>Snapshot vault</h2><p>{snapshots.length} snapshots across {groups.size} workspaces. Times shown in {timezone}.</p></div><span className="vault-tag">SIMULATED CRIU</span></div>
    <p className="vault-note">Restore wakes the workspace; this demo does not load a particular memory image. Retained snapshots continue to count toward storage estimates.</p>
    <input className="vault-search" aria-label="Search snapshots" placeholder="Search workspace, instance or filename" value={query} onChange={e => setQuery(e.target.value)}/>
    <div className="snapshot-grid">{visible.map(([instanceId, history]) => {
      const instance = fleet.find(i => i.id === instanceId);
      const s = history.find(snapshot => snapshot.id === selected[instanceId]) || history[0];
      return <article className="snapshot-card" key={instanceId}>
        <header><div><h3>{instance?.name || 'Workspace snapshot'}</h3><p className="snapshot-instance">{s.instance_id}</p></div><span className="vault-tag">{history.length} snapshot{history.length === 1 ? '' : 's'}</span></header>
        <label className="snapshot-picker">Snapshot history <span className="vault-muted">(newest first)</span>
          <select aria-label={`Snapshot history for ${instance?.name || instanceId}`} value={s.id} onChange={e => setSelected({...selected, [instanceId]: e.target.value})}>
            {history.map((snapshot, index) => <option key={snapshot.id} value={snapshot.id}>{index === 0 ? 'Latest: ' : ''}{snapshot.created_at ? dateTime(snapshot.created_at) : `${snapshot.legacy_date || 'Date unavailable'} / time not recorded`} / {snapshot.id.slice(0,8)}</option>)}
          </select>
        </label>
        <dl className="snapshot-meta">
          <div className="snapshot-time"><dt>Created</dt><dd>{s.created_at ? <time dateTime={s.created_at}>{dateTime(s.created_at)}</time> : <>{s.legacy_date || 'Date unavailable'} <span className="vault-muted">/ time not recorded</span></>}</dd></div>
          {s.simulated_at && <div className="snapshot-time"><dt>Demo date &amp; time</dt><dd><time dateTime={s.simulated_at}>{dateTime(s.simulated_at)}</time></dd></div>}
          <div><dt>Snapshot size</dt><dd>{s.size_mb} MiB</dd></div><div><dt>Saved panes</dt><dd>{s.tmux_panes}</dd></div><div><dt>Snapshot reference</dt><dd className="snapshot-reference" title={s.id}>{s.id}</dd></div>
        </dl>
        <details className="snapshot-file"><summary>Snapshot filename</summary><code>{s.filename}</code></details>
        {onRestore && <footer><button type="button" disabled={busy || !instance || ['running','idle'].includes(instance.state)} onClick={() => onRestore(s.instance_id)}>{['running','idle'].includes(instance?.state) ? 'Workspace running' : 'Restore workspace'}</button></footer>}
      </article>;
    })}</div>
    {!visible.length && <p className="vault-empty">{snapshots.length ? 'No snapshots match your search.' : 'No snapshots yet. Hibernate a running workspace to create one.'}</p>}
  </section>;
}
