type SyncHandler = () => Promise<void>;

let scheduledSync: number | null = null;
let currentIntervalMs: number | null = null;
let currentHandler: SyncHandler | null = null;

/**
 * Schedules automatic sync at fixed intervals.
 * Uses setInterval for deterministic timing - the interval is measured
 * from the start of one sync to the start of the next, regardless of
 * how long the sync takes.
 *
 * If a sync is still running when the next tick fires, it will be skipped.
 *
 * @param handler Callback invoked when the scheduled sync fires.
 * @param intervalMs Interval in milliseconds between runs.
 */
export function scheduleAutoSync(handler: SyncHandler, intervalMs: number | undefined): void {
  // Validate interval
  if (!intervalMs || !Number.isFinite(intervalMs) || intervalMs <= 0) {
    cancelScheduledSync();
    return;
  }

  // If same handler and interval, no change needed
  if (scheduledSync !== null && currentIntervalMs === intervalMs && currentHandler === handler) {
    return;
  }

  // Cancel existing schedule before creating new one
  cancelScheduledSync();

  currentHandler = handler;
  currentIntervalMs = intervalMs;

  // Track if sync is currently running to prevent overlapping syncs
  let syncRunning = false;

  const tick = async () => {
    // Skip this tick if previous sync is still running
    if (syncRunning) {
      return;
    }

    syncRunning = true;
    try {
      await handler();
    } finally {
      syncRunning = false;
    }
  };

  // Use setInterval for deterministic timing
  scheduledSync = setInterval(tick, intervalMs) as unknown as number;
}

/**
 * Clears the pending sync interval when present.
 */
export function cancelScheduledSync(): void {
  if (scheduledSync !== null) {
    clearInterval(scheduledSync);
    scheduledSync = null;
  }
  currentIntervalMs = null;
  currentHandler = null;
}

/**
 * Gets current scheduler status for debugging.
 */
export function getSchedulerStatus(): { active: boolean; intervalMs: number | null } {
  return {
    active: scheduledSync !== null,
    intervalMs: currentIntervalMs,
  };
}
