/**
 * Wall-clock scheduler utilities.
 *
 * Replaces setInterval-based scheduling (which drifts) with setTimeout chains
 * aligned to specific UTC hours. Each invocation computes the exact ms until
 * the next target hour and schedules accordingly.
 */
import { logger } from "../services/logger";

/**
 * Schedule a function to run daily at a specific UTC hour.
 * Returns a cleanup function that cancels the scheduled timer.
 *
 * On first call, computes the delay until the next occurrence of `utcHour`
 * (today if it hasn't passed yet, tomorrow otherwise). After each run,
 * re-schedules for the next day's occurrence to avoid drift.
 */
export function scheduleDaily(
  utcHour: number,
  fn: () => void | Promise<void>,
  label: string,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;

  function msUntilNextRun(): number {
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(utcHour, 0, 0, 0);
    if (next <= now) {
      // Already passed today — schedule for tomorrow
      next.setUTCDate(next.getUTCDate() + 1);
    }
    return next.getTime() - now.getTime();
  }

  function scheduleNext() {
    if (cancelled) return;
    const delayMs = msUntilNextRun();
    logger.info({ label, nextRunIn: `${Math.round(delayMs / 60_000)}m`, utcHour }, "Scheduled next run");
    timer = setTimeout(async () => {
      if (cancelled) return;
      try {
        await fn();
      } catch (err) {
        logger.error({ err, label }, "Scheduled task failed");
      }
      // Re-schedule for next day (don't use setInterval — avoids drift)
      scheduleNext();
    }, delayMs);
  }

  scheduleNext();

  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
}

/**
 * Schedule a function to run weekly on a specific UTC day and hour.
 * dayOfWeek: 0=Sunday, 1=Monday, ..., 6=Saturday.
 */
export function scheduleWeekly(
  dayOfWeek: number,
  utcHour: number,
  fn: () => void | Promise<void>,
  label: string,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;

  function msUntilNextRun(): number {
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(utcHour, 0, 0, 0);

    // Calculate days until target day
    let daysUntil = dayOfWeek - now.getUTCDay();
    if (daysUntil < 0 || (daysUntil === 0 && next <= now)) {
      daysUntil += 7;
    }
    next.setUTCDate(next.getUTCDate() + daysUntil);
    return next.getTime() - now.getTime();
  }

  function scheduleNext() {
    if (cancelled) return;
    const delayMs = msUntilNextRun();
    logger.info({ label, nextRunIn: `${Math.round(delayMs / 3_600_000)}h`, dayOfWeek, utcHour }, "Scheduled next run");
    timer = setTimeout(async () => {
      if (cancelled) return;
      try {
        await fn();
      } catch (err) {
        logger.error({ err, label }, "Scheduled task failed");
      }
      scheduleNext();
    }, delayMs);
  }

  scheduleNext();

  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
}

/**
 * Schedule a function to run hourly, aligned to the top of each UTC hour.
 *
 * Tier 0.5 of the CallAnalyzer adaptation plan. Used by the scheduled-reports
 * tick (generation + delivery), where running aligned to the hour makes
 * cross-instance behavior predictable in multi-instance deployments.
 *
 * On first call, computes the delay until the next top-of-hour and schedules
 * accordingly. After each run, re-schedules for the next hour to avoid drift.
 *
 * NOTE: in multi-instance deployments, every instance will fire concurrently
 * at the top of the hour. The downstream task should be idempotent (which
 * runScheduledReportsTick is, via its UNIQUE(orgId, reportType, periodStart)
 * guard).
 */
export function scheduleHourly(
  fn: () => void | Promise<void>,
  label: string,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;

  function msUntilNextRun(): number {
    const now = new Date();
    const next = new Date(now);
    // Top of the next hour
    next.setUTCHours(now.getUTCHours() + 1, 0, 0, 0);
    return next.getTime() - now.getTime();
  }

  function scheduleNext() {
    if (cancelled) return;
    const delayMs = msUntilNextRun();
    logger.info({ label, nextRunIn: `${Math.round(delayMs / 60_000)}m` }, "Scheduled next hourly run");
    timer = setTimeout(async () => {
      if (cancelled) return;
      try {
        await fn();
      } catch (err) {
        logger.error({ err, label }, "Scheduled hourly task failed");
      }
      scheduleNext();
    }, delayMs);
  }

  scheduleNext();

  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
}
