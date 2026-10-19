import React, {useState} from 'react';
import {CostCurve, FleetLoadChart} from './GovernanceDashboard';

const money = value => `$${Number(value || 0).toFixed(2)}`;
const duration = value => `${Number(value || 0).toFixed(2)} h`;
const groups = [
  {key: 'active', label: 'Active', color: '#16804a', matches: state => ['running', 'idle'].includes(state)},
  {key: 'hibernated', label: 'Hibernated', color: '#4975c6', matches: state => ['hibernated', 'stopped'].includes(state)},
  {key: 'quarantined', label: 'Quarantined', color: '#c64d3e', matches: state => state === 'isolated'},
];

function ActivityDistribution({fleet}) {
  const [selected, setSelected] = useState(null);
  const [selectedWorkspace, setSelectedWorkspace] = useState(null);
  const counts = groups.map(group => ({...group, count: fleet.filter(item => group.matches(item.state)).length}));
  const total = counts.reduce((sum, group) => sum + group.count, 0);
  const circumference = 2 * Math.PI * 44;
  let offset = 0;
  return <section className="governance-chart analytics-distribution">
    <div className="governance-chart-heading"><div><h3>Workspace activity distribution</h3><p>Live state across the authorized fleet</p></div></div>
    <div className="distribution-content">
      <svg viewBox="0 0 120 120" role="img" aria-label={`${total} workspaces: ${counts.map(item => `${item.count} ${item.label}`).join(', ')}`}>
        <circle cx="60" cy="60" r="44" fill="none" stroke="#e8ece7" strokeWidth="13"/>
        {counts.map(group => {
          const length = total ? group.count / total * circumference : 0;
          const dashOffset = offset;
          offset += length;
          return <circle key={group.key} cx="60" cy="60" r="44" fill="none" stroke={group.color} strokeWidth="13"
            strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-dashOffset}
            transform="rotate(-90 60 60)" className={selected === group.key ? 'distribution-segment is-selected' : 'distribution-segment'}
            onClick={() => setSelected(selected === group.key ? null : group.key)}>
            <title>{group.count} {group.label}</title>
          </circle>;
        })}
        <text className="distribution-total" x="60" y="58" textAnchor="middle">{total}</text>
        <text className="distribution-caption" x="60" y="73" textAnchor="middle">workspaces</text>
      </svg>
      <div className="distribution-legend">{counts.map(group => <button type="button" key={group.key} aria-pressed={selected === group.key}
        onClick={() => setSelected(selected === group.key ? null : group.key)}>
        <i style={{backgroundColor: group.color}}/><span>{group.label}</span><strong>{group.count}</strong>
      </button>)}</div>
    </div>
    {selected && <div className="distribution-detail" aria-live="polite">
      <strong>{groups.find(group => group.key === selected)?.label} workspaces</strong>
      {fleet.filter(item => groups.find(group => group.key === selected)?.matches(item.state)).map(item =>
        <button type="button" key={item.id} aria-pressed={selectedWorkspace === item.id} onClick={() => setSelectedWorkspace(selectedWorkspace === item.id ? null : item.id)}>
          {item.name} <small>{item.owner || 'Unassigned'} · {item.shift_start || '—'}–{item.shift_end || '—'}</small>
        </button>)}
      {!counts.find(group => group.key === selected)?.count && <span>No workspaces in this state.</span>}
    </div>}
    {selectedWorkspace && fleet.find(item => item.id === selectedWorkspace) && <WorkspaceAccessDetail workspace={fleet.find(item => item.id === selectedWorkspace)}/>}
  </section>;
}

function WorkspaceAccessDetail({workspace}) {
  return <div className="workspace-access-detail" aria-live="polite">
    <strong>{workspace.name}</strong>
    <span className={workspace.access_mode ? 'access-mode-badge' : 'access-mode-badge is-inactive'}>
      {workspace.access_mode ? `IN ACCESS MODE · ${workspace.active_user || workspace.owner || 'Employee'}` : 'NO ACTIVE SESSION'}
    </span>
    <small>Shift {workspace.shift_start || '—'}–{workspace.shift_end || '—'} · CPU {Number(workspace.cpu || 0).toFixed(1)}% · Memory {workspace.memory_percent == null ? '—' : `${Number(workspace.memory_percent).toFixed(1)}%`}</small>
  </div>;
}

function buildCandle(points, fallback) {
  const values = points.length ? points : [fallback, fallback, fallback];
  return {
    low:Math.min(...values), high:Math.max(...values), open:values[0], close:values.at(-1),
  };
}

