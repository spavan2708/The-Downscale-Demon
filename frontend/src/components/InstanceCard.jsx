import React from 'react';

export default function InstanceCard({instance, busy, canManage, onWake, onPurge, onAnomaly}) {
  const active = ['running', 'idle'].includes(instance.state);
  const cpu = Math.max(0, Math.min(100, Number(instance.cpu) || 0));
  return <article className="workspace-card">
    <header className="workspace-heading">
      <div><h3>{instance.name}</h3><p className="workspace-id">{instance.id}</p></div>
      <span className={`workspace-status status-${instance.state}`}>{instance.state}</span>
    </header>
    <dl className="workspace-details">
      <div><dt>Employee ID</dt><dd>{instance.owner}</dd></div>
      <div><dt>Machine type</dt><dd>{instance.type}</dd></div>
      <div><dt>Shift hours</dt><dd>{instance.shift}</dd></div>
      <div><dt>CPU usage</dt><dd>{cpu}%<meter min="0" max="100" value={cpu} aria-label={`${instance.name} CPU usage`}/></dd></div>
    </dl>
    {(instance.anomaly || instance.exempt) && <div className="workspace-flags">{instance.anomaly && <span className="workspace-alert">Off-hours threat</span>}{instance.exempt && <span>Exempt from automatic hibernation</span>}</div>}
    <footer className="workspace-actions">
      {instance.state !== 'running' && <button disabled={busy} className="workspace-button primary" onClick={onWake}>Wake workspace</button>}
      {canManage && active && <button disabled={busy} className="workspace-button" onClick={onPurge}>CRIU purge</button>}
      {active && <button disabled={busy} className="workspace-button" onClick={onAnomaly}>Test anomaly</button>}
    </footer>
  </article>;
}
