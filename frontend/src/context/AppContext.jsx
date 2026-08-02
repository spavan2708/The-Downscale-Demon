import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppContext } from "./appContext";
import { getEmployees } from "../services/employeeService";
import useMetricsSimulation from "../hooks/useMetricsSimulation";
import useWorkspaceEngine from "../hooks/useWorkspaceEngine";
import {
  buildSavingsTrend,
  defaultSettings,
  employeeMeta,
  seedNotifications,
  seedOvertimeRequests,
  seedSavings,
  seedWorkspaces,
} from "../data/initialData";
import { formatHour } from "../utils/format";

export function AppProvider({ children }) {
  const [employees, setEmployees] = useState([]);
  const [employeesLoading, setEmployeesLoading] = useState(true);
  const [employeesError, setEmployeesError] = useState(null);
  const [overtimeRequests, setOvertimeRequests] = useState(seedOvertimeRequests);
  const [notifications, setNotifications] = useState(seedNotifications);
  const [savings, setSavings] = useState(seedSavings);
  const [savingsTrend, setSavingsTrend] = useState(() =>
    buildSavingsTrend(seedSavings.total)
  );
  const [settings, setSettings] = useState(() => {
    const stored = localStorage.getItem("downscale-settings");
    return stored
      ? { ...defaultSettings, ...JSON.parse(stored) }
      : defaultSettings;
  });

  const settingsRef = useRef(settings);
  const savingsRef = useRef(savings);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    savingsRef.current = savings;
  }, [savings]);

  const addNotification = useCallback((type, message) => {
    if (settingsRef.current.notifications === false) return;
    setNotifications((prev) =>
      [{ id: Date.now(), type, message, timestamp: new Date() }, ...prev].slice(0, 30)
    );
  }, []);

  const handleScaled = useCallback(() => {
    const current = savingsRef.current;
    const nextTotal = current.total + 45;
    setSavings({
      ...current,
      today: current.today + 45,
      week: current.week + 45,
      month: current.month + 45,
      year: current.year + 45,
      total: nextTotal,
    });
    setSavingsTrend((trend) =>
      [...trend, { time: formatHour(new Date()), total: nextTotal }].slice(-24)
    );
  }, []);

  const metrics = useMetricsSimulation();

  const {
    workspaces,
    doScale,
    doWake,
    doRestart,
    doDelete,
  } = useWorkspaceEngine({
    seed: seedWorkspaces,
    addNotification,
    onScaled: handleScaled,
    autoScale: settings.autoScale,
    enginePaused: settings.enginePaused,
    idleTimeout: settings.idleTimeout,
  });

  const loadEmployees = useCallback(async () => {
    setEmployeesLoading(true);
    setEmployeesError(null);
    try {
      const data = await getEmployees();
      setEmployees(
        data.map((emp) => ({ ...emp, ...(employeeMeta[emp.name] || {}) }))
      );
    } catch {
      setEmployeesError("Backend unavailable. Employee data could not be loaded.");
    } finally {
      setEmployeesLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function fetchEmployees() {
      try {
        const data = await getEmployees();
        if (cancelled) return;
        setEmployees(data.map((emp) => ({ ...emp, ...(employeeMeta[emp.name] || {}) })));
      } catch {
        if (!cancelled) {
          setEmployeesError("Backend unavailable. Employee data could not be loaded.");
        }
      } finally {
        if (!cancelled) setEmployeesLoading(false);
      }
    }

    fetchEmployees();
    return () => {
      cancelled = true;
    };
  }, []);

  const approveRequest = useCallback(
    (id) => {
      const req = overtimeRequests.find((r) => r.id === id);
      if (!req) return;
      setOvertimeRequests((prev) =>
        prev.map((r) => (r.id === id ? { ...r, status: "approved" } : r))
      );
      setEmployees((prev) =>
        prev.map((e) =>
          e.name === req.employee ? { ...e, overtime: true, access: true } : e
        )
      );
      addNotification("success", `Manager approved overtime for ${req.employee}`);
    },
    [overtimeRequests, addNotification]
  );

  const rejectRequest = useCallback(
    (id) => {
      const req = overtimeRequests.find((r) => r.id === id);
      if (!req) return;
      setOvertimeRequests((prev) =>
        prev.map((r) => (r.id === id ? { ...r, status: "rejected" } : r))
      );
      addNotification("warning", `Manager rejected overtime for ${req.employee}`);
    },
    [overtimeRequests, addNotification]
  );

  const changeShift = useCallback(
    (name, shift) => {
      setEmployees((prev) =>
        prev.map((e) => (e.name === name ? { ...e, shift, access: true } : e))
      );
      addNotification("info", `Shift approved — ${name} moved to ${shift}`);
    },
    [addNotification]
  );

  const toggleAccess = useCallback(
    (name) => {
      let blocked = false;
      setEmployees((prev) =>
        prev.map((e) => {
          if (e.name !== name) return e;
          blocked = !e.access;
          return { ...e, access: !e.access };
        })
      );
      addNotification(
        blocked ? "warning" : "success",
        blocked ? `Access blocked for ${name}` : `Access granted for ${name}`
      );
    },
    [addNotification]
  );

  const toggleOvertime = useCallback(
    (name, on) => {
      setEmployees((prev) =>
        prev.map((e) => (e.name === name ? { ...e, overtime: on } : e))
      );
      addNotification(
        on ? "success" : "warning",
        on ? `Overtime approved for ${name}` : `Overtime rejected for ${name}`
      );
    },
    [addNotification]
  );

  const toggleAutoScale = useCallback(() => {
    setSettings((prev) => ({ ...prev, autoScale: !prev.autoScale }));
    addNotification(
      settings.autoScale ? "warning" : "success",
      settings.autoScale ? "Auto scale disabled" : "Auto scale enabled"
    );
  }, [settings.autoScale, addNotification]);

  const toggleEnginePaused = useCallback(() => {
    setSettings((prev) => ({ ...prev, enginePaused: !prev.enginePaused }));
    addNotification(
      settings.enginePaused ? "success" : "warning",
      settings.enginePaused ? "Engine resumed" : "Engine paused"
    );
  }, [settings.enginePaused, addNotification]);

  const updateSettings = useCallback((patch) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      localStorage.setItem("downscale-settings", JSON.stringify(next));
      return next;
    });
  }, []);

  const resetSettings = useCallback(() => {
    setSettings(defaultSettings);
    localStorage.removeItem("downscale-settings");
    addNotification("info", "Settings restored to defaults");
  }, [addNotification]);

  const stats = useMemo(
    () => ({
      running: workspaces.filter(
        (w) => w.status === "Running" || w.status === "Starting"
      ).length,
      sleeping: workspaces.filter(
        (w) => w.status === "Sleeping" || w.status === "Scaling"
      ).length,
      pendingOvertime: overtimeRequests.filter((r) => r.status === "pending").length,
      cloudSavings: savings.total,
    }),
    [workspaces, overtimeRequests, savings.total]
  );

  const value = useMemo(
    () => ({
      employees,
      employeesLoading,
      employeesError,
      loadEmployees,
      workspaces,
      overtimeRequests,
      notifications,
      metrics,
      stats,
      savings,
      savingsTrend,
      settings,
      addNotification,
      approveRequest,
      rejectRequest,
      changeShift,
      toggleAccess,
      toggleOvertime,
      doScale,
      doWake,
      doRestart,
      doDelete,
      toggleAutoScale,
      toggleEnginePaused,
      updateSettings,
      resetSettings,
    }),
    [
      employees,
      employeesLoading,
      employeesError,
      loadEmployees,
      workspaces,
      overtimeRequests,
      notifications,
      metrics,
      stats,
      savings,
      savingsTrend,
      settings,
      addNotification,
      approveRequest,
      rejectRequest,
      changeShift,
      toggleAccess,
      toggleOvertime,
      doScale,
      doWake,
      doRestart,
      doDelete,
      toggleAutoScale,
      toggleEnginePaused,
      updateSettings,
      resetSettings,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
