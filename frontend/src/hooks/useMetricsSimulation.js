import { useEffect, useRef, useState } from "react";
import { clamp, randomDelta } from "../utils/format";

const INITIAL_METRICS = {
  cpu: 42,
  memory: 61,
  storage: 48,
  network: 35,
  requests: 120,
  history: {
    cpu: [32, 38, 35, 44, 41, 47, 42],
    memory: [55, 58, 52, 63, 60, 64, 61],
    network: [28, 34, 31, 40, 36, 38, 35],
    requests: [95, 110, 104, 128, 116, 122, 120],
  },
};

export default function useMetricsSimulation() {
  const [metrics, setMetrics] = useState(INITIAL_METRICS);
  const ref = useRef(metrics);

  useEffect(() => {
    ref.current = metrics;
  }, [metrics]);

  useEffect(() => {
    const timer = setInterval(() => {
      const prev = ref.current;
      const next = {
        cpu: clamp(prev.cpu + randomDelta(7), 8, 96),
        memory: clamp(prev.memory + randomDelta(5), 12, 96),
        storage: clamp(prev.storage + randomDelta(3), 10, 96),
        network: clamp(prev.network + randomDelta(9), 5, 98),
        requests: clamp(prev.requests + randomDelta(18), 40, 420),
      };
      setMetrics({
        ...next,
        history: {
          cpu: [...prev.history.cpu.slice(-19), next.cpu],
          memory: [...prev.history.memory.slice(-19), next.memory],
          network: [...prev.history.network.slice(-19), next.network],
          requests: [...prev.history.requests.slice(-19), next.requests],
        },
      });
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  return metrics;
}
