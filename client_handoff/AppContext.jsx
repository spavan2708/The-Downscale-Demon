import {createContext, useCallback, useContext, useEffect, useRef, useState} from 'react';

const API = 'http://3.27.211.126:8000';
const FLEET_WS = 'ws://3.27.211.126:8000/ws/fleet';

const AppContext = createContext(null);

export function AppProvider({children}) {
  const [auth, setAuth] = useState(null);
  const [fleet, setFleet] = useState(null);
  const [connection, setConnection] = useState('Disconnected');
  const [telemetry, setTelemetry] = useState([]);
  const [pingMs, setPingMs] = useState(null);
  const [backgroundError, setBackgroundError] = useState('');
  const [testPing, setTestPing] = useState(null);
  const [inbox, setInbox] = useState({announcements: [], requests: []});
  const [inboxRevision, setInboxRevision] = useState(0);
  const socketRef = useRef(null);
  const authRef = useRef(auth);
  const inboxRef = useRef(inbox);
  const fleetRef = useRef(fleet);
  authRef.current = auth;
  inboxRef.current = inbox;
  fleetRef.current = fleet;

  const request = useCallback(async (path, body, token = auth?.access_token) => {
    const response = await fetch(`${API}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(token ? {Authorization: `Bearer ${token}`} : {}),
        ...(body === undefined ? {} : {'Content-Type': 'application/json'}),
      },
      ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && token && authRef.current?.access_token === token) {
        setAuth(null);
        setFleet(null);
        setTelemetry([]);
        setPingMs(null);
      }
      const detail = Array.isArray(data.detail)
        ? data.detail.map(item => `${(item.loc || []).filter(part => part !== 'body').join('.')}: ${item.msg}`).join('; ')
        : data.detail;
      const error = new Error(typeof detail === 'string' ? detail : data.reason || `Request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return data;
  }, [auth?.access_token]);

  const refreshFleet = useCallback(async () => {
    if (!authRef.current) return null;
    const token = authRef.current.access_token;
    const data = await request('/api/instances', undefined, token);
    if (authRef.current?.access_token !== token) return null;
    const assignedFleet = Array.isArray(data.fleet) ? data.fleet : [];
    setFleet({...data, fleet: assignedFleet});
    setBackgroundError('');
    setTelemetry(previous => {
      const byId = new Map(previous.map(item => [item.instance_id, item]));
      return assignedFleet.map(instance => ({
        instance_id: instance.id,
        state: instance.state,
        cpu_percent: instance.cpu,
        memory_mb: instance.memory_mb ?? null,
        memory_percent: instance.memory_percent ?? null,
        observed_at: instance.telemetry_updated_at ?? null,
        ...(Date.parse(byId.get(instance.id)?.observed_at) > Date.parse(instance.telemetry_updated_at) ? byId.get(instance.id) : {}),
      }));
    });
    return data;
  }, [request]);

  useEffect(() => {
    if (!auth) {
      setFleet(null);
      setTelemetry([]);
      setConnection('Disconnected');
      setPingMs(null);
      setBackgroundError('');
      setTestPing(null);
      socketRef.current?.close();
      socketRef.current = null;
      return undefined;
    }
    let disposed = false;
    let socket;
    let retry;
    let pingTimer;
    let activityTimer;
    let delay = 1000;
    let requestSequence = 0;
    const refresh = () => refreshFleet().catch(error => {
      if (!disposed) setBackgroundError(error.message);
    });
    const connect = () => {
      if (disposed) return;
      setConnection('Connecting');
      socket = new WebSocket(FLEET_WS);
      socketRef.current = socket;
      socket.onopen = () => {
        if (disposed) return;
        delay = 1000;
        socket.send(JSON.stringify({token: auth.access_token}));
        setConnection('Connected');
        refresh();
        pingTimer = setInterval(() => {
          if (socket.readyState !== WebSocket.OPEN) return;
          const sentAt = Date.now();
          requestSequence = sentAt;
          socket.send(JSON.stringify({type: 'PING', sent_at: sentAt}));
        }, 15000);
        const sendActivity = () => {
          if (socket.readyState !== WebSocket.OPEN || auth.user?.role !== 'employee'
              || document.visibilityState !== 'visible' || !document.hasFocus()) return;
          for (const instance of fleetRef.current?.fleet || []) {
            if (instance.owner === auth.user.id && ['running', 'idle'].includes(instance.state)) {
              socket.send(JSON.stringify({type: 'ACTIVITY', instance_id: instance.id}));
            }
          }
        };
        sendActivity();
        activityTimer = setInterval(sendActivity, 30000);
      };
      socket.onmessage = event => {
        if (disposed) return;
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message.type === 'PONG' && message.sent_at === requestSequence) {
          setPingMs(Math.max(0, Date.now() - message.sent_at));
        }
        if (message.type === 'ADMIN_TEST_PING') {
          setTestPing({id: message.details, actor: message.actor_id, receivedAt: new Date().toLocaleTimeString()});
        }
        if (Array.isArray(message.telemetry)) setTelemetry(message.telemetry);
        if (['SUPPORT_REQUEST_CREATED', 'SUPPORT_REQUEST_UPDATED', 'ANNOUNCEMENT_CREATED'].includes(message.type)) {
          setInboxRevision(value => value + 1);
        }
        if (message.analytics) {
          setFleet(previous => previous ? {...previous, analytics: message.analytics} : previous);
        }
        if (['FLEET_UPDATED', 'SESSION_TERMINATED', 'SUPPORT_REQUEST_CREATED', 'SUPPORT_REQUEST_UPDATED'].includes(message.type)) refresh();
      };
      socket.onclose = event => {
        clearInterval(pingTimer);
        clearInterval(activityTimer);
        if (disposed) return;
        if (event.code === 4401) {
          setAuth(null);
          setFleet(null);
          setTelemetry([]);
          setConnection('Disconnected');
          setTestPing(null);
          return;
        }
        setConnection('Reconnecting');
        setPingMs(null);
        retry = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 15000);
      };
      socket.onerror = () => socket.close();
    };
    refresh();
    connect();
    window.addEventListener('focus', refresh);
    return () => {
      disposed = true;
      clearTimeout(retry);
      clearInterval(pingTimer);
      clearInterval(activityTimer);
      socket?.close();
      if (socketRef.current === socket) socketRef.current = null;
      window.removeEventListener('focus', refresh);
    };
  }, [auth, refreshFleet]);

  return <AppContext.Provider value={{
    auth, setAuth, fleet, setFleet, request, refreshFleet, connection,
    telemetry, pingMs, setPingMs, backgroundError, setBackgroundError, inboxRevision,
    testPing, setTestPing,
  }}>{children}</AppContext.Provider>;
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useAppContext must be used inside AppProvider');
  return context;
}
