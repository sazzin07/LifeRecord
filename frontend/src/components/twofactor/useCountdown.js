import { useCallback, useEffect, useState } from "react";

/** Seconds left on a wait (the pause before another text message may be sent). `start(n)` begins counting down from n. */
export function useCountdown() {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return undefined;
    const timer = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [left]);
  const start = useCallback((seconds) => setLeft(Math.max(0, Math.ceil(seconds))), []);
  return [left, start];
}
