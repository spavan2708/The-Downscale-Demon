import { useCallback, useEffect, useRef, useState } from "react";

export default function useWorkspaceEngine({
  seed,
  addNotification,
  onScaled,
  autoScale,
  enginePaused,
  idleTimeout,
}) {
  const [workspaces, setWorkspaces] = useState(seed);
  const ref = useRef(workspaces);

  useEffect(() => {
    ref.current = workspaces;
  }, [workspaces]);

  const doScale = useCallback(
    (id, source) => {
      const ws = ref.current.find((w) => w.id === id);
      if (!ws || ws.status === "Scaling" || ws.status === "Sleeping") return;

      setWorkspaces((prev) =>
        prev.map((w) => (w.id === id ? { ...w, status: "Scaling", idle: 0 } : w))
      );
      addNotification(
        "info",
        source === "auto"
          ? `${ws.name} idle limit reached — auto scale triggered`
          : `Workspace ${ws.name} scaling to zero`
      );

      setTimeout(() => {
        setWorkspaces((prev) =>
          prev.map((w) => (w.id === id ? { ...w, status: "Sleeping" } : w))
        );
        onScaled();
        addNotification("success", `Workspace ${ws.name} scaled to zero — ₹45 saved`);
      }, 1800);
    },
    [addNotification, onScaled]
  );

  const doWake = useCallback(
    (id) => {
      const ws = ref.current.find((w) => w.id === id);
      if (!ws || ws.status === "Starting" || ws.status === "Running") return;

      setWorkspaces((prev) =>
        prev.map((w) => (w.id === id ? { ...w, status: "Starting" } : w))
      );
      addNotification("info", `Waking workspace ${ws.name}`);

      setTimeout(() => {
        setWorkspaces((prev) =>
          prev.map((w) => (w.id === id ? { ...w, status: "Running", idle: 0 } : w))
        );
        addNotification("success", `Workspace ${ws.name} awakened`);
      }, 1600);
    },
    [addNotification]
  );

  const doRestart = useCallback(
    (id) => {
      const ws = ref.current.find((w) => w.id === id);
      if (!ws || ws.status === "Restarting") return;

      setWorkspaces((prev) =>
        prev.map((w) => (w.id === id ? { ...w, status: "Restarting" } : w))
      );
      addNotification("info", `Restarting workspace ${ws.name}`);

      setTimeout(() => {
        setWorkspaces((prev) =>
          prev.map((w) => (w.id === id ? { ...w, status: "Running", idle: 0 } : w))
        );
        addNotification("success", `Workspace ${ws.name} restarted`);
      }, 1500);
    },
    [addNotification]
  );

  const doDelete = useCallback(
    (id) => {
      const ws = ref.current.find((w) => w.id === id);
      if (!ws) return;
      setWorkspaces((prev) => prev.filter((w) => w.id !== id));
      addNotification("warning", `Workspace ${ws.name} deleted from cluster`);
    },
    [addNotification]
  );

  useEffect(() => {
    const timer = setInterval(() => {
      setWorkspaces((prev) =>
        prev.map((ws) => {
          if (ws.status !== "Running" && ws.status !== "Idle") return ws;
          const idle = ws.idle + 1;
          if (
            ws.status === "Idle" &&
            autoScale &&
            !enginePaused &&
            idle >= idleTimeout
          ) {
            doScale(ws.id, "auto");
            return { ...ws, status: "Scaling", idle: 0 };
          }
          return { ...ws, idle };
        })
      );
    }, 1000);
    return () => clearInterval(timer);
  }, [doScale, autoScale, enginePaused, idleTimeout]);

  return { workspaces, doScale, doWake, doRestart, doDelete };
}