function CandlePanel({fleet, telemetryByWorkspace, metric, label, memory = false, selectedId, onSelect}) {
  const width = 760, height = 224, left = 42, right = 14, top = 18, bottom = 46;
  const plotWidth = width-left-right, plotHeight = height-top-bottom;
  const count = Math.max(fleet.length, 1);
  const candleWidth = Math.min(24, plotWidth/count*0.42);
  const y = value => top + (100-Math.max(0,Math.min(100,value)))*plotHeight/100;
  return <section className="governance-chart candle-panel">
    <div className="governance-chart-heading"><div><h3>{label} shift-window OHLC</h3><p>Each candle summarizes one workspace’s observed shift telemetry.</p></div>
      <div className="chart-legend"><span><i className="legend-managed"/>Lower / stable</span><span><i className="legend-cpu"/>Higher close</span></div></div>
    {fleet.length ? <svg className="candlestick-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label} open, high, low and close telemetry candles for all workspaces`}>
      {[0,25,50,75,100].map(level => <g key={level}><line x1={left} x2={width-right} y1={y(level)} y2={y(level)}/><text x="3" y={y(level)+4}>{level}%</text></g>)}
      {fleet.map((workspace,index) => {
        const raw = (telemetryByWorkspace[workspace.id] || []).map(point => Number(point[metric])).filter(Number.isFinite);
        const fallback = Number(memory ? workspace.memory_percent : workspace.cpu) || 0;
        const candle = buildCandle(raw, fallback);
        const center = left+(index+0.5)*plotWidth/count;
        const rising = candle.close > candle.open;
        const fill = rising ? '#c64d3e' : '#16804a';
        return <g key={workspace.id} className={selectedId === workspace.id ? 'candle-workspace is-selected' : 'candle-workspace'} role="button" tabIndex="0"
          aria-label={`${workspace.name}: open ${candle.open.toFixed(1)}%, high ${candle.high.toFixed(1)}%, low ${candle.low.toFixed(1)}%, close ${candle.close.toFixed(1)}%`}
          onClick={() => onSelect(workspace)} onKeyDown={event => {if (event.key === 'Enter' || event.key === ' ') {event.preventDefault(); onSelect(workspace);}}}>
          <line className="candle-wick" x1={center} x2={center} y1={y(candle.high)} y2={y(candle.low)} stroke={fill}/>
          <rect className="candle-body" x={center-candleWidth/2} y={Math.min(y(candle.open),y(candle.close))}
            width={candleWidth} height={Math.max(2,Math.abs(y(candle.open)-y(candle.close)))} fill={fill}/>
          <text className="candle-label" x={center} y={height-25} textAnchor="middle">{workspace.name.length > 14 ? `${workspace.name.slice(0,12)}…` : workspace.name}</text>
          <title>{workspace.name} · O {candle.open.toFixed(1)}% · H {candle.high.toFixed(1)}% · L {candle.low.toFixed(1)}% · C {candle.close.toFixed(1)}%</title>
        </g>;
      })}
    </svg> : <p className="governance-empty">No workspaces are available for the chart.</p>}
    {fleet.find(item => item.id === selectedId) && <WorkspaceAccessDetail workspace={fleet.find(item => item.id === selectedId)}/>}
  </section>;
}

function LiveTicker({fleet, runtime, runtimeSyncedAt, clockNow}) {
  const running = fleet.filter(item => ['running','idle'].includes(item.state));
  const hibernated = fleet.filter(item => ['hibernated','stopped'].includes(item.state));
  const nonProduction = fleet.filter(item => !item.is_production && !item.exempt);
  const scaledToZero = nonProduction.filter(item => ['hibernated','stopped'].includes(item.state)).length;
  const elapsedHours = Math.max(0,clockNow-runtimeSyncedAt)/3_600_000;
  const activeHours = Number(runtime?.today_active_hours ?? runtime?.active_hours ?? 0)+elapsedHours*running.length;
  const hibernatedHours = Number(runtime?.today_hibernated_hours ?? runtime?.hibernated_hours ?? 0)+elapsedHours*hibernated.length;
  const savedRate = hibernated.reduce((sum,item)=>sum+(Number(item.hourly_rate)||0),0);
  const preserved = Number(runtime?.today_estimated_credits_preserved_usd ?? runtime?.estimated_credits_preserved_usd ?? 0)+elapsedHours*savedRate;
  const runningRate = running.reduce((sum,item)=>sum+(Number(item.hourly_rate)||0),0);
  const efficiency = nonProduction.length ? scaledToZero/nonProduction.length*100 : 0;
  return <section className="live-cost-ticker" aria-label="Live FinOps metrics">
    <article><span>Total cumulative active hours today</span><strong>{activeHours.toFixed(2)} h</strong></article>
    <article><span>Hibernated hours preserved</span><strong>{hibernatedHours.toFixed(2)} h</strong></article>
    <article><span>Estimated AWS credits preserved</span><strong>${preserved.toFixed(4)}</strong><small>Modeled avoidance; not AWS-issued credits</small></article>
    <article><span>Active running spend rate</span><strong>${runningRate.toFixed(4)}/hr</strong></article>
    <article><span>Fleet downscale efficiency</span><strong>{efficiency.toFixed(1)}%</strong></article>
  </section>;
}

