import React, {useEffect, useState} from 'react';
import {useAuth} from '../context/AppContext';
const apiBase = import.meta.env.VITE_API_BASE_URL
  || (typeof window !== 'undefined' && window.location.port === '5173' ? 'http://localhost:8000' : '');
const websocketOrigin = apiBase
  ? apiBase.replace(/^http/, 'ws')
  : `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`;
export default function TerminalStream({instanceId,onClose}) {
  const {token} = useAuth();
  const [logs,setLogs] = useState([]);
  useEffect(() => {
    const ws = new WebSocket(`${websocketOrigin}/ws/criu-dump/${encodeURIComponent(instanceId)}`);
    ws.onopen = () => ws.send(JSON.stringify({token}));
    ws.onmessage = event => setLogs(previous => [...previous,event.data]);
    ws.onclose = event => {if (event.code >= 4000) setLogs(previous => [...previous,`Purge rejected (${event.code})`]);};
    ws.onerror = () => setLogs(previous => [...previous,'Connection failed. Check fleet state before retrying.']);
    return () => ws.close();
  },[instanceId,token]);
  return <div className="modal-backdrop"><section role="dialog" aria-modal="true" aria-label="CRIU terminal" className="command-modal terminal-modal"><button onClick={onClose} className="command-button terminal-close">DISMISS</button><h2 className="dialog-title">CRIU MEMORY DUMP</h2><div role="log" className="terminal-log">{logs.map((line,i) => <p key={i}>{line}</p>)}</div></section></div>;
}
