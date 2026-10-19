import React, {useMemo, useState} from 'react';

const money = value => `$${Number(value || 0).toFixed(2)}`;
const hours = value => `${Number(value || 0).toFixed(2)} h`;
const activeState = state => ['running', 'idle'].includes(state);
const statusName = state => state === 'isolated' ? 'Quarantined' : state === 'hibernated' || state === 'stopped' ? 'Hibernating' : state;

function shiftOpenAtHour(instance, hour) {
  if (instance.exempt || instance.snoozed || instance.shift_start === instance.shift_end) return true;
  const [startHour, startMinute] = (instance.shift_start || '09:00').split(':').map(Number);
  const [endHour, endMinute] = (instance.shift_end || '18:00').split(':').map(Number);
  const start = startHour + startMinute / 60;
  const end = endHour + endMinute / 60;
  const sample = (hour + 0.5) % 24;
  return start < end ? sample >= start && sample < end : sample >= start || sample < end;
}

function linePath(values, maxValue, width, height) {
  if (!values.length) return '';
  return values.map((value, index) => {
    const x = (index / Math.max(1, values.length - 1)) * width;
    const y = height - Math.max(0, Math.min(100, (value / maxValue) * 100)) * height / 100;
    return `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

export function FleetLoadChart({history = []}) {
  const cpuValues = history.map(sample => sample.cpu);
  const memoryValues = history.map(sample => sample.memory).filter(Number.isFinite);
  const chartPath = values => linePath(values, 100, 548, 125)
    .replaceAll(/([ML])([\d.]+),([\d.]+)/g, (_, command, x, y) => `${command}${Number(x) + 42},${Number(y) + 25}`);
  return <section className="governance-chart">
    <div className="governance-chart-heading"><div><h3>Fleet resource load</h3><p>{history.some(sample => sample.demo) ? 'Illustrative localhost demo samples · not live AWS telemetry' : 'Rolling observed fleet averages · since this dashboard connected'}</p></div><div className="chart-legend"><span><i className="legend-cpu"/>CPU</span><span><i className="legend-memory"/>Memory</span></div></div>
    {history.length ? <div className="load-chart">
      <svg viewBox="0 0 600 180" role="img" aria-label="Rolling fleet CPU and memory utilization timeline">
        {[0, 25, 50, 75, 100].map(level => <g key={level}><line x1="42" x2="590" y1={150 - level * 1.25} y2={150 - level * 1.25}/><text x="5" y={154 - level * 1.25}>{level}%</text></g>)}
        <path className="chart-cpu-path" d={chartPath(cpuValues)}/>
        {memoryValues.length > 1 && <path className="chart-memory-path" d={chartPath(memoryValues)}/>}
        {history.map((sample, index) => <circle key={`${sample.at}-${index}`} className="chart-cpu-point" cx={42 + index / Math.max(1, history.length - 1) * 548} cy={150 - sample.cpu * 1.25} r="3"><title>{new Date(sample.at).toLocaleTimeString()}: fleet CPU {sample.cpu.toFixed(1)}%</title></circle>)}
        {history.length > 1 && <><text x="42" y="170">{new Date(history[0].at).toLocaleTimeString()}</text><text x="530" y="170">{new Date(history.at(-1).at).toLocaleTimeString()}</text></>}
      </svg>
    </div> : <p className="governance-empty">Collecting WebSocket telemetry samples. The timeline begins when the dashboard connects.</p>}
    {history.length > 0 && memoryValues.length < 2 && <p className="chart-footnote">Memory trend needs at least two valid memory telemetry samples.</p>}
  </section>;
}

export function CostCurve({fleet = [], timezone}) {
  const series = useMemo(() => Array.from({length: 24}, (_, hour) => {
    const baseline = fleet.reduce((sum, item) => sum + (Number(item.hourly_rate) || 0), 0);
    const managed = fleet.reduce((sum, item) => sum + (shiftOpenAtHour(item, hour) ? Number(item.hourly_rate) || 0 : 0), 0);
    return {hour, baseline, managed};
  }), [fleet]);
  const max = Math.max(0.01, ...series.map(item => item.baseline));
  const pathFor = key => series.map((item, index) => {
    const x = 46 + index / 23 * 540;
    const y = 145 - item[key] / max * 120;
    return `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return <section className="governance-chart">
    <div className="governance-chart-heading"><div><h3>Hourly cloud cost curve</h3><p>24×7 baseline vs shift projection · server shift time ({timezone})</p></div><div className="chart-legend"><span><i className="legend-baseline"/>Baseline</span><span><i className="legend-managed"/>Managed</span></div></div>
    <svg className="cost-chart" viewBox="0 0 600 180" role="img" aria-label="Hourly baseline and managed cost projection">
      {[0, 1, 2, 3].map(index => <line key={index} x1="46" x2="586" y1={25 + index * 40} y2={25 + index * 40}/>)}
      <path className="chart-baseline-path" d={pathFor('baseline')}/>
      <path className="chart-managed-path" d={pathFor('managed')}/>
      {[0, 6, 12, 18, 23].map(hour => <text key={hour} x={46 + hour / 23 * 540} y="170">{String(hour).padStart(2, '0')}:00</text>)}
    </svg>
    <p className="chart-footnote">Projection uses configured hourly rates and scheduled shifts; exempt/snoozed workspaces remain in the baseline curve. Actual charges depend on AWS billing.</p>
  </section>;
}

export default function GovernanceDashboard({
  fleet = [], analytics = {}, governance = {}, telemetryHistory = [], pingMs, currentUser, isAdmin, busy, timezone, demoMode,
  onShift, onWake, onPurge, onAccess, onDelete, onDecision,
}) {
  const visibleFleet = fleet || [];
  const visibleGovernance = governance || {};
  const [selectedId, setSelectedId] = useState(visibleFleet[0]?.id || null);
  const [deleting, setDeleting] = useState(null);
  const [confirmation, setConfirmation] = useState('');
  const selected = visibleFleet.find(item => item.id === selectedId) || visibleFleet[0];
  const runtimeById = new Map((visibleGovernance?.runtime?.workspaces || []).map(item => [item.instance_id, item]));
  const employeeById = new Map((visibleGovernance?.employees || []).map(item => [item.id, item]));
  const runtime = visibleGovernance?.runtime || {};
  const baselineDaily = visibleFleet.reduce((sum, item) => sum + (Number(item.hourly_rate) || 0) * 24, 0);
  const threats = visibleFleet.filter(item => item.anomaly || item.state === 'isolated').length;
  const active = visibleFleet.filter(item => activeState(item.state)).length;
  const cpuTotal = visibleFleet.filter(item => activeState(item.state)).reduce((sum, item) => sum + (Number(item.cpu) || 0), 0);
  const savingsEfficiency = Number(analytics?.downscale_rate) || 0;

  return <div className="governance-dashboard">
    <section className="executive-section" aria-labelledby="executive-summary-title">
      <div className="governance-section-heading"><div><p className="eyebrow">Cloud governance</p><h2 id="executive-summary-title">Executive summary</h2><p>Scoped to your authorized workspaces · {currentUser.team_id || 'all teams'}</p></div><span className="governance-live-tag">LIVE GOVERNANCE</span></div>
      <div className="executive-cards">
        <article className="executive-card savings-card"><span>Estimated credits preserved</span><strong>{money(runtime.estimated_credits_preserved_usd || 0)}</strong><small>Since runtime tracking started · modeled compute avoidance</small></article>
        <article className="executive-card"><span>Active nodes</span><strong>{active}<small> / {visibleFleet.length}</small></strong><small>{active ? (cpuTotal / active).toFixed(1) : '0.0'}% average CPU across active nodes</small></article>
        <article className="executive-card threat-card"><span>Blocked threats</span><strong>{visibleFleet.filter(item => item.state === 'isolated').length}</strong><small>{threats ? `${threats} isolated or flagged for review` : 'No active quarantine flags'}</small></article>
        <article className="executive-card"><span>Downscale efficiency</span><strong>{savingsEfficiency.toFixed(1)}%</strong><small>Hibernated share of non-exempt workspaces</small></article>
      </div>
      <div className="spend-comparison">
        <div><span>24×7 baseline · projected / day</span><strong>{money(baselineDaily)}</strong></div>
        <div><span>Demon-managed · projected / day</span><strong>{money(analytics?.total_daily)}</strong></div>
        <div><span>Projected savings · / day</span><strong>{money(analytics?.daily_savings)}</strong></div>
      </div>
      <div className="spend-comparison">
        <div><span>24×7 baseline · tracked</span><strong>{money(runtime.baseline_compute_usd)}</strong></div>
        <div><span>Demon-managed · tracked</span><strong>{money(runtime.managed_compute_usd)}</strong></div>
        <div><span>Tracked runtime</span><strong>{hours(runtime.tracked_hours)}</strong></div>
        <p>Tracked from database state intervals. Preserved amount is an estimate, not AWS-issued credits or billed savings.</p>
      </div>
    </section>

    <section className="fleet-map-section" aria-labelledby="fleet-map-title">
      <div className="governance-section-heading"><div><p className="eyebrow">Workspace operations</p><h2 id="fleet-map-title">Fleet map &amp; command grid</h2><p>Select a workspace to inspect its state, runtime, and available controls.</p></div><div className="fleet-map-legend"><span><i className="state-dot state-active"/>Active</span><span><i className="state-dot state-hibernated"/>Hibernating</span><span><i className="state-dot state-quarantined"/>Quarantined</span><span><i className="state-dot state-access"/>In access mode</span></div></div>
      <div className="fleet-command-layout">
        <div className="fleet-matrix" role="list" aria-label="Workspace activity matrix">
          {visibleFleet.map(item => <article role="listitem" key={item.id} className="fleet-matrix-card">
            <button type="button" aria-pressed={selected?.id === item.id} className={`fleet-matrix-cell ${selected?.id === item.id ? 'is-selected' : ''} matrix-${item.state}`} onClick={() => setSelectedId(item.id)}>
              <span className="state-dot"/><strong>{item.name}</strong><small>{item.owner || 'Unassigned'} · {item.anomaly ? 'Anomaly detected' : statusName(item.state)}</small>
              {item.access_mode && <span className="access-mode-badge">IN ACCESS MODE · {item.active_user || item.owner}</span>}
              <small>CPU {Number(item.cpu || 0).toFixed(1)}% · Memory {item.memory_percent == null ? '—' : `${Number(item.memory_percent).toFixed(1)}%`}</small>
              <span className="matrix-load-track" aria-label={`CPU load ${Number(item.cpu || 0).toFixed(1)} percent`}><span style={{width: `${Math.max(0, Math.min(100, Number(item.cpu) || 0))}%`}}/></span>
              <small>Shift {item.shift_start || '—'}–{item.shift_end || '—'}</small>
            </button>
            {isAdmin && <button type="button" className="matrix-terminate" disabled={busy} onClick={() => {setDeleting(item); setConfirmation('');}}>Terminate &amp; Delete Workspace</button>}
          </article>)}
          {!visibleFleet.length && <p className="governance-empty">No authorized workspaces are allocated.</p>}
        </div>
        {selected && <article className="workspace-command-panel">
          <header><div><p className="eyebrow">Selected workspace</p><h3>{selected.name}</h3><small>{selected.id} · {selected.type}</small></div><span className={`workspace-status status-${selected.state}`}>{statusName(selected.state)}</span></header>
          <dl className="runtime-details">
            <div><dt>Active runtime</dt><dd>{hours(runtimeById.get(selected.id)?.active_hours)}</dd></div>
            <div><dt>Hibernated runtime</dt><dd>{hours(runtimeById.get(selected.id)?.hibernated_hours)}</dd></div>
            <div><dt>Managed spend</dt><dd>{money(runtimeById.get(selected.id)?.managed_compute_usd)}</dd></div>
            <div><dt>Telemetry updated</dt><dd>{selected.telemetry_updated_at ? new Date(selected.telemetry_updated_at).toLocaleTimeString() : 'No sample'}</dd></div>
          </dl>
          <div className="selected-access-details"><strong>{selected.access_mode ? 'IN ACCESS MODE' : 'No active employee session'}</strong><span>{selected.access_mode ? `Active user: ${selected.active_user || selected.owner || 'Employee'}` : `Assigned employee: ${selected.owner || 'Unassigned'}`}</span><span>Shift: {selected.shift_start || '—'}–{selected.shift_end || '—'}</span></div>
          <div className="selected-telemetry"><span>CPU <b>{Number(selected.cpu || 0).toFixed(1)}%</b></span><span>Memory <b>{selected.memory_percent == null ? '—' : `${Number(selected.memory_percent).toFixed(1)}%`}</b></span><span>Connection <b>{pingMs == null ? '—' : `${pingMs} ms`}</b></span></div>
          <div className="workspace-command-actions">
            {selected.state !== 'running' && selected.state !== 'isolated' && <button type="button" disabled={busy} onClick={() => onWake(selected.id)}>Wake</button>}
            {(currentUser.role === 'manager' || currentUser.role === 'team_lead' || isAdmin) && <button type="button" disabled={busy} onClick={() => onShift(selected)}>Adjust shift</button>}
            {(currentUser.role === 'manager' || currentUser.role === 'team_lead' || isAdmin) && <button type="button" disabled={busy || !activeState(selected.state)} onClick={() => onPurge(selected.id)}>Hibernate</button>}
            {isAdmin && <button type="button" className="command-delete-button" disabled={busy} onClick={() => {setDeleting(selected); setConfirmation('');}}>Terminate &amp; Delete Workspace</button>}
          </div>
          <p className="runtime-provenance">{`Runtime counts are derived from persisted state-transition intervals. AWS lifecycle: ${visibleGovernance?.aws_lifecycle_enabled ? 'enabled' : 'disabled'}.`}</p>
        </article>}
      </div>
      <div className="governance-charts"><FleetLoadChart history={telemetryHistory}/><CostCurve fleet={visibleFleet} timezone={timezone}/></div>
    </section>

    <section className="granular-governance-section" aria-labelledby="governance-control-title">
      <div className="governance-section-heading"><div><p className="eyebrow">People, policy &amp; evidence</p><h2 id="governance-control-title">Granular governance &amp; audit</h2><p>Team Leads can manage their team; stack termination is Chief Architect-only.</p></div></div>
      <div className="governance-columns">
        <section className="governance-subpanel"><h3>Employee access</h3><p className="panel-subtitle">Blocking revokes active sessions and requests workspace downscale immediately.</p>
          {(visibleGovernance?.employees || []).filter(employee => employee.role === 'employee').map(employee => <article className="employee-governance-row" key={employee.id}>
            <div><strong>{employee.name}</strong><small>{employee.id} · {employee.workspace_count} workspace(s)</small></div>
            <button type="button" className={employee.access_blocked ? 'access-toggle is-blocked' : 'access-toggle'} disabled={busy} aria-pressed={employee.access_blocked} onClick={() => onAccess(employee.id, !employee.access_blocked)}>{employee.access_blocked ? 'Access blocked · restore' : 'Emergency Revoke / Lockout'}</button>
          </article>)}
          {!visibleGovernance?.employees?.some(employee => employee.role === 'employee') && <p className="governance-empty">No employees in this governance scope.</p>}
        </section>
        <section className="governance-subpanel" id="overtime-approvals"><h3>Pending shift extensions</h3><p className="panel-subtitle">Overtime approvals update the employee’s shift bounds immediately.</p>
          {(visibleGovernance?.requests || []).filter(request=>request.request_type==='overtime' && request.status==='open').map(request => <article className="overtime-request-row" key={request.id}>
            <div><span className="request-type">SHIFT EXTENSION · {request.extension_hours ? `+${request.extension_hours} HOURS` : 'DURATION NOT SPECIFIED'}</span><strong>{request.subject}</strong><small>{employeeById.get(request.owner_id)?.name || request.owner_id} · {request.instance_id || 'No workspace'}</small><p>{request.details}</p></div>
            <div className="request-actions"><button type="button" disabled={busy} onClick={() => onDecision(request.id, 'approved')}>Approve (+{request.extension_hours || 2} Hrs)</button><button type="button" disabled={busy} onClick={() => onDecision(request.id, 'rejected')}>Reject</button></div>
          </article>)}
          {!(visibleGovernance?.requests || []).some(request=>request.request_type==='overtime' && request.status==='open') && <p className="governance-empty">No pending shift extensions.</p>}
        </section>
      </div>
      <section className="governance-subpanel audit-panel"><div className="audit-heading"><div><h3>Governance audit log</h3><p className="panel-subtitle">Latest lifecycle, access, request, and policy events in your scope.</p></div><span>{visibleGovernance?.audit?.length || 0} events</span></div>
        <div className="audit-list">{(visibleGovernance?.audit || []).slice(0, 30).map(event => <article className="audit-event" key={event.id}><time dateTime={event.created_at}>{event.created_at ? new Date(event.created_at).toLocaleString() : 'Time unavailable'}</time><strong>{event.event_type.replaceAll('_', ' ')}</strong><span>{event.details || event.instance_id || 'Platform event'}</span><small>{event.actor_id ? `by ${event.actor_id}` : 'system'}</small></article>)}
          {!visibleGovernance?.audit?.length && <p className="governance-empty">Audit events will appear as governance actions occur.</p>}</div>
      </section>
    </section>

    {deleting && <div className="modal-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="delete-workspace-title" className="command-modal governance-delete-modal">
      <div className="modal-heading"><h2 id="delete-workspace-title" className="dialog-title">Delete workspace / terminate stack</h2><button type="button" className="command-button" onClick={() => setDeleting(null)}>Cancel</button></div>
      <p>This permanently removes <strong>{deleting.name}</strong> from the workspace registry and terminates its EC2 instance. Any attached EBS volume will be safely detached and retained; this action does not erase volume data.</p>
      <label>Type <code>{deleting.name}</code> to confirm<input className="command-input" autoComplete="off" value={confirmation} onChange={event => setConfirmation(event.target.value)}/></label>
      <div className="delete-modal-actions"><button type="button" className="command-button" onClick={() => setDeleting(null)}>Keep workspace</button><button type="button" className="command-button command-button-danger" disabled={busy || confirmation !== deleting.name} onClick={async () => {if (await onDelete(deleting.id, confirmation) !== false) setDeleting(null);}}>Terminate and delete</button></div>
    </section></div>}
  </div>;
}