export default function AnalyticsDashboard({fleet, analytics, timezone, runtime, telemetryHistory, telemetryByWorkspace = {}, canViewRuntime, runtimeSyncedAt, clockNow, onWorkspaceSelect}) {
  const baselineDaily = fleet.reduce((sum, item) => sum + (Number(item.hourly_rate) || 0) * 24, 0);
  const [selectedId, setSelectedId] = useState(fleet[0]?.id || null);
  const activeSelectedId = fleet.some(item=>item.id===selectedId) ? selectedId : fleet[0]?.id;
  const selectWorkspace = workspace => {
    setSelectedId(workspace.id);
    onWorkspaceSelect?.(workspace);
  };
  return <section className="analytics-section analytics-dashboard">
    <div className="section-heading"><div><p className="eyebrow">Fleet economics</p><h2>Cloud cost &amp; access analytics</h2>
      <p>Scheduled cost comparison, observed fleet state, and live resource trends.</p></div><span className="section-count">24-hour view · rates configured by deployment</span></div>

    <LiveTicker fleet={fleet} runtime={runtime} runtimeSyncedAt={runtimeSyncedAt} clockNow={clockNow}/>
    <section className="daily-runtime-panel">
      <div className="daily-runtime-heading"><div><p className="eyebrow">Runtime counters</p><h3>Today’s workspace runtime</h3><p>Lifecycle intervals clipped to today in {runtime?.daily_tracking_timezone || timezone}.</p></div>
        <span className="runtime-live-label">LIVE · database intervals</span></div>
      {canViewRuntime && runtime ? <div className="daily-runtime-cards">
        <article><span>Cumulative active hours</span><strong>{duration(runtime?.today_active_hours)}</strong><small>Across workspaces recorded today</small></article>
        <article><span>Hibernated hours preserved</span><strong>{duration(runtime?.today_hibernated_hours)}</strong><small>Time in stopped / hibernated states</small></article>
        <article><span>Estimated compute avoidance</span><strong>{money(runtime?.today_estimated_credits_preserved_usd)}</strong><small>Modeled at configured rates; not AWS-issued credits</small></article>
      </div> : <p className="runtime-access-note">{canViewRuntime ? 'Loading lifecycle runtime intervals…' : 'Daily runtime counters are available to authorized governance roles.'}</p>}
      {canViewRuntime && runtime && <p className="runtime-provenance">Counters include persisted state intervals only; runtime before lifecycle tracking was enabled is unavailable.</p>}
    </section>

    <div className="analytics-spend-summary" aria-label="Projected daily cost comparison">
      <article><span>24×7 baseline · projected / day</span><strong>{money(baselineDaily)}</strong></article>
      <article><span>Demon-managed · projected / day</span><strong>{money(analytics?.total_daily)}</strong></article>
      <article><span>Projected savings · / day</span><strong>{money(analytics?.daily_savings)}</strong></article>
    </div>
    <div className="analytics-chart-grid">
      <CostCurve fleet={fleet} timezone={timezone}/>
      <ActivityDistribution fleet={fleet}/>
      <FleetLoadChart history={telemetryHistory}/>
    </div>
    <div className="candlestick-grid">
      <CandlePanel fleet={fleet} telemetryByWorkspace={telemetryByWorkspace} metric="cpu" label="CPU" selectedId={activeSelectedId} onSelect={selectWorkspace}/>
      <CandlePanel fleet={fleet} telemetryByWorkspace={telemetryByWorkspace} metric="memory" label="Memory" memory selectedId={activeSelectedId} onSelect={selectWorkspace}/>
    </div>
    <p className="section-footnote">Cost curves use configured instance rates and scheduled shifts. {telemetryHistory.some(sample => sample.demo) ? 'Localhost telemetry points are illustrative demo samples, not live AWS readings.' : 'Telemetry trends are observed WebSocket samples collected only while this dashboard is connected.'} These charts are not historical CloudWatch data or billing records.</p>
  </section>;
}
