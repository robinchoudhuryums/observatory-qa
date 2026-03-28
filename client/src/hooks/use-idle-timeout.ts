import { useState, useEffect, useRef, useCallback } from "react";

const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const WARNING_DURATION_MS = 2 * 60 * 1000;
const TICK_INTERVAL_MS = 1000;

const ACTIVITY_EVENTS: Array<keyof DocumentEventMap> = [
  "mousedown", "keydown", "touchstart", "scroll", "click",
];

export interface IdleTimeoutState {
  isWarning: boolean;
  remainingSeconds: number;
  /** Call to dismiss the warning and reset the idle timer (HIPAA "Stay Logged In"). */
  stayLoggedIn: () => void;
}

export function useIdleTimeout(): IdleTimeoutState {
  const [isWarning, setIsWarning] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(Math.floor(WARNING_DURATION_MS / 1000));
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const warningDeadlineRef = useRef<number>(0);

  const clearTimers = useCallback(() => {
    if (idleTimerRef.current !== null) { clearTimeout(idleTimerRef.current); idleTimerRef.current = null; }
    if (countdownRef.current !== null) { clearInterval(countdownRef.current); countdownRef.current = null; }
  }, []);

  const performLogout = useCallback(async () => {
    clearTimers();
    try { await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }); } catch {}
    // Clear only auth-related storage, not user preferences (theme, tour state, etc.)
    sessionStorage.clear();
    window.location.href = "/auth";
  }, [clearTimers]);

  const startWarning = useCallback(() => {
    setIsWarning(true);
    warningDeadlineRef.current = Date.now() + WARNING_DURATION_MS;
    setRemainingSeconds(Math.floor(WARNING_DURATION_MS / 1000));
    countdownRef.current = setInterval(() => {
      const left = Math.max(0, Math.ceil((warningDeadlineRef.current - Date.now()) / 1000));
      setRemainingSeconds(left);
      if (left <= 0) performLogout();
    }, TICK_INTERVAL_MS);
  }, [performLogout]);

  const resetIdleTimer = useCallback(() => {
    clearTimers();
    setIsWarning(false);
    setRemainingSeconds(Math.floor(WARNING_DURATION_MS / 1000));
    idleTimerRef.current = setTimeout(() => { startWarning(); }, IDLE_TIMEOUT_MS);
  }, [clearTimers, startWarning]);

  useEffect(() => {
    resetIdleTimer();
    const handler = () => { resetIdleTimer(); };
    for (const event of ACTIVITY_EVENTS) document.addEventListener(event, handler, { passive: true });
    return () => {
      clearTimers();
      for (const event of ACTIVITY_EVENTS) document.removeEventListener(event, handler);
    };
  }, [resetIdleTimer, clearTimers]);

  return { isWarning, remainingSeconds, stayLoggedIn: resetIdleTimer };
}
