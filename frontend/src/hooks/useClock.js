import { useEffect, useState } from "react";
import { formatTime } from "../utils/format";

export default function useClock() {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return formatTime(now);
}
